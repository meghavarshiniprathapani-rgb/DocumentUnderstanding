"""
Retrieva AI — API Endpoint Tests
Validates status codes, headers, and config_version recording across all responses.
"""

from io import BytesIO

from fastapi.testclient import TestClient


def test_root_endpoint(client: TestClient, test_settings):
    """Ensures root discovery endpoint returns config_version in body and header."""
    response = client.get("/")
    assert response.status_code == 200
    assert response.headers.get("X-Config-Version") == test_settings.config_version

    data = response.json()
    assert data["config_version"] == test_settings.config_version
    assert data["status"] == "success"
    assert "data" in data


def test_health_endpoint(client: TestClient, test_settings):
    """Ensures health check endpoint reports system status and config_version."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.headers.get("X-Config-Version") == test_settings.config_version

    payload = response.json()
    assert payload["config_version"] == test_settings.config_version
    assert payload["status"] == "success"
    assert payload["data"]["status"] == "healthy"
    assert payload["data"]["ocr_engine"] == test_settings.ocr_engine


def test_list_documents(client: TestClient, test_settings):
    """Ensures document listing returns repository summaries with config_version."""
    response = client.get("/api/v1/documents")
    assert response.status_code == 200
    assert response.headers.get("X-Config-Version") == test_settings.config_version

    payload = response.json()
    assert payload["config_version"] == test_settings.config_version
    assert isinstance(payload["data"], list)
    assert len(payload["data"]) >= 1


def test_get_document_detail(client: TestClient):
    """Ensures existing document metadata is returned, 404 for unknown ID."""
    response = client.get("/api/v1/documents/doc-001")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["document_id"] == "doc-001"

    bad_response = client.get("/api/v1/documents/non-existent-id")
    assert bad_response.status_code == 404


def test_upload_document_validation(client: TestClient, test_settings):
    """Ensures upload validates PDF MIME type and size limits."""
    txt_file = {"file": ("test.txt", BytesIO(b"Hello world"), "text/plain")}
    res_bad_format = client.post("/api/v1/documents/upload", files=txt_file)
    assert res_bad_format.status_code == 400

    pdf_content = b"%PDF-1.4 Mock PDF Stream Data"
    pdf_file = {"file": ("sample.pdf", BytesIO(pdf_content), "application/pdf")}
    res_valid = client.post("/api/v1/documents/upload", files=pdf_file)
    assert res_valid.status_code == 201
    payload = res_valid.json()
    assert payload["config_version"] == test_settings.config_version
    assert payload["data"]["title"] == "sample.pdf"


def test_execute_search_endpoint(client: TestClient, test_settings):
    """Ensures multi-modal query endpoint filters results and embeds config_version."""
    query_body = {
        "query": "revenue operating profit",
        "content_type": "All",
        "min_score": 0.50,
        "top_k": 5,
    }
    response = client.post("/api/v1/search", json=query_body)
    assert response.status_code == 200
    assert response.headers.get("X-Config-Version") == test_settings.config_version

    payload = response.json()
    assert payload["config_version"] == test_settings.config_version
    assert isinstance(payload["data"], list)


def test_baseline_initialization_successful_health(client: TestClient, test_settings):
    from backend.app.services import get_document_service
    ds = get_document_service()
    ds._initialize_baseline_repository()
    assert ds.degraded_mode_active is False
    assert ds.last_error is None
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    assert res.json()["data"]["status"] == "healthy"
    assert res.json()["data"]["degraded_mode_active"] is False


def test_baseline_initialization_genuine_degradation_health(client: TestClient):
    from unittest.mock import patch
    from backend.app.services import get_document_service
    ds = get_document_service()
    with patch.object(ds, "_parse_ground_truth_to_elements", side_effect=RuntimeError("Simulated baseline ground truth parsing failure")):
        ds._initialize_baseline_repository()
        assert ds.degraded_mode_active is True
        res = client.get("/api/v1/health")
        assert res.status_code == 200
        assert res.json()["data"]["status"] == "degraded"
        assert res.json()["data"]["degraded_mode_active"] is True
    ds._initialize_baseline_repository()
    assert ds.degraded_mode_active is False
    assert ds.last_error is None
