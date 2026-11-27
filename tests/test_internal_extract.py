from pathlib import Path
from unittest.mock import patch

import pymupdf as fitz
import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings, get_settings
from backend.app.main import app


@pytest.fixture(scope="module")
def client() -> TestClient:
    from backend.app.services import get_document_service
    with TestClient(app) as test_client:
        doc_service = get_document_service()
        prior_last_error = doc_service.last_error
        try:
            yield test_client
        finally:
            doc_service.last_error = prior_last_error


@pytest.fixture(scope="module")
def settings() -> Settings:
    return get_settings()


@pytest.fixture(scope="module")
def valid_pdf_path() -> Path:
    repo_root = Path(__file__).resolve().parent.parent
    upload_dir = repo_root / "data" / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    sample_file = upload_dir / "test_m164_sample.pdf"

    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), "Retrieva AI Extraction Test Document Heading", fontsize=18)
    page.insert_text((72, 120), "This is a paragraph of extracted text for internal endpoint verification.", fontsize=12)
    doc.save(str(sample_file))
    doc.close()

    yield sample_file

    if sample_file.exists():
        try:
            sample_file.unlink()
        except OSError:
            pass


def test_successful_extraction_and_doc_id_preservation(client: TestClient, settings: Settings, valid_pdf_path: Path):
    doc_id = "doc-test-m164-001"
    payload = {
        "document_id": doc_id,
        "file_path": str(valid_pdf_path),
        "mode": "flat",
    }
    headers = {"X-Internal-Secret": settings.internal_api_secret}
    response = client.post("/api/v1/internal/extract", json=payload, headers=headers)

    assert response.status_code == 200
    res = response.json()
    assert res["status"] == "success"
    assert res["config_version"] == settings.config_version

    data = res["data"]
    assert data["document_id"] == doc_id
    assert data["mode"] == "flat"
    assert data["status"] in ("processed", "degraded")
    assert data["page_count"] >= 1
    assert len(data["elements"]) >= 1
    assert data["indexing_status"] == "Indexed"
    assert "extractor" in data
    assert "model_versions" in data
    assert isinstance(data["extraction_warnings"], list)

    elem = data["elements"][0]
    assert "page" in elem
    assert "type" in elem
    assert "reading_order" in elem
    assert "text" in elem
    assert "bbox" in elem
    assert "raw_confidence" in elem
    assert "model_version" in elem


def test_all_four_supported_modes(client: TestClient, settings: Settings, valid_pdf_path: Path):
    modes = ["flat", "reference", "candidate", "candidate_ft"]
    headers = {"X-Internal-Secret": settings.internal_api_secret}

    for idx, mode in enumerate(modes):
        doc_id = f"doc-test-mode-{idx}"
        payload = {
            "document_id": doc_id,
            "file_path": str(valid_pdf_path),
            "mode": mode,
        }
        response = client.post("/api/v1/internal/extract", json=payload, headers=headers)
        assert response.status_code == 200
        res = response.json()
        assert res["data"]["mode"] == mode
        assert res["data"]["document_id"] == doc_id


def test_invalid_authentication(client: TestClient, settings: Settings, valid_pdf_path: Path):
    payload = {
        "document_id": "doc-test-auth",
        "file_path": str(valid_pdf_path),
        "mode": "flat",
    }

    resp_no_auth = client.post("/api/v1/internal/extract", json=payload)
    assert resp_no_auth.status_code == 401

    resp_bad_header = client.post(
        "/api/v1/internal/extract",
        json=payload,
        headers={"X-Internal-Secret": "wrong-secret-token"},
    )
    assert resp_bad_header.status_code == 401

    resp_bad_bearer = client.post(
        "/api/v1/internal/extract",
        json=payload,
        headers={"Authorization": "Bearer wrong-secret-token"},
    )
    assert resp_bad_bearer.status_code == 401

    resp_valid_bearer = client.post(
        "/api/v1/internal/extract",
        json=payload,
        headers={"Authorization": f"Bearer {settings.internal_api_secret}"},
    )
    assert resp_valid_bearer.status_code == 200


def test_path_traversal_rejection(client: TestClient, settings: Settings):
    headers = {"X-Internal-Secret": settings.internal_api_secret}

    traversal_paths = [
        "../../backend/src/server.js",
        "data/uploads/../../package.json",
        "../requirements.txt",
    ]

    for p in traversal_paths:
        payload = {
            "document_id": "doc-test-traversal",
            "file_path": p,
            "mode": "flat",
        }
        resp = client.post("/api/v1/internal/extract", json=payload, headers=headers)
        assert resp.status_code == 400


def test_symbolic_link_escape_rejection(client: TestClient, settings: Settings, valid_pdf_path: Path):
    headers = {"X-Internal-Secret": settings.internal_api_secret}
    payload = {
        "document_id": "doc-test-symlink",
        "file_path": str(valid_pdf_path),
        "mode": "flat",
    }
    with patch.object(Path, "is_symlink", return_value=True):
        resp = client.post("/api/v1/internal/extract", json=payload, headers=headers)
        assert resp.status_code == 400
        detail_msg = resp.json().get("detail", "")
        assert "Symbolic links are strictly prohibited" in detail_msg


def test_missing_file_handling(client: TestClient, settings: Settings):
    headers = {"X-Internal-Secret": settings.internal_api_secret}
    payload = {
        "document_id": "doc-test-missing",
        "file_path": "data/uploads/definitely_nonexistent_doc_9999.pdf",
        "mode": "flat",
    }
    resp = client.post("/api/v1/internal/extract", json=payload, headers=headers)
    assert resp.status_code == 404


def test_invalid_pdf_magic_bytes(client: TestClient, settings: Settings):
    headers = {"X-Internal-Secret": settings.internal_api_secret}
    repo_root = Path(__file__).resolve().parent.parent
    fake_pdf = repo_root / "data" / "uploads" / "test_fake_file.pdf"
    fake_pdf.write_bytes(b"NOT A REAL PDF FILE CONTENT 1234567890")

    try:
        payload = {
            "document_id": "doc-test-fake",
            "file_path": str(fake_pdf),
            "mode": "flat",
        }
        resp = client.post("/api/v1/internal/extract", json=payload, headers=headers)
        assert resp.status_code == 400
    finally:
        if fake_pdf.exists():
            fake_pdf.unlink()


def test_unsupported_mode_rejection(client: TestClient, settings: Settings, valid_pdf_path: Path):
    headers = {"X-Internal-Secret": settings.internal_api_secret}
    payload = {
        "document_id": "doc-test-bad-mode",
        "file_path": str(valid_pdf_path),
        "mode": "unsupported_arm_xyz",
    }
    resp = client.post("/api/v1/internal/extract", json=payload, headers=headers)
    assert resp.status_code == 422


def test_empty_document_id_rejection(client: TestClient, settings: Settings, valid_pdf_path: Path):
    headers = {"X-Internal-Secret": settings.internal_api_secret}
    payload = {
        "document_id": "   ",
        "file_path": str(valid_pdf_path),
        "mode": "flat",
    }
    resp = client.post("/api/v1/internal/extract", json=payload, headers=headers)
    assert resp.status_code == 422


def test_extraction_exception_handling(client: TestClient, settings: Settings, valid_pdf_path: Path):
    headers = {"X-Internal-Secret": settings.internal_api_secret}
    payload = {
        "document_id": "doc-test-exception",
        "file_path": str(valid_pdf_path),
        "mode": "flat",
    }

    with patch("backend.extractors.pdfplumber_extractor.PdfPlumberExtractor.extract", side_effect=RuntimeError("Simulated OCR core failure")):
        resp = client.post("/api/v1/internal/extract", json=payload, headers=headers)
        assert resp.status_code == 500
        res = resp.json()
        error_msg = res.get("detail", res.get("message", ""))
        assert "Simulated OCR core failure" in error_msg


def test_empty_extraction_result(client: TestClient, settings: Settings, valid_pdf_path: Path):
    headers = {"X-Internal-Secret": settings.internal_api_secret}
    payload = {
        "document_id": "doc-test-empty-result",
        "file_path": str(valid_pdf_path),
        "mode": "flat",
    }

    with patch("backend.extractors.pdfplumber_extractor.PdfPlumberExtractor.extract", return_value=[]):
        resp = client.post("/api/v1/internal/extract", json=payload, headers=headers)
        assert resp.status_code == 422


def test_repeated_request_behavior(client: TestClient, settings: Settings, valid_pdf_path: Path):
    headers = {"X-Internal-Secret": settings.internal_api_secret}
    doc_id = "doc-test-repeated-001"
    payload = {
        "document_id": doc_id,
        "file_path": str(valid_pdf_path),
        "mode": "flat",
    }

    resp1 = client.post("/api/v1/internal/extract", json=payload, headers=headers)
    assert resp1.status_code == 200

    resp2 = client.post("/api/v1/internal/extract", json=payload, headers=headers)
    assert resp2.status_code == 200
    data2 = resp2.json()["data"]
    assert data2["document_id"] == doc_id
    assert data2["indexing_status"] == "Indexed"


def test_existing_public_upload_endpoint_regression(client: TestClient):
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), "Public Upload Endpoint Regression Check", fontsize=14)
    pdf_bytes = doc.tobytes()
    doc.close()

    files = {"file": ("regression_check_doc.pdf", pdf_bytes, "application/pdf")}
    resp = client.post("/api/v1/documents/upload", files=files)
    assert resp.status_code in (200, 201)
    res = resp.json()
    assert res["status"] == "success"
    assert "document_id" in res["data"]


def test_fail_closed_server_secret_misconfiguration(client: TestClient, valid_pdf_path: Path):
    payload = {
        "document_id": "doc-test-misconfig",
        "file_path": str(valid_pdf_path),
        "mode": "flat",
    }
    from backend.app.config import get_settings
    from backend.app.main import app
    app.dependency_overrides[get_settings] = lambda: Settings(internal_api_secret="")
    try:
        resp = client.post("/api/v1/internal/extract", json=payload, headers={"X-Internal-Secret": "any-token"})
        assert resp.status_code == 500
        assert "Server authentication misconfiguration" in resp.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_settings, None)


def test_faiss_failure_rollback_atomicity(client: TestClient, settings: Settings, valid_pdf_path: Path):
    from backend.app.services import get_document_service
    doc_service = get_document_service()
    initial_chunks_count = len(doc_service.all_chunks)

    headers = {"X-Internal-Secret": settings.internal_api_secret}
    payload = {
        "document_id": "doc-test-faiss-rollback",
        "file_path": str(valid_pdf_path),
        "mode": "flat",
    }

    with patch.object(doc_service.retriever, "index", side_effect=RuntimeError("Simulated FAISS index allocation failure")):
        resp = client.post("/api/v1/internal/extract", json=payload, headers=headers)
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["indexing_status"] == "Failed"
        assert data["status"] == "degraded"
        assert data["indexing_diagnostics"] is not None
        assert data["indexing_diagnostics"]["latest_version_indexed"] is False
        assert data["indexing_diagnostics"]["previous_version_searchable"] is False
        assert data["indexing_diagnostics"]["searchable"] is False
        assert any("FAISS indexing failed" in w for w in data["extraction_warnings"])
        assert len(doc_service.all_chunks) == initial_chunks_count


def test_mode_divergence_behavior(client: TestClient, settings: Settings, valid_pdf_path: Path):
    headers = {"X-Internal-Secret": settings.internal_api_secret}

    resp_flat = client.post(
        "/api/v1/internal/extract",
        json={"document_id": "doc-test-divergence-flat", "file_path": str(valid_pdf_path), "mode": "flat"},
        headers=headers,
    )
    assert resp_flat.status_code == 200
    data_flat = resp_flat.json()["data"]
    assert data_flat["model_versions"]["layout_engine"] == "None:NaiveOrder"
    assert data_flat["model_versions"]["provenance_subsystem"] == "None:Uncalibrated"
    assert all(e["calibrated_confidence"] is None for e in data_flat["elements"])

    resp_ref = client.post(
        "/api/v1/internal/extract",
        json={"document_id": "doc-test-divergence-ref", "file_path": str(valid_pdf_path), "mode": "reference"},
        headers=headers,
    )
    assert resp_ref.status_code == 200
    data_ref = resp_ref.json()["data"]
    assert data_ref["model_versions"]["layout_engine"] == "LayoutOrderRecovery:v1.0.0"
    assert data_ref["model_versions"]["provenance_subsystem"] == "None:Uncalibrated"
    assert all(e["calibrated_confidence"] is None for e in data_ref["elements"])

    resp_cand = client.post(
        "/api/v1/internal/extract",
        json={"document_id": "doc-test-divergence-cand", "file_path": str(valid_pdf_path), "mode": "candidate"},
        headers=headers,
    )
    assert resp_cand.status_code == 200
    data_cand = resp_cand.json()["data"]
    assert data_cand["model_versions"]["layout_engine"] == "LayoutOrderRecovery:v1.0.0"
    assert data_cand["model_versions"]["provenance_subsystem"].startswith("O3:")
    assert any(e["calibrated_confidence"] is not None for e in data_cand["elements"])


def test_path_sanitization_in_errors(client: TestClient, settings: Settings):
    headers = {"X-Internal-Secret": settings.internal_api_secret}
    repo_root = Path(__file__).resolve().parent.parent
    payload = {
        "document_id": "doc-test-sanitize-error",
        "file_path": "data/uploads/secret_missing_target_file.pdf",
        "mode": "flat",
    }
    resp = client.post("/api/v1/internal/extract", json=payload, headers=headers)
    assert resp.status_code == 404
    detail = resp.json()["detail"]
    assert "secret_missing_target_file.pdf" in detail
    assert str(repo_root) not in detail


def test_relative_path_resolution_within_uploads(client: TestClient, settings: Settings, valid_pdf_path: Path):
    headers = {"X-Internal-Secret": settings.internal_api_secret}
    payload = {
        "document_id": "doc-test-relative-path",
        "file_path": valid_pdf_path.name,
        "mode": "flat",
    }
    resp = client.post("/api/v1/internal/extract", json=payload, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "success"


def test_candidate_ft_fallback_integrity(client: TestClient, settings: Settings, valid_pdf_path: Path):
    headers = {"X-Internal-Secret": settings.internal_api_secret}
    doc_id = "doc-test-candft-fallback"
    payload = {
        "document_id": doc_id,
        "file_path": str(valid_pdf_path),
        "mode": "candidate_ft",
    }
    with patch("backend.extractors.docling_extractor.DoclingExtractor.extract", side_effect=RuntimeError("Docling native model execution failure")):
        resp = client.post("/api/v1/internal/extract", json=payload, headers=headers)
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["mode"] == "candidate_ft"
        assert data["status"] == "degraded"
        assert data["fallback"] is not None
        assert data["fallback"]["fallback_occurred"] is True
        assert data["fallback"]["requested_mode"] == "candidate_ft"
        assert data["fallback"]["actual_extractor"] == "PyMuPDF_pdfplumber"
        assert "Docling native model execution failure" in data["fallback"]["reason"]
        assert data["extractor"]["fallback_occurred"] is True
        assert "Docling native model execution failure" in data["extractor"]["fallback_reason"]
        assert any("Fallback to PyMuPDF_pdfplumber" in w for w in data["extraction_warnings"])


def test_faiss_failure_injection_and_search_preservation(client: TestClient, settings: Settings):
    from backend.app.services import get_document_service
    doc_service = get_document_service()
    headers = {"X-Internal-Secret": settings.internal_api_secret}

    repo_root = Path(__file__).resolve().parent.parent
    upload_dir = repo_root / "data" / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    sample_file = upload_dir / "test_faiss_preservation.pdf"

    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), "Retrieva Uniquely Identifiable Search Alpha Bravo 98765", fontsize=16)
    page.insert_text((72, 120), "Content paragraph with searchable tokens for index preservation validation.", fontsize=12)
    doc.save(str(sample_file))
    doc.close()

    doc_id = "doc-test-faiss-search-preservation"
    payload = {
        "document_id": doc_id,
        "file_path": str(sample_file),
        "mode": "flat",
    }

    try:
        resp_init = client.post("/api/v1/internal/extract", json=payload, headers=headers)
        assert resp_init.status_code == 200
        data_init = resp_init.json()["data"]
        assert data_init["indexing_status"] == "Indexed"

        initial_search = doc_service.search("Uniquely Identifiable Search Alpha Bravo 98765", document_id=doc_id, min_score=0.0)
        assert len(initial_search) > 0
        total_chunks_before = len(doc_service.all_chunks)
        initial_doc_chunks = [c for c in doc_service.all_chunks if c.source_doc_id == doc_id]
        assert len(initial_doc_chunks) > 0

        initial_faiss_index = doc_service.retriever.index_faiss
        initial_retriever_chunks = list(doc_service.retriever.chunks)

        def partial_mutation_failing_index(chunks):
            import faiss

            from backend.retrieval.schema import Chunk
            doc_service.retriever.chunks = [Chunk(chunk_id="corrupt_partial_chunk", text="corrupt", chunk_type="text", source_doc_id=doc_id, page_number=1, bbox=None)]
            doc_service.retriever.index_faiss = faiss.IndexFlatIP(128)
            raise RuntimeError("Forced FAISS index failure after partial mutation")

        with patch.object(doc_service.retriever, "index", side_effect=partial_mutation_failing_index):
            resp_fail = client.post("/api/v1/internal/extract", json=payload, headers=headers)
            assert resp_fail.status_code == 200
            data_fail = resp_fail.json()["data"]
            assert data_fail["indexing_status"] == "Failed"
            assert data_fail["status"] == "degraded"
            assert data_fail["indexing_diagnostics"] is not None
            assert data_fail["indexing_diagnostics"]["latest_version_indexed"] is False
            assert data_fail["indexing_diagnostics"]["previous_version_searchable"] is True
            assert data_fail["indexing_diagnostics"]["searchable"] is True
            assert data_fail["indexing_diagnostics"]["error_type"] == "RuntimeError"
            assert any("FAISS indexing failed" in w for w in data_fail["extraction_warnings"])

        assert len(doc_service.all_chunks) == total_chunks_before
        assert doc_service.retriever.chunks == initial_retriever_chunks
        assert doc_service.retriever.index_faiss is initial_faiss_index
        restored_doc_chunks = [c for c in doc_service.all_chunks if c.source_doc_id == doc_id]
        assert len(restored_doc_chunks) == len(initial_doc_chunks)

        preserved_search = doc_service.search("Uniquely Identifiable Search Alpha Bravo 98765", document_id=doc_id, min_score=0.0)
        assert len(preserved_search) > 0
        assert preserved_search[0].id == initial_search[0].id

        resp_success = client.post("/api/v1/internal/extract", json=payload, headers=headers)
        assert resp_success.status_code == 200
        data_success = resp_success.json()["data"]
        assert data_success["indexing_status"] == "Indexed"
        assert data_success["indexing_diagnostics"]["latest_version_indexed"] is True
        assert data_success["indexing_diagnostics"]["previous_version_searchable"] is True
        assert data_success["indexing_diagnostics"]["searchable"] is True

        final_doc_chunks = [c for c in doc_service.all_chunks if c.source_doc_id == doc_id]
        assert len(final_doc_chunks) == len(initial_doc_chunks)
        assert len(doc_service.all_chunks) == total_chunks_before

        final_search = doc_service.search("Uniquely Identifiable Search Alpha Bravo 98765", document_id=doc_id, min_score=0.0)
        assert len(final_search) > 0

    finally:
        if sample_file.exists():
            try:
                sample_file.unlink()
            except OSError:
                pass


def test_extract_skip_indexing_and_index_persisted_elements(client: TestClient, settings: Settings, valid_pdf_path: Path):
    from backend.app.services import get_document_service
    doc_service = get_document_service()
    headers = {"X-Internal-Secret": settings.internal_api_secret}
    doc_id = "doc-test-split-pipeline-001"
    extract_resp = client.post(
        "/api/v1/internal/extract",
        json={
            "document_id": doc_id,
            "file_path": str(valid_pdf_path),
            "mode": "reference",
            "skip_indexing": True,
        },
        headers=headers,
    )
    assert extract_resp.status_code == 200
    ext_data = extract_resp.json()["data"]
    assert ext_data["indexing_status"] == "Skipped"
    assert ext_data["indexing_diagnostics"]["latest_version_indexed"] is False
    assert ext_data["indexing_diagnostics"]["durable_on_disk"] is False
    assert len(ext_data["elements"]) >= 1

    unauth_resp = client.post(
        "/api/v1/internal/index",
        json={
            "document_id": doc_id,
            "file_hash": "a" * 64,
            "filename": valid_pdf_path.name,
            "mode": "reference",
            "is_degraded": False,
            "page_count": ext_data["page_count"],
            "elements": [
                {
                    "page": el["page"],
                    "type": el["type"],
                    "reading_order": el["reading_order"],
                    "text": el["text"],
                    "bbox": el["bbox"],
                    "confidence": el["raw_confidence"],
                }
                for el in ext_data["elements"]
            ],
        },
        headers={"X-Internal-Secret": "wrong-secret"},
    )
    assert unauth_resp.status_code == 401

    index_resp = client.post(
        "/api/v1/internal/index",
        json={
            "document_id": doc_id,
            "file_hash": "a" * 64,
            "filename": valid_pdf_path.name,
            "mode": "reference",
            "is_degraded": False,
            "page_count": ext_data["page_count"],
            "elements": [
                {
                    "page": el["page"],
                    "type": el["type"],
                    "reading_order": el["reading_order"],
                    "text": el["text"],
                    "bbox": el["bbox"],
                    "confidence": el["raw_confidence"],
                }
                for el in ext_data["elements"]
            ],
        },
        headers=headers,
    )
    assert index_resp.status_code == 200
    idx_data = index_resp.json()["data"]
    assert idx_data["document_id"] == doc_id
    assert idx_data["mode"] == "reference"
    assert idx_data["indexing_status"] == "Indexed"
    assert idx_data["searchable"] is True
    assert idx_data["chunk_count"] >= 1
    assert idx_data["indexing_diagnostics"]["vector_store"] == "FAISS"
    assert idx_data["indexing_diagnostics"]["durable_on_disk"] is False
    assert idx_data["indexing_diagnostics"]["latest_version_indexed"] is True

    results = doc_service.search("Extraction Test Document Heading", document_id=doc_id, min_score=0.0)
    assert len(results) >= 1
    assert results[0].provenance is not None
    assert results[0].provenance["source_file_hash"] == "a" * 64


def test_index_persisted_elements_failure_preserves_prior_version(client: TestClient, settings: Settings):
    from backend.app.services import get_document_service
    doc_service = get_document_service()
    headers = {"X-Internal-Secret": settings.internal_api_secret}
    doc_id = "doc-test-index-rollback-002"

    init_resp = client.post(
        "/api/v1/internal/index",
        json={
            "document_id": doc_id,
            "file_hash": "1" * 64,
            "filename": "v1.pdf",
            "mode": "reference",
            "is_degraded": False,
            "page_count": 1,
            "elements": [
                {
                    "page": 1,
                    "type": "heading",
                    "reading_order": 0,
                    "text": "Orbital Baseline Telemetry AlphaV1",
                    "bbox": {"x": 10.0, "y": 10.0, "width": 200.0, "height": 20.0},
                    "confidence": 0.99,
                }
            ],
        },
        headers=headers,
    )
    assert init_resp.status_code == 200
    assert init_resp.json()["data"]["indexing_status"] == "Indexed"

    before_results = doc_service.search("Orbital Baseline Telemetry AlphaV1", document_id=doc_id, min_score=0.0)
    assert len(before_results) == 1
    assert before_results[0].provenance["source_file_hash"] == "1" * 64
    prior_index_ref = doc_service.retriever.index_faiss
    prior_chunks = list(doc_service.all_chunks)

    with patch.object(doc_service.retriever, "index", side_effect=RuntimeError("Simulated FAISS replacement failure")):
        fail_resp = client.post(
            "/api/v1/internal/index",
            json={
                "document_id": doc_id,
                "file_hash": "2" * 64,
                "filename": "v2.pdf",
                "mode": "reference",
                "is_degraded": False,
                "page_count": 1,
                "elements": [
                    {
                        "page": 1,
                        "type": "heading",
                        "reading_order": 0,
                        "text": "Orbital Replacement Telemetry BetaV2",
                        "bbox": {"x": 10.0, "y": 10.0, "width": 200.0, "height": 20.0},
                        "confidence": 0.99,
                    }
                ],
            },
            headers=headers,
        )
        assert fail_resp.status_code == 500
        import json
        fail_detail = json.loads(fail_resp.json()["detail"])
        assert fail_detail["indexing_status"] == "Failed"
        assert fail_detail["indexing_diagnostics"]["latest_version_indexed"] is False
        assert fail_detail["indexing_diagnostics"]["previous_version_searchable"] is True
        assert fail_detail["indexing_diagnostics"]["searchable"] is True
        assert fail_detail["indexing_diagnostics"]["durable_on_disk"] is False
        assert doc_service.retriever.index_faiss is prior_index_ref
        assert len(doc_service.all_chunks) == len(prior_chunks)

    after_fail_results = doc_service.search("Orbital Baseline Telemetry AlphaV1", document_id=doc_id, min_score=0.0)
    assert len(after_fail_results) == 1
    assert after_fail_results[0].provenance["source_file_hash"] == "1" * 64

    v2_resp = client.post(
        "/api/v1/internal/index",
        json={
            "document_id": doc_id,
            "file_hash": "2" * 64,
            "filename": "v2.pdf",
            "mode": "reference",
            "is_degraded": False,
            "page_count": 1,
            "elements": [
                {
                    "page": 1,
                    "type": "heading",
                    "reading_order": 0,
                    "text": "Orbital Replacement Telemetry BetaV2",
                    "bbox": {"x": 10.0, "y": 10.0, "width": 200.0, "height": 20.0},
                    "confidence": 0.99,
                }
            ],
        },
        headers=headers,
    )
    assert v2_resp.status_code == 200
    assert v2_resp.json()["data"]["indexing_status"] == "Indexed"
    v2_results = doc_service.search("Orbital Replacement Telemetry BetaV2", document_id=doc_id, min_score=0.0)
    assert len(v2_results) == 1
    assert v2_results[0].provenance["source_file_hash"] == "2" * 64
    stale_v1 = doc_service.search("Orbital Baseline Telemetry AlphaV1", document_id=doc_id, min_score=0.5)
    assert all(r.provenance["source_file_hash"] == "2" * 64 for r in stale_v1)
