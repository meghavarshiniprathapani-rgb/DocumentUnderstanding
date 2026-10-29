"""PyMuPDF + pdfplumber Extractor Implementation for Retrieva AI.

Combines PyMuPDF (vector text, font attributes, math heuristics) with
pdfplumber (precise line-intersection table grid topology).
"""

import re
from pathlib import Path
from typing import Optional

import pdfplumber
import pymupdf

from backend.extractors.base import (
    BaseExtractor,
    BoundingBox,
    Element,
    ElementType,
    FormulaData,
    TableCell,
)

# Common LaTeX / math symbols and patterns
MATH_SYMBOLS = set("∀∂∃∅∇∈∉∋∏∑−∗√∝∞∠∧∨∩∪∫∬∭∮∴∵∶∷∼∽≅≈≉≠≡≤≥≦≧≪≫⊂⊃⊆⊇⊕⊗⊥⋅αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΥΦΨΩ")
MATH_OPERATOR_PATTERN = re.compile(r"(\b(sin|cos|tan|log|ln|lim|exp|det|max|min)\b|[\^_]\{?[a-zA-Z0-9+-]+\}?|[=<>±×÷])")


class PdfPlumberExtractor(BaseExtractor):
    """Extractor B: High-performance deterministic layout parsing using PyMuPDF and pdfplumber."""

    def __init__(self) -> None:
        super().__init__(
            name="PyMuPDF_pdfplumber",
            version=f"fitz:{pymupdf.__version__}_pdfplumber:{pdfplumber.__version__}",
        )

    def extract(self, pdf_path: str | Path) -> list[Element]:
        """Extract structured elements from PDF using PyMuPDF + pdfplumber."""
        path_obj = Path(pdf_path).resolve()
        if not path_obj.exists():
            raise FileNotFoundError(f"PDF document not found: {path_obj}")

        elements: list[Element] = []
        reading_idx = 0

        # Open simultaneously with PyMuPDF (fast text/font analysis) and pdfplumber (table topology)
        with pdfplumber.open(str(path_obj)) as plumber_pdf, pymupdf.open(str(path_obj)) as fitz_pdf:
            total_pages = min(len(plumber_pdf.pages), len(fitz_pdf))

            for page_idx in range(total_pages):
                plumber_page = plumber_pdf.pages[page_idx]
                fitz_page = fitz_pdf[page_idx]
                page_no = page_idx + 1

                page_elements: list[Element] = []
                table_bboxes: list[tuple[float, float, float, float]] = []

                # 1. Extract Structured Tables via pdfplumber
                try:
                    found_tables = plumber_page.find_tables()
                except Exception:
                    found_tables = []

                for tbl in found_tables:
                    t_bbox_tuple = tbl.bbox  # (x0, top, x1, bottom)
                    t_bbox = BoundingBox(
                        x_min=round(float(t_bbox_tuple[0]), 2),
                        y_min=round(float(t_bbox_tuple[1]), 2),
                        x_max=round(float(t_bbox_tuple[2]), 2),
                        y_max=round(float(t_bbox_tuple[3]), 2),
                    )
                    table_bboxes.append(t_bbox_tuple)

                    extracted_data = tbl.extract() or []
                    table_cells: list[TableCell] = []

                    # Build structured grid cells with row/col spans
                    row_count = len(extracted_data)
                    col_count = max((len(r) for r in extracted_data), default=0)

                    # Extract cell bounding boxes if available from table.cells
                    raw_cells = tbl.cells or []
                    for r_i, row in enumerate(extracted_data):
                        for c_i, cell_text in enumerate(row):
                            c_text_clean = str(cell_text or "").strip()
                            c_bbox: Optional[BoundingBox] = None

                            # Approximate cell bbox from table.cells if indices match
                            cell_idx = r_i * col_count + c_i
                            if cell_idx < len(raw_cells):
                                cb = raw_cells[cell_idx]
                                c_bbox = BoundingBox(
                                    x_min=round(float(cb[0]), 2),
                                    y_min=round(float(cb[1]), 2),
                                    x_max=round(float(cb[2]), 2),
                                    y_max=round(float(cb[3]), 2),
                                )

                            table_cells.append(
                                TableCell(
                                    row_index=r_i,
                                    col_index=c_i,
                                    row_span=1,
                                    col_span=1,
                                    text=c_text_clean,
                                    bbox=c_bbox,
                                    is_header=r_i == 0,
                                )
                            )

                    # Render table summary text for embedding / search fallback
                    rendered_rows = [" | ".join(str(c or "") for c in r) for r in extracted_data]
                    table_text = "\n".join(rendered_rows)

                    page_elements.append(
                        Element(
                            type=ElementType.TABLE,
                            page=page_no,
                            bbox=t_bbox,
                            reading_order=0,  # Will be sequenced per page
                            text=table_text,
                            table_cells=table_cells,
                            raw_confidence=0.98,
                            metadata={"rows": row_count, "cols": col_count},
                        )
                    )

                # 2. Extract Text Blocks & Math Formulas via PyMuPDF dict extraction
                page_dict = fitz_page.get_text("dict")
                blocks = page_dict.get("blocks", [])

                # Calculate median body font size for heading classification
                font_sizes: list[float] = []
                for b in blocks:
                    for line in b.get("lines", []):
                        for span in line.get("spans", []):
                            if span.get("size"):
                                font_sizes.append(span["size"])
                median_font_size = sorted(font_sizes)[len(font_sizes) // 2] if font_sizes else 11.0

                for b in blocks:
                    # Ignore image blocks (type 1) or empty blocks
                    if b.get("type", 0) != 0:
                        if b.get("type") == 1:  # Image
                            b_bbox = b.get("bbox", (0, 0, 0, 0))
                            page_elements.append(
                                Element(
                                    type=ElementType.FIGURE,
                                    page=page_no,
                                    bbox=BoundingBox(
                                        x_min=round(float(b_bbox[0]), 2),
                                        y_min=round(float(b_bbox[1]), 2),
                                        x_max=round(float(b_bbox[2]), 2),
                                        y_max=round(float(b_bbox[3]), 2),
                                    ),
                                    reading_order=0,
                                    text="[Figure Image]",
                                    raw_confidence=0.90,
                                )
                            )
                        continue

                    b_bbox_tuple = b.get("bbox", (0, 0, 0, 0))
                    # Check if block is entirely contained within an already-extracted table
                    is_inside_table = False
                    for tb in table_bboxes:
                        if (
                            b_bbox_tuple[0] >= tb[0] - 2
                            and b_bbox_tuple[1] >= tb[1] - 2
                            and b_bbox_tuple[2] <= tb[2] + 2
                            and b_bbox_tuple[3] <= tb[3] + 2
                        ):
                            is_inside_table = True
                            break
                    if is_inside_table:
                        continue

                    # Concatenate block text and analyze spans for font attributes
                    block_text_lines: list[str] = []
                    has_math_symbols = False
                    has_superscript = False
                    max_span_size = 0.0

                    for line in b.get("lines", []):
                        line_parts = []
                        for span in line.get("spans", []):
                            s_text = span.get("text", "")
                            s_font = span.get("font", "").lower()
                            s_flags = span.get("flags", 0)
                            s_size = span.get("size", 11.0)
                            max_span_size = max(max_span_size, s_size)

                            if any(c in MATH_SYMBOLS for c in s_text):
                                has_math_symbols = True
                            if "math" in s_font or "cmr" in s_font or "cmsy" in s_font or "symbol" in s_font:
                                has_math_symbols = True
                            # Bit 0 (flags & 1) indicates superscript/subscript in MuPDF
                            if s_flags & 1:
                                has_superscript = True

                            line_parts.append(s_text)
                        line_str = "".join(line_parts).strip()
                        if line_str:
                            block_text_lines.append(line_str)

                    full_block_text = "\n".join(block_text_lines).strip()
                    if not full_block_text:
                        continue

                    b_bbox = BoundingBox(
                        x_min=round(float(b_bbox_tuple[0]), 2),
                        y_min=round(float(b_bbox_tuple[1]), 2),
                        x_max=round(float(b_bbox_tuple[2]), 2),
                        y_max=round(float(b_bbox_tuple[3]), 2),
                    )

                    # Classify formula, heading, or standard text
                    is_math = (has_math_symbols and (has_superscript or "=" in full_block_text)) or bool(
                        MATH_OPERATOR_PATTERN.search(full_block_text) and ("=" in full_block_text or "\\frac" in full_block_text)
                    )

                    if is_math and len(full_block_text) < 300:
                        latex_code = full_block_text.replace("\n", " ")
                        formula_data = FormulaData(
                            latex=latex_code,
                            is_display="\n" in full_block_text or (b_bbox.width > 120 and b_bbox.height < 50),
                            raw_text=full_block_text,
                        )
                        page_elements.append(
                            Element(
                                type=ElementType.FORMULA,
                                page=page_no,
                                bbox=b_bbox,
                                reading_order=0,
                                text=full_block_text,
                                formula=formula_data,
                                raw_confidence=0.92,
                            )
                        )
                    elif max_span_size > (median_font_size * 1.25) or (
                        len(full_block_text) < 120 and full_block_text.endswith(":")
                    ):
                        page_elements.append(
                            Element(
                                type=ElementType.HEADING,
                                page=page_no,
                                bbox=b_bbox,
                                reading_order=0,
                                text=full_block_text,
                                raw_confidence=0.95,
                            )
                        )
                    else:
                        page_elements.append(
                            Element(
                                type=ElementType.TEXT,
                                page=page_no,
                                bbox=b_bbox,
                                reading_order=0,
                                text=full_block_text,
                                raw_confidence=0.97,
                            )
                        )

                # Order elements spatially by vertical position as initial baseline
                page_elements.sort(key=lambda el: (el.bbox.y_min, el.bbox.x_min))
                for el in page_elements:
                    el.reading_order = reading_idx
                    reading_idx += 1
                    elements.append(el)

        return elements
