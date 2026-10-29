"""Comprehensive Integration Tests for Retrieva AI FastAPI Service.

Tests:
1. Health & Metrics: model versions, config id, index size, last error, timing headers.
2. Ingestion & Upload Validation: real extraction, indexing, MIME type, size limit, page limit.
3. Page Layout Retrieval: 2D bounding boxes, recovered reading order, provenance hashes.
4. Multi-Modal Search: FAISS vector retrieval, table data parsing, confidence & degraded flagging.
5. Degraded Mode & Recovery Path: anomaly detection and accepted bundle reload.
"""

from io import BytesIO

import fitz  # pymupdf
from fastapi.testclient import TestClient

from backend.app.config import get_settings


def create_sample_pdf_bytes(num_pages: int = 1, text: str = "Test Content") -> bytes:
    """Helper creating real in-memory PDF binary bytes."""
    doc = fitz.open()
    for _ in range(num_pages):
        page = doc.new_page(width=800, height=1100)
        page.insert_text((50, 100), text, fontsize=12)
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


# ==============================================================================
# 1. Health and Metrics Payload Tests
# ==============================================================================


def test_health_metrics_payload(client: TestClient):
    """GET /api/v1/health must return metrics-style payload with model versions and index size."""
    settings = get_settings()
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    assert "X-Config-Version" in res.headers
    assert "X-Process-Time-Ms" in res.headers

    body = res.json()
    assert body["status"] in ("healthy", "success")
    data = body["data"]

    # Telemetry and model metadata
    assert data["config_id"] == settings.config_id
    assert data["config_version"] == settings.config_version
    assert "model_versions" in data
    assert "extractor" in data["model_versions"]
    assert "embedding" in data["model_versions"]
    assert "provenance_subsystem" in data["model_versions"]

    # Resource metrics
    assert data["index_size"] >= 5
    assert data["documents_count"] >= 3
    assert data["uptime_seconds"] >= 0.0
    assert data["last_error"] is None


# ==============================================================================
# 2. Ingestion & Validation Integration Tests
# ==============================================================================


def test_upload_valid_pdf_real_extraction_and_indexing(client: TestClient):
    """POST /api/v1/documents/upload must extract real elements and index them into FAISS."""
    pdf_content = create_sample_pdf_bytes(
        num_pages=2,
        text="Section 1.0 Enterprise Architecture Overview.\nRevenue projections and server clusters.",
    )
    files = {"file": ("architecture_report.pdf", BytesIO(pdf_content), "application/pdf")}

    res = client.post("/api/v1/documents/upload", files=files)
    assert res.status_code == 201
    assert "X-Process-Time-Ms" in res.headers

    payload = res.json()
    assert payload["status"] in ("success", "degraded")
    doc_data = payload["data"]
    assert doc_data["title"] == "architecture_report.pdf"
    assert doc_data["pages_count"] == 2
    assert doc_data["metrics"]["text_blocks"] >= 1
    assert doc_data["file_hash"] is not None


def test_upload_rejects_non_pdf_file_extension(client: TestClient):
    """Upload must reject files without .pdf extension with 400 Bad Request."""
    files = {"file": ("data_table.csv", BytesIO(b"col1,col2\nval1,val2"), "text/csv")}
    res = client.post("/api/v1/documents/upload", files=files)
    assert res.status_code == 400
    assert "Only PDF files are supported" in res.json()["detail"]


def test_upload_rejects_invalid_magic_bytes(client: TestClient):
    """Upload must reject fake PDF files lacking '%PDF-' magic header with 400 Bad Request."""
    fake_pdf = {"file": ("corrupt.pdf", BytesIO(b"NOT_A_REAL_PDF_STREAM"), "application/pdf")}
    res = client.post("/api/v1/documents/upload", files=fake_pdf)
    assert res.status_code == 400
    assert "Stream does not begin with '%PDF-'" in res.json()["detail"]


def test_upload_rejects_excessive_page_count(client: TestClient):
    """Upload must reject documents exceeding max_pages_per_document with 400 Bad Request."""
    # Create 105-page PDF
    large_pdf_bytes = create_sample_pdf_bytes(num_pages=105, text="Page content")
    files = {"file": ("giant_manual.pdf", BytesIO(large_pdf_bytes), "application/pdf")}

    res = client.post("/api/v1/documents/upload", files=files)
    assert res.status_code == 400
    assert "exceeds maximum allowed limit" in res.json()["detail"]


def test_upload_rejects_oversized_file(client: TestClient, monkeypatch):
    """Upload must reject files exceeding max_upload_size_mb with 413 Payload Too Large."""
    # Temporarily monkeypatch max_upload_size_mb to 0 for size trigger
    settings = get_settings()
    monkeypatch.setattr(settings, "max_upload_size_mb", 0)

    pdf_bytes = create_sample_pdf_bytes(num_pages=1, text="Oversized test")
    files = {"file": ("large.pdf", BytesIO(pdf_bytes), "application/pdf")}

    res = client.post("/api/v1/documents/upload", files=files)
    assert res.status_code == 413
    assert "exceeds maximum allowed size" in res.json()["detail"]


# ==============================================================================
# 3. Page Layout Retrieval Integration Tests
# ==============================================================================


def test_get_page_layout_segments_and_provenance(client: TestClient):
    """GET /api/v1/documents/{id}/pages/{n} must return real bounding boxes and reading order."""
    res = client.get("/api/v1/documents/doc-001/pages/1")
    assert res.status_code == 200
    assert "X-Config-Version" in res.headers
    assert "X-Process-Time-Ms" in res.headers

    payload = res.json()
    segments = payload["data"]
    assert len(segments) >= 3

    # Validate first segment structure
    first_seg = segments[0]
    assert "id" in first_seg
    assert "type" in first_seg
    assert "bbox" in first_seg
    assert first_seg["bbox"]["width"] > 0
    assert first_seg["bbox"]["height"] > 0
    assert "reading_order" in first_seg
    assert "confidence" in first_seg

    # Provenance audit trail must be present
    assert first_seg["provenance"] is not None
    assert "source_file_hash" in first_seg["provenance"]
    assert "page_number" in first_seg["provenance"]


def test_get_page_layout_out_of_bounds_404(client: TestClient):
    """Requesting an out-of-range page number must return 404 Not Found."""
    res = client.get("/api/v1/documents/doc-001/pages/999")
    assert res.status_code == 404
    assert "Page 999 not found" in res.json()["detail"]


def test_get_page_layout_unknown_document_404(client: TestClient):
    """Requesting an unknown document ID must return 404 Not Found."""
    res = client.get("/api/v1/documents/doc-unknown-999/pages/1")
    assert res.status_code == 404


# ==============================================================================
# 4. Search & Multi-Modal Retrieval Integration Tests
# ==============================================================================


def test_search_retrieves_relevant_table_with_markdown_topology(client: TestClient):
    """POST /api/v1/search must retrieve Enterprise Cloud table with parsed headers/rows."""
    req_body = {
        "query": "Enterprise Cloud revenue 2025 YoY Growth",
        "document_id": "All",
        "content_type": "All",
        "min_score": 0.30,
        "top_k": 5,
    }
    res = client.post("/api/v1/search", json=req_body)
    assert res.status_code == 200
    assert "X-Process-Time-Ms" in res.headers

    results = res.json()["data"]
    assert len(results) >= 1

    top_match = results[0]
    assert "document_title" in top_match
    assert "relevance_score" in top_match
    assert "reading_order" in top_match
    assert "confidence" in top_match

    # Verify structured table data when content_type is Table
    table_matches = [r for r in results if r["content_type"] == "Table"]
    if table_matches:
        t_match = table_matches[0]
        assert t_match["table_data"] is not None
        assert "headers" in t_match["table_data"]
        assert "rows" in t_match["table_data"]


def test_search_content_type_filtering(client: TestClient):
    """POST /api/v1/search with content_type='Table' must only return Table items."""
    req_body = {
        "query": "cloud infrastructure latency uptime",
        "content_type": "Table",
        "top_k": 5,
    }
    res = client.post("/api/v1/search", json=req_body)
    assert res.status_code == 200

    results = res.json()["data"]
    for r in results:
        assert r["content_type"] == "Table"


def test_search_document_id_filtering(client: TestClient):
    """POST /api/v1/search with document_id='doc-002' must only return results from doc-002."""
    req_body = {
        "query": "LayoutLMv3 multi-modal transformer spatial attention",
        "document_id": "doc-002",
        "top_k": 5,
    }
    res = client.post("/api/v1/search", json=req_body)
    assert res.status_code == 200

    results = res.json()["data"]
    for r in results:
        assert r["document_id"] == "doc-002"


# ==============================================================================
# 5. Degraded Mode & Recovery Path Integration Tests
# ==============================================================================


def test_degraded_flag_never_silent(client: TestClient):
    """Degraded results must carry is_degraded=True and diagnostic reasons rather than silent return."""
    req_body = {
        "query": "revenue",
        "top_k": 10,
    }
    res = client.post("/api/v1/search", json=req_body)
    assert res.status_code == 200

    results = res.json()["data"]
    for r in results:
        if r["is_degraded"]:
            assert len(r["degraded_reasons"]) > 0
            assert r["fallback_strategy"] is not None


def test_recovery_path_reload_accepted_bundle(client: TestClient):
    """POST /api/v1/health/reload must re-establish accepted configuration and reset degraded states."""
    res = client.post("/api/v1/health/reload")
    assert res.status_code == 200

    payload = res.json()
    assert payload["status"] == "success"
    data = payload["data"]
    assert data["degraded_mode_active"] is False
    assert data["reindexed_chunks"] >= 5

    # Verify health endpoint immediately reflects healthy state
    health_res = client.get("/api/v1/health")
    assert health_res.json()["data"]["status"] == "healthy"
    assert health_res.json()["data"]["degraded_mode_active"] is False
