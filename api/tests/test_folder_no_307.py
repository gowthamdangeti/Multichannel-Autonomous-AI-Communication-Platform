from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.folder import router as folder_router
from api.routes.workflow_recording import router as recording_router
from api.services.auth.depends import get_user


def _make_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(folder_router, prefix="/api/v1")
    app.include_router(recording_router, prefix="/api/v1")
    app.dependency_overrides[get_user] = lambda: SimpleNamespace(
        id=1,
        selected_organization_id=11,
    )
    return app


def test_folder_post_without_trailing_slash_returns_200():
    app = _make_test_app()
    client = TestClient(app, follow_redirects=False)

    fake_folder = SimpleNamespace(
        id=10,
        name="Test Folder",
        created_at=datetime(2026, 9, 24, 12, 0, tzinfo=timezone.utc),
    )

    with patch("api.routes.folder.db_client") as mock_db:
        mock_db.create_folder = AsyncMock(return_value=fake_folder)

        # POST /api/v1/folder without trailing slash should return 200, NOT 307 redirect
        response = client.post("/api/v1/folder", json={"name": "Test Folder"})
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == 10
        assert data["name"] == "Test Folder"


def test_recording_get_without_trailing_slash_returns_200():
    app = _make_test_app()
    client = TestClient(app, follow_redirects=False)

    with patch("api.routes.workflow_recording.db_client") as mock_db:
        mock_db.get_recordings = AsyncMock(return_value=[])

        # GET /api/v1/workflow-recordings without trailing slash should return 200, NOT 307
        response = client.get("/api/v1/workflow-recordings")
        assert response.status_code == 200
        data = response.json()
        assert "recordings" in data
