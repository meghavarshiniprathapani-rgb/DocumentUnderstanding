# Retrieva AI — Ground-Truth Annotation Guide

> **Document Version:** 1.0.0  
> **Status:** Standard Reference Manual  
> **Scope:** Ground-Truth Page Annotation, Coordinate Geometry, Table Topology, Formula Representation, and Critical-Scene Classification  

---

## 1. Introduction & Objectives

The **Retrieva AI Independent Oracle** provides an objective, unbiased ground truth for scoring document extraction pipelines. To prevent any model-specific bias, ground-truth annotations are created independently of any OCR engine, LayoutLM transformer, or heuristic parser.

Each annotated page is stored as a self-contained JSON document conforming to the schema in [`eval/oracle_schema.py`](file:///c:/Disk%20D/Capstone/eval/oracle_schema.py).

---

## 2. Coordinate System & Spatial Geometry

- **Coordinate Standard**: All element bounding boxes are expressed in **2D Euclidean Cartesian coordinates**:
  $$\mathbf{b} = [x, y, \text{width}, \text{height}]$$
- **Origin**: $(0, 0)$ is positioned at the **top-left corner** of the page canvas.
- **Reference Canvas Dimensions**: Normalized to $W_{\text{page}} = 800.0$ and $H_{\text{page}} = 1100.0$ points.
- **Tightest Enclosing Rectangle**: Bounding boxes must enclose all visual tokens of the element with a maximum margin of 2 points.
- **Derived Coordinates**:
  $$x_0 = x, \quad y_0 = y, \quad x_1 = x + \text{width}, \quad y_1 = y + \text{height}$$

---

## 3. Element Types & Classification Criteria

Every visual layout region must be assigned exactly one canonical element type:

| Type | Definition | Annotation Requirements |
| :--- | :--- | :--- |
| **`heading`** | Document titles, chapter headers, section headers (`H1`, `H2`, `H3`), and table titles. | Clean string; reading order index; mark `is_critical` if main document or legal header. |
| **`text`** | Running paragraphs, narrative clauses, abstracts, footnotes, and callout descriptions. | Complete transcribed text preserving punctuation and hyphenation. |
| **`table`** | 2D structured grids composed of rows and columns with delimited cell boundaries. | Requires nested `table` object with `num_rows`, `num_cols`, and individual `cells`. |
| **`formula`** | Mathematical equations, algebraic relations, chemical formulas, and formal proofs. | Requires nested `formula` object with canonical `latex`, plain `text`, and `formula_type`. |
| **`figure`** | Architectural schematics, flowcharts, photographs, organizational diagrams, and vector plots. | Bounding box enclosing the entire graphic; caption text if embedded. |

---

## 4. Reading Order Indexing (`reading_order`)

Reading order defines the canonical sequence in which a human reader consumes the document:

1. **Sequential 0-Indexed Integer**: `0, 1, 2, ..., N-1` without gaps or duplicates.
2. **Multi-Column Layouts**: Annotate down the entire left column before transitioning to the top of the right column.
3. **Spanning Elements**: Elements that span across multiple columns (e.g., page-wide titles or banner tables) take reading order precedence before the column split resumes.
4. **Footnotes & Disclaimers**: Footnotes receive reading order indices immediately following the referencing narrative paragraph or at the very end of the page body.
5. **Captions**: Table captions are annotated immediately before their respective table; figure captions immediately follow their respective figure.

---

## 5. Table Grid Structure & Span Topology

Tables are represented as logical row-column matrices with explicit coordinate spans:

```json
{
  "num_rows": 3,
  "num_cols": 3,
  "cells": [
    {
      "cell_id": "c-0-0",
      "row_index": 0,
      "col_index": 0,
      "row_span": 1,
      "col_span": 3,
      "content": "Consolidated Financial Summary ($ Millions)",
      "is_header": true
    },
    {
      "cell_id": "c-1-0",
      "row_index": 1,
      "col_index": 0,
      "row_span": 1,
      "col_span": 1,
      "content": "Operating Profit",
      "is_header": false
    }
  ]
}
```

### Table Annotation Rules
- **Logical Grid**: Cell positions are strictly defined by `(row_index, col_index)` on the logical table grid.
- **Spans**: When a header spans multiple columns, set `col_span > 1`. When a cell spans multiple vertical rows, set `row_span > 1`.
- **Empty Cells**: Empty table cells must still be annotated with `content: ""` if they represent a legitimate structural grid cell.
- **Headers**: Cells residing in the header block or column hierarchy must set `"is_header": true`.

---

## 6. Formula Annotation & LaTeX Standards

Mathematical expressions are captured with full syntactic fidelity:

```json
{
  "formula": {
    "latex": "\\text{Attention}(Q, K, V) = \\text{softmax}\\left(\\frac{Q K^T}{\\sqrt{d_k}}\\right) V",
    "text": "Attention(Q, K, V) = softmax((Q K^T) / sqrt(d_k)) V",
    "formula_type": "display"
  }
}
```

### Formula Standards
1. **LaTeX Syntax**: Use standard KaTeX/LaTeX mathematical markup.
2. **Whitespace Normalization**: Do not add unnecessary trailing spaces; enclose superscripts and subscripts in braces (`x^{2}`, `x_{i}`).
3. **Formula Type**:
   - `"display"`: Standalone centered or indented equation on its own line.
   - `"inline"`: Equation embedded directly within a running text sentence.

---

## 7. Definition of "Critical Scenes" (`is_critical`)

### 7.1 What is a "Critical Scene"?

A **Critical Scene** is an element or visual region whose accurate extraction is **essential to downstream business, legal, or research decisions**. Any omission, bounding box corruption, or semantic error in a critical scene causes fatal failure in retrieval or automated compliance auditing.

### 7.2 Criteria for Designating Critical Scenes

An element must be marked with `"is_critical": true` if it falls into one of the following categories:

| Critical Category | Description | Document Types | Consequences of Extraction Failure |
| :--- | :--- | :--- | :--- |
| **`financial_line_item`** | Consolidated net income, total assets/liabilities, YoY revenue rows, operating margin percentages. | Financial Annual Reports, 10-K Filings | Hallucinated earnings numbers; flawed credit risk models. |
| **`compliance_mandate`** | Statutory compliance clauses, indemnification limits, penalty terms, audit requirements. | Legal Contracts, Security Policies | Breaches of regulatory compliance; unspotted liability caps. |
| **`primary_theorem`** | Main mathematical formulas, loss functions, optimization objectives, novel architectures. | Academic Papers, Whitepapers | Incorrect algorithm implementation; broken scientific derivations. |
| **`form_field_binding`** | Taxpayer identification (SSN/EIN), signature blocks, regulatory check boxes. | Tax Forms, Vendor Questionnaires | Rejected filings; unauthorized corporate commitments. |
| **`document_header`** | Formal filing titles, legal party designations, effective execution dates. | All Documents | Misattribution of entire filing to wrong legal entity. |

### 7.3 Critical-Scene Failure Rate (CSFR)

During evaluation, the oracle tracks the **Critical-Scene Failure Rate (CSFR)**:

$$\text{CSFR} = \frac{\text{Number of Failed Critical Elements}}{\text{Total Critical Elements Annotated}}$$

A critical element fails if:
- It is omitted or missed ($\text{IoU} < 0.50$ against ground truth).
- Its element classification is mispredicted (e.g. table classified as text).
- Its extracted text or formula similarity falls below $80\%$.
- For tables, its structural cell-adjacency F1 falls below $75\%$.

A system with high overall F1 but poor CSFR is **rejected for production**.

---

## 8. Annotation JSON Example

```json
{
  "page_id": "doc-001_p1",
  "document_id": "doc-001",
  "page_number": 1,
  "width": 800.0,
  "height": 1100.0,
  "elements": [
    {
      "id": "elem-101",
      "type": "heading",
      "bbox": { "x": 50.0, "y": 60.0, "width": 700.0, "height": 45.0 },
      "reading_order": 0,
      "text": "ANNUAL FINANCIAL REPORT & BALANCES",
      "is_critical": true,
      "critical_category": "document_header"
    },
    {
      "id": "elem-102",
      "type": "table",
      "bbox": { "x": 50.0, "y": 250.0, "width": 700.0, "height": 280.0 },
      "reading_order": 1,
      "text": "Table 1.1: Consolidated Revenue Breakdown ($ Millions)",
      "is_critical": true,
      "critical_category": "financial_line_item",
      "table": {
        "num_rows": 2,
        "num_cols": 2,
        "cells": [
          { "cell_id": "c-0-0", "row_index": 0, "col_index": 0, "row_span": 1, "col_span": 1, "content": "Segment", "is_header": true },
          { "cell_id": "c-0-1", "row_index": 0, "col_index": 1, "row_span": 1, "col_span": 1, "content": "2025 ($M)", "is_header": true },
          { "cell_id": "c-1-0", "row_index": 1, "col_index": 0, "row_span": 1, "col_span": 1, "content": "Cloud Solutions", "is_header": false },
          { "cell_id": "c-1-1", "row_index": 1, "col_index": 1, "row_span": 1, "col_span": 1, "content": "189.5", "is_header": false }
        ]
      }
    }
  ]
}
```

