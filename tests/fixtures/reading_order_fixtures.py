"""Fixtures for Layout Analysis and Reading Order Recovery.

Provides standardized layout scenarios:
- 1-column page
- 2-column page
- 3-column page
- page with floating sidebar
"""

from backend.extractors.base import BoundingBox, Element, ElementType


def create_one_column_fixture() -> tuple[list[Element], list[str]]:
    """Generates a standard single-column page layout.

    Returns:
        (elements, expected_id_sequence)
    """
    elements = [
        Element(
            type=ElementType.HEADING,
            page=1,
            bbox=BoundingBox(x_min=50.0, y_min=30.0, x_max=550.0, y_max=50.0),
            reading_order=0,
            text="Running Header: Executive Summary",
            metadata={"role": "header", "id": "header"},
        ),
        Element(
            type=ElementType.HEADING,
            page=1,
            bbox=BoundingBox(x_min=50.0, y_min=90.0, x_max=450.0, y_max=120.0),
            reading_order=1,
            text="1. Introduction",
            metadata={"id": "intro_heading"},
        ),
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=50.0, y_min=135.0, x_max=550.0, y_max=220.0),
            reading_order=2,
            text="First paragraph of the single column document containing introductory prose.",
            metadata={"id": "para_1"},
        ),
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=50.0, y_min=240.0, x_max=550.0, y_max=330.0),
            reading_order=3,
            text="Second paragraph continuing the narrative and outlining technical scope.",
            metadata={"id": "para_2"},
        ),
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=50.0, y_min=750.0, x_max=550.0, y_max=770.0),
            reading_order=4,
            text="Page 1 of 12 — Confidential",
            metadata={"role": "footer", "id": "footer"},
        ),
    ]
    expected_order = ["header", "intro_heading", "para_1", "para_2", "footer"]
    return elements, expected_order


def create_two_column_fixture() -> tuple[list[Element], list[str]]:
    """Generates a 2-column page layout with header and footer.

    In naive top-to-bottom sorting, Col 1 and Col 2 paragraphs interleave:
    [Header, Col1_P1, Col2_P1, Col1_P2, Col2_P2, Footer].
    In correct column reading order:
    [Header, Col1_P1, Col1_P2, Col2_P1, Col2_P2, Footer].
    """
    elements = [
        # Running Header
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=50.0, y_min=25.0, x_max=560.0, y_max=45.0),
            reading_order=0,
            text="Annual Report 2026 — Research & Development",
            metadata={"role": "header", "id": "header"},
        ),
        # Column 1 Paragraph 1
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=50.0, y_min=100.0, x_max=275.0, y_max=190.0),
            reading_order=1,
            text="Column 1 Paragraph 1: Initial research initiatives in deep learning.",
            metadata={"id": "col1_p1"},
        ),
        # Column 2 Paragraph 1 (same vertical height as Col1 P1)
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=305.0, y_min=100.0, x_max=550.0, y_max=190.0),
            reading_order=2,
            text="Column 2 Paragraph 1: Downstream evaluation benchmarks.",
            metadata={"id": "col2_p1"},
        ),
        # Column 1 Paragraph 2
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=50.0, y_min=210.0, x_max=275.0, y_max=320.0),
            reading_order=3,
            text="Column 1 Paragraph 2: Methodology details and loss formulations.",
            metadata={"id": "col1_p2"},
        ),
        # Column 2 Paragraph 2
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=305.0, y_min=210.0, x_max=550.0, y_max=320.0),
            reading_order=4,
            text="Column 2 Paragraph 2: Empirical findings across stratified splits.",
            metadata={"id": "col2_p2"},
        ),
        # Running Footer
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=50.0, y_min=745.0, x_max=550.0, y_max=765.0),
            reading_order=5,
            text="Page 4 — Retrieva AI Technical Documentation",
            metadata={"role": "footer", "id": "footer"},
        ),
    ]
    expected_order = ["header", "col1_p1", "col1_p2", "col2_p1", "col2_p2", "footer"]
    return elements, expected_order


def create_three_column_fixture() -> tuple[list[Element], list[str]]:
    """Generates a 3-column page layout.

    Columns: Col 1 [50..180], Col 2 [210..340], Col 3 [370..500].
    Expected: Col 1 top-to-bottom, Col 2 top-to-bottom, Col 3 top-to-bottom.
    """
    elements = [
        # Col 1 item 1
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=50.0, y_min=100.0, x_max=185.0, y_max=200.0),
            reading_order=0,
            text="Column 1 Top Story",
            metadata={"id": "col1_top"},
        ),
        # Col 2 item 1
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=215.0, y_min=100.0, x_max=350.0, y_max=200.0),
            reading_order=1,
            text="Column 2 Center Feature",
            metadata={"id": "col2_top"},
        ),
        # Col 3 item 1
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=380.0, y_min=100.0, x_max=515.0, y_max=200.0),
            reading_order=2,
            text="Column 3 Analysis",
            metadata={"id": "col3_top"},
        ),
        # Col 1 item 2
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=50.0, y_min=230.0, x_max=185.0, y_max=350.0),
            reading_order=3,
            text="Column 1 Continued",
            metadata={"id": "col1_bottom"},
        ),
        # Col 2 item 2
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=215.0, y_min=230.0, x_max=350.0, y_max=350.0),
            reading_order=4,
            text="Column 2 Continued",
            metadata={"id": "col2_bottom"},
        ),
        # Col 3 item 2
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=380.0, y_min=230.0, x_max=515.0, y_max=350.0),
            reading_order=5,
            text="Column 3 Continued",
            metadata={"id": "col3_bottom"},
        ),
    ]
    expected_order = [
        "col1_top",
        "col1_bottom",
        "col2_top",
        "col2_bottom",
        "col3_top",
        "col3_bottom",
    ]
    return elements, expected_order


def create_floating_sidebar_fixture() -> tuple[list[Element], list[str]]:
    """Generates a page with primary main column and a floating sidebar in right margin.

    Main body: [50..360]
    Sidebar: [410..550]
    """
    elements = [
        Element(
            type=ElementType.HEADING,
            page=1,
            bbox=BoundingBox(x_min=50.0, y_min=90.0, x_max=350.0, y_max=125.0),
            reading_order=0,
            text="Primary Chapter Title",
            metadata={"id": "main_title"},
        ),
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=50.0, y_min=140.0, x_max=360.0, y_max=260.0),
            reading_order=1,
            text="Main body paragraph 1 explaining the core theoretical foundation.",
            metadata={"id": "main_p1"},
        ),
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=415.0, y_min=150.0, x_max=550.0, y_max=380.0),
            reading_order=2,
            text="KEY TAKEAWAY SIDEBAR: Remember that invariance holds under coordinate normalization.",
            metadata={"role": "sidebar", "id": "sidebar_callout"},
        ),
        Element(
            type=ElementType.TEXT,
            page=1,
            bbox=BoundingBox(x_min=50.0, y_min=280.0, x_max=360.0, y_max=420.0),
            reading_order=3,
            text="Main body paragraph 2 continuing the primary narrative without interruption.",
            metadata={"id": "main_p2"},
        ),
    ]
    # Main column should not be interrupted by the sidebar
    expected_order = ["main_title", "main_p1", "main_p2", "sidebar_callout"]
    return elements, expected_order

