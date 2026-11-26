import os
from pathlib import Path
import secrets
from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException, status
from backend.app.config import Settings, get_settings
from backend.app.schemas.common import BaseResponse
from backend.app.schemas.internal import InternalExtractRequest, InternalExtractResponse
from backend.app.services import DocumentService, get_document_service

router = APIRouter(prefix="/internal", tags=["Internal"])


def verify_internal_auth(
    x_internal_secret: Optional[str] = Header(None, alias="X-Internal-Secret"),
    authorization: Optional[str] = Header(None),
    settings: Settings = Depends(get_settings),
) -> bool:
    server_secret = (settings.internal_api_secret or "").strip()
    if not server_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server authentication misconfiguration: internal API secret is not configured",
        )
    provided = None
    if x_internal_secret:
        provided = x_internal_secret.strip()
    elif authorization:
        parts = authorization.strip().split(" ", 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            provided = parts[1].strip()
        else:
            provided = authorization.strip()
    if not provided or not secrets.compare_digest(provided, server_secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: invalid or missing internal secret",
        )
    return True


def validate_pdf_path(raw_path_str: str, upload_dir_str: str, repo_root: Path) -> Path:
    raw_path = Path(raw_path_str)
    base_dir = (repo_root / upload_dir_str).resolve()

    if os.path.islink(raw_path_str) or raw_path.is_symlink():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Symbolic links are strictly prohibited for internal file paths",
        )

    if raw_path.is_absolute():
        target = raw_path.resolve()
    else:
        try:
            rel = raw_path.relative_to("data/uploads")
            target = (base_dir / rel).resolve()
        except ValueError:
            try:
                rel = raw_path.relative_to("uploads")
                target = (base_dir / rel).resolve()
            except ValueError:
                target = (base_dir / raw_path).resolve()

    real_path = Path(os.path.realpath(str(target)))
    if os.path.islink(str(target)) or real_path != target or target.is_symlink():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Symbolic links are strictly prohibited for internal file paths",
        )

    try:
        real_path.relative_to(base_dir)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path traversal or symlink escape detected: file must reside inside uploads directory",
        )

    if real_path == base_dir:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path cannot be the uploads directory itself",
        )

    safe_name = raw_path.name

    if not real_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Target file does not exist: {safe_name}",
        )

    if not real_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Target path is not a regular file: {safe_name}",
        )

    if real_path.suffix.lower() != ".pdf":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file extension '{real_path.suffix}'. Only PDF files are supported.",
        )

    try:
        open_flags = os.O_RDONLY
        if hasattr(os, "O_NOFOLLOW"):
            open_flags |= os.O_NOFOLLOW
        if hasattr(os, "O_BINARY"):
            open_flags |= os.O_BINARY
        fd = os.open(str(real_path), open_flags)
        try:
            with os.fdopen(fd, "rb") as f:
                header = f.read(5)
        except Exception:
            raise
    except OSError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to securely read file: access denied or link encountered",
        )

    if not header.startswith(b"%PDF-"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid PDF binary header: file stream does not begin with '%PDF-'.",
        )

    return real_path


@router.post("/extract", response_model=BaseResponse[InternalExtractResponse])
def internal_extract(
    payload: InternalExtractRequest,
    authenticated: bool = Depends(verify_internal_auth),
    doc_service: DocumentService = Depends(get_document_service),
    settings: Settings = Depends(get_settings),
) -> BaseResponse[InternalExtractResponse]:
    validated_path = validate_pdf_path(payload.file_path, settings.upload_dir, doc_service.repo_root)
    result = doc_service.process_document_by_path(
        document_id=payload.document_id,
        file_path=validated_path,
        mode=payload.mode,
    )
    status_msg = "Document extraction completed successfully" if result.status == "processed" else "Document extraction completed with degraded status"
    return BaseResponse[InternalExtractResponse](
        status="success",
        message=status_msg,
        data=result,
    )
