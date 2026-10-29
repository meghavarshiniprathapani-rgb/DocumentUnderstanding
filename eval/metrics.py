"""
Retrieva AI — Independent Oracle Evaluation Metrics
Independent scoring suite implementing:
1. Spatial Intersection over Union (IoU) & Precision/Recall/F1
2. Reading-Order Accuracy (Pairwise Order Accuracy & Kendall's Tau)
3. Table Structure Fidelity (Cell-Adjacency Graph F1 & TEDS-style score)
4. Formula Extraction Match (LaTeX normalization, exact match & edit similarity)
5. Critical-Scene Failure Rate (CSFR)
6. 95% Bootstrap Confidence Intervals & Per-Condition Stratified Breakdowns
"""

import math
import random
import re
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Sequence, Set, Tuple

# ==============================================================================
# 1. Spatial Geometry & Classification Metrics
# ==============================================================================


def calculate_iou(box_a: Tuple[float, float, float, float], box_b: Tuple[float, float, float, float]) -> float:
    """
    Computes Intersection over Union (IoU) between two bounding boxes.
    Boxes are in (x, y, width, height) format.
    """
    ax, ay, aw, ah = box_a
    bx, by, bw, bh = box_b

    ax0, ay0, ax1, ay1 = ax, ay, ax + aw, ay + ah
    bx0, by0, bx1, by1 = bx, by, bx + bw, by + bh

    ix0 = max(ax0, bx0)
    iy0 = max(ay0, by0)
    ix1 = min(ax1, bx1)
    iy1 = min(ay1, by1)

    iw = max(0.0, ix1 - ix0)
    ih = max(0.0, iy1 - iy0)
    intersection_area = iw * ih

    area_a = aw * ah
    area_b = bw * bh
    union_area = area_a + area_b - intersection_area

    if union_area <= 0:
        return 0.0

    return intersection_area / union_area


def calculate_precision_recall(
    true_positives: int = 0,
    false_positives: int = 0,
    false_negatives: int = 0,
    *,
    tp: int | None = None,
    fp: int | None = None,
    fn: int | None = None,
) -> Tuple[float, float]:
    """Computes precision and recall with zero-division safety."""
    if tp is not None:
        true_positives = tp
    if fp is not None:
        false_positives = fp
    if fn is not None:
        false_negatives = fn
    precision = true_positives / (true_positives + false_positives) if (true_positives + false_positives) > 0 else 0.0
    recall = true_positives / (true_positives + false_negatives) if (true_positives + false_negatives) > 0 else 0.0
    return precision, recall


def calculate_f1_score(precision: float, recall: float) -> float:
    """Computes harmonic mean F1 score from precision and recall."""
    if (precision + recall) == 0:
        return 0.0
    return 2 * (precision * recall) / (precision + recall)


def summarize_benchmark_metrics(tp: int, fp: int, fn: int, mean_iou: float) -> Dict[str, float]:
    """Generates standardized benchmark score dictionary."""
    p, r = calculate_precision_recall(tp, fp, fn)
    f1 = calculate_f1_score(p, r)
    return {
        "precision": round(p, 4),
        "recall": round(r, 4),
        "f1_score": round(f1, 4),
        "mean_iou": round(mean_iou, 4),
    }


# ==============================================================================
# 2. Reading-Order Accuracy (Pairwise Order Accuracy & Kendall's Tau)
# ==============================================================================


def calculate_reading_order_accuracy(
    predicted_order: Sequence[Any],
    ground_truth_order: Sequence[Any],
) -> Dict[str, float]:
    """
    Computes reading-order accuracy comparing predicted sequence against ground truth.
    Measures:
    - pairwise_order_accuracy (POA): fraction of pairs in concordant relative order [0.0, 1.0].
    - kendall_tau: standard rank correlation coefficient in [-1.0, 1.0].
    - normalized_kendall_tau: (tau + 1) / 2 in [0.0, 1.0].

    Accepts sequences of element IDs (ordered by their reading position).
    """
    gt_items = list(ground_truth_order)
    pred_items = list(predicted_order)

    # Filter to intersection of common elements
    common_set = set(gt_items).intersection(set(pred_items))
    if len(common_set) <= 1:
        return {
            "pairwise_order_accuracy": 1.0,
            "kendall_tau": 1.0,
            "normalized_kendall_tau": 1.0,
            "evaluated_pairs": 0,
        }

    # Restrict to common items preserving relative order
    filtered_gt = [item for item in gt_items if item in common_set]
    filtered_pred = [item for item in pred_items if item in common_set]

    # Map item to its index position in predicted sequence
    pred_index_map = {item: idx for idx, item in enumerate(filtered_pred)}

    n = len(filtered_gt)
    total_pairs = n * (n - 1) // 2
    concordant = 0
    discordant = 0

    for i in range(n):
        for j in range(i + 1, n):
            u = filtered_gt[i]
            v = filtered_gt[j]
            # In ground truth, u appears before v (since i < j)
            if pred_index_map[u] < pred_index_map[v]:
                concordant += 1
            else:
                discordant += 1

    poa = concordant / total_pairs
    tau = (concordant - discordant) / total_pairs
    norm_tau = (tau + 1.0) / 2.0

    return {
        "pairwise_order_accuracy": round(poa, 4),
        "kendall_tau": round(tau, 4),
        "normalized_kendall_tau": round(norm_tau, 4),
        "evaluated_pairs": total_pairs,
    }


# ==============================================================================
# 3. Table Structure Fidelity (Cell Adjacency & TEDS-Style Grid Score)
# ==============================================================================


def extract_table_adjacency_relations(cells: List[Dict[str, Any]]) -> Set[Tuple[str, str, str]]:
    """
    Constructs horizontal and vertical cell adjacency relations from grid cells.
    Handles row_span and col_span geometry.
    Returns set of relations: ('right', content_u, content_v) or ('down', content_u, content_w).
    """
    # Map (row, col) coordinates to cell
    grid: Dict[Tuple[int, int], Dict[str, Any]] = {}
    for cell in cells:
        r = cell.get("row_index", 0)
        c = cell.get("col_index", 0)
        rs = cell.get("row_span", 1)
        cs = cell.get("col_span", 1)
        for dr in range(rs):
            for dc in range(cs):
                grid[(r + dr, c + dc)] = cell

    relations: Set[Tuple[str, str, str]] = set()

    for cell in cells:
        r = cell.get("row_index", 0)
        c = cell.get("col_index", 0)
        rs = cell.get("row_span", 1)
        cs = cell.get("col_span", 1)
        content_u = str(cell.get("content", "")).strip()

        # Right neighbors: check column immediately to the right across all spanned rows
        right_col = c + cs
        seen_right: Set[str] = set()
        for row_pos in range(r, r + rs):
            neighbor = grid.get((row_pos, right_col))
            if neighbor is not None:
                neighbor_content = str(neighbor.get("content", "")).strip()
                if neighbor.get("cell_id") != cell.get("cell_id") and neighbor_content not in seen_right:
                    relations.add(("right", content_u, neighbor_content))
                    seen_right.add(neighbor_content)

        # Down neighbors: check row immediately below across all spanned columns
        down_row = r + rs
        seen_down: Set[str] = set()
        for col_pos in range(c, c + cs):
            neighbor = grid.get((down_row, col_pos))
            if neighbor is not None:
                neighbor_content = str(neighbor.get("content", "")).strip()
                if neighbor.get("cell_id") != cell.get("cell_id") and neighbor_content not in seen_down:
                    relations.add(("down", content_u, neighbor_content))
                    seen_down.add(neighbor_content)

    return relations


def calculate_table_structure_fidelity(
    predicted_cells: List[Dict[str, Any]],
    ground_truth_cells: List[Dict[str, Any]],
) -> Dict[str, float]:
    """
    Computes structural table fidelity using cell adjacency graph relations.
    Measures precision, recall, and F1 of horizontal ('right') and vertical ('down')
    topological neighborhood relations.
    """
    if not ground_truth_cells and not predicted_cells:
        return {"precision": 1.0, "recall": 1.0, "f1_score": 1.0, "relations_count": 0}
    if not ground_truth_cells or not predicted_cells:
        return {"precision": 0.0, "recall": 0.0, "f1_score": 0.0, "relations_count": 0}

    gt_rel = extract_table_adjacency_relations(ground_truth_cells)
    pred_rel = extract_table_adjacency_relations(predicted_cells)

    if not gt_rel and not pred_rel:
        # Table with single cell: compare content match directly
        c_gt = str(ground_truth_cells[0].get("content", "")).strip()
        c_pred = str(predicted_cells[0].get("content", "")).strip()
        score = 1.0 if c_gt == c_pred else 0.0
        return {"precision": score, "recall": score, "f1_score": score, "relations_count": 0}

    common = gt_rel.intersection(pred_rel)
    tp = len(common)
    fp = len(pred_rel - gt_rel)
    fn = len(gt_rel - pred_rel)

    precision, recall = calculate_precision_recall(tp=tp, fp=fp, fn=fn)
    f1 = calculate_f1_score(precision, recall)

    return {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1_score": round(f1, 4),
        "relations_count": len(gt_rel),
    }


def calculate_teds_style_score(
    predicted_table: Dict[str, Any],
    ground_truth_table: Dict[str, Any],
) -> float:
    """
    Tree-Edit-Distance-based Similarity (TEDS) approximation for HTML/structured tables.
    Decomposes tables into canonical grid cell sequences and computes normalized edit distance.
    """

    def serialize_table(table: Dict[str, Any]) -> List[str]:
        cells = table.get("cells", [])
        sorted_cells = sorted(cells, key=lambda c: (c.get("row_index", 0), c.get("col_index", 0)))
        tokens = [f"table_{table.get('num_rows', 0)}x{table.get('num_cols', 0)}"]
        for cell in sorted_cells:
            tokens.append(
                f"cell:r{cell.get('row_index', 0)}c{cell.get('col_index', 0)}:"
                f"rs{cell.get('row_span', 1)}cs{cell.get('col_span', 1)}:"
                f"{str(cell.get('content', '')).strip()}"
            )
        return tokens

    tokens_pred = serialize_table(predicted_table)
    tokens_gt = serialize_table(ground_truth_table)

    if tokens_pred == tokens_gt:
        return 1.0
    if not tokens_pred or not tokens_gt:
        return 0.0

    # Sequence Levenshtein edit distance
    dist = calculate_levenshtein_distance(tokens_pred, tokens_gt)
    max_len = max(len(tokens_pred), len(tokens_gt))
    similarity = 1.0 - (dist / max_len)
    return round(max(0.0, similarity), 4)


# ==============================================================================
# 4. Formula Extraction Match (LaTeX Normalization & Edit Similarity)
# ==============================================================================


def normalize_latex(latex_str: str) -> str:
    """
    Normalizes mathematical LaTeX string by:
    - Stripping delimiter tokens ($$, $, \\[ \\]) and equation environments
    - Stripping \\left and \\right scaling modifiers
    - Canonicalizing single-character braces (e.g. ^{2} -> ^2, _{i} -> _i)
    - Normalizing whitespace between mathematical variables and operators
    """
    s = latex_str.strip()

    # Strip environment delimiters
    s = re.sub(r"^\$\$|^\$|^\\\[", "", s).strip()
    s = re.sub(r"\$\$$|\$$|\\\]$", "", s).strip()
    s = re.sub(r"\\begin\{equation\*?\}", "", s).strip()
    s = re.sub(r"\\end\{equation\*?\}", "", s).strip()

    # Strip \left and \right
    s = s.replace(r"\left", "").replace(r"\right", "")

    # Single-char exponents and subscripts: ^{2} -> ^2, _{i} -> _i
    s = re.sub(r"\^\{([a-zA-Z0-9])\}", r"^\1", s)
    s = re.sub(r"_\{([a-zA-Z0-9])\}", r"_\1", s)

    # Tokenize and rejoin to normalize variable whitespace
    tokens = re.findall(r"\\[a-zA-Z]+|[a-zA-Z0-9]|[^\s]", s)
    return "".join(tokens)


def calculate_levenshtein_distance(seq_a: Sequence[Any], seq_b: Sequence[Any]) -> int:
    """Classic dynamic programming Levenshtein distance."""
    m, n = len(seq_a), len(seq_b)
    dp = [[0] * (n + 1) for _ in range(m + 1)]

    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j

    for i in range(1, m + 1):
        for j in range(1, n + 1):
            cost = 0 if seq_a[i - 1] == seq_b[j - 1] else 1
            dp[i][j] = min(
                dp[i - 1][j] + 1,  # deletion
                dp[i][j - 1] + 1,  # insertion
                dp[i - 1][j - 1] + cost,  # substitution
            )

    return dp[m][n]


def calculate_formula_match(predicted_latex: str, ground_truth_latex: str) -> Dict[str, Any]:
    """
    Evaluates formula extraction match across multiple string and syntactic metrics:
    - exact_match: True if raw LaTeX matches verbatim.
    - normalized_match: True if LaTeX matches after syntactic canonicalization.
    - edit_similarity: Normalized character edit similarity [0.0, 1.0].
    - score: Aggregate weighted formula fidelity score.
    """
    raw_match = predicted_latex.strip() == ground_truth_latex.strip()

    norm_pred = normalize_latex(predicted_latex)
    norm_gt = normalize_latex(ground_truth_latex)
    norm_match = norm_pred == norm_gt

    max_len = max(len(norm_pred), len(norm_gt))
    if max_len == 0:
        edit_sim = 1.0
    else:
        dist = calculate_levenshtein_distance(norm_pred, norm_gt)
        edit_sim = max(0.0, 1.0 - (dist / max_len))

    # Token overlap similarity
    tokens_pred = re.findall(r"\\[a-zA-Z]+|[a-zA-Z0-9]|[^\s]", norm_pred)
    tokens_gt = re.findall(r"\\[a-zA-Z]+|[a-zA-Z0-9]|[^\s]", norm_gt)

    if tokens_pred == tokens_gt:
        token_sim = 1.0
    elif not tokens_pred or not tokens_gt:
        token_sim = 0.0
    else:
        token_dist = calculate_levenshtein_distance(tokens_pred, tokens_gt)
        token_sim = max(0.0, 1.0 - (token_dist / max(len(tokens_pred), len(tokens_gt))))

    # Aggregate formula score: exact normalized match yields 1.0; otherwise weighted edit similarity
    formula_score = 1.0 if norm_match else round(0.5 * edit_sim + 0.5 * token_sim, 4)

    return {
        "exact_match": raw_match,
        "normalized_match": norm_match,
        "character_edit_similarity": round(edit_sim, 4),
        "token_edit_similarity": round(token_sim, 4),
        "score": round(formula_score, 4),
    }


# ==============================================================================
# 5. Critical-Scene Failure Rate (CSFR)
# ==============================================================================


def calculate_critical_scene_failure_rate(
    predicted_elements: List[Dict[str, Any]],
    ground_truth_elements: List[Dict[str, Any]],
    iou_threshold: float = 0.50,
    text_similarity_threshold: float = 0.80,
) -> Dict[str, Any]:
    """
    Evaluates failure rate across elements designated with is_critical == True.
    A critical element fails if:
    1. Omission: No predicted element has IoU >= iou_threshold.
    2. Misclassification: Predicted element has different layout type.
    3. Content distortion: Text / formula similarity < text_similarity_threshold.
    4. Table distortion: Table structure fidelity < 0.75.

    Returns:
    - failure_rate: failed_critical / total_critical in [0.0, 1.0].
    - total_critical: Total critical ground-truth elements.
    - failed_critical: Count of failed critical elements.
    - passed_critical: Count of passed critical elements.
    - failure_details: List of diagnostic failure entries.
    """
    critical_gt = [e for e in ground_truth_elements if e.get("is_critical") is True]

    if not critical_gt:
        return {
            "failure_rate": 0.0,
            "total_critical": 0,
            "failed_critical": 0,
            "passed_critical": 0,
            "status": "NO_CRITICAL_SCENES",
            "failures": [],
        }

    failures = []
    passed_count = 0

    for gt_elem in critical_gt:
        gt_box = gt_elem.get("bbox")
        if isinstance(gt_box, dict):
            gt_coords = (gt_box["x"], gt_box["y"], gt_box["width"], gt_box["height"])
        elif isinstance(gt_box, (list, tuple)):
            gt_coords = tuple(gt_box[:4])
        else:
            gt_coords = (0.0, 0.0, 0.0, 0.0)

        gt_type = gt_elem.get("type")
        elem_id = gt_elem.get("id", "unknown")

        # Find best matching predicted element by IoU
        best_pred = None
        best_iou = 0.0

        for pred_elem in predicted_elements:
            pred_box = pred_elem.get("bbox")
            if isinstance(pred_box, dict):
                pred_coords = (pred_box["x"], pred_box["y"], pred_box["width"], pred_box["height"])
            elif isinstance(pred_box, (list, tuple)):
                pred_coords = tuple(pred_box[:4])
            else:
                pred_coords = (0.0, 0.0, 0.0, 0.0)

            iou = calculate_iou(gt_coords, pred_coords)
            if iou > best_iou:
                best_iou = iou
                best_pred = pred_elem

        # Check Failure Condition 1: Omission
        if best_pred is None or best_iou < iou_threshold:
            failures.append(
                {
                    "element_id": elem_id,
                    "reason": "omission",
                    "detail": f"Best IoU {best_iou:.3f} < threshold {iou_threshold}",
                }
            )
            continue

        # Check Failure Condition 2: Misclassification
        pred_type = best_pred.get("type")
        if pred_type != gt_type:
            failures.append(
                {
                    "element_id": elem_id,
                    "reason": "misclassification",
                    "detail": f"Expected type '{gt_type}', got '{pred_type}'",
                }
            )
            continue

        # Check Failure Condition 3: Content or structural distortion
        if gt_type == "table":
            gt_cells = gt_elem.get("table", {}).get("cells", []) if isinstance(gt_elem.get("table"), dict) else []
            pred_cells = best_pred.get("table", {}).get("cells", []) if isinstance(best_pred.get("table"), dict) else []
            table_eval = calculate_table_structure_fidelity(pred_cells, gt_cells)
            if table_eval["f1_score"] < 0.75:
                failures.append(
                    {
                        "element_id": elem_id,
                        "reason": "table_structure_distortion",
                        "detail": f"Table structure F1 {table_eval['f1_score']:.3f} < 0.75",
                    }
                )
                continue

        elif gt_type == "formula":
            gt_latex = gt_elem.get("formula", {}).get("latex", "") if isinstance(gt_elem.get("formula"), dict) else ""
            pred_latex = (
                best_pred.get("formula", {}).get("latex", "") if isinstance(best_pred.get("formula"), dict) else ""
            )
            form_eval = calculate_formula_match(pred_latex, gt_latex)
            if form_eval["score"] < 0.75:
                failures.append(
                    {
                        "element_id": elem_id,
                        "reason": "formula_distortion",
                        "detail": f"Formula match score {form_eval['score']:.3f} < 0.75",
                    }
                )
                continue

        else:
            # Text / Heading text comparison
            gt_text = gt_elem.get("text", "").strip()
            pred_text = best_pred.get("text", "").strip()
            max_len = max(len(gt_text), len(pred_text))
            if max_len > 0:
                dist = calculate_levenshtein_distance(gt_text, pred_text)
                sim = max(0.0, 1.0 - (dist / max_len))
            else:
                sim = 1.0

            if sim < text_similarity_threshold:
                failures.append(
                    {
                        "element_id": elem_id,
                        "reason": "text_distortion",
                        "detail": f"Text edit similarity {sim:.3f} < threshold {text_similarity_threshold}",
                    }
                )
                continue

        passed_count += 1

    total = len(critical_gt)
    failed = len(failures)
    failure_rate = round(failed / total, 4)

    return {
        "failure_rate": failure_rate,
        "total_critical": total,
        "failed_critical": failed,
        "passed_critical": passed_count,
        "status": "PASS" if failure_rate == 0.0 else "WARNING",
        "failures": failures,
    }


# ==============================================================================
# 6. Bootstrap Confidence Intervals & Per-Condition Stratified Breakdowns
# ==============================================================================


def calculate_bootstrap_ci(
    data: Sequence[float],
    n_bootstrap: int = 1000,
    confidence_level: float = 0.95,
    seed: int = 42,
) -> Tuple[float, float, float]:
    """
    Computes non-parametric bootstrap confidence interval using percentile method.
    Returns (mean, lower_ci, upper_ci).
    """
    if not data:
        return (0.0, 0.0, 0.0)

    data_list = [float(x) for x in data]
    n = len(data_list)
    point_estimate = sum(data_list) / n

    if n == 1 or all(x == data_list[0] for x in data_list):
        return (round(point_estimate, 4), round(point_estimate, 4), round(point_estimate, 4))

    rng = random.Random(seed)
    bootstrap_means: List[float] = []

    for _ in range(n_bootstrap):
        sample = [data_list[rng.randint(0, n - 1)] for _ in range(n)]
        bootstrap_means.append(sum(sample) / n)

    bootstrap_means.sort()
    alpha = (1.0 - confidence_level) / 2.0
    lower_idx = max(0, int(math.floor(alpha * n_bootstrap)))
    upper_idx = min(n_bootstrap - 1, int(math.ceil((1.0 - alpha) * n_bootstrap)) - 1)

    lower_ci = bootstrap_means[lower_idx]
    upper_ci = bootstrap_means[upper_idx]

    return (
        round(point_estimate, 4),
        round(lower_ci, 4),
        round(upper_ci, 4),
    )


def calculate_per_condition_breakdowns(
    evaluation_records: Iterable[Dict[str, Any]],
    metric_key: str = "score",
    condition_keys: Sequence[str] = ("document_type", "layout_type", "has_tables", "has_formulas", "element_type"),
    seed: int = 42,
) -> Dict[str, Dict[str, Dict[str, Any]]]:
    """
    Groups evaluation scores across categorical condition attributes and computes
    sample count, mean score, and 95% bootstrap confidence intervals for each condition stratum.
    """
    records = list(evaluation_records)
    breakdowns: Dict[str, Dict[str, Dict[str, Any]]] = {}

    for cond_key in condition_keys:
        grouped_scores: Dict[str, List[float]] = defaultdict(list)

        for rec in records:
            if cond_key in rec and metric_key in rec:
                raw_val = rec[cond_key]
                val_str = str(raw_val)
                score = float(rec[metric_key])
                grouped_scores[val_str].append(score)

        breakdowns[cond_key] = {}
        for val_str, scores in sorted(grouped_scores.items()):
            mean_val, lower_ci, upper_ci = calculate_bootstrap_ci(scores, seed=seed)
            breakdowns[cond_key][val_str] = {
                "sample_count": len(scores),
                "mean": mean_val,
                "ci_95_lower": lower_ci,
                "ci_95_upper": upper_ci,
            }

    return breakdowns
