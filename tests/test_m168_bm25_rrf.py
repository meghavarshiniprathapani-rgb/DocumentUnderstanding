import concurrent.futures
import os
import subprocess
import sys
from typing import List

import numpy as np

from backend.extractors.base import BoundingBox, Element, ElementType, TableCell
from backend.provenance.schema import EnrichedElement
from backend.retrieval.bm25 import BM25Index, bm25_tokenize
from backend.retrieval.chunking import StructuredElementChunker
from backend.retrieval.embedding import DenseDeterministicEmbedding
from backend.retrieval.retriever import FaissRetriever
from backend.retrieval.schema import Chunk


def make_test_chunk(
    chunk_id: str,
    text: str,
    source_doc_id: str = "doc-001",
    chunk_type: str = "structured_text",
    raw_confidence: float = 1.0,
    calibrated_confidence: float = 1.0,
    is_degraded: bool = False,
) -> Chunk:
    return Chunk(
        chunk_id=chunk_id,
        text=text,
        chunk_type=chunk_type,
        source_doc_id=source_doc_id,
        source_file_hash="hash123",
        page_number=1,
        bbox=BoundingBox(x_min=10.0, y_min=20.0, x_max=100.0, y_max=200.0),
        element_ids=[f"elem-{chunk_id}"],
        provenance=None,
        calibrated_confidence=calibrated_confidence,
        raw_confidence=raw_confidence,
        is_degraded=is_degraded,
        metadata={},
    )


def test_tokenization_numeric_and_punctuation_examples():
    text_189 = "The reported revenue was 189.5 million dollars."
    tokens_189 = bm25_tokenize(text_189)
    assert "189.5" in tokens_189

    text_pct = "Operating margin decreased by -8.9% in Q3."
    tokens_pct = bm25_tokenize(text_pct)
    assert "-8.9%" in tokens_pct
    assert "-8.9" in tokens_pct
    assert "8.9" in tokens_pct

    text_rd = "Investments in R&D accelerated substantially."
    tokens_rd = bm25_tokenize(text_rd)
    assert "r&d" in tokens_rd
    assert "r" in tokens_rd
    assert "d" in tokens_rd

    text_ebitda = "Adjusted EBITDA grew past expectations."
    tokens_ebitda = bm25_tokenize(text_ebitda)
    assert "ebitda" in tokens_ebitda

    text_x2 = "The quadratic term x^2 dominates as x grows."
    tokens_x2 = bm25_tokenize(text_x2)
    assert "x^2" in tokens_x2
    assert "x" in tokens_x2
    assert "2" in tokens_x2

    text_frac = r"The formula is given by \frac{a}{b} in the paper."
    tokens_frac = bm25_tokenize(text_frac)
    assert r"\frac{a}{b}" in tokens_frac
    assert r"\frac" in tokens_frac
    assert "a" in tokens_frac
    assert "b" in tokens_frac

    text_sqrt = r"Scale factor is \sqrt{d_k} in self-attention."
    tokens_sqrt = bm25_tokenize(text_sqrt)
    assert r"\sqrt{d_k}" in tokens_sqrt
    assert r"\sqrt" in tokens_sqrt
    assert "d" in tokens_sqrt
    assert "k" in tokens_sqrt


def test_bm25_inverted_index_construction():
    index = BM25Index(k1=1.5, b=0.75)
    chunks = [
        make_test_chunk("c1", "Enterprise Cloud generated 189.5 million revenue."),
        make_test_chunk("c2", "Hardware experienced negative -8.9% contraction."),
        make_test_chunk("c3", "R&D expenditures and adjusted EBITDA report."),
    ]
    index.index(chunks)

    assert index.corpus_size == 3
    assert "189.5" in index._doc_freqs
    assert index._doc_freqs["189.5"] == 1
    assert "-8.9%" in index._doc_freqs
    assert "r&d" in index._doc_freqs
    assert "ebitda" in index._doc_freqs
    assert index._avg_doc_len > 0.0


def test_bm25_scoring_and_ranking():
    index = BM25Index()
    chunks = [
        make_test_chunk("c1", "The company reported general cloud performance."),
        make_test_chunk("c2", "Enterprise Cloud revenue was 189.5 million for 2025."),
        make_test_chunk("c3", "Enterprise Cloud segment had 189.5 in 2025 with 189.5 confirmed."),
    ]
    index.index(chunks)

    results = index.retrieve("Enterprise Cloud 189.5", top_k=3)
    assert len(results) == 3
    assert results[0].chunk.chunk_id == "c3"
    assert results[1].chunk.chunk_id == "c2"
    assert results[2].chunk.chunk_id == "c1"
    assert results[0].score > results[1].score > results[2].score


def test_bm25_empty_corpus_and_empty_query():
    index = BM25Index()
    assert index.retrieve("query") == []
    assert index.score_candidates("query") == []

    chunks = [make_test_chunk("c1", "Some sample text.")]
    index.index(chunks)

    assert index.retrieve("") == []
    assert index.retrieve("   ") == []
    assert index.retrieve("!@$%^&*") == []

    index.index([])
    assert index.corpus_size == 0
    assert index.retrieve("sample") == []


def test_bm25_document_filtering():
    index = BM25Index()
    chunks = [
        make_test_chunk("c1", "Exact revenue 189.5 in doc one.", source_doc_id="doc-001"),
        make_test_chunk("c2", "Exact revenue 189.5 in doc two.", source_doc_id="doc-002"),
        make_test_chunk("c3", "Exact revenue 189.5 in doc three.", source_doc_id="doc-003"),
    ]
    index.index(chunks)

    results_all = index.retrieve("189.5", top_k=5)
    assert len(results_all) == 3

    results_doc1 = index.retrieve("189.5", top_k=5, document_ids=["doc-001"])
    assert len(results_doc1) == 1
    assert results_doc1[0].chunk.source_doc_id == "doc-001"

    results_doc2_3 = index.retrieve("189.5", top_k=5, document_ids=["doc-002", "doc-003"])
    assert len(results_doc2_3) == 2
    assert {r.chunk.source_doc_id for r in results_doc2_3} == {"doc-002", "doc-003"}


def test_hybrid_rrf_scoring_and_ranking():
    retriever = FaissRetriever(use_hybrid=True, use_confidence_weighting=False)
    chunks = [
        make_test_chunk("c_bm25_only", "UniqueTokenXYZ is specified here."),
        make_test_chunk("c_dense_semantic", "A comprehensive overview of global computing platforms and systems."),
        make_test_chunk("c_both", "UniqueTokenXYZ global computing platform overview."),
    ]
    retriever.index(chunks)

    results = retriever.retrieve("UniqueTokenXYZ computing", top_k=3)
    assert len(results) == 3
    assert results[0].chunk.chunk_id == "c_both"
    assert results[0].rank == 1
    assert results[0].score >= results[1].score


def test_hybrid_candidate_in_only_one_stream():
    retriever = FaissRetriever(use_hybrid=True)
    chunks = [
        make_test_chunk("c1", "Alpha beta gamma delta epsilon zeta."),
        make_test_chunk("c2", "Financial metrics summary with operating income."),
    ]
    retriever.index(chunks)

    results = retriever.retrieve("Alpha", top_k=2)
    assert len(results) >= 1
    assert results[0].chunk.chunk_id == "c1"


def test_hybrid_duplicate_candidate_handling():
    retriever = FaissRetriever(use_hybrid=True)
    chunks = [
        make_test_chunk("c1", "Revenue report for fiscal year 2025."),
        make_test_chunk("c2", "Operating expenses and capital allocation."),
    ]
    retriever.index(chunks)

    results = retriever.retrieve("Revenue report fiscal 2025", top_k=5)
    retrieved_cids = [r.chunk.chunk_id for r in results]
    assert len(retrieved_cids) == len(set(retrieved_cids))


def test_dense_only_fallback():
    retriever_dense = FaissRetriever(use_hybrid=False, use_confidence_weighting=False)
    retriever_hybrid = FaissRetriever(use_hybrid=True, use_confidence_weighting=False)

    chunks = [
        make_test_chunk("c1", "Enterprise Cloud infrastructure performance."),
        make_test_chunk("c2", "Consumer hardware devices division."),
        make_test_chunk("c3", "Software applications and developer tooling."),
    ]
    retriever_dense.index(chunks)
    retriever_hybrid.index(chunks)

    res_fallback = retriever_hybrid.retrieve("Enterprise Cloud", top_k=3, use_hybrid=False)
    res_dense = retriever_dense.retrieve("Enterprise Cloud", top_k=3)

    assert len(res_fallback) == len(res_dense)
    for r_f, r_d in zip(res_fallback, res_dense):
        assert r_f.chunk.chunk_id == r_d.chunk.chunk_id
        assert abs(r_f.score - r_d.score) < 1e-4


def test_concurrent_index_rebuild_and_retrieval():
    retriever = FaissRetriever(use_hybrid=True)
    initial_chunks = [
        make_test_chunk(f"init_{i}", f"Initial document chunk content number {i}")
        for i in range(20)
    ]
    retriever.index(initial_chunks)

    errors: List[Exception] = []

    def reader_task():
        try:
            for _ in range(30):
                res = retriever.retrieve("document content number", top_k=5)
                assert isinstance(res, list)
        except Exception as exc:
            errors.append(exc)

    def writer_task():
        try:
            for i in range(10):
                new_chunks = [
                    make_test_chunk(f"dyn_{i}_{j}", f"Dynamic iteration {i} chunk content {j}")
                    for j in range(15)
                ]
                retriever.index(new_chunks)
        except Exception as exc:
            errors.append(exc)

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        futures = [
            executor.submit(reader_task),
            executor.submit(reader_task),
            executor.submit(writer_task),
            executor.submit(reader_task),
            executor.submit(writer_task),
        ]
        concurrent.futures.wait(futures)

    assert not errors


def test_all_four_experiment_modes_retrieval():
    retriever = FaissRetriever(use_hybrid=True, use_confidence_weighting=True)
    chunker = StructuredElementChunker()

    modes = ["flat", "reference", "candidate", "candidate_ft"]
    all_chunks = []

    for mode in modes:
        cell_1 = TableCell(row_index=0, col_index=0, text=f"Metric_{mode}", is_header=True)
        cell_2 = TableCell(row_index=0, col_index=1, text="Value", is_header=True)
        cell_3 = TableCell(row_index=1, col_index=0, text=f"Score_{mode}")
        cell_4 = TableCell(row_index=1, col_index=1, text="189.5")

        elem_table = Element(
            type=ElementType.TABLE,
            page=1,
            bbox=BoundingBox(x_min=10.0, y_min=20.0, x_max=200.0, y_max=100.0),
            reading_order=0,
            text=f"Table summary for {mode}",
            table_cells=[cell_1, cell_2, cell_3, cell_4],
            raw_confidence=0.95,
            metadata={"id": f"elem_tbl_{mode}", "mode": mode},
        )
        elem_text = Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=10.0, y_min=110.0, x_max=200.0, y_max=180.0),
            reading_order=1,
            text=f"Section text describing {mode} operations with EBITDA growth.",
            raw_confidence=0.92,
            metadata={"id": f"elem_txt_{mode}", "mode": mode},
        )

        enr_table = EnrichedElement(element=elem_table, provenance=None, confidence_signals=None, routing=None)
        enr_text = EnrichedElement(element=elem_text, provenance=None, confidence_signals=None, routing=None)

        mode_chunks = chunker.chunk_elements([enr_table, enr_text], doc_id=f"doc_{mode}")
        for c in mode_chunks:
            c.metadata["mode"] = mode
        all_chunks.extend(mode_chunks)

    retriever.index(all_chunks)

    for mode in modes:
        res = retriever.retrieve(f"Metric_{mode} 189.5", top_k=3, document_ids=[f"doc_{mode}"])
        assert len(res) >= 1
        assert res[0].chunk.source_doc_id == f"doc_{mode}"
        assert res[0].chunk.metadata.get("mode") == mode

    res_cross = retriever.retrieve("EBITDA", top_k=10)
    assert len(res_cross) >= 4


def test_deterministic_embedding_cross_process_reproducibility():
    embedder = DenseDeterministicEmbedding(dimension=128, seed=42)
    sample_text = "Enterprise Cloud revenue was 189.5 million dollars with EBITDA growth."
    base_vec = embedder.embed_texts([sample_text])
    assert base_vec.shape == (1, 128)
    assert base_vec.dtype == np.float32

    same_process_vec = embedder.embed_texts([sample_text])
    assert np.array_equal(base_vec, same_process_vec)

    code = (
        "import numpy as np\n"
        "from backend.retrieval.embedding import DenseDeterministicEmbedding\n"
        "emb = DenseDeterministicEmbedding(dimension=128, seed=42)\n"
        "v = emb.embed_texts(['Enterprise Cloud revenue was 189.5 million dollars with EBITDA growth.'])\n"
        "print(v.tobytes().hex())\n"
    )

    seeds = ["0", "1", "42", "100", "999", "random_unset"]
    for s in seeds:
        env = dict(os.environ)
        if s == "random_unset":
            env.pop("PYTHONHASHSEED", None)
        else:
            env["PYTHONHASHSEED"] = s
        out = subprocess.check_output([sys.executable, "-c", code], env=env, text=True).strip()
        assert out == base_vec.tobytes().hex()


def test_single_stream_and_dual_stream_rrf_min_score_compatibility():
    retriever_unweighted = FaissRetriever(use_hybrid=True, use_confidence_weighting=False)
    retriever_weighted = FaissRetriever(use_hybrid=True, use_confidence_weighting=True)

    chunk_single_bm25 = make_test_chunk(
        "c_bm25",
        "UniqueZetaToken998811 exclusively matched here.",
        raw_confidence=0.90,
        calibrated_confidence=0.90,
    )
    chunk_single_degraded = make_test_chunk(
        "c_degraded",
        "UniqueDegradedToken5544 exclusively matched here.",
        raw_confidence=0.40,
        calibrated_confidence=0.40,
        is_degraded=True,
    )
    chunk_dual = make_test_chunk(
        "c_dual",
        "Enterprise Cloud revenue scaled up 189.5 million.",
        raw_confidence=0.95,
        calibrated_confidence=0.95,
    )
    chunk_other = make_test_chunk(
        "c_other",
        "General legal boilerplate terms.",
        raw_confidence=0.90,
        calibrated_confidence=0.90,
    )

    all_chunks = [chunk_single_bm25, chunk_single_degraded, chunk_dual, chunk_other]
    retriever_unweighted.index(all_chunks)
    retriever_weighted.index(all_chunks)

    res_unweighted = retriever_unweighted.retrieve("UniqueZetaToken998811", top_k=2)
    assert len(res_unweighted) >= 1
    assert res_unweighted[0].chunk.chunk_id == "c_bm25"
    assert res_unweighted[0].score >= 0.70
    assert res_unweighted[0].score >= 0.50

    res_degraded = retriever_weighted.retrieve("UniqueDegradedToken5544", top_k=2)
    assert len(res_degraded) >= 1
    assert res_degraded[0].chunk.chunk_id == "c_degraded"
    assert res_degraded[0].score >= 0.50

    res_dual = retriever_unweighted.retrieve("Enterprise Cloud revenue 189.5", top_k=2)
    assert len(res_dual) >= 1
    assert res_dual[0].chunk.chunk_id == "c_dual"
    assert res_dual[0].score >= 0.90


def test_document_service_search_preserves_single_stream_with_min_score():
    from backend.app.services.document_service import DocumentService

    doc_service = DocumentService()
    chunk_bm25 = make_test_chunk(
        "c_kwd",
        "UnmatchedSemanticExactCode99211 is detailed here.",
        source_doc_id="doc-test-1",
    )
    doc_service.retriever.index([chunk_bm25])

    hits = doc_service.search("UnmatchedSemanticExactCode99211", min_score=0.50, top_k=5, use_hybrid=True)
    assert len(hits) >= 1
    assert hits[0].id == "res-c_kwd"
    assert hits[0].relevance_score >= 0.50
