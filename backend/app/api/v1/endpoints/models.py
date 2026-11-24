from typing import List, Dict, Any
from fastapi import APIRouter
from app.config import settings

router = APIRouter()

@router.get("/")
async def list_model_providers() -> List[Dict[str, Any]]:
    """List connected LLM and frontier reasoning providers."""
    return [
        {
            "provider": "openai",
            "name": "OpenAI",
            "models": ["gpt-4o", "gpt-4o-mini", "o1-preview", "o1-mini"],
            "configured": bool(settings.OPENAI_API_KEY),
            "status": "ready" if settings.OPENAI_API_KEY else "unconfigured"
        },
        {
            "provider": "gemini",
            "name": "Google Gemini",
            "models": ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-2.0-flash"],
            "configured": bool(settings.GEMINI_API_KEY),
            "status": "ready" if settings.GEMINI_API_KEY else "unconfigured"
        },
        {
            "provider": "anthropic",
            "name": "Anthropic Claude",
            "models": ["claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"],
            "configured": bool(settings.ANTHROPIC_API_KEY),
            "status": "ready" if settings.ANTHROPIC_API_KEY else "unconfigured"
        },
        {
            "provider": "groq",
            "name": "Groq LPU",
            "models": ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
            "configured": bool(settings.GROQ_API_KEY),
            "status": "ready" if settings.GROQ_API_KEY else "unconfigured"
        },
        {
            "provider": "deepseek",
            "name": "DeepSeek",
            "models": ["deepseek-chat", "deepseek-coder", "deepseek-reasoner"],
            "configured": bool(settings.DEEPSEEK_API_KEY),
            "status": "ready" if settings.DEEPSEEK_API_KEY else "unconfigured"
        }
    ]
