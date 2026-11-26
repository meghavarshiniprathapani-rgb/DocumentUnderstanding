from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field, field_validator


class InternalExtractRequest(BaseModel):
    document_id: str = Field(..., description="Target document identifier")
    file_path: str = Field(..., description="Server-side path to PDF file")
    mode: Literal["flat", "reference", "candidate", "candidate_ft"] = Field(
        default="flat",
        description="Extraction mode arm",
    )

    @field_validator("document_id")
    @classmethod
    def validate_document_id(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("document_id cannot be empty")
        return s


class ExtractedElementSchema(BaseModel):
    element_id: Optional[str] = None
    page: int
    type: str
    reading_order: int
    text: str
    bbox: Dict[str, float]
    table_data: Optional[Dict[str, Any]] = None
    formula_latex: Optional[str] = None
    raw_confidence: float
    calibrated_confidence: Optional[float] = None
    provenance: Optional[Dict[str, Any]] = None
    flags: Dict[str, Any] = Field(default_factory=dict)
    model_version: Optional[str] = None


class InternalExtractResponse(BaseModel):
    document_id: str
    mode: str
    status: str
    page_count: int
    elements: List[ExtractedElementSchema]
    processing_time_ms: float
    extractor: Dict[str, Any]
    model_versions: Dict[str, str]
    extraction_warnings: List[str] = Field(default_factory=list)
    indexing_status: str
    indexing_diagnostics: Optional[Dict[str, Any]] = None
    fallback: Optional[Dict[str, Any]] = None
