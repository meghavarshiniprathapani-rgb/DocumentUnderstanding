import json
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import pymupdf as fitz
import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings, get_settings
from backend.app.main import create_app
from backend.app.schemas.internal import PersistedElementIndexItem
from backend.app.services.document_service import DocumentService
from backend.retrieval import Chunk, FaissRetriever


def _make_pdf(path: Path, heading: str, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), heading, fontsize=18)
    page.insert_text((72, 120), body, fontsize=12)
    doc.save(str(path))
    doc.close()


def _make_item(
    doc_id: str,
    text: str,
    confidence: float = 0.95,
    is_degraded: bool = False,
    reasons: list[str] | None = None,
    page: int = 1,
    reading_order: int = 0,
) -> PersistedElementIndexItem:
    flags = {"is_degraded": is_degraded, "degraded_reasons": list(reasons or [])}
    return PersistedElementIndexItem(
        page=page,
        type="text",
        reading_order=reading_order,
        text=text,
        bbox={"x0": 72.0, "y0": 100.0, "x1": 420.0, "y1": 130.0},
        confidence=confidence,
        provenance={
            "element_id": f"{doc_id}_el_{reading_order}",
            "source_file_hash": f"hash-{doc_id}",
            "calibrated_confidence": confidence,
            "is_degraded": is_degraded,
            "degraded_reasons": list(reasons or []),
        },
        flags=flags,
        model_version="1.0.0",
    )


def test_startup_does_not_load_orphaned_upload_pdfs(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("EXPRESS_SERVICE_URL", raising=False)
    repo_root = Path(__file__).resolve().parent.parent
    orphan_path = repo_root / "data" / "uploads" / f"doc-999_orphan_{uuid.uuid4().hex[:6]}.pdf"
    _make_pdf(orphan_path, "OrphanHeading", "OrphanSecretDiskToken999 should never load at startup.")

    try:
        svc = DocumentService()
        assert "doc-999" not in svc.documents
        assert "doc-999" not in svc.document_paths
        assert not any(c.source_doc_id == "doc-999" for c in svc.all_chunks)
        hits = svc.search("OrphanSecretDiskToken999", min_score=0.0, top_k=10)
        assert not any("doc-999" in h.document_id for h in hits)
        app = create_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/documents")
            assert resp.status_code == 200
            doc_ids = {d["document_id"] for d in resp.json()["data"]}
            assert "doc-999" not in doc_ids
    finally:
        if orphan_path.exists():
            orphan_path.unlink()


def test_express_unavailable_exposes_zero_uploads_via_lifespan(monkeypatch: pytest.MonkeyPatch):
    repo_root = Path(__file__).resolve().parent.parent
    upload_path = repo_root / "data" / "uploads" / f"doc-998_unreachable_{uuid.uuid4().hex[:6]}.pdf"
    _make_pdf(upload_path, "UnreachableHeading", "ExpressDownOrphanToken998 must not leak.")
    monkeypatch.setenv("EXPRESS_SERVICE_URL", "http://127.0.0.1:19999")

    try:
        svc = DocumentService()
        res = svc.sync_from_express_recovery("http://127.0.0.1:19999", "secret", force=True)
        assert res["synced"] is False
        assert "doc-998" not in svc.documents
        user_uploads = [d for d in svc.list_documents() if d.category == "User Upload"]
        assert user_uploads == []
    finally:
        if upload_path.exists():
            upload_path.unlink()


def test_skip_indexing_leaves_prior_and_memory_state_untouched_across_all_modes():
    svc = DocumentService()
    repo_root = svc.repo_root
    temp_pdf_v1 = repo_root / "data" / "uploads" / f"m167_skip_v1_{uuid.uuid4().hex[:6]}.pdf"
    temp_pdf_v2 = repo_root / "data" / "uploads" / f"m167_skip_v2_{uuid.uuid4().hex[:6]}.pdf"
    try:
        _make_pdf(temp_pdf_v1, "AlphaV1", "M167SkipInitialTokenAlpha is indexed only once committed.")
        _make_pdf(temp_pdf_v2, "BetaV2", "M167SkipTransientTokenBeta must never enter FAISS during extract.")

        for mode in ("flat", "reference", "candidate", "candidate_ft"):
            fresh_id = f"doc-m167-skip-{mode}"
            ext = svc.process_document_by_path(
                document_id=fresh_id,
                file_path=temp_pdf_v2,
                mode=mode,
                skip_indexing=True,
            )
            assert ext.indexing_status == "Skipped"
            assert fresh_id not in svc.documents
            assert fresh_id not in svc.page_segments
            assert fresh_id not in svc.document_paths
            assert not any(c.source_doc_id == fresh_id for c in svc.all_chunks)
            assert svc.degraded_mode_active is False

        target_id = "doc-m167-versioned"
        svc.index_persisted_elements(
            document_id=target_id,
            file_hash="hash-v1",
            filename="v1.pdf",
            mode="flat",
            is_degraded=False,
            page_count=1,
            elements=[_make_item(target_id, "M167SkipInitialTokenAlpha persisted V1 content")],
            job_id=10,
            lease_generation=1,
            skip_remote_verify=True,
        )

        ext_v2 = svc.process_document_by_path(
            document_id=target_id,
            file_path=temp_pdf_v2,
            mode="candidate",
            skip_indexing=True,
        )
        assert ext_v2.indexing_status == "Skipped"
        assert svc.get_document_summary(target_id).file_hash == "hash-v1"
        v1_hits = svc.search("M167SkipInitialTokenAlpha", document_id=target_id, min_score=0.0, top_k=5)
        assert len(v1_hits) == 1
        v2_hits = svc.search("M167SkipTransientTokenBeta", document_id=target_id, min_score=0.0, top_k=5)
        assert not any("M167SkipTransientTokenBeta" in h.query_match_snippet for h in v2_hits)

        prior_faiss = svc.retriever.index_faiss
        with patch.object(svc.retriever, "index", side_effect=RuntimeError("injected FAISS failure")):
            with pytest.raises(Exception):
                svc.index_persisted_elements(
                    document_id=target_id,
                    file_hash="hash-v2-failed",
                    filename="v2.pdf",
                    mode="candidate",
                    is_degraded=False,
                    page_count=1,
                    elements=[_make_item(target_id, "M167FailedOverwriteToken must not stick")],
                    job_id=11,
                    lease_generation=1,
                    skip_remote_verify=True,
                )

        assert svc.retriever.index_faiss is prior_faiss
        assert svc.get_document_summary(target_id).file_hash == "hash-v1"
        preserved_hits = svc.search("M167SkipInitialTokenAlpha", document_id=target_id, min_score=0.0, top_k=5)
        assert len(preserved_hits) == 1
        assert "M167SkipInitialTokenAlpha" in preserved_hits[0].query_match_snippet
    finally:
        for p in (temp_pdf_v1, temp_pdf_v2):
            if p.exists():
                p.unlink()


def test_concurrent_indexing_and_search_thread_safety():
    svc = DocumentService()
    errors: list[Exception] = []
    stop_event = threading.Event()

    def writer_task(idx: int) -> None:
        try:
            doc_id = f"doc-concurrent-{idx % 4}"
            svc.index_persisted_elements(
                document_id=doc_id,
                file_hash=f"hash-conc-{idx}",
                filename=f"{doc_id}.pdf",
                mode="candidate",
                is_degraded=False,
                page_count=1,
                elements=[_make_item(doc_id, f"ConcurrentToken{idx % 4} iteration {idx} verification")],
                job_id=100 + idx,
                lease_generation=1,
                skip_remote_verify=True,
            )
        except Exception as exc:
            errors.append(exc)

    def reader_task() -> None:
        try:
            while not stop_event.is_set():
                svc.search("ConcurrentToken", min_score=0.0, top_k=10)
                svc.list_documents()
                svc.get_health_metrics()
        except Exception as exc:
            errors.append(exc)

    readers = [threading.Thread(target=reader_task) for _ in range(3)]
    for t in readers:
        t.start()

    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = [pool.submit(writer_task, i) for i in range(16)]
            for f in futures:
                f.result()
    finally:
        stop_event.set()
        for t in readers:
            t.join(timeout=5.0)

    assert not errors
    with svc._state_lock:
        assert svc.retriever.index_faiss is not None
        assert svc.retriever.index_faiss.ntotal == len(svc.retriever.chunks) == len(svc.all_chunks)
    for bucket in range(4):
        hits = svc.search(f"ConcurrentToken{bucket}", document_id=f"doc-concurrent-{bucket}", min_score=0.0, top_k=5)
        assert len(hits) >= 1


def test_concurrent_recovery_coalescing_with_force():
    svc = DocumentService()
    started_first = threading.Event()
    release_first = threading.Event()
    call_counter = {"count": 0}
    lock = threading.Lock()

    class FakeResponse:
        ok = True
        status_code = 200

        def __init__(self, version_tag: str) -> None:
            self._version_tag = version_tag

        def json(self):
            return {
                "data": {
                    "documents": [
                        {
                            "document_id": "doc-coalesce-1",
                            "file_hash": f"hash-{self._version_tag}",
                            "filename": "coalesce.pdf",
                            "mode": "flat",
                            "is_degraded": False,
                            "page_count": 1,
                            "job_id": 50 if self._version_tag == "pass1" else 51,
                            "lease_generation": 1,
                            "is_recovery": True,
                            "extraction_warnings": [],
                            "elements": [
                                {
                                    "page": 1,
                                    "type": "text",
                                    "reading_order": 0,
                                    "text": f"CoalescedRecoveryToken {self._version_tag}",
                                    "bbox": {"x0": 50, "y0": 50, "x1": 300, "y1": 80},
                                    "confidence": 0.95,
                                    "provenance": {"element_id": "el-0"},
                                    "flags": {"is_degraded": False, "degraded_reasons": []},
                                }
                            ],
                        }
                    ],
                    "deleted_document_ids": [],
                    "ineligible_document_ids": [],
                }
            }

    def fake_get(*args, **kwargs):
        with lock:
            call_counter["count"] += 1
            current = call_counter["count"]
        if current == 1:
            started_first.set()
            assert release_first.wait(timeout=5.0)
            return FakeResponse("pass1")
        return FakeResponse("pass2")

    with patch("backend.app.services.document_service.requests.get", side_effect=fake_get):
        with ThreadPoolExecutor(max_workers=3) as pool:
            f1 = pool.submit(svc.sync_from_express_recovery, "http://127.0.0.1:3999", "secret", False)
            assert started_first.wait(timeout=5.0)
            f2 = pool.submit(svc.sync_from_express_recovery, "http://127.0.0.1:3999", "secret", True)
            f3 = pool.submit(svc.sync_from_express_recovery, "http://127.0.0.1:3999", "secret", False)
            threading.Event().wait(0.08)
            release_first.set()
            r1 = f1.result(timeout=10.0)
            r2 = f2.result(timeout=10.0)
            r3 = f3.result(timeout=10.0)

    assert call_counter["count"] == 2
    assert r1["synced"] is True
    assert r2["synced"] is True
    assert r3["synced"] is True
    hits = svc.search("CoalescedRecoveryToken pass2", document_id="doc-coalesce-1", min_score=0.0, top_k=5)
    assert len(hits) == 1
    assert "pass2" in hits[0].query_match_snippet


def test_degraded_restoration_and_confidence_cap():
    svc = DocumentService()
    reason_text = "Low confidence (0.39 < threshold 0.75)"

    svc.index_persisted_elements(
        document_id="doc-deg-explicit",
        file_hash="hash-deg-1",
        filename="deg1.pdf",
        mode="candidate",
        is_degraded=True,
        page_count=1,
        elements=[
            _make_item(
                "doc-deg-explicit",
                "SharedRankingSignal DegradationPayloadText",
                confidence=0.95,
                is_degraded=True,
                reasons=[reason_text],
            )
        ],
        job_id=20,
        lease_generation=1,
        extraction_warnings=[reason_text],
        skip_remote_verify=True,
    )

    assert svc.degraded_mode_active is True
    health = svc.get_health_metrics()
    assert health.degraded_mode_active is True
    assert health.status == "degraded"

    hits = svc.search("DegradationPayloadText", document_id="doc-deg-explicit", min_score=0.0, top_k=5)
    assert len(hits) == 1
    assert hits[0].is_degraded is True
    assert reason_text in hits[0].degraded_reasons
    assert hits[0].query_match_snippet.startswith("[DEGRADED EXTRACTION: Raw slice fallback]")

    svc.index_persisted_elements(
        document_id="doc-deg-implicit",
        file_hash="hash-deg-2",
        filename="deg2.pdf",
        mode="candidate",
        is_degraded=True,
        page_count=1,
        elements=[
            PersistedElementIndexItem(
                page=1,
                type="text",
                reading_order=0,
                text="ImplicitDegradedPayloadToken without per element flags",
                bbox={"x0": 10, "y0": 10, "x1": 200, "y1": 30},
                confidence=0.60,
                provenance={"element_id": "imp-0"},
                flags=None,
            )
        ],
        job_id=21,
        lease_generation=1,
        extraction_warnings=["Fallback to PdfPlumber: Docling unavailable"],
        skip_remote_verify=True,
    )

    imp_hits = svc.search("ImplicitDegradedPayloadToken", document_id="doc-deg-implicit", min_score=0.0, top_k=5)
    assert len(imp_hits) == 1
    assert imp_hits[0].is_degraded is True
    assert "Fallback to PdfPlumber: Docling unavailable" in imp_hits[0].degraded_reasons

    retriever = FaissRetriever(use_confidence_weighting=True)
    clean_chunk = Chunk(
        chunk_id="c-clean",
        text="Identical comparison signal for ranking calibration check",
        chunk_type="structured_text",
        source_doc_id="doc-clean",
        raw_confidence=0.95,
        calibrated_confidence=0.95,
        is_degraded=False,
    )
    degraded_chunk = Chunk(
        chunk_id="c-deg",
        text="Identical comparison signal for ranking calibration check",
        chunk_type="structured_text",
        source_doc_id="doc-deg",
        raw_confidence=0.95,
        calibrated_confidence=0.95,
        is_degraded=True,
    )
    retriever.index([degraded_chunk, clean_chunk])
    ranked = retriever.retrieve("Identical comparison signal for ranking calibration check", top_k=2)
    assert len(ranked) == 2
    assert ranked[0].chunk.chunk_id == "c-clean"
    assert ranked[1].chunk.chunk_id == "c-deg"
    assert ranked[0].score > ranked[1].score

    svc.purge_document_from_memory("doc-deg-explicit")
    svc.purge_document_from_memory("doc-deg-implicit")
    assert svc.degraded_mode_active is False


def test_failed_recovery_preserves_prior_valid_index():
    svc = DocumentService()
    svc.index_persisted_elements(
        document_id="doc-preserve-rec",
        file_hash="hash-keep",
        filename="keep.pdf",
        mode="flat",
        is_degraded=False,
        page_count=1,
        elements=[_make_item("doc-preserve-rec", "ValidRecoveryPreserveToken stays indexed on failure")],
        job_id=30,
        lease_generation=1,
        skip_remote_verify=True,
    )

    class Fail500Response:
        ok = False
        status_code = 500

    with patch("backend.app.services.document_service.requests.get", return_value=Fail500Response()):
        res_http = svc.sync_from_express_recovery("http://127.0.0.1:3999", "secret", force=True)
        assert res_http["synced"] is False

    hits_after_500 = svc.search("ValidRecoveryPreserveToken", document_id="doc-preserve-rec", min_score=0.0, top_k=5)
    assert len(hits_after_500) == 1

    class EmptyInvalidResponse:
        ok = True
        status_code = 200

        def json(self):
            return {
                "data": {
                    "documents": [],
                    "deleted_document_ids": [],
                    "ineligible_document_ids": [],
                }
            }

    prior_faiss = svc.retriever.index_faiss
    with patch("backend.app.services.document_service.requests.get", return_value=EmptyInvalidResponse()):
        with patch.object(svc.retriever, "index", side_effect=RuntimeError("faiss rebuild crash")):
            res_crash = svc.sync_from_express_recovery("http://127.0.0.1:3999", "secret", force=True)
            assert res_crash["synced"] is False

    assert svc.retriever.index_faiss is prior_faiss
    hits_after_crash = svc.search("ValidRecoveryPreserveToken", document_id="doc-preserve-rec", min_score=0.0, top_k=5)
    assert len(hits_after_crash) == 1


def test_stale_version_fencing_without_express_and_via_api(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("EXPRESS_SERVICE_URL", raising=False)
    app = create_app()
    settings: Settings = get_settings()
    headers = {"X-Internal-Secret": settings.internal_api_secret}

    with TestClient(app) as client:
        doc_id = "doc-fence-api"
        resp_ok = client.post(
            "/api/v1/internal/index",
            headers=headers,
            json={
                "document_id": doc_id,
                "file_hash": "hash-gen2",
                "filename": "fence.pdf",
                "mode": "flat",
                "is_degraded": False,
                "page_count": 1,
                "job_id": 10,
                "lease_generation": 2,
                "elements": [
                    {
                        "page": 1,
                        "type": "text",
                        "reading_order": 0,
                        "text": "FreshGen2AuthoritativeToken present in FAISS",
                        "bbox": {"x0": 50, "y0": 50, "x1": 300, "y1": 80},
                        "confidence": 0.95,
                        "provenance": {"element_id": "el-gen2"},
                        "flags": {"is_degraded": False, "degraded_reasons": []},
                    }
                ],
            },
        )
        assert resp_ok.status_code == 200

        resp_stale_gen = client.post(
            "/api/v1/internal/index",
            headers=headers,
            json={
                "document_id": doc_id,
                "file_hash": "hash-gen1",
                "filename": "fence.pdf",
                "mode": "flat",
                "is_degraded": False,
                "page_count": 1,
                "job_id": 10,
                "lease_generation": 1,
                "elements": [
                    {
                        "page": 1,
                        "type": "text",
                        "reading_order": 0,
                        "text": "StaleOldGen1Token must be rejected",
                        "bbox": {"x0": 50, "y0": 50, "x1": 300, "y1": 80},
                        "confidence": 0.95,
                        "provenance": {"element_id": "el-gen1"},
                        "flags": {"is_degraded": False, "degraded_reasons": []},
                    }
                ],
            },
        )
        assert resp_stale_gen.status_code == 409
        assert "Rejected" in json.dumps(resp_stale_gen.json())

        resp_stale_job = client.post(
            "/api/v1/internal/index",
            headers=headers,
            json={
                "document_id": doc_id,
                "file_hash": "hash-job9",
                "filename": "fence.pdf",
                "mode": "flat",
                "is_degraded": False,
                "page_count": 1,
                "job_id": 9,
                "lease_generation": 9,
                "elements": [
                    {
                        "page": 1,
                        "type": "text",
                        "reading_order": 0,
                        "text": "StaleOlderJob9Token must be rejected",
                        "bbox": {"x0": 50, "y0": 50, "x1": 300, "y1": 80},
                        "confidence": 0.95,
                        "provenance": {"element_id": "el-job9"},
                        "flags": {"is_degraded": False, "degraded_reasons": []},
                    }
                ],
            },
        )
        assert resp_stale_job.status_code == 409

        search_fresh = client.post(
            "/api/v1/search",
            json={"query": "FreshGen2AuthoritativeToken", "document_id": doc_id, "min_score": 0.0, "top_k": 5},
        )
        assert search_fresh.status_code == 200
        assert len(search_fresh.json()["data"]) == 1

        search_stale = client.post(
            "/api/v1/search",
            json={"query": "StaleOldGen1Token", "document_id": doc_id, "min_score": 0.0, "top_k": 5},
        )
        assert search_stale.status_code == 200
        assert not any("StaleOld" in r["query_match_snippet"] for r in search_stale.json()["data"])
