"""Retrieva AI — Document Ingestion and Page Layout API Endpoints.

Implements real extraction, indexing, validation, and layout segment retrieval.
"""

from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from backend.app.schemas.common import (
    BaseResponse,
    DocumentSummary,
    SegmentSchema,
)
from backend.app.services import DocumentService, get_document_service

router = APIRouter(prefix="/documents", tags=["Documents"])


@router.get("", response_model=BaseResponse[List[DocumentSummary]])
def list_documents(
    doc_service: DocumentService = Depends(get_document_service),
) -> BaseResponse[List[DocumentSummary]]:
    """Returns all real indexed documents currently registered in the repository."""
    docs = list(doc_service.documents.values())
    return BaseResponse[List[DocumentSummary]](
        status="success",
        message=f"Retrieved {len(docs)} repository documents",
        data=docs,
    )


@router.get("/{document_id}", response_model=BaseResponse[DocumentSummary])
def get_document(
    document_id: str,
    doc_service: DocumentService = Depends(get_document_service),
) -> BaseResponse[DocumentSummary]:
    """Fetches metadata for a specific document by its ID."""
    if document_id not in doc_service.documents:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Document with ID '{document_id}' not found",
        )
    return BaseResponse[DocumentSummary](
        status="success",
        data=doc_service.documents[document_id],
    )


@router.get("/{document_id}/file")
def get_document_file(
    document_id: str,
    doc_service: DocumentService = Depends(get_document_service),
):
    """Streams the raw PDF document binary for rendering in PDF.js."""
    from fastapi.responses import FileResponse

    repo_root = doc_service.repo_root
    pdf_path = repo_root / "data" / "sample_documents" / f"{document_id}.pdf"
    if not pdf_path.exists():
        upload_matches = list((repo_root / "data" / "uploads").glob(f"{document_id}_*"))
        if upload_matches:
            pdf_path = upload_matches[0]

    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail=f"PDF binary for '{document_id}' not found")

    return FileResponse(
        path=pdf_path,
        media_type="application/pdf",
        filename=f"{document_id}.pdf",
    )


@router.post("/upload", response_model=BaseResponse[DocumentSummary], status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(..., description="PDF document binary stream"),
    doc_service: DocumentService = Depends(get_document_service),
) -> BaseResponse[DocumentSummary]:
    """Validates PDF size, type, page count, and executes real extraction, layout recovery, and indexing."""
    filename = file.filename or "uploaded_document.pdf"
    content = await file.read()

    summary = doc_service.upload_document(file_bytes=content, filename=filename)

    status_msg = (
        "Document uploaded, extracted, and indexed with degraded warnings"
        if summary.is_degraded
        else "Document uploaded, extracted, and indexed successfully"
    )
    return BaseResponse[DocumentSummary](
        status="degraded" if summary.is_degraded else "success",
        message=status_msg,
        data=summary,
    )


@router.get("/{document_id}/pages/{page_number}", response_model=BaseResponse[List[SegmentSchema]])
def get_page_layout(
    document_id: str,
    page_number: int,
    doc_service: DocumentService = Depends(get_document_service),
) -> BaseResponse[List[SegmentSchema]]:
    """Returns real 2D bounding boxes, recovered reading order, and provenance for a specified page."""
    segments = doc_service.get_page_layout(document_id=document_id, page_number=page_number)
    return BaseResponse[List[SegmentSchema]](
        status="success",
        message=f"Retrieved {len(segments)} layout segments for page {page_number}",
        data=segments,
    )
