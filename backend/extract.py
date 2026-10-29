"""Command Line Interface (CLI) for Document Extraction in Retrieva AI.

Usage:
    python -m backend.extract --extractor A data/sample_documents/doc-001.pdf
    python -m backend.extract --extractor B data/sample_documents/doc-001.pdf --output result.json
"""

import argparse
import json
import sys
from pathlib import Path

from backend.extractors import get_extractor


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract structured elements (tables, formulas, text) from a PDF document.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "file",
        type=str,
        help="Path to the PDF document to extract",
    )
    parser.add_argument(
        "--extractor",
        "-e",
        type=str,
        default="A",
        choices=["A", "B", "docling", "pdfplumber"],
        help="Extractor pipeline to use: 'A' (Docling) or 'B' (PyMuPDF + pdfplumber)",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default=None,
        help="Optional path to write the extracted JSON output. If omitted, prints to stdout.",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        default=True,
        help="Format JSON with indentation",
    )

    args = parser.parse_args()

    pdf_path = Path(args.file)
    if not pdf_path.exists():
        sys.stderr.write(f"Error: PDF file does not exist: {pdf_path}\n")
        return 1

    try:
        extractor = get_extractor(args.extractor)
        elements = extractor.extract(pdf_path)

        serialized_elements = [el.model_dump(by_alias=True, mode="json") for el in elements]

        output_data = {
            "extractor": extractor.name,
            "version": extractor.version,
            "file": str(pdf_path.name),
            "element_count": len(elements),
            "elements": serialized_elements,
        }

        indent = 2 if args.pretty else None
        json_str = json.dumps(output_data, indent=indent, default=str)

        if args.output:
            out_path = Path(args.output)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(json_str, encoding="utf-8")
            print(f"Successfully extracted {len(elements)} elements to {out_path}")
        else:
            print(json_str)

        return 0
    except Exception as exc:
        sys.stderr.write(f"Extraction failed: {exc}\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())

