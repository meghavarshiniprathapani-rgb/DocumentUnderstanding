"""Confidence Calibration Engine for Retrieva AI.

Implements Platt scaling calibration, multi-signal confidence combination,
and Expected Calibration Error (ECE) with reliability curve generation.
"""

import math
from typing import List, Sequence, Tuple

from backend.provenance.config import ProvenanceConfig
from backend.provenance.schema import CalibrationReport, ReliabilityBin


def combine_confidence_signals(
    raw_confidence: float,
    dual_agreement: float | None,
    table_consistency: float | None,
    reading_order_score: float | None,
    config: ProvenanceConfig,
) -> float:
    """Compute weighted combination of raw confidence and independent signals."""
    weights = [config.weight_raw_confidence]
    scores = [raw_confidence]

    if dual_agreement is not None:
        weights.append(config.weight_dual_agreement)
        scores.append(dual_agreement)

    if table_consistency is not None:
        weights.append(config.weight_table_consistency)
        scores.append(table_consistency)

    if reading_order_score is not None:
        weights.append(config.weight_reading_order_agreement)
        scores.append(reading_order_score)

    total_weight = sum(weights)
    if total_weight <= 0.0:
        return raw_confidence

    combined = sum(w * s for w, s in zip(weights, scores)) / total_weight
    return round(float(max(0.01, min(0.99, combined))), 4)


def apply_platt_scaling(
    probability: float,
    scale_a: float = 1.20,
    shift_b: float = -0.15,
) -> float:
    """Calibrate confidence probability using Platt scaling sigmoid transform."""
    # Clamp to avoid numerical singularity in logit
    p = max(0.001, min(0.999, probability))
    # Compute log-odds logit
    logit = math.log(p / (1.0 - p))
    # Sigmoidal Platt transform
    calibrated_z = (scale_a * logit) + shift_b
    calibrated_p = 1.0 / (1.0 + math.exp(-calibrated_z))
    return round(float(max(0.01, min(0.99, calibrated_p))), 4)


def compute_expected_calibration_error(
    confidences: Sequence[float],
    accuracies: Sequence[float | int],
    num_bins: int = 10,
) -> CalibrationReport:
    """Compute Expected Calibration Error (ECE), MCE, and reliability curve bins.

    Args:
        confidences: Predicted confidence probabilities in [0.0, 1.0].
        accuracies: Binary empirical correctness (1 for accurate, 0 for failure) or [0.0, 1.0].
        num_bins: Number of equal-width bins (default 10: 0.1 intervals).

    Returns:
        CalibrationReport with ECE, MCE, Brier score, and bin details.
    """
    if len(confidences) != len(accuracies):
        raise ValueError(f"Lengths mismatch: confidences ({len(confidences)}) vs accuracies ({len(accuracies)})")

    n = len(confidences)
    if n == 0:
        return CalibrationReport(
            expected_calibration_error=0.0,
            max_calibration_error=0.0,
            brier_score=0.0,
            num_samples=0,
            bins=[],
        )

    bin_width = 1.0 / num_bins
    bins_data: List[ReliabilityBin] = []
    total_weighted_ece = 0.0
    max_ce = 0.0
    brier_sum = 0.0

    for m in range(num_bins):
        bin_lower = m * bin_width
        bin_upper = (m + 1) * bin_width

        # Include upper boundary in the last bin
        bin_indices = [
            i for i, c in enumerate(confidences)
            if (bin_lower <= c < bin_upper) or (m == num_bins - 1 and bin_lower <= c <= bin_upper)
        ]
        bin_count = len(bin_indices)

        if bin_count > 0:
            bin_conf_mean = sum(confidences[i] for i in bin_indices) / bin_count
            bin_acc_mean = sum(accuracies[i] for i in bin_indices) / bin_count
            cal_error = abs(bin_conf_mean - bin_acc_mean)

            total_weighted_ece += (bin_count / n) * cal_error
            max_ce = max(max_ce, cal_error)
        else:
            bin_conf_mean = (bin_lower + bin_upper) / 2.0
            bin_acc_mean = 0.0
            cal_error = 0.0

        bins_data.append(
            ReliabilityBin(
                bin_index=m,
                bin_lower=round(bin_lower, 3),
                bin_upper=round(bin_upper, 3),
                element_count=bin_count,
                mean_confidence=round(bin_conf_mean, 4),
                accuracy=round(bin_acc_mean, 4),
                calibration_error=round(cal_error, 4),
            )
        )

    for c, a in zip(confidences, accuracies):
        brier_sum += (c - float(a)) ** 2

    brier_score = brier_sum / n

    return CalibrationReport(
        expected_calibration_error=round(total_weighted_ece, 4),
        max_calibration_error=round(max_ce, 4),
        brier_score=round(brier_score, 4),
        num_samples=n,
        bins=bins_data,
    )


def fit_platt_parameters(
    raw_confidences: Sequence[float],
    empirical_accuracies: Sequence[float | int],
) -> Tuple[float, float]:
    """Fit Platt scaling parameters (scale_a, shift_b) on dev data using log-likelihood gradient descent."""
    if len(raw_confidences) < 5:
        return 1.20, -0.15  # Return default calibrated parameters if data too small

    a = 1.0
    b = 0.0
    lr = 0.05
    epochs = 150

    logits = [
        math.log(max(0.001, min(0.999, c)) / (1.0 - max(0.001, min(0.999, c))))
        for c in raw_confidences
    ]
    targets = [float(acc) for acc in empirical_accuracies]
    m = len(logits)

    for _ in range(epochs):
        grad_a = 0.0
        grad_b = 0.0
        for z, y in zip(logits, targets):
            p = 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, a * z + b))))
            err = p - y
            grad_a += err * z
            grad_b += err

        a -= lr * (grad_a / m)
        b -= lr * (grad_b / m)
        a = max(0.20, min(5.0, a))  # Positive scale bound

    return round(float(a), 4), round(float(b), 4)

