"""Retrieva AI — Multi-Modal Spatial Vector Search Endpoint.

Executes real dense FAISS retrieval with spatial coordinates, reading order,
and transparent degraded-mode flagging.
"""

from typing import List

from fastapi import APIRouter, Depends

from backend.app.schemas.common import (
    BaseResponse,
    MultiDocumentSearchResponse,
    SearchQueryRequest,
    SearchResultItem,
)
from backend.app.services import DocumentService, get_document_service

router = APIRouter(prefix="/search", tags=["Search"])


@router.post("", response_model=BaseResponse[List[SearchResultItem]])
def execute_search(
    payload: SearchQueryRequest,
    doc_service: DocumentService = Depends(get_document_service),
) -> BaseResponse[List[SearchResultItem]]:
    """Evaluates multi-modal spatial query across indexed document chunks using FAISS.

    Attaches 2D bounding boxes, recovered reading order, provenance hashes,
    and flags degraded extractions transparently.
    """
    results = doc_service.search(
        query=payload.query,
        document_id=payload.document_id,
        document_ids=payload.document_ids,
        content_type=payload.content_type,
        min_score=payload.min_score,
        top_k=payload.top_k or 10,
    )

    has_degraded = any(r.is_degraded for r in results)
    status_str = "degraded" if has_degraded else "success"
    message_str = (
        f"Query '{payload.query}' executed with {len(results)} matches (degraded items flagged)"
        if has_degraded
        else f"Query '{payload.query}' executed with {len(results)} matches"
    )

    return BaseResponse[List[SearchResultItem]](
        status=status_str,
        message=message_str,
        data=results,
    )


@router.post("/aggregate", response_model=BaseResponse[MultiDocumentSearchResponse])
def execute_aggregate_search(
    payload: SearchQueryRequest,
    doc_service: DocumentService = Depends(get_document_service),
) -> BaseResponse[MultiDocumentSearchResponse]:
    """Retrieves ranked multi-document chunks with cross-document consensus, divergences, and coverage."""
    res = doc_service.search_aggregate(
        query=payload.query,
        document_id=payload.document_id,
        document_ids=payload.document_ids,
        content_type=payload.content_type,
        min_score=payload.min_score,
        top_k=payload.top_k or 10,
    )

    return BaseResponse[MultiDocumentSearchResponse](
        status="success",
        message=f"Consolidated evidence across {len(res.documents_searched)} documents ({len(res.results)} matches)",
        data=res,
    )
