"""Degraded Path Routing Engine for Low-Confidence Document Elements.

Identifies low-confidence and structurally degraded elements and routes them
to designated fallback strategies (raw slice retention, bounding box expansion,
or human-in-the-loop audit queues).
"""

from typing import List

from backend.extractors.base import Element
from backend.provenance.config import ProvenanceConfig
from backend.provenance.schema import ConfidenceSignals, DegradedRoutingRecord


class DegradedPathRouter:
    """Routes document elements based on calibrated multi-signal confidence."""

    def __init__(self, config: ProvenanceConfig) -> None:
        self.config = config

    def evaluate_and_route(
        self,
        element: Element,
        confidence_signals: ConfidenceSignals,
        is_critical: bool = False,
    ) -> DegradedRoutingRecord:
        """Evaluate element confidence and assign degraded routing status."""
        score = confidence_signals.calibrated_confidence
        reasons: List[str] = []

        threshold = (
            self.config.critical_scene_strict_threshold
            if is_critical
            else self.config.low_confidence_threshold
        )

        is_low_confidence = score < threshold

        if is_low_confidence:
            reasons.append(
                f"Calibrated confidence {score:.4f} is below the required threshold {threshold:.2f} "
                f"({'critical element' if is_critical else 'standard element'})."
            )

        if confidence_signals.dual_agreement_score is not None and confidence_signals.dual_agreement_score < 0.40:
            reasons.append(
                f"Extremely low cross-extractor agreement ({confidence_signals.dual_agreement_score:.4f}): "
                "extractors diverged significantly on element boundaries or text content."
            )

        if confidence_signals.table_consistency_score is not None and confidence_signals.table_consistency_score < 0.70:
            reasons.append(
                f"Table topological inconsistency detected ({confidence_signals.table_consistency_score:.4f}): "
                "cell coordinates overlap or spans exceed table grid limits."
            )

        if not reasons:
            return DegradedRoutingRecord(
                is_degraded=False,
                routing_action="STANDARD_PASS",
                reasons=[],
                fallback_strategy="NONE",
                fallback_data=None,
            )

        routing_action = (
            "CRITICAL_REVIEW_REQUIRED"
            if is_critical
            else "DEGRADED_FALLBACK"
        )

        # Prepare fallback data payload depending on configured strategy
        strategy = self.config.fallback_strategy
        fallback_data = {
            "strategy": strategy,
            "original_bbox": [element.bbox.x_min, element.bbox.y_min, element.bbox.x_max, element.bbox.y_max],
            "raw_text_snippet": element.text[:120],
        }

        if strategy == "BOUNDING_BOX_UNION":
            # Expand bounding box by 10% to prevent clipped visual segments in spatial retrieval
            w_pad = element.bbox.width * 0.10
            h_pad = element.bbox.height * 0.10
            fallback_data["expanded_bbox"] = [
                max(0.0, element.bbox.x_min - w_pad),
                max(0.0, element.bbox.y_min - h_pad),
                element.bbox.x_max + w_pad,
                element.bbox.y_max + h_pad,
            ]
        elif strategy == "HUMAN_REVIEW_QUEUE":
            fallback_data["review_priority"] = "HIGH" if is_critical else "MEDIUM"
            fallback_data["flagged_element_id"] = element.metadata.get("id", "elem_unknown")

        return DegradedRoutingRecord(
            is_degraded=True,
            routing_action=routing_action,
            reasons=reasons,
            fallback_strategy=strategy,
            fallback_data=fallback_data,
        )

