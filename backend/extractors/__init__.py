"""Extractors Package for Retrieva AI.

Exports interchangeable extraction backends:
- Extractor A: DoclingExtractor (lazy-loaded on demand to eliminate multi-second torch/transformers startup latency)
- Extractor B: PdfPlumberExtractor
"""

from typing import TYPE_CHECKING, Any

from backend.extractors.base import (
    BaseExtractor,
    BoundingBox,
    Element,
    ElementType,
    FormulaData,
    TableCell,
)
from backend.extractors.pdfplumber_extractor import PdfPlumberExtractor

if TYPE_CHECKING:
    from backend.extractors.docling_extractor import DoclingExtractor


def get_extractor(name_or_key: str) -> BaseExtractor:
    """Factory to retrieve an extractor instance by key or name.

    Args:
        name_or_key: 'A' or 'docling' -> DoclingExtractor
                     'B' or 'pdfplumber' / 'pymupdf' -> PdfPlumberExtractor

    Returns:
        Configured BaseExtractor instance.
    """
    key = name_or_key.strip().upper()
    if key in ("A", "DOCLING"):
        from backend.extractors.docling_extractor import DoclingExtractor

        return DoclingExtractor()
    elif key in ("B", "PDFPLUMBER", "PYMUPDF"):
        return PdfPlumberExtractor()
    else:
        raise ValueError(
            f"Unknown extractor identifier '{name_or_key}'. Supported extractors are 'A' (Docling) or 'B' (PyMuPDF + pdfplumber)."
        )


def __getattr__(name: str) -> Any:
    """Module-level attribute getter to lazy-load DoclingExtractor."""
    if name == "DoclingExtractor":
        from backend.extractors.docling_extractor import DoclingExtractor

        return DoclingExtractor
    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")


__all__ = [
    "BaseExtractor",
    "BoundingBox",
    "TableCell",
    "FormulaData",
    "ElementType",
    "Element",
    "DoclingExtractor",
    "PdfPlumberExtractor",
    "get_extractor",
]
