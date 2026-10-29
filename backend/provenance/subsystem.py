"""Master Subsystem Controller for Provenance, Calibrated Confidence, and Degraded Routing.

Can be dynamically enabled or disabled via ProvenanceConfig.
"""

from copy import deepcopy
from pathlib import Path
from typing import List, Optional

from backend.extractors.base import Element
from backend.provenance.calibration import apply_platt_scaling, combine_confidence_signals
from backend.provenance.config import ProvenanceConfig
from backend.provenance.routing import DegradedPathRouter
from backend.provenance.schema import (
    ConfidenceSignals,
    EnrichedElement,
    ProvenanceRecord,
)
from backend.provenance.signals import (
    compute_dual_extractor_agreement,
    compute_file_sha256,
    compute_reading_order_agreement,
    compute_table_structural_consistency,
)


class ProvenanceSubsystem:
    """Isolated subsystem managing provenance lineage, multi-signal confidence, and degraded routing."""

    def __init__(self, config: Optional[ProvenanceConfig] = None) -> None:
        self.config = config or ProvenanceConfig()
        self.router = DegradedPathRouter(self.config)

    def process_elements(
        self,
        elements: List[Element],
        pdf_path: str | Path,
        secondary_elements: Optional[List[Element]] = None,
        recovered_elements: Optional[List[Element]] = None,
        extractor_name: str = "UnknownExtractor",
        extractor_version: str = "1.0.0",
    ) -> List[EnrichedElement]:
        """Process document elements through provenance tracking and confidence calibration.

        If subsystem is disabled (config.enabled = False), elements pass through with minimal wrapper.
        """
        if not elements:
            return []

        # If subsystem is switched OFF, return immediately without computation overhead
        if not self.config.enabled:
            return [
                EnrichedElement(
                    element=el,
                    provenance=None,
                    confidence_signals=None,
                    routing=None,
                )
                for el in elements
            ]

        path_obj = Path(pdf_path).resolve()
        file_hash = (
            compute_file_sha256(path_obj)
            if self.config.provenance_tracking_enabled and path_obj.exists()
            else "unknown_file_hash_00000000"
        )

        total_count = len(elements)
        enriched_list: List[EnrichedElement] = []

        # Map recovered sequence index for reading order concordance
        recovered_idx_map = {}
        if recovered_elements:
            for idx, rec_el in enumerate(recovered_elements):
                # Match by text or bbox
                key = (rec_el.page, round(rec_el.bbox.x_min, 1), round(rec_el.bbox.y_min, 1))
                recovered_idx_map[key] = idx

        for i, el in enumerate(elements):
            element_copy = deepcopy(el)
            element_id = f"{file_hash[:8]}_p{el.page}_el{i:04d}"

            # 1. Provenance Audit Record
            prov_record = None
            if self.config.provenance_tracking_enabled:
                prov_record = ProvenanceRecord(
                    element_id=element_id,
                    source_file_hash=file_hash,
                    page_number=el.page,
                    bbox=el.bbox,
                    extractor_name=el.metadata.get("extractor_name", extractor_name),
                    extractor_version=el.metadata.get("extractor_version", extractor_version),
                    config_id=self.config.config_id,
                    parent_element_id=el.metadata.get("parent_id"),
                )

            # 2. Independent Validation Signals
            dual_agreement = None
            if secondary_elements is not None:
                dual_agreement = compute_dual_extractor_agreement(el, secondary_elements)

            table_consistency = None
            if el.type.value == "table":
                table_consistency = compute_table_structural_consistency(el)

            reading_order_score = None
            key = (el.page, round(el.bbox.x_min, 1), round(el.bbox.y_min, 1))
            if key in recovered_idx_map:
                reading_order_score = compute_reading_order_agreement(
                    i, recovered_idx_map[key], total_count
                )

            # 3. Multi-Signal Combined Confidence
            raw_conf = float(el.raw_confidence)
            combined_conf = combine_confidence_signals(
                raw_confidence=raw_conf,
                dual_agreement=dual_agreement,
                table_consistency=table_consistency,
                reading_order_score=reading_order_score,
                config=self.config,
            )

            # 4. Platt Scaling Calibration
            calibrated_conf = combined_conf
            if self.config.calibration_enabled:
                calibrated_conf = apply_platt_scaling(
                    combined_conf,
                    scale_a=self.config.platt_scale_a,
                    shift_b=self.config.platt_shift_b,
                )

            conf_signals = ConfidenceSignals(
                raw_confidence=round(raw_conf, 4),
                dual_agreement_score=dual_agreement,
                table_consistency_score=table_consistency,
                reading_order_score=reading_order_score,
                combined_confidence=combined_conf,
                calibrated_confidence=calibrated_conf,
            )

            # Update element's internal confidence to reflect calibrated score
            element_copy.raw_confidence = calibrated_conf

            # 5. Degraded Path Routing
            is_critical = el.metadata.get("is_critical", False)
            routing_record = self.router.evaluate_and_route(
                element=element_copy,
                confidence_signals=conf_signals,
                is_critical=is_critical,
            )

            enriched_list.append(
                EnrichedElement(
                    element=element_copy,
                    provenance=prov_record,
                    confidence_signals=conf_signals,
                    routing=routing_record,
                )
            )

        return enriched_list

