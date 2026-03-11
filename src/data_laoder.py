import yaml
import fitz  # PyMuPDF
import json

def load_platform_data(config_path='config/platform_workflow.yaml'):
    with open(config_path, 'r') as f:
        return yaml.safe_load(f)

def load_prd(pdf_path):
    doc = fitz.open(pdf_path)
    text = ''.join(page.get_text() for page in doc)
    doc.close()
    return text

def load_api_design(json_path):
    with open(json_path, 'r') as f:
        return json.load(f)

# Example use: data = load_platform_data()