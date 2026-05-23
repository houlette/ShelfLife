import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import create_access_token, get_current_user, hash_password, verify_password
from db.database import get_db
from db.models import InviteCode, User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterBody(BaseModel):
    email: str
    password: str
    invite_code: str


@router.post("/register")
def register(body: RegisterBody, db: Session = Depends(get_db)):
    invite = db.query(InviteCode).filter(
        InviteCode.code == body.invite_code,
        InviteCode.used_by.is_(None),
    ).first()
    if not invite:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or already-used invite code")
    if invite.expires_at and invite.expires_at < datetime.utcnow():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invite code has expired")
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email already registered")

    user = User(
        email=body.email,
        hashed_pw=hash_password(body.password),
        display_name=body.email.split("@")[0],
        is_admin=False,
        created_at=datetime.utcnow(),
    )
    db.add(user)
    db.flush()
    invite.used_by = user.id
    invite.used_at = datetime.utcnow()
    db.commit()
    return {"access_token": create_access_token(user.id), "token_type": "bearer"}


@router.post("/token")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form.username).first()
    if not user or not verify_password(form.password, user.hashed_pw):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return {"access_token": create_access_token(user.id), "token_type": "bearer"}


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "display_name": current_user.display_name,
        "is_admin": current_user.is_admin,
    }


@router.post("/invites")
def create_invite(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not current_user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    code = secrets.token_urlsafe(32)
    db.add(InviteCode(code=code, created_by=current_user.id))
    db.commit()
    return {"code": code}


@router.get("/invites")
def list_invites(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not current_user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    return [
        {
            "id": i.id,
            "code": i.code,
            "created_by": i.created_by,
            "used": i.used_by is not None,
            "used_by": i.used_by,
            "used_at": str(i.used_at) if i.used_at else None,
            "expires_at": str(i.expires_at) if i.expires_at else None,
        }
        for i in db.query(InviteCode).all()
    ]
