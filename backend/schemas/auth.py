from pydantic import BaseModel, EmailStr, field_validator


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    first_name: str | None = None
    last_name: str | None = None
    country: str | None = None
    phone_number: str | None = None
    name: str | None = None
    selected_plan_id: int | None = None


    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    otp: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class MessageResponse(BaseModel):
    message: str


class TwoFactorCodeRequest(BaseModel):
    otp: str


class RecoveryCodesResponse(BaseModel):
    recovery_codes: list[str]


class RecoveryStatusResponse(BaseModel):
    remaining: int
    generated_at: str | None = None


class Login2FARequest(BaseModel):
    email: EmailStr
    otp: str


class LoginRecoveryRequest(BaseModel):
    email: EmailStr
    password: str
    code: str


class UserResponse(BaseModel):
    id: int
    email: str | None
    email_verified: bool = False
    name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    avatar_key: str | None = None
    avatar_url: str | None = None
    country: str | None = None
    phone_number: str | None = None
    organization_id: int | None = None
    provider_id: str | None = None
    is_superuser: bool = False
    is_2fa_enabled: bool = False


class GoogleLoginRequest(BaseModel):
    credential: str


class AuthResponse(BaseModel):
    token: str | None = None
    user: UserResponse | None = None
    requires_2fa: bool = False
    message: str | None = None

