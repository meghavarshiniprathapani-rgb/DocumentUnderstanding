"""Configuration schema for Layout Analysis and Reading-Order Recovery."""

from typing import Literal

from pydantic import BaseModel, Field


class LayoutConfig(BaseModel):
    """Configurable parameters for spatial layout analysis and column segmentation."""

    # Page dimension defaults (standard US Letter points: 612 x 792)
    default_page_width: float = Field(default=612.0, ge=100.0)
    default_page_height: float = Field(default=792.0, ge=100.0)

    # Header and footer isolation thresholds (ratios of page height)
    header_max_y_ratio: float = Field(
        default=0.09,
        ge=0.0,
        le=0.25,
        description="Elements with y_max below this ratio of page height are treated as headers.",
    )
    footer_min_y_ratio: float = Field(
        default=0.91,
        ge=0.75,
        le=1.0,
        description="Elements with y_min above this ratio of page height are treated as footers.",
    )

    # Column segmentation thresholds
    min_column_gutter_width: float = Field(
        default=10.0,
        ge=2.0,
        description="Minimum horizontal whitespace in points to identify a distinct column gutter.",
    )
    max_columns: int = Field(
        default=4,
        ge=1,
        le=6,
        description="Maximum number of columns to detect on a single page.",
    )

    # Floating sidebar detection
    sidebar_max_width_ratio: float = Field(
        default=0.32,
        ge=0.10,
        le=0.50,
        description="Maximum fraction of page width an element can occupy to be classified as a sidebar.",
    )
    sidebar_min_height_ratio: float = Field(
        default=0.15,
        ge=0.05,
        le=0.80,
        description="Minimum fraction of page height for a floating sidebar block.",
    )
    sidebar_placement: Literal["after_anchoring_column", "end_of_page", "first"] = Field(
        default="after_anchoring_column",
        description="Policy for positioning floating sidebar elements in the recovered reading sequence.",
    )

    # Vertical line grouping tolerance
    vertical_line_overlap_tolerance: float = Field(
        default=4.0,
        ge=0.0,
        description="Vertical point tolerance for determining if elements belong to the same text line.",
    )

    reading_direction: Literal["ltr", "rtl"] = Field(
        default="ltr",
        description="Primary reading direction across columns (ltr: left-to-right, rtl: right-to-left).",
    )
