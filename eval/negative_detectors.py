"""Retrieva AI — Negative Anomaly Detection & Abstention Engines.

Implements detection, degraded mode routing, and silent-use prevention for:
- NT1: Scrambled multi-column reading order (horizontal zigzagging across column boundaries)
- NT2: Flattened tables into unstructured noise (missing cell grid, separator collapse)
- NT3: Extraction scored without mandatory downstream retrieval grounding check
- NT4: Preprocessing / augmentation partition leakage across dev and acceptance
- NT5: Throughput or memory failure exceeding declared workload envelope
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from backend.app.config import get_settings
from backend.extractors.base import Element, ElementType
from backend.provenance.signals import compute_table_structural_consistency
from eval.leakage import extract_doc_id_from_identifier


class NegativeTestAbstentionError(Exception):
    """Raised when the system must abstain from processing or scoring corrupted input."""

    pass


class UncheckedDownstreamRetrievalError(NegativeTestAbstentionError):
    """Raised when extraction scores are computed without mandatory downstream retrieval check."""

    pass


class WorkloadResourceEnvelopeExceededError(NegativeTestAbstentionError):
    """Raised when a document or query workload breaches throughput or memory limits."""

    pass


@dataclass
class NegativeAnomalyRecord:
    """Audit telemetry captured during a negative test execution."""

    case_id: str
    name: str
    fixture_id: str
    preconditions: str
    version: str
    config: Dict[str, Any]
    expected: Dict[str, Any]
    observed: Dict[str, Any]
    logs: List[str] = field(default_factory=list)
    recovery_time_ms: float = 0.0

    @property
    def condition_detected(self) -> bool:
        return bool(self.observed.get("condition_detected", False))

    @property
    def degraded_or_abstained(self) -> bool:
        return bool(self.observed.get("degraded_or_abstained", False))

    @property
    def output_labelled(self) -> bool:
        return bool(self.observed.get("output_labelled", False))

    @property
    def nothing_silently_used(self) -> bool:
        return bool(self.observed.get("silent_use_prevented", False))

    def to_dict(self) -> Dict[str, Any]:
        return {
            "case_id": self.case_id,
            "name": self.name,
            "fixture_id": self.fixture_id,
            "preconditions": self.preconditions,
            "version": self.version,
            "config": self.config,
            "expected": self.expected,
            "observed": self.observed,
            "logs": self.logs,
            "recovery_time_ms": round(self.recovery_time_ms, 2),
            "status": "PASS" if (
                self.condition_detected
                and self.degraded_or_abstained
                and self.output_labelled
                and self.nothing_silently_used
            ) else "FAIL"
        }


# =============================================================================
# NT1: Scrambled Multi-Column Reading Order Detector
# =============================================================================

def detect_scrambled_reading_order(elements: List[Element]) -> Tuple[bool, List[str]]:
    """Detects horizontal cross-column interleaving or scrambled reading order anomalies.

    Examines whether successive elements in reading order alternate across vertical column
    gutters (horizontal zigzag) while remaining on the same vertical band, or exhibit
    severe displacement inversions.
    """
    reasons: List[str] = []
    if len(elements) < 3:
        return False, reasons

    # Separate elements on same page
    pages: Dict[int, List[Element]] = {}
    for el in elements:
        pages.setdefault(el.page, []).append(el)

    is_scrambled = False

    for page_no, p_elements in pages.items():
        if len(p_elements) < 3:
            continue

        # Sort by declared reading_order
        ordered = sorted(p_elements, key=lambda e: e.reading_order)

        # Detect cross-column horizontal zigzag
        # A 2-column layout typically has left column center ~200-300 and right column ~500-600
        column_crossings = 0
        inversions = 0

        for i in range(len(ordered) - 1):
            curr = ordered[i]
            nxt = ordered[i + 1]

            curr_center_x = (curr.bbox.x_min + curr.bbox.x_max) / 2.0
            nxt_center_x = (nxt.bbox.x_min + nxt.bbox.x_max) / 2.0

            # If horizontal distance spans across the gutter (> 200pt)
            horizontal_jump = abs(curr_center_x - nxt_center_x)
            vertical_drop = nxt.bbox.y_min - curr.bbox.y_min

            # Horizontal jump across columns with very small or negative vertical progression
            if horizontal_jump > 200.0 and vertical_drop < 40.0:
                column_crossings += 1

            # Inversion: reading order moves upwards on page by more than 100pt without column shift
            if vertical_drop < -100.0 and horizontal_jump < 100.0:
                inversions += 1

        # In multi-column reading order, zigzagging more than once indicates scrambled cross-column reading
        if column_crossings >= 2 or inversions >= 2:
            is_scrambled = True
            reasons.append(
                f"Page {page_no}: Scrambled multi-column reading order detected ({column_crossings} horizontal cross-column jumps, {inversions} vertical inversions). Reading order cuts horizontally across columns."
            )

    return is_scrambled, reasons


# =============================================================================
# NT2: Flattened Tables Detector
# =============================================================================

def detect_flattened_table(element: Element) -> Tuple[bool, List[str]]:
    """Detects tables whose 2D cell grid structure has collapsed into noise."""
    reasons: List[str] = []
    if element.type != ElementType.TABLE:
        return False, reasons

    # 1. Check cell presence
    cells = element.table_cells or []
    if len(cells) <= 1:
        reasons.append(
            f"Flattened table detected: element labeled as TABLE contains only {len(cells)} structured cell(s). Expected multi-cell 2D grid."
        )
        return True, reasons

    # 2. Check structural consistency score
    consistency = compute_table_structural_consistency(element)
    if consistency < 0.60:
        reasons.append(
            f"Table topological noise detected: structural consistency {consistency:.2f} < 0.60 threshold. Collinear overlaps or missing row/col boundaries."
        )
        return True, reasons

    # 3. Check for single-row or single-column collapse
    row_indices = {c.row_index for c in cells}
    col_indices = {c.col_index for c in cells}
    if len(row_indices) < 2 and len(cells) > 2:
        reasons.append(
            "Flattened table detected: all cells collapsed into a single row index (separator confusion)."
        )
        return True, reasons

    if len(col_indices) < 2 and len(cells) > 2:
        reasons.append(
            "Flattened table detected: all cells collapsed into a single column index (newline confusion)."
        )
        return True, reasons

    return False, reasons


# =============================================================================
# NT3: Downstream Retrieval Check Verifier
# =============================================================================

def verify_downstream_retrieval_check(eval_payload: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """Asserts that extraction scores are NOT certified without mandatory downstream retrieval check.

    Returns:
        (is_valid, reasons)
        If downstream retrieval check is missing, is_valid is False and reasons detail the omission.
    """
    reasons: List[str] = []

    # Check for downstream retrieval verification
    has_retrieval = (
        "retrieval_metrics" in eval_payload
        or "kpi3_summary" in eval_payload
        or "pipeline_metrics" in eval_payload
    )

    checked_flag = bool(eval_payload.get("downstream_retrieval_checked", False))

    if not has_retrieval and not checked_flag:
        reasons.append(
            "NT3 VIOLATION: Extraction was scored purely on intermediate extractor metrics (char/IoU accuracy) "
            "without mandatory downstream retrieval grounding verification (KPI-3 rubric). "
            "System abstains from acceptance certification."
        )
        return False, reasons

    # Verify that retrieval metrics are not dummy empty objects
    retrieval_data = eval_payload.get("retrieval_metrics") or eval_payload.get("pipeline_metrics") or {}
    if isinstance(retrieval_data, dict) and len(retrieval_data) == 0 and not checked_flag:
        reasons.append(
            "NT3 VIOLATION: Empty retrieval payload provided. Downstream retrieval check did not run."
        )
        return False, reasons

    return True, []


# =============================================================================
# NT4: Partition Leakage Verifier
# =============================================================================

def verify_partition_leakage(
    dev_doc_ids: List[str],
    acceptance_doc_ids: List[str],
    dev_artifacts: Optional[List[str]] = None,
) -> Tuple[bool, List[str]]:
    """Detects any acceptance document or derived artifact leaking into dev partition.

    Returns:
        (leakage_detected, reasons)
    """
    reasons: List[str] = []
    dev_set = set(dev_doc_ids)
    acc_set = set(acceptance_doc_ids)

    # 1. Document ID overlap
    overlap = dev_set.intersection(acc_set)
    if overlap:
        reasons.append(
            f"NT4 LEAKAGE DETECTED: {len(overlap)} frozen acceptance document(s) leaked into dev partition: {sorted(overlap)}."
        )

    # 2. Derived artifacts check
    if dev_artifacts:
        leaked_artifacts = []
        for art in dev_artifacts:
            doc_id = extract_doc_id_from_identifier(art)
            if doc_id and doc_id in acc_set:
                leaked_artifacts.append(art)
        if leaked_artifacts:
            reasons.append(
                f"NT4 LEAKAGE DETECTED: {len(leaked_artifacts)} derived artifact(s) from acceptance partition found in dev cache: {leaked_artifacts[:5]}."
            )

    leakage_detected = len(reasons) > 0
    return leakage_detected, reasons


# =============================================================================
# NT5: Workload Resource Envelope Verifier
# =============================================================================

def verify_workload_resource_envelope(
    workload: Dict[str, Any],
    declared_limits: Optional[Dict[str, Any]] = None,
) -> Tuple[bool, List[str]]:
    """Detects throughput, latency, page count, or memory envelope violations."""
    reasons: List[str] = []
    settings = get_settings()

    limits = declared_limits or {
        "max_pages": settings.max_pages_per_document,  # e.g., 100
        "max_upload_size_mb": settings.max_upload_size_mb,  # e.g., 50MB
        "max_p95_latency_ms": 5.0,  # KPI-6 target
        "max_peak_memory_mb": 150.0,
    }

    # 1. Page count breach
    pages = workload.get("pages_count", 0)
    if pages > limits["max_pages"]:
        reasons.append(
            f"NT5 WORKLOAD BREACH: Page count ({pages}) exceeds declared envelope limit of {limits['max_pages']} pages."
        )

    # 2. File size breach
    file_size_mb = workload.get("file_size_mb", 0.0)
    if file_size_mb > limits["max_upload_size_mb"]:
        reasons.append(
            f"NT5 WORKLOAD BREACH: File size ({file_size_mb:.1f} MB) exceeds declared limit of {limits['max_upload_size_mb']} MB."
        )

    # 3. Throughput / Latency budget breach
    p95_latency = workload.get("latency_p95_ms", 0.0)
    if p95_latency > limits["max_p95_latency_ms"]:
        reasons.append(
            f"NT5 WORKLOAD BREACH: Query latency p95 ({p95_latency:.2f} ms) exceeds declared performance budget of {limits['max_p95_latency_ms']:.2f} ms."
        )

    # 4. Memory footprint breach
    peak_mem = workload.get("peak_memory_mb", 0.0)
    if peak_mem > limits["max_peak_memory_mb"]:
        reasons.append(
            f"NT5 WORKLOAD BREACH: Peak memory usage ({peak_mem:.1f} MB) exceeds declared allocation envelope of {limits['max_peak_memory_mb']:.1f} MB."
        )

    envelope_breached = len(reasons) > 0
    return envelope_breached, reasons

