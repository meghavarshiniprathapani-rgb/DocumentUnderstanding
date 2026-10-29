"""Unit tests for Layout Analysis and Reading Order Recovery Module."""


from backend.layout import LayoutConfig, LayoutOrderRecovery, recover_reading_order
from eval.metrics import calculate_reading_order_accuracy
from tests.fixtures import (
    create_floating_sidebar_fixture,
    create_one_column_fixture,
    create_three_column_fixture,
    create_two_column_fixture,
)


def test_one_column_reading_order():
    """Verify single-column page reading order is strictly preserved."""
    elements, expected_ids = create_one_column_fixture()
    recovered = recover_reading_order(elements)

    recovered_ids = [el.metadata["id"] for el in recovered]
    assert recovered_ids == expected_ids
    assert [el.reading_order for el in recovered] == [0, 1, 2, 3, 4]


def test_two_column_reading_order_vs_naive_sort():
    """Verify two-column reading order recovers column-by-column rather than row interleaving.

    Naive vertical sort interleaves:
    header -> col1_p1 -> col2_p1 -> col1_p2 -> col2_p2 -> footer
    Recovered order:
    header -> col1_p1 -> col1_p2 -> col2_p1 -> col2_p2 -> footer
    """
    elements, expected_ids = create_two_column_fixture()

    # Naive Y-sort (baseline)
    naive_sorted = sorted(elements, key=lambda e: (e.bbox.y_min, e.bbox.x_min))
    naive_ids = [el.metadata["id"] for el in naive_sorted]
    # Naive should interleave col1 and col2
    assert naive_ids == ["header", "col1_p1", "col2_p1", "col1_p2", "col2_p2", "footer"]

    # Module recovered order
    recovered = recover_reading_order(elements)
    recovered_ids = [el.metadata["id"] for el in recovered]
    assert recovered_ids == expected_ids

    # Compute KPI-1 (Pairwise Order Accuracy) against ground truth
    # Build ground truth index map
    gt_map = {item_id: idx for idx, item_id in enumerate(expected_ids)}
    naive_indices = [gt_map[i] for i in naive_ids]
    recovered_indices = [gt_map[i] for i in recovered_ids]

    # Evaluate KPI-1
    naive_metric = calculate_reading_order_accuracy(list(range(len(expected_ids))), naive_indices)
    recovered_metric = calculate_reading_order_accuracy(list(range(len(expected_ids))), recovered_indices)

    # Recovered metric must achieve perfect POA (1.0) and outperform naive sort
    assert recovered_metric["pairwise_order_accuracy"] == 1.0
    assert recovered_metric["kendall_tau"] == 1.0
    assert recovered_metric["pairwise_order_accuracy"] > naive_metric["pairwise_order_accuracy"]


def test_three_column_reading_order():
    """Verify three-column page reads column 1 -> column 2 -> column 3."""
    elements, expected_ids = create_three_column_fixture()
    recovered = recover_reading_order(elements)

    recovered_ids = [el.metadata["id"] for el in recovered]
    assert recovered_ids == expected_ids


def test_floating_sidebar_isolation():
    """Verify floating sidebar in the right margin does not fracture the main column."""
    elements, expected_ids = create_floating_sidebar_fixture()
    recovered = recover_reading_order(elements)

    recovered_ids = [el.metadata["id"] for el in recovered]
    assert recovered_ids == expected_ids


def test_custom_layout_config():
    """Verify LayoutConfig parameters correctly adjust column gutter thresholds."""
    custom_config = LayoutConfig(
        min_column_gutter_width=50.0,  # Huge gutter threshold
        header_max_y_ratio=0.15,
    )
    analyzer = LayoutOrderRecovery(config=custom_config)
    assert analyzer.config.min_column_gutter_width == 50.0
    assert analyzer.config.header_max_y_ratio == 0.15


def test_empty_and_single_element():
    """Verify edge cases with 0 or 1 element."""
    assert recover_reading_order([]) == []

    elements, _ = create_one_column_fixture()
    single = [elements[0]]
    result = recover_reading_order(single)
    assert len(result) == 1
    assert result[0].reading_order == 0
