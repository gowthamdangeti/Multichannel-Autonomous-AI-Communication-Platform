from fastapi import APIRouter, HTTPException, Depends
from app.schemas.auth import UserLogin, UserRegister, UserResponse, Token

router = APIRouter()

@router.post("/login", response_model=Token)
async def login(credentials: UserLogin):
    # Standard development authentication
    if credentials.email and credentials.password:
        return {
            "access_token": "mock-jwt-token-for-dev-autonomous-ai-os-session",
            "token_type": "bearer"
        }
    raise HTTPException(status_code=400, detail="Invalid credentials.")

@router.post("/register", response_model=UserResponse)
async def register(user_in: UserRegister):
    return {
        "id": "usr-dev-001",
        "email": user_in.email,
        "full_name": user_in.full_name,
        "role": "admin",
        "org_id": "org-dev-001",
        "is_active": True
    }

@router.get("/me", response_model=UserResponse)
async def get_current_user():
    return {
        "id": "usr-admin-001",
        "email": "admin@autonomous-ai-os.enterprise",
        "full_name": "Autonomous OS SuperAdmin",
        "role": "admin",
        "org_id": "org-enterprise-001",
        "is_active": True
    }
