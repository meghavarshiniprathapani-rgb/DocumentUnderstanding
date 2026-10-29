"""Layout Analysis and Reading-Order Recovery Module for Retrieva AI.

Performs multi-column segmentation (1-col, 2-col, 3-col), identifies and isolates
running headers/footers, and recovers natural reading sequence without interleaving
floating sidebars.
"""

from copy import deepcopy
from typing import Optional

from backend.extractors.base import Element
from backend.layout.config import LayoutConfig


class LayoutOrderRecovery:
    """Multi-column layout analyzer and reading order reconstruction engine."""

    def __init__(self, config: Optional[LayoutConfig] = None) -> None:
        self.config = config or LayoutConfig()

    def process(self, elements: list[Element]) -> list[Element]:
        """Process an extractor's raw elements and recover proper reading order.

        Args:
            elements: List of raw Element objects from an extractor.

        Returns:
            New list of Element objects with sequentially updated reading_order indices.
        """
        if not elements:
            return []

        # Group elements by page to process page topologies independently
        pages_dict: dict[int, list[Element]] = {}
        for el in elements:
            pages_dict.setdefault(el.page, []).append(deepcopy(el))

        ordered_all_pages: list[Element] = []
        global_reading_idx = 0

        for page_no in sorted(pages_dict.keys()):
            page_elements = pages_dict[page_no]
            ordered_page_elements = self._process_single_page(page_elements)

            for el in ordered_page_elements:
                el.reading_order = global_reading_idx
                global_reading_idx += 1
                ordered_all_pages.append(el)

        return ordered_all_pages

    def _process_single_page(self, elements: list[Element]) -> list[Element]:
        """Recover reading order for a single page of document elements."""
        if len(elements) <= 1:
            return elements

        # Estimate page dimensions from element bounding boxes or default config
        max_x = max((el.bbox.x_max for el in elements), default=self.config.default_page_width)
        max_y = max((el.bbox.y_max for el in elements), default=self.config.default_page_height)
        page_width = max(max_x, self.config.default_page_width)
        page_height = max(max_y, self.config.default_page_height)

        header_cutoff = page_height * self.config.header_max_y_ratio
        footer_cutoff = page_height * self.config.footer_min_y_ratio

        headers: list[Element] = []
        footers: list[Element] = []
        candidates: list[Element] = []

        # Step 1: Isolate Running Headers and Footers
        for el in elements:
            # Check if explicitly labeled in metadata or spatially located in margins
            role = el.metadata.get("docling_label", "") or el.metadata.get("role", "")
            if "header" in role and el.bbox.y_min < header_cutoff * 1.5:
                headers.append(el)
            elif "footer" in role and el.bbox.y_max > footer_cutoff * 0.95:
                footers.append(el)
            elif el.bbox.y_max <= header_cutoff:
                headers.append(el)
            elif el.bbox.y_min >= footer_cutoff:
                footers.append(el)
            else:
                candidates.append(el)

        # Sort headers top-to-bottom, left-to-right
        headers.sort(key=lambda e: (e.bbox.y_min, e.bbox.x_min))
        # Sort footers top-to-bottom, left-to-right
        footers.sort(key=lambda e: (e.bbox.y_min, e.bbox.x_min))

        if not candidates:
            return headers + footers

        # Step 2: Identify Floating Sidebars
        # A floating sidebar exists when explicitly tagged in metadata OR when there is an asymmetric
        # layout where a wide main column (> 45% page width) is flanked by a narrow marginal callout
        has_wide_main_column = any(
            (el.bbox.width / page_width) >= 0.45 and (el.bbox.width / page_width) < 0.70
            for el in candidates
        )

        sidebars: list[Element] = []
        body_elements: list[Element] = []

        for el in candidates:
            width_ratio = el.bbox.width / page_width
            is_sidebar_meta = "sidebar" in el.metadata.get("role", "") or "aside" in el.metadata.get("role", "")

            # A floating sidebar is narrow and positioned in outer marginal bands alongside a wide main column
            is_marginal = (el.bbox.x_min >= page_width * 0.65) or (el.bbox.x_max <= page_width * 0.35)
            is_narrow = width_ratio <= self.config.sidebar_max_width_ratio

            if is_sidebar_meta or (
                has_wide_main_column
                and is_marginal
                and is_narrow
                and el.bbox.height >= (page_height * self.config.sidebar_min_height_ratio)
            ):
                sidebars.append(el)
            else:
                body_elements.append(el)

        sidebars.sort(key=lambda e: (e.bbox.y_min, e.bbox.x_min))

        # Step 3: Multi-Column Analysis on Body Elements
        ordered_body = self._order_columns(body_elements, page_width)

        # Step 4: Reassemble final document flow
        result: list[Element] = []
        result.extend(headers)

        if self.config.sidebar_placement == "first":
            result.extend(sidebars)
            result.extend(ordered_body)
        elif self.config.sidebar_placement == "after_anchoring_column":
            result.extend(ordered_body)
            result.extend(sidebars)
        else:  # end_of_page
            result.extend(ordered_body)
            result.extend(sidebars)

        result.extend(footers)
        return result

    def _order_columns(self, elements: list[Element], page_width: float) -> list[Element]:
        """Detect columns and order elements column-by-column (LTR), top-to-bottom within each column."""
        if len(elements) <= 1:
            return elements

        # Identify full-width spanning elements (e.g. section headings, wide tables spanning >= 70% content width)
        min_body_x = min(e.bbox.x_min for e in elements)
        max_body_x = max(e.bbox.x_max for e in elements)
        content_span = max(1.0, max_body_x - min_body_x)

        spanning_elements: list[Element] = []
        columnar_elements: list[Element] = []

        for el in elements:
            # If element spans across more than 70% of the total body width, treat as horizontal spanning band
            if (el.bbox.width / content_span) >= 0.70 and content_span > 200:
                spanning_elements.append(el)
            else:
                columnar_elements.append(el)

        if not spanning_elements:
            return self._segment_into_columns_and_sort(elements)

        # If there are spanning elements, slice the page vertically into horizontal bands
        all_ordered: list[Element] = []
        # Sort spanning elements top-to-bottom
        spanning_elements.sort(key=lambda e: e.bbox.y_min)

        current_y = 0.0
        for span_el in spanning_elements:
            band_elements = [
                e for e in columnar_elements if current_y <= e.bbox.y_min < span_el.bbox.y_min
            ]
            if band_elements:
                all_ordered.extend(self._segment_into_columns_and_sort(band_elements))
            all_ordered.append(span_el)
            current_y = span_el.bbox.y_max

        # Remaining elements below the last spanning element
        bottom_elements = [e for e in columnar_elements if e.bbox.y_min >= current_y]
        if bottom_elements:
            all_ordered.extend(self._segment_into_columns_and_sort(bottom_elements))

        return all_ordered

    def _segment_into_columns_and_sort(self, elements: list[Element]) -> list[Element]:
        """Cluster non-spanning elements into vertical columns and sort each column top-to-bottom."""
        if len(elements) <= 1:
            return elements

        # Sort elements by horizontal start (x_min)
        sorted_by_x = sorted(elements, key=lambda e: e.bbox.x_min)

        # Detect horizontal gutters
        # Build projection of x intervals
        columns: list[list[Element]] = []
        current_column: list[Element] = [sorted_by_x[0]]
        current_col_x_max = sorted_by_x[0].bbox.x_max

        for el in sorted_by_x[1:]:
            gutter = el.bbox.x_min - current_col_x_max

            # If horizontal distance exceeds min_column_gutter_width, start a new column
            if gutter >= self.config.min_column_gutter_width and len(columns) < self.config.max_columns:
                columns.append(current_column)
                current_column = [el]
                current_col_x_max = el.bbox.x_max
            else:
                current_column.append(el)
                current_col_x_max = max(current_col_x_max, el.bbox.x_max)

        if current_column:
            columns.append(current_column)

        # Order columns according to reading direction (LTR)
        if self.config.reading_direction == "rtl":
            columns.reverse()

        ordered_result: list[Element] = []
        for col in columns:
            # Within each column, elements flow top-to-bottom
            col.sort(key=lambda e: (e.bbox.y_min, e.bbox.x_min))
            ordered_result.extend(col)

        return ordered_result


def recover_reading_order(
    elements: list[Element],
    config: Optional[LayoutConfig] = None,
) -> list[Element]:
    """Convenience helper to run layout analysis and reading order recovery."""
    analyzer = LayoutOrderRecovery(config=config)
    return analyzer.process(elements)
