@echo off
set DATABASE_URL=postgresql+asyncpg://postgres:postgres@127.0.0.1:5434/postgres
set REDIS_URL=redis://:redissecret@127.0.0.1:6379
set ENVIRONMENT=local
set DEPLOYMENT_MODE=oss
set MINIO_ENDPOINT=127.0.0.1:9000
set MINIO_PUBLIC_ENDPOINT=http://localhost:9000
set MINIO_ACCESS_KEY=minioadmin
set MINIO_SECRET_KEY=minioadmin
set MINIO_BUCKET=voice-audio
set MINIO_SECURE=false
set BACKEND_API_ENDPOINT=http://localhost:8000
set UI_APP_URL=http://localhost:3000
set LOG_LEVEL=DEBUG

"%~dp0..\venv\Scripts\python.exe" -m uvicorn api.app:app --reload --port 8000
