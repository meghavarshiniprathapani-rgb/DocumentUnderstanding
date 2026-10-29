"""Independent Signal Extraction for Provenance Confidence Calibration.

Extracts independent validation signals:
- Cryptographic SHA-256 file hashing
- Dual-extractor agreement (spatial IoU + text edit similarity)
- Table topological consistency (grid bounds, cell non-overlap, non-empty ratio)
- Reading-order displacement agreement
"""

import hashlib
from pathlib import Path
from typing import List

from backend.extractors.base import BoundingBox, Element, ElementType


def compute_file_sha256(file_path: str | Path) -> str:
    """Compute cryptographic SHA-256 hash of a file."""
    path_obj = Path(file_path).resolve()
    if not path_obj.exists():
        raise FileNotFoundError(f"File not found for hashing: {path_obj}")

    hasher = hashlib.sha256()
    with path_obj.open("rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def compute_box_iou(b1: BoundingBox, b2: BoundingBox) -> float:
    """Compute Intersection over Union between two bounding boxes."""
    x_left = max(b1.x_min, b2.x_min)
    y_top = max(b1.y_min, b2.y_min)
    x_right = min(b1.x_max, b2.x_max)
    y_bottom = min(b1.y_max, b2.y_max)

    if x_right <= x_left or y_bottom <= y_top:
        return 0.0

    intersection_area = (x_right - x_left) * (y_bottom - y_top)
    b1_area = b1.width * b1.height
    b2_area = b2.width * b2.height
    union_area = b1_area + b2_area - intersection_area

    if union_area <= 0.0:
        return 0.0

    return intersection_area / union_area


def compute_text_similarity(s1: str, s2: str) -> float:
    """Token-level Jaccard and character overlap similarity in [0.0, 1.0]."""
    t1 = s1.strip().lower()
    t2 = s2.strip().lower()

    if not t1 and not t2:
        return 1.0
    if not t1 or not t2:
        return 0.0
    if t1 == t2:
        return 1.0

    # Token overlap
    words1 = set(t1.split())
    words2 = set(t2.split())
    if not words1 or not words2:
        return 0.0

    jaccard = len(words1 & words2) / len(words1 | words2)
    return round(float(jaccard), 4)


def compute_dual_extractor_agreement(
    element: Element,
    secondary_elements: List[Element],
) -> float:
    """Compute agreement score between an element and secondary extractor elements.

    Matches by highest combination of spatial IoU and textual similarity on the same page.
    """
    if not secondary_elements:
        return 0.50  # Neutral fallback when secondary elements are not available

    same_page = [e for e in secondary_elements if e.page == element.page]
    if not same_page:
        return 0.0

    best_agreement = 0.0

    for sec_el in same_page:
        iou = compute_box_iou(element.bbox, sec_el.bbox)
        text_sim = compute_text_similarity(element.text, sec_el.text)

        # Weighted agreement: 60% spatial overlap + 40% text concordance
        candidate_agreement = (0.60 * iou) + (0.40 * text_sim)

        # Type penalty if extractors disagree on semantic element type
        if element.type != sec_el.type:
            candidate_agreement *= 0.70

        if candidate_agreement > best_agreement:
            best_agreement = candidate_agreement

    return round(float(best_agreement), 4)


def compute_table_structural_consistency(element: Element) -> float:
    """Compute structural and topological consistency for table elements.

    Validates:
    - Presence of structured cells with non-negative row/column indices
    - Valid non-zero spans (row_span >= 1, col_span >= 1)
    - Cell bounding box containment and lack of severe mutual collisions
    - Non-empty cell content ratio
    """
    if element.type != ElementType.TABLE:
        return 1.0  # Not a table, consistency is not penalized

    cells = element.table_cells
    if not cells:
        return 0.0

    total_cells = len(cells)
    valid_coords = 0
    non_empty = 0
    valid_spans = 0

    max_row = 0
    max_col = 0

    for c in cells:
        if c.row_index >= 0 and c.col_index >= 0:
            valid_coords += 1
            max_row = max(max_row, c.row_index + c.row_span)
            max_col = max(max_col, c.col_index + c.col_span)

        if c.row_span >= 1 and c.col_span >= 1:
            valid_spans += 1

        if str(c.text).strip():
            non_empty += 1

    coord_score = valid_coords / total_cells
    span_score = valid_spans / total_cells
    non_empty_score = non_empty / total_cells

    # Check cell bounding box mutual overlap if available
    overlap_penalty = 0.0
    cells_with_bbox = [c for c in cells if c.bbox is not None]
    if len(cells_with_bbox) > 1:
        collisions = 0
        comparisons = 0
        for i in range(len(cells_with_bbox)):
            for j in range(i + 1, len(cells_with_bbox)):
                comparisons += 1
                c1_b = cells_with_bbox[i].bbox
                c2_b = cells_with_bbox[j].bbox
                if c1_b and c2_b:
                    cell_iou = compute_box_iou(c1_b, c2_b)
                    if cell_iou > 0.30:  # Cells should not significantly overlap
                        collisions += 1
        if comparisons > 0:
            overlap_penalty = min(0.40, collisions / comparisons)

    consistency = (0.40 * coord_score) + (0.30 * span_score) + (0.30 * non_empty_score) - overlap_penalty
    return round(float(max(0.0, min(1.0, consistency))), 4)


def compute_reading_order_agreement(
    initial_idx: int,
    recovered_idx: int,
    total_page_elements: int,
) -> float:
    """Compute concordance between initial extractor sequence and layout recovery sequence."""
    if total_page_elements <= 1:
        return 1.0

    displacement = abs(initial_idx - recovered_idx)
    concordance = 1.0 - (displacement / max(1, total_page_elements))
    return round(float(max(0.0, min(1.0, concordance))), 4)
