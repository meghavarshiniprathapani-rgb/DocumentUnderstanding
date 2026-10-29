"""
Retrieva AI — Ground-Truth Annotation Oracle Schemas
Strict Pydantic models defining the per-page ground truth format:
- Bounding boxes [x, y, width, height]
- Reading order indices (0, 1, 2, ...)
- Element types: text, heading, table, formula, figure
- Table cells with row/col indices and spans
- Formulas with LaTeX and plain-text representation
- Critical scene classification
"""

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class BoundingBox(BaseModel):
    """2D spatial bounding box in [x, y, width, height] coordinates."""

    x: float = Field(..., ge=0.0, description="Horizontal coordinate of top-left vertex")
    y: float = Field(..., ge=0.0, description="Vertical coordinate of top-left vertex")
    width: float = Field(..., gt=0.0, description="Bounding box width")
    height: float = Field(..., gt=0.0, description="Bounding box height")

    def as_tuple(self) -> tuple[float, float, float, float]:
        return (self.x, self.y, self.width, self.height)

    def as_xyxy(self) -> tuple[float, float, float, float]:
        return (self.x, self.y, self.x + self.width, self.y + self.height)


class TableCellAnnotation(BaseModel):
    """Grid cell annotation supporting horizontal and vertical spans."""

    cell_id: str = Field(..., description="Unique cell identifier")
    row_index: int = Field(..., ge=0, description="0-indexed starting row")
    col_index: int = Field(..., ge=0, description="0-indexed starting column")
    row_span: int = Field(default=1, ge=1, description="Number of rows spanned by cell")
    col_span: int = Field(default=1, ge=1, description="Number of columns spanned by cell")
    content: str = Field(..., description="Extracted textual content of cell")
    is_header: bool = Field(default=False, description="Flag indicating if cell is a table header")
    bbox: Optional[BoundingBox] = Field(default=None, description="Cell bounding box coordinates")


class TableAnnotation(BaseModel):
    """Structured table grid annotation with cell topology."""

    num_rows: int = Field(..., ge=1, description="Total number of logical rows in table")
    num_cols: int = Field(..., ge=1, description="Total number of logical columns in table")
    cells: List[TableCellAnnotation] = Field(..., min_length=1, description="List of annotated table cells")

    @field_validator("cells")
    @classmethod
    def validate_cells_within_grid(cls, cells: List[TableCellAnnotation], info) -> List[TableCellAnnotation]:
        num_rows = info.data.get("num_rows")
        num_cols = info.data.get("num_cols")
        if num_rows is not None and num_cols is not None:
            for cell in cells:
                if cell.row_index + cell.row_span > num_rows:
                    raise ValueError(
                        f"Cell {cell.cell_id} row_index ({cell.row_index}) + row_span ({cell.row_span}) "
                        f"exceeds num_rows ({num_rows})"
                    )
                if cell.col_index + cell.col_span > num_cols:
                    raise ValueError(
                        f"Cell {cell.cell_id} col_index ({cell.col_index}) + col_span ({cell.col_span}) "
                        f"exceeds num_cols ({num_cols})"
                    )
        return cells


class FormulaAnnotation(BaseModel):
    """Mathematical formula annotation with LaTeX and plain-text representation."""

    latex: str = Field(..., min_length=1, description="Standard LaTeX representation of formula")
    text: str = Field(..., description="Plain-text or spoken representation")
    formula_type: Literal["inline", "display"] = Field(
        default="display", description="Inline equation within text paragraph or standalone display equation"
    )


class GroundTruthElement(BaseModel):
    """Individual document layout entity."""

    id: str = Field(..., description="Unique element identifier (e.g. 'elem-001')")
    type: Literal["text", "heading", "table", "formula", "figure"] = Field(..., description="Layout element category")
    bbox: BoundingBox = Field(..., description="Element bounding box geometry")
    reading_order: int = Field(..., ge=0, description="0-indexed position in canonical reading order")
    text: str = Field(..., description="Extracted textual content")
    is_critical: bool = Field(
        default=False, description="Flag indicating if element belongs to a high-impact critical scene"
    )
    critical_category: Optional[str] = Field(
        default=None,
        description="Category of critical scene (e.g. 'financial_line_item', 'compliance_mandate', 'primary_theorem')",
    )
    table: Optional[TableAnnotation] = Field(default=None, description="Structured table grid if type == 'table'")
    formula: Optional[FormulaAnnotation] = Field(
        default=None, description="Formula LaTeX representation if type == 'formula'"
    )

    @field_validator("table")
    @classmethod
    def validate_table_presence(cls, v: Optional[TableAnnotation], info) -> Optional[TableAnnotation]:
        elem_type = info.data.get("type")
        if elem_type == "table" and v is None:
            raise ValueError("Element of type 'table' must include 'table' annotation payload")
        return v

    @field_validator("formula")
    @classmethod
    def validate_formula_presence(cls, v: Optional[FormulaAnnotation], info) -> Optional[FormulaAnnotation]:
        elem_type = info.data.get("type")
        if elem_type == "formula" and v is None:
            raise ValueError("Element of type 'formula' must include 'formula' annotation payload")
        return v


class PageGroundTruth(BaseModel):
    """Authoritative ground-truth annotation for a single PDF page."""

    page_id: str = Field(..., description="Unique page identifier (e.g. 'doc-001_p1')")
    document_id: str = Field(..., description="Parent document identifier (e.g. 'doc-001')")
    page_number: int = Field(..., ge=1, description="1-indexed physical page number")
    width: float = Field(default=800.0, gt=0.0, description="Page canvas coordinate width")
    height: float = Field(default=1100.0, gt=0.0, description="Page canvas coordinate height")
    elements: List[GroundTruthElement] = Field(..., min_length=1, description="List of annotated page elements")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Annotator metadata and timestamps")

    @field_validator("elements")
    @classmethod
    def validate_unique_element_ids_and_reading_orders(
        cls, elements: List[GroundTruthElement]
    ) -> List[GroundTruthElement]:
        ids = set()
        reading_orders = set()
        for elem in elements:
            if elem.id in ids:
                raise ValueError(f"Duplicate element id detected: {elem.id}")
            ids.add(elem.id)
            if elem.reading_order in reading_orders:
                raise ValueError(f"Duplicate reading_order detected: {elem.reading_order}")
            reading_orders.add(elem.reading_order)
        return elements
