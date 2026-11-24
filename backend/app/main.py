import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api.v1.api import api_router
from app.core.agents.registry import registry

# Configure logging
logging.basicConfig(
    level=logging.INFO if not settings.DEBUG else logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("autonomous_ai_os")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Autonomous AI OS Platform...")
    logger.info(f"Loaded {len(registry.list_all())} autonomous agents across departments.")
    yield
    logger.info("Gracefully shutting down Autonomous AI OS Platform.")

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Enterprise-grade Autonomous Multi-Agent AI Operating System",
    version="1.0.0",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    redoc_url=f"{settings.API_V1_STR}/redoc",
    lifespan=lifespan
)

# Set up CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API v1 Router
app.include_router(api_router, prefix=settings.API_V1_STR)

# Root redirection / status
@app.get("/", tags=["Root"])
async def root():
    return {
        "platform": settings.PROJECT_NAME,
        "status": "operational",
        "docs_url": f"{settings.API_V1_STR}/docs",
        "health_check": f"{settings.API_V1_STR}/health"
    }

# Real-time WebSocket connection for agent state and execution streaming
@app.websocket("/api/v1/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket client connected to real-time agent stream.")
    try:
        while True:
            data = await websocket.receive_text()
            # Echo heartbeat or task status
            await websocket.send_json({
                "type": "heartbeat",
                "message": "Connected to Autonomous AI OS event stream",
                "active_agents": len(registry.list_all()),
                "received": data
            })
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected.")
