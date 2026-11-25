"""ARQ background task for processing knowledge base documents.

Downloads the uploaded file from S3, extracts text locally (using pypdf,
python-docx, or plain text reader), chunks it, generates embeddings via the
user's configured AI provider, and stores the chunks in the database.
"""

import os
import tempfile
from typing import Optional

from loguru import logger

from api.db import db_client
from api.services.gen_ai.document_extractor import extract_text_from_file, chunk_text
from api.services.storage import storage_fs

MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024


async def _get_embedding_service(user_id: int, organization_id: int):
    """Resolve and return the embedding service for the given user/org.

    Returns None if no embedding configuration is set up.
    """
    from api.services.configuration.ai_model_configuration import (
        apply_managed_embeddings_base_url,
        get_resolved_ai_model_configuration,
    )
    from api.services.configuration.registry import ServiceProviders
    from api.services.gen_ai import (
        AzureOpenAIEmbeddingService,
        OpenAIEmbeddingService,
    )
    from api.db.platform_client import platform_client
    from api.enums import OrganizationConfigurationKey
    from api.schemas.ai_model_configuration import OrganizationAIModelConfigurationV2

    resolved_config = await get_resolved_ai_model_configuration(
        user_id=user_id,
        organization_id=organization_id,
    )
    effective_config = resolved_config.effective

    if not effective_config.embeddings:
        # Fallback: check the default platform model configuration preset.
        # The admin's "Models & Keys" presets live here (e.g. Kira,
        # Grok). If one is marked default, use its embeddings config.
        default_preset = await platform_client.get_default_model_configuration()
        if default_preset and default_preset.config:
            try:
                parsed = OrganizationAIModelConfigurationV2.model_validate(
                    default_preset.config
                )
                if parsed.mode == "byok" and parsed.byok:
                    if parsed.byok.mode == "pipeline" and parsed.byok.pipeline:
                        effective_config.embeddings = parsed.byok.pipeline.embeddings
                    elif parsed.byok.mode == "realtime" and parsed.byok.realtime:
                        effective_config.embeddings = parsed.byok.realtime.embeddings
            except Exception:
                logger.warning(
                    "Failed to parse embeddings from default platform preset"
                )

    if not effective_config.embeddings:
        logger.error(
            f"No embedding config in effective config. "
            f"Config source={resolved_config.source}, "
            f"has_llm={bool(effective_config.llm)}, "
            f"has_tts={bool(effective_config.tts)}"
        )
        return None

    cfg = effective_config.embeddings
    provider = getattr(cfg, "provider", None)
    api_key = getattr(cfg, "api_key", None)
    model = getattr(cfg, "model", None)
    base_url = getattr(cfg, "base_url", None)

    logger.info(
        f"Resolved embedding config: provider={provider}, "
        f"model={model}, base_url={base_url}, "
        f"has_api_key={bool(api_key)}"
    )

    if not api_key:
        logger.error(
            f"Embedding config has no api_key for provider={provider}"
        )
        return None

    if provider == ServiceProviders.AZURE.value and getattr(cfg, "endpoint", None):
        return AzureOpenAIEmbeddingService(
            db_client=db_client,
            api_key=api_key,
            endpoint=cfg.endpoint,
            model_id=model or "text-embedding-3-small",
            api_version=getattr(cfg, "api_version", None) or "2024-02-15-preview",
        )
    else:
        resolved_base_url = apply_managed_embeddings_base_url(
            provider=provider,
            base_url=base_url,
        )
        return OpenAIEmbeddingService(
            db_client=db_client,
            api_key=api_key,
            model_id=model or "text-embedding-3-small",
            base_url=resolved_base_url,
        )


async def process_knowledge_base_document(
    ctx,
    document_id: int,
    s3_key: str,
    organization_id: int,
    created_by_provider_id: str,
    max_tokens: int = 128,
    retrieval_mode: str = "chunked",
):
    """Process a knowledge base document: download, extract, chunk, embed, store.

    Args:
        ctx: ARQ context
        document_id: Database ID of the document
        s3_key: S3 key where the file is stored
        organization_id: Organization ID
        created_by_provider_id: Uploading user's provider ID
        max_tokens: Maximum tokens per chunk (default 128)
        retrieval_mode: "chunked" for vector search or "full_document" for full text
    """
    logger.info(
        f"Processing knowledge base document: document_id={document_id}, "
        f"s3_key={s3_key}, org={organization_id}, mode={retrieval_mode}"
    )

    temp_file_path: Optional[str] = None

    try:
        await db_client.update_document_status(document_id, "processing")

        # ---- Step 1: Download from S3 ----
        filename = s3_key.split("/")[-1]
        file_extension = os.path.splitext(filename)[1] or ".bin"

        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=file_extension)
        temp_file_path = temp_file.name
        temp_file.close()

        logger.info(f"Downloading file from S3: {s3_key}")
        download_success = await storage_fs.adownload_file(s3_key, temp_file_path)
        if not download_success:
            raise Exception(f"Failed to download file from S3: {s3_key}")
        if not os.path.exists(temp_file_path):
            raise FileNotFoundError(f"Downloaded file not found: {temp_file_path}")

        file_size = os.path.getsize(temp_file_path)
        logger.info(f"Downloaded file size: {file_size} bytes")

        if file_size > MAX_FILE_SIZE_BYTES:
            error_message = (
                f"File size ({file_size / (1024 * 1024):.1f}MB) exceeds the "
                f"maximum allowed size of {MAX_FILE_SIZE_BYTES // (1024 * 1024)}MB."
            )
            logger.warning(f"Document {document_id}: {error_message}")
            await db_client.update_document_status(
                document_id, "failed", error_message=error_message
            )
            return

        # ---- Step 2: Compute file hash and MIME type ----
        file_hash = db_client.compute_file_hash(temp_file_path)
        mime_type = db_client.get_mime_type(temp_file_path)

        # ---- Step 3: Reject duplicates ----
        existing_doc = await db_client.get_document_by_hash(file_hash, organization_id)
        if existing_doc and existing_doc.id != document_id:
            error_message = (
                f"This file is a duplicate of '{existing_doc.filename}'. "
            )
            logger.warning(
                f"Duplicate document detected: {document_id} is duplicate of "
                f"{existing_doc.id} ({existing_doc.filename})"
            )
            await db_client.update_document_metadata(
                document_id,
                file_size_bytes=file_size,
                file_hash=file_hash,
                mime_type=mime_type,
            )
            await db_client.update_document_status(
                document_id,
                "failed",
                error_message=error_message,
                docling_metadata={
                    "duplicate_of": existing_doc.document_uuid,
                    "duplicate_filename": existing_doc.filename,
                },
            )
            return

        await db_client.update_document_metadata(
            document_id,
            file_size_bytes=file_size,
            file_hash=file_hash,
            mime_type=mime_type,
        )

        # ---- Step 4: Extract text locally ----
        logger.info(f"Extracting text from {filename} (type: {mime_type})")
        extracted_text = extract_text_from_file(temp_file_path)

        if not extracted_text or not extracted_text.strip():
            error_message = (
                f"Could not extract any text from '{filename}'. "
                f"The file may be empty, password-protected, or in an unsupported format."
            )
            logger.warning(f"Document {document_id}: {error_message}")
            await db_client.update_document_status(
                document_id, "failed", error_message=error_message
            )
            return

        logger.info(
            f"Extracted {len(extracted_text)} characters from {filename}"
        )

        # ---- Step 5: Full-document mode (store raw text, no chunking) ----
        if retrieval_mode == "full_document":
            await db_client.update_document_full_text(document_id, extracted_text)
            await db_client.update_document_status(
                document_id, "completed", total_chunks=1
            )
            logger.info(f"Document {document_id}: stored full text (no chunking)")
            return

        # ---- Step 6: Chunk the text ----
        chunks = chunk_text(extracted_text, max_tokens=max_tokens)
        if not chunks:
            error_message = "Text was empty after extraction; cannot chunk."
            logger.warning(f"Document {document_id}: {error_message}")
            await db_client.update_document_status(
                document_id, "failed", error_message=error_message
            )
            return

        logger.info(f"Split into {len(chunks)} chunks")

        # ---- Step 7: Generate embeddings ----
        from api.db.models import KnowledgeBaseChunkModel

        # Resolve the embedding service for the user who uploaded this document
        document = await db_client.get_document_by_id(document_id)
        if not document:
            raise Exception(f"Document {document_id} not found after creation")

        embedding_service = await _get_embedding_service(
            document.created_by, organization_id
        )
        if embedding_service is None:
            error_message = (
                "No embedding model configured. Please configure an embedding "
                "model in Settings > Model Configurations > Embedding "
                "and ensure it includes a valid API key."
            )
            logger.warning(f"Document {document_id}: {error_message}")

        model_id = embedding_service.get_model_id()
        embedding_dim = embedding_service.get_embedding_dimension()

        logger.info(
            f"Generating {embedding_dim}-dim embeddings via {model_id} "
            f"for {len(chunks)} chunks"
        )

        embeddings = await embedding_service.embed_texts(chunks)

        # ---- Step 8: Store chunks ----
        chunk_models = []
        for i, (chunk_text_str, embedding) in enumerate(zip(chunks, embeddings)):
            chunk_model = KnowledgeBaseChunkModel(
                document_id=document_id,
                organization_id=organization_id,
                chunk_text=chunk_text_str,
                contextualized_text=None,
                chunk_index=i,
                chunk_metadata={},
                embedding_model=model_id,
                embedding_dimension=embedding_dim,
                embedding=embedding,
                token_count=len(chunk_text_str) // 4,
            )
            chunk_models.append(chunk_model)

        await db_client.create_chunks_batch(chunk_models)

        await db_client.update_document_status(
            document_id,
            "completed",
            total_chunks=len(chunks),
            docling_metadata={
                "extraction_method": "local",
                "total_chars": len(extracted_text),
            },
        )

        logger.info(
            f"Document {document_id}: completed with {len(chunks)} chunks "
            f"({len(extracted_text)} chars, {model_id} embeddings)"
        )

    except Exception as e:
        logger.error(
            f"Error processing knowledge base document {document_id}: {e}",
            exc_info=True,
        )
        await db_client.update_document_status(
            document_id, "failed", error_message=str(e)
        )
        raise

    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
                logger.debug(f"Cleaned up temp file: {temp_file_path}")
            except Exception as e:
                logger.warning(f"Failed to clean up temp file {temp_file_path}: {e}")