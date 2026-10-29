"""Unit tests for Downstream Retrieval, Chunking, FAISS Indexing, and KPI-3 Evaluation."""

import numpy as np
import pytest

from backend.extractors.base import BoundingBox, Element, ElementType, FormulaData, TableCell
from backend.provenance.schema import ConfidenceSignals, EnrichedElement, ProvenanceRecord
from backend.retrieval import (
    DenseDeterministicEmbedding,
    FaissRetriever,
    NaiveFlatChunker,
    StructuredElementChunker,
)
from backend.retrieval.schema import Chunk
from eval.rate_kpi3 import calculate_cohens_kappa, score_chunk_kpi3
from eval.retrieval_metrics import (
    evaluate_retrieval_query,
)

# ==============================================================================
# 1. Chunker Unit Tests
# ==============================================================================


def test_naive_flat_chunker_slices_without_structure():
    """NaiveFlatChunker should slice arbitrary character windows and have no bbox or provenance."""
    chunker = NaiveFlatChunker(chunk_size=100, chunk_overlap=20)
    elements = [
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=0, y_min=0, x_max=100, y_max=50),
            reading_order=0,
            text="First sentence in document with some length.",
        ),
        Element(
            type=ElementType.TABLE,
            page=1,
            bbox=BoundingBox(x_min=0, y_min=60, x_max=100, y_max=200),
            reading_order=1,
            text="Table header row and data rows concatenated naively.",
        ),
    ]

    chunks = chunker.chunk_elements(elements, doc_id="doc-test")
    assert len(chunks) >= 1
    for c in chunks:
        assert c.chunk_type == "naive_flat"
        assert c.bbox is None
        assert c.provenance is None
        assert c.source_file_hash is None


def test_structured_element_chunker_preserves_table_whole():
    """StructuredElementChunker must format tables into whole markdown blocks with cells intact."""
    cells = [
        TableCell(row_index=0, col_index=0, text="Metric", is_header=True),
        TableCell(row_index=0, col_index=1, text="2025", is_header=True),
        TableCell(row_index=1, col_index=0, text="Revenue", is_header=False),
        TableCell(row_index=1, col_index=1, text="$412.5M", is_header=False),
    ]
    elem = Element(
        type=ElementType.TABLE,
        page=1,
        bbox=BoundingBox(x_min=50, y_min=100, x_max=500, y_max=300),
        reading_order=0,
        text="Table 1: Financial Performance",
        table_cells=cells,
    )

    chunker = StructuredElementChunker()
    chunks = chunker.chunk_elements([elem], doc_id="doc-001", file_hash="hash-abc-123")

    assert len(chunks) == 1
    chunk = chunks[0]
    assert chunk.chunk_type == "structured_table"
    assert chunk.source_file_hash == "hash-abc-123"
    assert "| Metric | 2025 |" in chunk.text
    assert "| Revenue | $412.5M |" in chunk.text
    assert chunk.bbox.x_min == 50.0


def test_structured_element_chunker_preserves_formula_latex():
    """StructuredElementChunker must preserve LaTeX formula strings without truncation."""
    formula_obj = FormulaData(
        latex=r"\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{Q K^T}{\sqrt{d_k}}\right) V",
        is_display=True,
    )
    elem = Element(
        type=ElementType.FORMULA,
        page=1,
        bbox=BoundingBox(x_min=60, y_min=200, x_max=400, y_max=250),
        reading_order=1,
        text="Attention formula",
        formula=formula_obj,
    )

    chunker = StructuredElementChunker()
    chunks = chunker.chunk_elements([elem], doc_id="doc-002")

    assert len(chunks) == 1
    assert chunks[0].chunk_type == "structured_formula"
    assert r"\text{Attention}(Q, K, V)" in chunks[0].text
    assert r"\sqrt{d_k}" in chunks[0].text


def test_structured_element_chunker_attaches_provenance_and_confidence():
    """StructuredElementChunker on EnrichedElement must attach provenance, confidence, and degraded flags."""
    prov = ProvenanceRecord(
        element_id="elem-test",
        source_file_hash="sha256-verified-digest",
        page_number=2,
        bbox=BoundingBox(x_min=10, y_min=20, x_max=200, y_max=100),
        extractor_name="TestExtractor",
        extractor_version="1.0.0",
        config_id="O3-v1.0.0",
    )
    signals = ConfidenceSignals(
        raw_confidence=0.88,
        combined_confidence=0.85,
        calibrated_confidence=0.91,
    )
    elem = Element(
        type=ElementType.TEXT,
        page=2,
        bbox=BoundingBox(x_min=10, y_min=20, x_max=200, y_max=100),
        reading_order=0,
        text="Verified audited paragraph.",
    )
    enriched = EnrichedElement(
        element=elem,
        provenance=prov,
        confidence_signals=signals,
    )

    chunker = StructuredElementChunker()
    chunks = chunker.chunk_elements([enriched], doc_id="doc-005")

    assert len(chunks) == 1
    c = chunks[0]
    assert c.source_file_hash == "sha256-verified-digest"
    assert c.calibrated_confidence == 0.91
    assert c.page_number == 2
    assert c.provenance.extractor_name == "TestExtractor"


# ==============================================================================
# 2. Embedding and FAISS Retriever Unit Tests
# ==============================================================================


def test_dense_deterministic_embedding_properties():
    """Embedding vectors must be float32, unit normalized (L2=1.0), and deterministic."""
    embedder = DenseDeterministicEmbedding(dimension=128, seed=42)
    vec1 = embedder.embed_query("Enterprise Cloud Revenue")
    vec2 = embedder.embed_query("Enterprise Cloud Revenue")

    assert vec1.shape == (1, 128)
    assert vec1.dtype == np.float32
    assert np.allclose(vec1, vec2)  # Deterministic

    norm = np.linalg.norm(vec1)
    assert pytest.approx(norm, abs=1e-5) == 1.0


def test_faiss_retriever_ranking_and_retrieval():
    """FaissRetriever must index chunks and retrieve highest semantic match at rank 1."""
    retriever = FaissRetriever()
    chunks = [
        Chunk(
            chunk_id="c1",
            text="Enterprise Cloud revenue expanded to $189.5M in 2025.",
            chunk_type="structured_text",
            source_doc_id="doc-001",
        ),
        Chunk(
            chunk_id="c2",
            text="Attention(Q, K, V) scaled dot product formula.",
            chunk_type="structured_formula",
            source_doc_id="doc-002",
        ),
        Chunk(
            chunk_id="c3",
            text="IRS Form W-9 Employer Identification Number EIN.",
            chunk_type="structured_text",
            source_doc_id="doc-006",
        ),
    ]

    retriever.index(chunks)
    results = retriever.retrieve("What was the Enterprise Cloud revenue?", top_k=2)

    assert len(results) == 2
    assert results[0].chunk.chunk_id == "c1"
    assert results[0].rank == 1
    assert results[0].score > results[1].score


# ==============================================================================
# 3. Retrieval Metrics and KPI-3 Rubric Unit Tests
# ==============================================================================


def test_evaluate_retrieval_query_hit_and_mrr():
    """Verify hit@k, MRR, and answer grounding calculation for a query."""
    query_rec = {
        "question_id": "q-toy",
        "gold_doc_id": "doc-001",
        "gold_element_id": "elem-101",
        "expected_answer": "412.5M",
        "target_keywords": ["revenue", "412.5M"],
        "question_type": "prose_fact_lookup",
    }
    chunks = [
        Chunk(
            chunk_id="c-irrelevant",
            text="Unrelated legal boilerplate text.",
            source_doc_id="doc-999",
        ),
        Chunk(
            chunk_id="c-gold",
            text="Consolidated revenue reached $412.5M in fiscal 2025.",
            source_doc_id="doc-001",
            element_ids=["elem-101"],
        ),
    ]

    from backend.retrieval.schema import RetrievalResult

    results = [
        RetrievalResult(chunk=chunks[0], score=0.85, rank=1),
        RetrievalResult(chunk=chunks[1], score=0.80, rank=2),
    ]

    eval_res = evaluate_retrieval_query(query_rec, results, k_values=[1, 3, 5])

    assert eval_res["first_hit_rank"] == 2
    assert eval_res["reciprocal_rank"] == 0.5  # 1/2
    assert eval_res["hit_at_1"] == 0.0
    assert eval_res["hit_at_3"] == 1.0
    assert eval_res["hit_at_5"] == 1.0
    assert eval_res["answer_grounding"] == 0.0  # Top-1 was irrelevant


def test_cohens_kappa_perfect_agreement():
    """Identical scores must yield Cohen's Kappa = 1.0."""
    scores1 = [25.0, 55.0, 78.0, 95.0, 88.0, 30.0]
    scores2 = [25.0, 55.0, 78.0, 95.0, 88.0, 30.0]

    unweighted, weighted = calculate_cohens_kappa(scores1, scores2)
    assert unweighted == 1.0
    assert weighted == 1.0


def test_cohens_kappa_disagreement():
    """Opposite scores must yield non-positive Cohen's Kappa."""
    scores1 = [15.0, 20.0, 30.0, 35.0]  # All Tier 0
    scores2 = [90.0, 95.0, 92.0, 89.0]  # All Tier 3

    unweighted, weighted = calculate_cohens_kappa(scores1, scores2)
    assert unweighted <= 0.0
    assert weighted <= 0.0


def test_kpi3_scoring_rubric_criteria():
    """Verify KPI-3 criteria C1-C5 points mapping on a gold audited chunk."""
    query = {
        "question_id": "q-1",
        "gold_doc_id": "doc-001",
        "gold_element_id": "elem-103",
        "expected_answer": "189.5",
        "target_keywords": ["Enterprise Cloud", "189.5"],
        "question_type": "table_lookup",
    }
    chunk = Chunk(
        chunk_id="c_top",
        text="| Segment | 2025 ($M) |\n|---|---|\n| Enterprise Cloud | 189.5 |",
        chunk_type="structured_table",
        source_doc_id="doc-001",
        source_file_hash="sha256-hash-doc-001",
        page_number=1,
        bbox=BoundingBox(x_min=50, y_min=200, x_max=700, y_max=400),
        element_ids=["elem-103"],
        calibrated_confidence=0.96,
        is_degraded=False,
    )

    scores = score_chunk_kpi3(query, chunk, noise_variance=0.0)
    assert scores["c1_grounding"] == 20.0  # Exact answer and doc match
    assert scores["c2_modality"] == 20.0   # Whole markdown table preserved
    assert scores["c3_provenance"] == 20.0 # Hash + bbox + page + element
    assert scores["c4_reading_order"] == 19.0 # Structured layout recovered
    assert scores["c5_confidence"] == 19.0 # Calibrated confidence
    assert scores["total_score"] >= 95.0   # Exemplary Anchor 100 tier
