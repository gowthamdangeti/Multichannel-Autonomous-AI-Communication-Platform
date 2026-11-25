import io
import logging
from typing import Optional, Dict, Any
from minio import Minio
from minio.error import S3Error
from app.config import settings

logger = logging.getLogger(__name__)

class MinioStorageClient:
    """Manages persistent artifact storage in MinIO object storage."""

    def __init__(self):
        self.bucket_name = settings.MINIO_BUCKET_NAME
        self.endpoint = settings.MINIO_ENDPOINT
        try:
            self.client = Minio(
                endpoint=self.endpoint,
                access_key=settings.MINIO_ROOT_USER,
                secret_key=settings.MINIO_ROOT_PASSWORD,
                secure=settings.MINIO_SECURE
            )
            self._ensure_bucket()
        except Exception as e:
            logger.warning(f"Could not connect to MinIO on {self.endpoint}: {e}")
            self.client = None

    def _ensure_bucket(self):
        if self.client and not self.client.bucket_exists(self.bucket_name):
            self.client.make_bucket(self.bucket_name)
            logger.info(f"Created MinIO bucket [{self.bucket_name}].")

    async def upload_artifact(
        self,
        workflow_id: str,
        filename: str,
        content: str,
        content_type: str = "text/plain"
    ) -> Optional[str]:
        """Upload an autonomous artifact to MinIO and return its storage path."""
        if not self.client:
            return None

        object_name = f"{workflow_id}/{filename}"
        content_bytes = content.encode("utf-8")
        data_stream = io.BytesIO(content_bytes)

        try:
            self.client.put_object(
                bucket_name=self.bucket_name,
                object_name=object_name,
                data=data_stream,
                length=len(content_bytes),
                content_type=content_type
            )
            storage_path = f"s3://{self.bucket_name}/{object_name}"
            logger.info(f"Persisted artifact to MinIO: {storage_path}")
            return storage_path
        except Exception as e:
            logger.error(f"Failed to upload artifact to MinIO: {e}")
            return None

    def get_artifact(self, workflow_id: str, filename: str) -> Optional[str]:
        if not self.client:
            return None
        object_name = f"{workflow_id}/{filename}"
        try:
            response = self.client.get_object(self.bucket_name, object_name)
            return response.read().decode("utf-8")
        except Exception as e:
            logger.error(f"Failed to retrieve artifact from MinIO: {e}")
            return None

storage_client = MinioStorageClient()
