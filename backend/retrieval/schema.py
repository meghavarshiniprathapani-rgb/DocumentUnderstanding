"""Data schemas for retrieval, chunking, and downstream evaluation."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from backend.extractors.base import BoundingBox
from backend.provenance.schema import ProvenanceRecord


class Chunk(BaseModel):
    """Represents a text chunk produced from documents for indexing and retrieval."""

    chunk_id: str = Field(description="Unique chunk identifier.")
    text: str = Field(description="Textual content of the chunk.")
    chunk_type: str = Field(
        default="structured_text",
        description="Type of chunk: structured_table, structured_formula, structured_text, or naive_flat.",
    )
    source_doc_id: str = Field(description="Source document identifier.")
    source_file_hash: Optional[str] = Field(
        default=None,
        description="Cryptographic SHA-256 hash of the source document.",
    )
    page_number: int = Field(default=1, description="Page number where the chunk originates.")
    bbox: Optional[BoundingBox] = Field(
        default=None,
        description="Bounding box or union bounding box covering the chunk.",
    )
    element_ids: List[str] = Field(
        default_factory=list,
        description="IDs of source elements comprising this chunk.",
    )
    provenance: Optional[ProvenanceRecord] = Field(
        default=None,
        description="Full provenance audit record when O3 is active.",
    )
    calibrated_confidence: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Multi-signal calibrated confidence score when O3 is active.",
    )
    raw_confidence: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="Raw confidence score from base extractor.",
    )
    is_degraded: bool = Field(
        default=False,
        description="Whether this chunk originated from a degraded-path fallback.",
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Additional structured metadata (e.g. table dimensions, formula syntax).",
    )


class RetrievalResult(BaseModel):
    """Result of retrieving a chunk against a query."""

    chunk: Chunk = Field(description="The retrieved chunk.")
    score: float = Field(description="Retrieval similarity score (cosine / inner product).")
    rank: int = Field(description="Rank of the result (1-indexed).")
