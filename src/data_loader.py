import json
from typing import Any, Dict

import fitz  # PyMuPDF
import yaml


def load_platform_data(config_path: str = "config/platform_workflow.yaml") -> Dict[str, Any]:
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def load_prd(pdf_path: str) -> str:
    """
    Load a PRD PDF file and return its text content.
    """
    doc = fitz.open(pdf_path)
    try:
        text = "".join(page.get_text() for page in doc)
    finally:
        doc.close()
    return text


def load_api_design(json_path: str) -> Dict[str, Any]:
    with open(json_path, "r") as f:
        return json.load(f)

