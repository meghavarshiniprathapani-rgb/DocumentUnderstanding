"""Retrieva AI — Document Ingestion and Page Layout API Endpoints.

Implements real extraction, indexing, validation, and layout segment retrieval.
"""

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from backend.app.schemas.common import (
    BaseResponse,
    BatchUploadResponse,
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


@router.get("/analytics/summary", response_model=BaseResponse[Dict[str, Any]])
def get_analytics_summary(
    doc_service: DocumentService = Depends(get_document_service),
) -> BaseResponse[Dict[str, Any]]:
    """Returns actual real analytics aggregated across all active files in the repository."""
    data = doc_service.get_dashboard_analytics()
    return BaseResponse[Dict[str, Any]](
        status="success",
        message="Live analytics across real repository documents",
        data=data,
    )


@router.get("/batch/{batch_id}", response_model=BaseResponse[BatchUploadResponse])
def get_batch_status(
    batch_id: str,
    doc_service: DocumentService = Depends(get_document_service),
) -> BaseResponse[BatchUploadResponse]:
    """Retrieves processing progress and item statuses for a multi-document batch."""
    res = doc_service.get_batch_status(batch_id)
    if not res:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Batch with ID '{batch_id}' not found",
        )
    return BaseResponse[BatchUploadResponse](
        status="success",
        message=f"Batch '{batch_id}' retrieved ({res.successful_count} succeeded, {res.failed_count} failed)",
        data=res,
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
    pdf_path = getattr(doc_service, "document_paths", {}).get(document_id)
    if not pdf_path or not pdf_path.exists():
        doc_summary = doc_service.documents.get(document_id)
        is_user_upload = bool(doc_summary and doc_summary.category == "User Upload")
        upload_matches = sorted(
            (repo_root / "data" / "uploads").glob(f"{document_id}_*"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if is_user_upload and upload_matches:
            pdf_path = upload_matches[0]
        else:
            sample_path = repo_root / "data" / "sample_documents" / f"{document_id}.pdf"
            if sample_path.exists():
                pdf_path = sample_path
            elif upload_matches:
                pdf_path = upload_matches[0]

    if not pdf_path or not pdf_path.exists():
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


@router.post("/upload-batch", response_model=BaseResponse[BatchUploadResponse], status_code=status.HTTP_201_CREATED)
async def upload_documents_batch(
    files: List[UploadFile] = File(..., description="Batch of PDF document files"),
    doc_service: DocumentService = Depends(get_document_service),
) -> BaseResponse[BatchUploadResponse]:
    """Process multiple uploaded PDF files in a single batch operation with partial success tolerance."""
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No files provided in batch upload.")

    files_data = []
    for f in files:
        content = await f.read()
        files_data.append((f.filename or "uploaded.pdf", content))

    batch_result = doc_service.upload_batch(files_data)
    batch_status = "success" if batch_result.failed_count == 0 else "partial_success"
    batch_msg = (
        f"Batch processed: {batch_result.successful_count} succeeded, "
        f"{batch_result.failed_count} failed, {batch_result.duplicate_count} duplicate"
    )

    return BaseResponse[BatchUploadResponse](
        status=batch_status,
        message=batch_msg,
        data=batch_result,
    )


@router.delete("/{document_id}", response_model=BaseResponse[Dict[str, Any]])
def delete_document(
    document_id: str,
    doc_service: DocumentService = Depends(get_document_service),
) -> BaseResponse[Dict[str, Any]]:
    """Eradicates a document, its disk file, segments, and all associated FAISS vectors."""
    res = doc_service.delete_document(document_id)
    return BaseResponse[Dict[str, Any]](
        status="success",
        message=f"Document '{document_id}' deleted and purged from vector index.",
        data=res,
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
