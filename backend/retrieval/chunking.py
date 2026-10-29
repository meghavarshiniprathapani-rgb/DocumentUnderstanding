"""Chunking strategies for downstream retrieval evaluation.

Compares:
1. NaiveFlatChunker: Concatenates plain text and splits into fixed-size character windows,
   fragmenting tables and formulas, with zero element provenance.
2. StructuredElementChunker: Preserves tables as whole structured blocks, maintains LaTeX
   formulas intact, respects reading-order boundaries, and attaches cryptographic provenance.
"""

from abc import ABC, abstractmethod
from typing import Any, List, Optional

from backend.extractors.base import BoundingBox, Element, ElementType, TableCell
from backend.provenance.schema import EnrichedElement
from backend.retrieval.schema import Chunk


class BaseChunker(ABC):
    """Abstract base interface for document chunkers."""

    @abstractmethod
    def chunk_elements(
        self,
        elements: List[Any],
        doc_id: str,
        file_hash: Optional[str] = None,
    ) -> List[Chunk]:
        """Convert a sequence of elements into retrieval chunks."""
        pass


class NaiveFlatChunker(BaseChunker):
    """Baseline naive chunker.

    Flattens all element text into a continuous character stream and applies a fixed-size
    sliding window with character overlap, ignoring layout, table columns, and formulas.
    """

    def __init__(self, chunk_size: int = 350, chunk_overlap: int = 50) -> None:
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def chunk_elements(
        self,
        elements: List[Any],
        doc_id: str,
        file_hash: Optional[str] = None,
    ) -> List[Chunk]:
        # Unwrap EnrichedElement if necessary
        plain_texts = []
        for item in elements:
            elem = item.element if isinstance(item, EnrichedElement) else item
            text = elem.text.strip()
            if text:
                plain_texts.append(text)

        full_text = "\n".join(plain_texts)
        if not full_text:
            return []

        chunks: List[Chunk] = []
        idx = 0
        start = 0
        text_len = len(full_text)

        step = max(1, self.chunk_size - self.chunk_overlap)
        while start < text_len:
            end = min(start + self.chunk_size, text_len)
            slice_text = full_text[start:end].strip()
            if slice_text:
                chunks.append(
                    Chunk(
                        chunk_id=f"{doc_id}_naive_chunk_{idx}",
                        text=slice_text,
                        chunk_type="naive_flat",
                        source_doc_id=doc_id,
                        source_file_hash=file_hash,
                        page_number=1,  # Naive chunker loses exact page association across text joins
                        bbox=None,  # No spatial bounds
                        element_ids=[],
                        provenance=None,
                        calibrated_confidence=None,
                        raw_confidence=0.5,
                        is_degraded=False,
                        metadata={
                            "char_start": start,
                            "char_end": end,
                            "strategy": "naive_character_window",
                        },
                    )
                )
                idx += 1

            if end >= text_len:
                break
            start += step

        return chunks


class StructuredElementChunker(BaseChunker):
    """Structured element chunker.

    - Keeps tables whole: Formats structured tables into complete Markdown representations.
    - Preserves formulas: Keeps LaTeX mathematical notation intact without truncation.
    - Preserves reading order: Groups coherent paragraphs up to max_chunk_chars.
    - Attaches provenance: Links cryptographic hash, page number, spatial bbox, and confidence.
    """

    def __init__(self, max_text_chunk_chars: int = 500) -> None:
        self.max_text_chunk_chars = max_text_chunk_chars

    @staticmethod
    def _format_table_as_markdown(table_cells: List[TableCell], num_rows: int, num_cols: int) -> str:
        """Render a list of TableCell objects as a complete GitHub-flavored Markdown table."""
        if not table_cells or num_rows <= 0 or num_cols <= 0:
            return ""

        grid = [["" for _ in range(num_cols)] for _ in range(num_rows)]
        for cell in table_cells:
            r = min(max(0, cell.row_index), num_rows - 1)
            c = min(max(0, cell.col_index), num_cols - 1)
            raw_c = cell.text or cell.content or ""
            grid[r][c] = raw_c.replace("\n", " ").strip()

        lines = []
        # Header row
        header_cells = [grid[0][c] or f"Col_{c+1}" for c in range(num_cols)]
        lines.append("| " + " | ".join(header_cells) + " |")
        lines.append("| " + " | ".join(["---"] * num_cols) + " |")

        # Data rows
        for r in range(1, num_rows):
            row_cells = [grid[r][c] for c in range(num_cols)]
            lines.append("| " + " | ".join(row_cells) + " |")

        return "\n".join(lines)

    @staticmethod
    def _union_bboxes(bboxes: List[BoundingBox]) -> Optional[BoundingBox]:
        """Compute spatial bounding box union over a list of bounding boxes."""
        if not bboxes:
            return None
        return BoundingBox(
            x_min=min(b.x_min for b in bboxes),
            y_min=min(b.y_min for b in bboxes),
            x_max=max(b.x_max for b in bboxes),
            y_max=max(b.y_max for b in bboxes),
        )

    def chunk_elements(
        self,
        elements: List[Any],
        doc_id: str,
        file_hash: Optional[str] = None,
    ) -> List[Chunk]:
        chunks: List[Chunk] = []
        chunk_counter = 0

        current_text_group: List[str] = []
        current_elem_ids: List[str] = []
        current_bboxes: List[BoundingBox] = []
        current_page = 1
        current_prov = None
        current_cal_conf = None
        current_is_degraded = False

        def flush_text_group() -> None:
            nonlocal chunk_counter, current_text_group, current_elem_ids, current_bboxes
            nonlocal current_page, current_prov, current_cal_conf, current_is_degraded

            if not current_text_group:
                return

            joined_text = "\n\n".join(current_text_group).strip()
            if joined_text:
                union_box = self._union_bboxes(current_bboxes)
                chunks.append(
                    Chunk(
                        chunk_id=f"{doc_id}_struct_chunk_{chunk_counter}",
                        text=joined_text,
                        chunk_type="structured_text",
                        source_doc_id=doc_id,
                        source_file_hash=file_hash or (current_prov.source_file_hash if current_prov else None),
                        page_number=current_page,
                        bbox=union_box,
                        element_ids=list(current_elem_ids),
                        provenance=current_prov,
                        calibrated_confidence=current_cal_conf,
                        raw_confidence=1.0,
                        is_degraded=current_is_degraded,
                        metadata={
                            "strategy": "structured_reading_order_grouping",
                            "element_count": len(current_elem_ids),
                        },
                    )
                )
                chunk_counter += 1

            current_text_group = []
            current_elem_ids = []
            current_bboxes = []
            current_is_degraded = False

        for item in elements:
            is_enriched = isinstance(item, EnrichedElement)
            elem: Element = item.element if is_enriched else item
            prov = item.provenance if is_enriched else None
            cal_conf = item.calibrated_confidence if is_enriched else None
            is_deg = bool(item.routing.is_degraded) if (is_enriched and item.routing) else False

            elem_id = str(elem.metadata.get("id", f"elem_{elem.reading_order}"))

            # CASE 1: Table - Keep completely whole
            if elem.type == ElementType.TABLE:
                flush_text_group()
                table_md = ""
                if elem.table_cells:
                    num_rows = max((c.row_index for c in elem.table_cells), default=0) + 1
                    num_cols = max((c.col_index for c in elem.table_cells), default=0) + 1
                    table_md = self._format_table_as_markdown(elem.table_cells, num_rows, num_cols)

                content_parts = []
                if elem.text:
                    content_parts.append(elem.text.strip())
                if table_md:
                    content_parts.append(table_md)
                table_text = "\n\n".join(content_parts)

                chunks.append(
                    Chunk(
                        chunk_id=f"{doc_id}_struct_table_{chunk_counter}",
                        text=table_text,
                        chunk_type="structured_table",
                        source_doc_id=doc_id,
                        source_file_hash=file_hash or (prov.source_file_hash if prov else None),
                        page_number=elem.page,
                        bbox=elem.bbox,
                        element_ids=[elem_id],
                        provenance=prov,
                        calibrated_confidence=cal_conf,
                        raw_confidence=elem.raw_confidence,
                        is_degraded=is_deg,
                        metadata={
                            "strategy": "atomic_table_preservation",
                            "num_cells": len(elem.table_cells) if elem.table_cells else 0,
                        },
                    )
                )
                chunk_counter += 1
                continue

            # CASE 2: Formula - Keep intact
            if elem.type == ElementType.FORMULA:
                flush_text_group()
                formula_str = ""
                f_obj = elem.formula or elem.formula_data
                if f_obj and f_obj.latex:
                    formula_str = f"$$\n{f_obj.latex}\n$$"
                elif elem.text:
                    formula_str = f"$$\n{elem.text}\n$$"

                chunks.append(
                    Chunk(
                        chunk_id=f"{doc_id}_struct_formula_{chunk_counter}",
                        text=formula_str,
                        chunk_type="structured_formula",
                        source_doc_id=doc_id,
                        source_file_hash=file_hash or (prov.source_file_hash if prov else None),
                        page_number=elem.page,
                        bbox=elem.bbox,
                        element_ids=[elem_id],
                        provenance=prov,
                        calibrated_confidence=cal_conf,
                        raw_confidence=elem.raw_confidence,
                        is_degraded=is_deg,
                        metadata={
                            "strategy": "atomic_formula_preservation",
                            "has_latex": bool(elem.formula_data and elem.formula_data.latex),
                        },
                    )
                )
                chunk_counter += 1
                continue

            # CASE 3: Text or Heading
            current_page = elem.page
            if prov:
                current_prov = prov
            if cal_conf is not None:
                current_cal_conf = cal_conf
            if is_deg:
                current_is_degraded = True

            text_content = elem.text.strip()
            if not text_content:
                continue

            # Check if adding this exceeds max_text_chunk_chars
            group_len = sum(len(t) for t in current_text_group)
            if group_len + len(text_content) > self.max_text_chunk_chars:
                flush_text_group()

            current_text_group.append(text_content)
            current_elem_ids.append(elem_id)
            if elem.bbox:
                current_bboxes.append(elem.bbox)

        flush_text_group()
        return chunks
