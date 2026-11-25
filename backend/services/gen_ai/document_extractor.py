"""Local document text extraction for knowledge base processing.

Extracts text from uploaded documents (PDF, DOCX, TXT, etc.) on the server
side, replacing the deprecated hosted Model Proxy Service (MPS).
"""

import os
from typing import Dict, Optional

from loguru import logger

# Supported file extensions and their descriptions
SUPPORTED_EXTENSIONS: Dict[str, str] = {
    ".pdf": "PDF document",
    ".docx": "Word document",
    ".doc": "Word document (legacy)",
    ".txt": "Plain text",
    ".md": "Markdown",
    ".csv": "CSV data",
    ".json": "JSON data",
    ".xml": "XML data",
    ".html": "HTML document",
    ".htm": "HTML document",
}


def extract_text_from_file(file_path: str) -> Optional[str]:
    """Extract text content from a document file.

    Args:
        file_path: Absolute path to the uploaded file.

    Returns:
        Extracted text string, or None if extraction failed.
    """
    ext = os.path.splitext(file_path)[1].lower()

    if ext not in SUPPORTED_EXTENSIONS:
        logger.warning(f"Unsupported file extension: {ext} ({file_path})")
        return None

    try:
        if ext == ".pdf":
            return _extract_pdf(file_path)
        elif ext in (".docx", ".doc"):
            return _extract_docx(file_path)
        elif ext in (".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm"):
            return _extract_plain_text(file_path)
        else:
            return None
    except Exception as e:
        logger.error(f"Failed to extract text from {file_path}: {e}", exc_info=True)
        return None


def _extract_pdf(file_path: str) -> str:
    """Extract text from a PDF using pypdf.

    Args:
        file_path: Path to the PDF file.

    Returns:
        Extracted text.
    """
    try:
        from pypdf import PdfReader
    except ImportError:
        logger.error("pypdf package is not installed.")
        return ""

    reader = PdfReader(file_path)
    pages = []
    for page_num, page in enumerate(reader.pages):
        text = page.extract_text()
        if text:
            pages.append(text)

    if not pages:
        logger.warning(f"No text extracted from PDF: {file_path}")

    return "\n\n".join(pages)


def _extract_docx(file_path: str) -> str:
    """Extract text from a DOCX file using python-docx.

    Args:
        file_path: Path to the DOCX file.

    Returns:
        Extracted text.
    """
    try:
        from docx import Document
    except ImportError:
        logger.error("python-docx package is not installed.")
        return ""

    doc = Document(file_path)
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    return "\n\n".join(paragraphs)


def _extract_plain_text(file_path: str) -> str:
    """Read a plain text file with encoding detection.

    Args:
        file_path: Path to the text file.

    Returns:
        File contents as a string.
    """
    # Try common encodings in order
    encodings = ["utf-8", "latin-1", "cp1252", "iso-8859-1"]

    for enc in encodings:
        try:
            with open(file_path, "r", encoding=enc) as f:
                return f.read()
        except UnicodeDecodeError:
            continue
        except Exception as e:
            logger.warning(f"Error reading {file_path} with {enc}: {e}")
            continue

    # Fallback: read with errors='replace'
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def chunk_text(text: str, max_tokens: int = 512, overlap_tokens: int = 64) -> list[str]:
    """Split text into overlapping chunks, approximately `max_tokens` long.

    Uses a simple token approximation (~4 chars per token) to split text into
    semantically sensible chunks at paragraph or sentence boundaries.

    Args:
        text: The full text to chunk.
        max_tokens: Maximum tokens per chunk (default 512).
        overlap_tokens: Number of tokens of overlap between consecutive chunks.

    Returns:
        List of chunk text strings.
    """
    if not text or not text.strip():
        return []

    # Approximate token count: ~4 characters per token for English text
    chars_per_token = 4
    max_chars = max_tokens * chars_per_token
    overlap_chars = overlap_tokens * chars_per_token

    # Split on double newlines first (paragraphs)
    paragraphs = text.split("\n\n")

    chunks: list[str] = []
    current_chunk: list[str] = []
    current_length = 0

    for para in paragraphs:
        para_stripped = para.strip()
        if not para_stripped:
            continue

        para_len = len(para_stripped)

        # If a single paragraph is longer than max_chars, split it on sentences
        if para_len > max_chars and not current_chunk:
            # Split long paragraph into sentence-level chunks
            sentence_chunks = _split_long_paragraph(para_stripped, max_chars, overlap_chars)
            chunks.extend(sentence_chunks)
            continue

        # If adding this paragraph would exceed max_chars, start a new chunk
        if current_length + para_len > max_chars and current_chunk:
            chunks.append("\n\n".join(current_chunk))
            # Carry overlap from the end of the previous chunk
            overlap_text = _get_overlap_text(current_chunk, overlap_chars)
            current_chunk = [overlap_text] if overlap_text else []
            current_length = len(overlap_text) if overlap_text else 0

        current_chunk.append(para_stripped)
        current_length += para_len

    # Don't forget the last chunk
    if current_chunk:
        chunks.append("\n\n".join(current_chunk))

    return chunks


def _split_long_paragraph(text: str, max_chars: int, overlap_chars: int) -> list[str]:
    """Split a very long paragraph into chunks at sentence boundaries."""
    import re

    # Split on period + space, question mark, exclamation mark (sentence boundaries)
    sentences = re.split(r"(?<=[.!?])\s+", text)
    sentences = [s.strip() for s in sentences if s.strip()]

    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    for sent in sentences:
        sent_len = len(sent)

        if current_len + sent_len > max_chars and current:
            chunks.append(" ".join(current))

            overlap_text = _get_overlap_text_sentences(current, overlap_chars)
            if overlap_text:
                current = [overlap_text]
                current_len = len(overlap_text)
            else:
                current = []
                current_len = 0

        # If a single sentence exceeds max_chars, split by char
        if sent_len > max_chars and not current:
            for i in range(0, sent_len, max_chars - overlap_chars):
                chunk = sent[i : i + max_chars]
                if chunk.strip():
                    chunks.append(chunk.strip())
            continue

        current.append(sent)
        current_len += sent_len

    if current:
        chunks.append(" ".join(current))

    return chunks


def _get_overlap_text(chunk_parts: list[str], overlap_chars: int) -> str:
    """Get text from the end of a chunk for overlap with the next chunk."""
    combined = "\n\n".join(chunk_parts)
    if len(combined) <= overlap_chars:
        # Entire chunk fits in overlap — use it all (still a valid overlap)
        return combined
    cutoff = len(combined) - overlap_chars
    # Try to break at a newline for cleanliness
    newline_pos = combined.find("\n", cutoff)
    if newline_pos != -1 and newline_pos < len(combined) - 10:
        return combined[newline_pos + 1 :]
    return combined[cutoff:]


def _get_overlap_text_sentences(sentences: list[str], overlap_chars: int) -> str:
    """Get text from the end of a sentence list for overlap."""
    combined = " ".join(sentences)
    if len(combined) <= overlap_chars:
        return combined
    cutoff = len(combined) - overlap_chars
    return combined[cutoff:]