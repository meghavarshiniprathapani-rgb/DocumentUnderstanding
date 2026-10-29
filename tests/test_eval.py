"""
Retrieva AI — Evaluation Suite Tests
Validates IoU calculations, metric formulas, and evaluation runner output.
"""

from eval.metrics import (
    calculate_f1_score,
    calculate_iou,
    calculate_precision_recall,
)
from eval.runner import run_evaluation


def test_calculate_iou_exact_match():
    """Identical bounding boxes must yield IoU = 1.0."""
    box_a = (50.0, 50.0, 100.0, 100.0)
    assert calculate_iou(box_a, box_a) == 1.0


def test_calculate_iou_disjoint():
    """Non-overlapping bounding boxes must yield IoU = 0.0."""
    box_a = (0.0, 0.0, 50.0, 50.0)
    box_b = (100.0, 100.0, 50.0, 50.0)
    assert calculate_iou(box_a, box_b) == 0.0


def test_calculate_iou_partial_overlap():
    """Partially overlapping boxes must yield valid ratio 0 < IoU < 1."""
    box_a = (0.0, 0.0, 10.0, 10.0)  # area = 100
    box_b = (5.0, 0.0, 10.0, 10.0)  # overlap = 5x10 = 50, union = 150
    iou = calculate_iou(box_a, box_b)
    assert round(iou, 3) == round(50.0 / 150.0, 3)


def test_precision_recall_and_f1():
    """Validates harmonic mean F1 score calculation."""
    precision, recall = calculate_precision_recall(tp=80, fp=20, fn=20)
    assert precision == 0.8
    assert recall == 0.8
    f1 = calculate_f1_score(precision, recall)
    assert round(f1, 2) == 0.80

    # Zero edge cases
    assert calculate_f1_score(0.0, 0.0) == 0.0


def test_evaluation_runner_records_config_version(test_settings, tmp_path):
    """Ensures evaluation runner executes cleanly and records config_version in output."""
    output = run_evaluation(output_dir=tmp_path)
    assert output["config_version"] == test_settings.config_version
    assert "benchmarks" in output
    assert "FUNSD" in output["benchmarks"]
    assert "CORD" in output["benchmarks"]
    assert output["aggregate_metrics"]["status"] == "PASS"

    # Verify JSON report file was written
    expected_file = tmp_path / f"eval_report_v{test_settings.config_version}.json"
    assert expected_file.exists()
