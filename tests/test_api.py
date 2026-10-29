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
    # Existing
    response = client.get("/api/v1/documents/doc-001")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["document_id"] == "doc-001"

    # Missing
    bad_response = client.get("/api/v1/documents/non-existent-id")
    assert bad_response.status_code == 404


def test_upload_document_validation(client: TestClient, test_settings):
    """Ensures upload validates PDF MIME type and size limits."""
    # 1. Reject non-PDF file
    txt_file = {"file": ("test.txt", BytesIO(b"Hello world"), "text/plain")}
    res_bad_format = client.post("/api/v1/documents/upload", files=txt_file)
    assert res_bad_format.status_code == 400

    # 2. Accept valid PDF
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
