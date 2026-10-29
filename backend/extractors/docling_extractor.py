"""Docling Extractor Implementation for Retrieva AI.

Wraps IBM Docling 2.144.0 multimodal document parsing pipeline behind BaseExtractor.
"""

from pathlib import Path
from typing import Any, Optional

import docling
from docling.document_converter import DocumentConverter

from backend.extractors.base import (
    BaseExtractor,
    BoundingBox,
    Element,
    ElementType,
    FormulaData,
    TableCell,
)


class DoclingExtractor(BaseExtractor):
    """Extractor A: Multimodal document extraction using IBM Docling."""

    def __init__(self, pipeline_options: Optional[Any] = None) -> None:
        super().__init__(name="Docling", version=docling.__version__)
        self._converter = DocumentConverter()

    def extract(self, pdf_path: str | Path) -> list[Element]:
        """Extract structured elements from PDF using Docling."""
        path_obj = Path(pdf_path).resolve()
        if not path_obj.exists():
            raise FileNotFoundError(f"PDF document not found: {path_obj}")

        conv_result = self._converter.convert(str(path_obj))
        doc = conv_result.document

        elements: list[Element] = []
        reading_idx = 0

        # Iterate over all document elements preserving Docling's reading sequence
        for item, _level in doc.iterate_items():
            label_name = getattr(item, "label", "").lower()
            text_content = getattr(item, "text", "") or ""

            # Extract provenance bounding box if available
            prov = getattr(item, "prov", None)
            page_no = 1
            bbox = BoundingBox(x_min=0.0, y_min=0.0, x_max=612.0, y_max=792.0)

            if prov and len(prov) > 0:
                p = prov[0]
                page_no = getattr(p, "page_no", 1)
                b = getattr(p, "bbox", None)
                if b is not None:
                    # Docling BoundingBox coordinates
                    left = getattr(b, "l", 0.0)
                    top = getattr(b, "t", 0.0)
                    right = getattr(b, "r", 612.0)
                    bottom = getattr(b, "b", 792.0)
                    # Support both top-left and bottom-left origin
                    y_min = min(top, bottom)
                    y_max = max(top, bottom)
                    x_min = min(left, right)
                    x_max = max(left, right)
                    bbox = BoundingBox(
                        x_min=round(float(x_min), 2),
                        y_min=round(float(y_min), 2),
                        x_max=round(float(x_max), 2),
                        y_max=round(float(y_max), 2),
                    )

            elem_type = ElementType.TEXT
            table_cells: Optional[list[TableCell]] = None
            formula_data: Optional[FormulaData] = None

            # Determine ElementType and structure
            if "table" in label_name or hasattr(item, "data"):
                elem_type = ElementType.TABLE
                table_cells = []
                data = getattr(item, "data", None)
                raw_cells = getattr(data, "table_cells", []) if data else []

                for cell in raw_cells:
                    r_idx = getattr(cell, "start_row_offset_idx", 0)
                    c_idx = getattr(cell, "start_col_offset_idx", 0)
                    r_span = getattr(cell, "row_span", 1)
                    c_span = getattr(cell, "col_span", 1)
                    c_text = getattr(cell, "text", "")
                    c_bbox_obj = getattr(cell, "bbox", None)
                    c_bbox = None
                    if c_bbox_obj is not None:
                        cl = getattr(c_bbox_obj, "l", 0.0)
                        ct = getattr(c_bbox_obj, "t", 0.0)
                        cr = getattr(c_bbox_obj, "r", 0.0)
                        cb = getattr(c_bbox_obj, "b", 0.0)
                        c_bbox = BoundingBox(
                            x_min=round(float(min(cl, cr)), 2),
                            y_min=round(float(min(ct, cb)), 2),
                            x_max=round(float(max(cl, cr)), 2),
                            y_max=round(float(max(ct, cb)), 2),
                        )
                    table_cells.append(
                        TableCell(
                            row_index=r_idx,
                            col_index=c_idx,
                            row_span=r_span,
                            col_span=c_span,
                            text=c_text,
                            bbox=c_bbox,
                            is_header=r_idx == 0,
                        )
                    )
            elif "formula" in label_name or "equation" in label_name or "math" in label_name:
                elem_type = ElementType.FORMULA
                latex_code = getattr(item, "latex", "") or text_content
                formula_data = FormulaData(
                    latex=latex_code,
                    is_display="display" in label_name or "\n" in text_content,
                    raw_text=text_content,
                )
            elif "heading" in label_name or "title" in label_name or "section" in label_name:
                elem_type = ElementType.HEADING
            elif "picture" in label_name or "figure" in label_name or "image" in label_name:
                elem_type = ElementType.FIGURE

            elements.append(
                Element(
                    type=elem_type,
                    page=page_no,
                    bbox=bbox,
                    reading_order=reading_idx,
                    text=text_content,
                    table_cells=table_cells,
                    formula=formula_data,
                    raw_confidence=0.95,
                    metadata={"docling_label": label_name},
                )
            )
            reading_idx += 1

        return elements
