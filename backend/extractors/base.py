"""Base Extractor Interface and Element Schemas for Retrieva AI.

Defines the interchangeable contract for PDF document extraction pipelines.
"""

from abc import ABC, abstractmethod
from enum import Enum
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field


class ElementType(str, Enum):
    """Semantic element classification types."""

    TEXT = "text"
    HEADING = "heading"
    TABLE = "table"
    FORMULA = "formula"
    FIGURE = "figure"


class BoundingBox(BaseModel):
    """Bounding box coordinates [x_min, y_min, x_max, y_max]."""

    x_min: float = Field(..., ge=0.0, description="Left coordinate")
    y_min: float = Field(..., ge=0.0, description="Top coordinate")
    x_max: float = Field(..., ge=0.0, description="Right coordinate")
    y_max: float = Field(..., ge=0.0, description="Bottom coordinate")

    @property
    def width(self) -> float:
        return max(0.0, self.x_max - self.x_min)

    @property
    def height(self) -> float:
        return max(0.0, self.y_max - self.y_min)

    @property
    def area(self) -> float:
        return self.width * self.height


class TableCell(BaseModel):
    """Structured table cell representation preserving row/column spanning."""

    row_index: int = Field(..., ge=0, description="0-indexed start row")
    col_index: int = Field(..., ge=0, description="0-indexed start column")
    row_span: int = Field(default=1, ge=1, description="Number of rows spanned")
    col_span: int = Field(default=1, ge=1, description="Number of columns spanned")
    text: str = Field(default="", description="Textual content of the cell")
    content: Optional[str] = Field(default=None, description="Alias for cell content")
    bbox: Optional[BoundingBox] = Field(default=None, description="Cell bounding box")
    is_header: bool = Field(default=False, description="Whether this cell is part of a table header")


class FormulaData(BaseModel):
    """Structured mathematical formula representation."""

    latex: str = Field(..., description="Normalized LaTeX representation")
    is_display: bool = Field(default=False, description="True for standalone block/display equations")
    raw_text: Optional[str] = Field(default=None, description="Raw OCR or text stream characters")
    text: Optional[str] = Field(default=None, description="Alias for raw text")
    formula_type: Optional[str] = Field(default="display", description="display or inline")


class Element(BaseModel):
    """Canonical document element output by an extractor.

    Attributes:
        type: Semantic category (text, heading, table, formula, figure).
        page: 1-indexed document page number.
        bbox: Spatial boundary of the element.
        reading_order: Initial or recovered reading sequence index.
        text: Plaintext transcription of the element.
        table_cells: Structured list of cells if element is a table.
        formula: Structured mathematical representation if element is a formula.
        raw_confidence: Model confidence score in [0.0, 1.0].
        metadata: Extractor-specific auxiliary information.
    """

    type: ElementType = Field(..., description="Element semantic type")
    page: int = Field(..., ge=1, description="1-indexed page number")
    bbox: BoundingBox = Field(..., description="Element bounding box")
    reading_order: int = Field(..., ge=0, description="Reading order index")
    text: str = Field(default="", description="Textual content")
    table_cells: Optional[list[TableCell]] = Field(
        default=None,
        alias="table cells",
        description="Structured table cells if type == table",
    )
    formula: Optional[FormulaData] = Field(
        default=None,
        description="Structured formula data if type == formula",
    )
    formula_data: Optional[FormulaData] = Field(
        default=None,
        description="Alias for structured formula data",
    )
    raw_confidence: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="Raw extractor confidence score",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Auxiliary extractor metadata",
    )

    model_config = {
        "populate_by_name": True,
        "arbitrary_types_allowed": True,
    }


class BaseExtractor(ABC):
    """Abstract interface for all document extraction backends."""

    def __init__(self, name: str, version: str) -> None:
        self.name = name
        self.version = version

    @abstractmethod
    def extract(self, pdf_path: str | Path) -> list[Element]:
        """Extract structured elements from a PDF document.

        Args:
            pdf_path: Absolute or relative path to the PDF file.

        Returns:
            List of structured Element objects with bbox, reading order,
            and structured tables/formulas.
        """
        pass

