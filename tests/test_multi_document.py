from io import BytesIO
from typing import Generator
import pytest
import pymupdf as fitz
from fastapi.testclient import TestClient

from backend.app.main import create_app


def create_test_pdf(text: str, title: str = "Test Doc") -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 100), f"# {title}", fontsize=18)
    page.insert_text((72, 140), text, fontsize=11)
    b = doc.tobytes()
    doc.close()
    return b


@pytest.fixture
def test_client() -> Generator[TestClient, None, None]:
    app = create_app()
    with TestClient(app) as client:
        yield client


def test_batch_upload_multiple_documents(test_client: TestClient):
    pdf1 = create_test_pdf("Quarterly revenue grew by 18 percent year over year.", "Doc Alpha")
    pdf2 = create_test_pdf("Supply chain logistics efficiency improved significantly.", "Doc Beta")

    files = [
        ("files", ("doc_alpha.pdf", BytesIO(pdf1), "application/pdf")),
        ("files", ("doc_beta.pdf", BytesIO(pdf2), "application/pdf")),
    ]

    res = test_client.post("/api/v1/documents/upload-batch", files=files)
    assert res.status_code == 201

    payload = res.json()["data"]
    assert payload["total_files"] == 2
    assert payload["successful_count"] >= 1
    assert len(payload["items"]) == 2

    batch_id = payload["batch_id"]
    status_res = test_client.get(f"/api/v1/documents/batch/{batch_id}")
    assert status_res.status_code == 200
    status_payload = status_res.json()["data"]
    assert status_payload["batch_id"] == batch_id


def test_batch_upload_duplicate_detection(test_client: TestClient):
    pdf = create_test_pdf("Unique invariant content for duplicate detection check.", "Doc Gamma")

    files_1 = [("files", ("doc_gamma.pdf", BytesIO(pdf), "application/pdf"))]
    res_1 = test_client.post("/api/v1/documents/upload-batch", files=files_1)
    assert res_1.status_code == 201

    files_2 = [("files", ("doc_gamma_copy.pdf", BytesIO(pdf), "application/pdf"))]
    res_2 = test_client.post("/api/v1/documents/upload-batch", files=files_2)
    assert res_2.status_code == 201
    payload_2 = res_2.json()["data"]
    assert payload_2["duplicate_count"] == 1
    assert payload_2["items"][0]["status"] == "Duplicate"


def test_cross_document_selective_search(test_client: TestClient):
    pdf_fin = create_test_pdf("Operating margin for enterprise cloud expanded by 4.2 percent.", "Finance Report")
    pdf_sec = create_test_pdf("Zero trust authentication protocols enforce cryptographic tokens.", "Security Whitepaper")

    files = [
        ("files", ("fin_report.pdf", BytesIO(pdf_fin), "application/pdf")),
        ("files", ("sec_whitepaper.pdf", BytesIO(pdf_sec), "application/pdf")),
    ]
    res_upload = test_client.post("/api/v1/documents/upload-batch", files=files)
    assert res_upload.status_code == 201
    items = res_upload.json()["data"]["items"]

    doc_fin_id = items[0]["document_id"]
    doc_sec_id = items[1]["document_id"]

    search_all = test_client.post(
        "/api/v1/search",
        json={"query": "operating margin cloud", "document_ids": None, "top_k": 5}
    )
    assert search_all.status_code == 200
    all_results = search_all.json()["data"]
    assert any(r["document_id"] == doc_fin_id for r in all_results)

    search_filtered = test_client.post(
        "/api/v1/search",
        json={"query": "operating margin cloud", "document_ids": [doc_sec_id], "top_k": 5}
    )
    assert search_filtered.status_code == 200
    filtered_results = search_filtered.json()["data"]
    for r in filtered_results:
        assert r["document_id"] == doc_sec_id


def test_search_aggregate_endpoint(test_client: TestClient):
    res = test_client.post(
        "/api/v1/search/aggregate",
        json={"query": "financial revenue operating margin", "top_k": 10}
    )
    assert res.status_code == 200
    payload = res.json()["data"]
    assert "evidence_aggregation" in payload
    assert "consensus_topics" in payload["evidence_aggregation"]
    assert "coverage_summary" in payload["evidence_aggregation"]
    assert "documents_searched" in payload
    assert "documents_matched" in payload


def test_analytics_summary_endpoint(test_client: TestClient):
    res = test_client.get("/api/v1/documents/analytics/summary")
    assert res.status_code == 200
    data = res.json()["data"]
    assert "total_documents" in data
    assert "total_chunks" in data
    assert "total_pages" in data
    assert "text_blocks" in data
    assert "average_parsing_accuracy" in data
    assert data["total_documents"] >= 1


def test_delete_document_and_purge_faiss_index(test_client: TestClient):
    unique_text = "Ephemeral document destined for deletion test sequence."
    pdf = create_test_pdf(unique_text, "Temporary Doc")

    res_upload = test_client.post(
        "/api/v1/documents/upload-batch",
        files=[("files", ("temp_doc.pdf", BytesIO(pdf), "application/pdf"))]
    )
    assert res_upload.status_code == 201
    item = res_upload.json()["data"]["items"][0]
    temp_doc_id = item["document_id"]

    search_before = test_client.post(
        "/api/v1/search",
        json={"query": "Ephemeral document destined for deletion", "document_ids": [temp_doc_id]}
    )
    assert search_before.status_code == 200
    assert len(search_before.json()["data"]) >= 1

    del_res = test_client.delete(f"/api/v1/documents/{temp_doc_id}")
    assert del_res.status_code == 200
    assert del_res.json()["data"]["deleted"] is True

    get_res = test_client.get(f"/api/v1/documents/{temp_doc_id}")
    assert get_res.status_code == 404

    search_after = test_client.post(
        "/api/v1/search",
        json={"query": "Ephemeral document destined for deletion", "document_ids": [temp_doc_id]}
    )
    assert search_after.status_code == 200
    assert len(search_after.json()["data"]) == 0
