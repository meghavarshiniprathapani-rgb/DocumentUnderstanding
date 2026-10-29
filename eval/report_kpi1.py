"""CLI script to report KPI-1 (Reading-Order Accuracy) on Dev and Layout Fixtures.

Compares Baseline Naive Reading Order vs LayoutOrderRecovery Module:
- Pairwise Order Accuracy (POA)
- Kendall's Tau Rank Correlation
"""

from backend.layout import LayoutOrderRecovery
from eval.metrics import calculate_reading_order_accuracy
from tests.fixtures import (
    create_floating_sidebar_fixture,
    create_one_column_fixture,
    create_three_column_fixture,
    create_two_column_fixture,
)


def run_kpi1_report():
    layout = LayoutOrderRecovery()
    fixtures = [
        ("1-Column Standard Layout", create_one_column_fixture()),
        ("2-Column Multi-Column Page", create_two_column_fixture()),
        ("3-Column Multi-Column Page", create_three_column_fixture()),
        ("Floating Sidebar in Margin", create_floating_sidebar_fixture()),
    ]

    print("=" * 105)
    print("KPI-1 READING-ORDER ACCURACY BENCHMARK: BASELINE SORT VS. LAYOUT ANALYSIS MODULE")
    print("=" * 105)
    print(
        f"{'Layout Scenario':<32} | {'Baseline POA':<14} | {'Recovered POA':<14} | "
        f"{'Baseline Tau':<14} | {'Recovered Tau':<14} | {'POA Gain':<10}"
    )
    print("-" * 105)

    for name, (elements, expected_ids) in fixtures:
        naive_sorted = sorted(elements, key=lambda e: (e.bbox.y_min, e.bbox.x_min))
        naive_ids = [e.metadata["id"] for e in naive_sorted]

        recovered = layout.process(elements)
        recovered_ids = [e.metadata["id"] for e in recovered]

        gt_map = {item_id: idx for idx, item_id in enumerate(expected_ids)}
        naive_indices = [gt_map[i] for i in naive_ids]
        recovered_indices = [gt_map[i] for i in recovered_ids]
        gt_indices = list(range(len(expected_ids)))

        b_acc = calculate_reading_order_accuracy(gt_indices, naive_indices)
        r_acc = calculate_reading_order_accuracy(gt_indices, recovered_indices)

        poa_b = b_acc["pairwise_order_accuracy"]
        poa_r = r_acc["pairwise_order_accuracy"]
        tau_b = b_acc["kendall_tau"]
        tau_r = r_acc["kendall_tau"]
        gain = poa_r - poa_b

        print(
            f"{name:<32} | {poa_b:^14.4f} | {poa_r:^14.4f} | "
            f"{tau_b:^14.4f} | {tau_r:^14.4f} | {gain:^+10.4f}"
        )

    print("=" * 105)


if __name__ == "__main__":
    run_kpi1_report()

