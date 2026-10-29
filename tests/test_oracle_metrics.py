"""
Retrieva AI — Independent Oracle Metrics Unit Tests
Tests reading order accuracy, table structure fidelity, formula extraction match,
critical-scene failure rate, and bootstrap confidence intervals using hand-made toy examples
with analytically known correct scores.
"""

import pytest

from eval.metrics import (
    calculate_bootstrap_ci,
    calculate_critical_scene_failure_rate,
    calculate_formula_match,
    calculate_per_condition_breakdowns,
    calculate_reading_order_accuracy,
    calculate_table_structure_fidelity,
    calculate_teds_style_score,
)
from eval.oracle_schema import (
    BoundingBox,
    GroundTruthElement,
    PageGroundTruth,
    TableAnnotation,
    TableCellAnnotation,
)

# ==============================================================================
# 1. Reading-Order Accuracy Tests (Hand-Made Toy Permutations)
# ==============================================================================


def test_reading_order_perfect_match():
    """
    Toy Example 1: Perfect reading order [0, 1, 2, 3] vs [0, 1, 2, 3].
    Expected:
      - Concordant pairs: 6/6
      - Pairwise order accuracy: 1.0000
      - Kendall's Tau: 1.0000
      - Normalized Kendall Tau: 1.0000
    """
    gt_order = ["elem-A", "elem-B", "elem-C", "elem-D"]
    pred_order = ["elem-A", "elem-B", "elem-C", "elem-D"]

    res = calculate_reading_order_accuracy(pred_order, gt_order)
    assert res["pairwise_order_accuracy"] == 1.0
    assert res["kendall_tau"] == 1.0
    assert res["normalized_kendall_tau"] == 1.0
    assert res["evaluated_pairs"] == 6


def test_reading_order_complete_reversal():
    """
    Toy Example 2: Complete reversal [3, 2, 1, 0] vs [0, 1, 2, 3].
    Expected:
      - Concordant pairs: 0/6
      - Discordant pairs: 6/6
      - Pairwise order accuracy: 0.0000
      - Kendall's Tau: -1.0000
      - Normalized Kendall Tau: 0.0000
    """
    gt_order = ["elem-A", "elem-B", "elem-C", "elem-D"]
    pred_order = ["elem-D", "elem-C", "elem-B", "elem-A"]

    res = calculate_reading_order_accuracy(pred_order, gt_order)
    assert res["pairwise_order_accuracy"] == 0.0
    assert res["kendall_tau"] == -1.0
    assert res["normalized_kendall_tau"] == 0.0
    assert res["evaluated_pairs"] == 6


def test_reading_order_single_adjacent_swap():
    """
    Toy Example 3: Single adjacent swap [0, 2, 1, 3] vs [0, 1, 2, 3].
    Pairs:
      (A, B) -> Concordant (A before B)
      (A, C) -> Concordant (A before C)
      (A, D) -> Concordant (A before D)
      (B, C) -> Discordant (C before B in pred!)
      (B, D) -> Concordant (B before D)
      (C, D) -> Concordant (C before D)
    Expected:
      - Concordant: 5, Discordant: 1, Total: 6
      - Pairwise order accuracy: 5/6 = 0.8333
      - Kendall's Tau: (5 - 1)/6 = 4/6 = 0.6667
      - Normalized Kendall Tau: (0.6667 + 1) / 2 = 0.8333
    """
    gt_order = ["A", "B", "C", "D"]
    pred_order = ["A", "C", "B", "D"]

    res = calculate_reading_order_accuracy(pred_order, gt_order)
    assert res["pairwise_order_accuracy"] == 0.8333
    assert res["kendall_tau"] == 0.6667
    assert res["normalized_kendall_tau"] == 0.8333
    assert res["evaluated_pairs"] == 6


def test_reading_order_single_or_empty_element():
    """Edge cases: single element or empty list must yield 1.0."""
    res_single = calculate_reading_order_accuracy(["A"], ["A"])
    assert res_single["pairwise_order_accuracy"] == 1.0
    assert res_single["kendall_tau"] == 1.0

    res_empty = calculate_reading_order_accuracy([], [])
    assert res_empty["pairwise_order_accuracy"] == 1.0


# ==============================================================================
# 2. Table Structure Fidelity Tests (Cell Adjacency & TEDS)
# ==============================================================================


def test_table_structure_exact_2x2():
    """
    Toy Example 1: Identical 2x2 table grid.
    Grid:
      [A] [B]
      [C] [D]
    Adjacency relations:
      - right: (A, B), (C, D)
      - down:  (A, C), (B, D)
    Total relations: 4.
    Expected:
      - Precision: 1.0, Recall: 1.0, F1: 1.0
    """
    cells = [
        {"cell_id": "c00", "row_index": 0, "col_index": 0, "row_span": 1, "col_span": 1, "content": "A"},
        {"cell_id": "c01", "row_index": 0, "col_index": 1, "row_span": 1, "col_span": 1, "content": "B"},
        {"cell_id": "c10", "row_index": 1, "col_index": 0, "row_span": 1, "col_span": 1, "content": "C"},
        {"cell_id": "c11", "row_index": 1, "col_index": 1, "row_span": 1, "col_span": 1, "content": "D"},
    ]

    res = calculate_table_structure_fidelity(cells, cells)
    assert res["precision"] == 1.0
    assert res["recall"] == 1.0
    assert res["f1_score"] == 1.0
    assert res["relations_count"] == 4


def test_table_structure_spanning_cell():
    """
    Toy Example 2: Table with column-spanning header vs flat 2x2 grid.
    Ground Truth:
      Row 0: [Header (spans 2 cols)]
      Row 1: [B]  [C]
      GT Relations:
        - down:  (Header, B), (Header, C)
        - right: (B, C)
        Total GT relations = 3.

    Predicted: Flat 2x2 grid where Header was split into [Header_L] and [Header_R]
      Row 0: [Header_L] [Header_R]
      Row 1: [B]        [C]
      Pred Relations:
        - right: (Header_L, Header_R), (B, C)
        - down:  (Header_L, B), (Header_R, C)
        Total Pred relations = 4.

    Intersection of relations:
      - Common matching relations: ('right', 'B', 'C') only! (1 relation)
    Expected:
      - TP = 1
      - FP = 3 (pred had 4)
      - FN = 2 (gt had 3)
      - Precision = 1/4 = 0.25
      - Recall = 1/3 = 0.3333
      - F1 = 2 * (0.25 * 0.3333) / (0.25 + 0.3333) = 0.2857
    """
    gt_cells = [
        {"cell_id": "h", "row_index": 0, "col_index": 0, "row_span": 1, "col_span": 2, "content": "Header"},
        {"cell_id": "b", "row_index": 1, "col_index": 0, "row_span": 1, "col_span": 1, "content": "B"},
        {"cell_id": "c", "row_index": 1, "col_index": 1, "row_span": 1, "col_span": 1, "content": "C"},
    ]

    pred_cells = [
        {"cell_id": "hl", "row_index": 0, "col_index": 0, "row_span": 1, "col_span": 1, "content": "Header_L"},
        {"cell_id": "hr", "row_index": 0, "col_index": 1, "row_span": 1, "col_span": 1, "content": "Header_R"},
        {"cell_id": "b", "row_index": 1, "col_index": 0, "row_span": 1, "col_span": 1, "content": "B"},
        {"cell_id": "c", "row_index": 1, "col_index": 1, "row_span": 1, "col_span": 1, "content": "C"},
    ]

    res = calculate_table_structure_fidelity(pred_cells, gt_cells)
    assert res["precision"] == 0.25
    assert res["recall"] == 0.3333
    assert res["f1_score"] == 0.2857
    assert res["relations_count"] == 3


def test_teds_style_table_score():
    """Validates TEDS-style normalized tree edit similarity."""
    t1 = {
        "num_rows": 2,
        "num_cols": 2,
        "cells": [
            {"row_index": 0, "col_index": 0, "content": "Rev"},
            {"row_index": 0, "col_index": 1, "content": "2025"},
        ],
    }
    # Exact match
    assert calculate_teds_style_score(t1, t1) == 1.0

    # Slight modification
    t2 = {
        "num_rows": 2,
        "num_cols": 2,
        "cells": [
            {"row_index": 0, "col_index": 0, "content": "Revenue"},  # modified content
            {"row_index": 0, "col_index": 1, "content": "2025"},
        ],
    }
    score = calculate_teds_style_score(t2, t1)
    assert 0.0 < score < 1.0


# ==============================================================================
# 3. Formula Extraction Match Tests
# ==============================================================================


def test_formula_exact_match():
    """Identical raw formula strings must yield 1.0 score and exact_match=True."""
    f = "\\text{Attention}(Q, K, V) = \\text{softmax}\\left(\\frac{Q K^T}{\\sqrt{d_k}}\\right) V"
    res = calculate_formula_match(f, f)
    assert res["exact_match"] is True
    assert res["normalized_match"] is True
    assert res["score"] == 1.0


def test_formula_syntactic_normalization_match():
    """
    Toy Example: Formatting variance (delimiters, spacing, left/right brackets)
    Formula 1: "$$ E = m c^2 $$"
    Formula 2: "E=mc^{2}"
    Normalizes to identical syntax: "E=mc^{2}" or "E=mc^2".
    """
    f1 = "$$ E = m c^2 $$"
    f2 = "E=mc^2"

    res = calculate_formula_match(f1, f2)
    assert res["normalized_match"] is True
    assert res["score"] == 1.0


def test_formula_single_character_alteration():
    """
    Toy Example: Variable change E = mc^2 vs E = mc^3
    Known character distance = 1.
    Normalized length = 6 ('E=mc^2').
    Character edit similarity = 1.0 - 1/6 = 0.8333.
    """
    f1 = "E = mc^2"
    f2 = "E = mc^3"

    res = calculate_formula_match(f1, f2)
    assert res["exact_match"] is False
    assert res["normalized_match"] is False
    assert res["character_edit_similarity"] == 0.8333
    assert 0.70 < res["score"] < 1.0


# ==============================================================================
# 4. Critical-Scene Failure Rate (CSFR) Tests
# ==============================================================================


def test_critical_scene_zero_failure():
    """All critical scenes detected accurately -> CSFR = 0.0."""
    gt_elements = [
        {
            "id": "e1",
            "type": "heading",
            "bbox": [50.0, 50.0, 700.0, 40.0],
            "text": "FINANCIAL EARNINGS",
            "is_critical": True,
        },
        {
            "id": "e2",
            "type": "text",
            "bbox": [50.0, 100.0, 700.0, 80.0],
            "text": "Net income grew significantly.",
            "is_critical": True,
        },
        {
            "id": "e3",
            "type": "text",
            "bbox": [50.0, 200.0, 700.0, 50.0],
            "text": "Footnote disclaimer.",
            "is_critical": False,  # Non-critical
        },
    ]

    pred_elements = [
        {
            "type": "heading",
            "bbox": [50.0, 50.0, 700.0, 40.0],
            "text": "FINANCIAL EARNINGS",
        },
        {
            "type": "text",
            "bbox": [50.0, 100.0, 700.0, 80.0],
            "text": "Net income grew significantly.",
        },
    ]

    res = calculate_critical_scene_failure_rate(pred_elements, gt_elements)
    assert res["total_critical"] == 2
    assert res["failed_critical"] == 0
    assert res["passed_critical"] == 2
    assert res["failure_rate"] == 0.0
    assert res["status"] == "PASS"


def test_critical_scene_omission_failure():
    """
    Toy Example: 2 critical scenes, 1 omitted by extractor.
    Expected:
      - Total critical: 2
      - Failed critical: 1
      - CSFR: 1/2 = 0.5000
    """
    gt_elements = [
        {"id": "e1", "type": "heading", "bbox": [0, 0, 100, 20], "text": "H1", "is_critical": True},
        {"id": "e2", "type": "text", "bbox": [0, 30, 100, 50], "text": "C2", "is_critical": True},
    ]
    # Prediction only extracted e1
    pred_elements = [
        {"type": "heading", "bbox": [0, 0, 100, 20], "text": "H1"},
    ]

    res = calculate_critical_scene_failure_rate(pred_elements, gt_elements)
    assert res["total_critical"] == 2
    assert res["failed_critical"] == 1
    assert res["failure_rate"] == 0.50
    assert res["failures"][0]["reason"] == "omission"


def test_critical_scene_misclassification_failure():
    """
    Toy Example: Critical table misclassified as generic text.
    Expected:
      - Total critical: 1
      - Failed critical: 1 (reason: misclassification)
      - CSFR: 1.0000
    """
    gt_elements = [
        {"id": "t1", "type": "table", "bbox": [10, 10, 200, 100], "text": "Table 1", "is_critical": True},
    ]
    pred_elements = [
        {"type": "text", "bbox": [10, 10, 200, 100], "text": "Table 1"},  # Misclassified as text
    ]

    res = calculate_critical_scene_failure_rate(pred_elements, gt_elements)
    assert res["total_critical"] == 1
    assert res["failed_critical"] == 1
    assert res["failure_rate"] == 1.0
    assert res["failures"][0]["reason"] == "misclassification"


# ==============================================================================
# 5. Bootstrap Confidence Intervals & Per-Condition Stratification Tests
# ==============================================================================


def test_bootstrap_ci_constant_array():
    """Array of identical values must yield zero-width CI matching the mean."""
    data = [0.85, 0.85, 0.85, 0.85, 0.85]
    mean, lower, upper = calculate_bootstrap_ci(data)
    assert mean == 0.85
    assert lower == 0.85
    assert upper == 0.85


def test_bootstrap_ci_known_sample():
    """
    Toy Example: Sample [0.70, 0.75, 0.80, 0.85, 0.90]
    Known analytical mean = 0.80.
    Asserts lower <= mean <= upper.
    """
    data = [0.70, 0.75, 0.80, 0.85, 0.90]
    mean, lower, upper = calculate_bootstrap_ci(data, n_bootstrap=1000, seed=42)
    assert mean == 0.80
    assert lower <= mean <= upper
    assert 0.70 <= lower <= 0.80
    assert 0.80 <= upper <= 0.90


def test_per_condition_breakdowns():
    """
    Toy Example: Stratified evaluation across document_type and layout_type.
    """
    records = [
        {"document_type": "financial report", "layout_type": "multi-column", "score": 0.90},
        {"document_type": "financial report", "layout_type": "multi-column", "score": 0.80},
        {"document_type": "legal", "layout_type": "single-column", "score": 0.70},
        {"document_type": "legal", "layout_type": "single-column", "score": 0.60},
    ]

    breakdowns = calculate_per_condition_breakdowns(
        records,
        metric_key="score",
        condition_keys=["document_type", "layout_type"],
        seed=42,
    )

    # Check document_type breakdown
    assert "document_type" in breakdowns
    fin = breakdowns["document_type"]["financial report"]
    assert fin["sample_count"] == 2
    assert fin["mean"] == 0.85
    assert fin["ci_95_lower"] <= 0.85 <= fin["ci_95_upper"]

    leg = breakdowns["document_type"]["legal"]
    assert leg["sample_count"] == 2
    assert leg["mean"] == 0.65

    # Check layout_type breakdown
    assert "layout_type" in breakdowns
    multi = breakdowns["layout_type"]["multi-column"]
    assert multi["mean"] == 0.85
    single = breakdowns["layout_type"]["single-column"]
    assert single["mean"] == 0.65


# ==============================================================================
# 6. Oracle Schema Pydantic Validation Tests
# ==============================================================================


def test_page_ground_truth_schema_valid():
    """Ensures PageGroundTruth validates complete multi-element structure."""
    page = PageGroundTruth(
        page_id="doc-test_p1",
        document_id="doc-test",
        page_number=1,
        elements=[
            GroundTruthElement(
                id="e1",
                type="heading",
                bbox=BoundingBox(x=10, y=10, width=100, height=30),
                reading_order=0,
                text="Title",
            ),
            GroundTruthElement(
                id="e2",
                type="table",
                bbox=BoundingBox(x=10, y=50, width=200, height=100),
                reading_order=1,
                text="Table 1",
                table=TableAnnotation(
                    num_rows=1,
                    num_cols=1,
                    cells=[
                        TableCellAnnotation(
                            cell_id="c1",
                            row_index=0,
                            col_index=0,
                            row_span=1,
                            col_span=1,
                            content="Cell content",
                        )
                    ],
                ),
            ),
        ],
    )
    assert page.page_number == 1
    assert len(page.elements) == 2


def test_page_ground_truth_rejects_duplicate_reading_orders():
    """Two elements cannot share identical reading order."""
    with pytest.raises(ValueError, match="Duplicate reading_order"):
        PageGroundTruth(
            page_id="doc-test_p1",
            document_id="doc-test",
            page_number=1,
            elements=[
                GroundTruthElement(
                    id="e1",
                    type="heading",
                    bbox=BoundingBox(x=0, y=0, width=50, height=20),
                    reading_order=0,
                    text="A",
                ),
                GroundTruthElement(
                    id="e2",
                    type="text",
                    bbox=BoundingBox(x=0, y=30, width=50, height=20),
                    reading_order=0,  # Duplicate!
                    text="B",
                ),
            ],
        )
