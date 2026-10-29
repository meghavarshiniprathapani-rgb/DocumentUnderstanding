"""Unit tests for Interchangeable Extractors (BaseExtractor, Docling, PdfPlumber)."""

from pathlib import Path

import pytest

from backend.extractors import (
    BaseExtractor,
    BoundingBox,
    DoclingExtractor,
    Element,
    ElementType,
    FormulaData,
    PdfPlumberExtractor,
    TableCell,
    get_extractor,
)


def test_element_schema_and_structured_types():
    """Verify Element schema preserves structured table cells and formulas without flattening."""
    cell1 = TableCell(
        row_index=0,
        col_index=0,
        row_span=1,
        col_span=2,
        text="Header Span",
        bbox=BoundingBox(x_min=10.0, y_min=10.0, x_max=100.0, y_max=30.0),
        is_header=True,
    )
    table_elem = Element(
        type=ElementType.TABLE,
        page=1,
        bbox=BoundingBox(x_min=10.0, y_min=10.0, x_max=100.0, y_max=100.0),
        reading_order=0,
        text="Header Span\nCell A | Cell B",
        table_cells=[cell1],
        raw_confidence=0.98,
    )
    assert table_elem.table_cells is not None
    assert len(table_elem.table_cells) == 1
    assert table_elem.table_cells[0].col_span == 2

    formula_elem = Element(
        type=ElementType.FORMULA,
        page=1,
        bbox=BoundingBox(x_min=20.0, y_min=50.0, x_max=80.0, y_max=70.0),
        reading_order=1,
        text="E = mc^2",
        formula=FormulaData(latex="E = mc^2", is_display=True, raw_text="E=mc^2"),
        raw_confidence=0.95,
    )
    assert formula_elem.formula is not None
    assert formula_elem.formula.latex == "E = mc^2"
    assert formula_elem.formula.is_display is True


def test_get_extractor_factory():
    """Verify factory returns appropriate instances for both extractors."""
    ext_a = get_extractor("A")
    assert isinstance(ext_a, DoclingExtractor)
    assert isinstance(ext_a, BaseExtractor)
    assert ext_a.name == "Docling"

    ext_b = get_extractor("B")
    assert isinstance(ext_b, PdfPlumberExtractor)
    assert isinstance(ext_b, BaseExtractor)
    assert "PyMuPDF" in ext_b.name

    with pytest.raises(ValueError, match="Unknown extractor identifier"):
        get_extractor("UNKNOWN")


def test_pdfplumber_extractor_extracts_placeholder_pdf():
    """Verify PdfPlumberExtractor correctly extracts elements from a sample PDF."""
    pdf_path = Path("data/sample_documents/doc-001.pdf")
    if not pdf_path.exists():
        pytest.skip("doc-001.pdf not found")

    extractor = PdfPlumberExtractor()
    elements = extractor.extract(pdf_path)

    assert len(elements) >= 1
    first_el = elements[0]
    assert isinstance(first_el, Element)
    assert first_el.page == 1
    assert "doc-001" in first_el.text
    assert first_el.bbox.width > 0
    assert first_el.bbox.height > 0
    assert 0.0 <= first_el.raw_confidence <= 1.0


def test_docling_extractor_extracts_placeholder_pdf():
    """Verify DoclingExtractor extracts elements and attaches metadata."""
    pdf_path = Path("data/sample_documents/doc-001.pdf")
    if not pdf_path.exists():
        pytest.skip("doc-001.pdf not found")

    extractor = DoclingExtractor()
    elements = extractor.extract(pdf_path)

    assert len(elements) >= 1
    first_el = elements[0]
    assert isinstance(first_el, Element)
    assert first_el.page == 1
    assert "doc-001" in first_el.text
    assert "docling_label" in first_el.metadata


def test_extractor_raises_on_nonexistent_file():
    """Verify both extractors raise FileNotFoundError when file is missing."""
    ext_a = DoclingExtractor()
    ext_b = PdfPlumberExtractor()

    with pytest.raises(FileNotFoundError):
        ext_a.extract("non_existent_file.pdf")

    with pytest.raises(FileNotFoundError):
        ext_b.extract("non_existent_file.pdf")
