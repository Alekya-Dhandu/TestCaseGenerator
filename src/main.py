from typing import Any, Dict, List, Optional

import io

import fitz  # PyMuPDF
from docx import Document
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from src.ai_generator import generate_test_cases
from src.data_loader import load_platform_data
from src.formatter import build_excel_bytes


app = FastAPI(title="AI Test Case Generator", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class GenerateRequest(BaseModel):
    prd_text: str
    impacted_screens: List[str] = []
    api_design: Optional[Dict[str, Any]] = None
    provider: Optional[str] = None


class ExportRequest(BaseModel):
    test_cases: List[Dict[str, Any]]


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/api/generate")
def generate(
    req: GenerateRequest, x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")
) -> Dict[str, Any]:
    """
    Generate test cases from PRD + impacted screens using platform config.
    """
    platform_data = load_platform_data()
    result = generate_test_cases(
        prd_text=req.prd_text,
        api_design=req.api_design,
        platform_data=platform_data,
        impacted_screens=req.impacted_screens,
        api_key_override=x_api_key,
        provider_override=req.provider,
    )
    # result already has shape: {"test_cases": [...], "used_mock": bool, "error": str|None}
    return result


def _extract_text_from_pdf_bytes(data: bytes) -> str:
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        parts: List[str] = []
        for page in doc:
            txt = page.get_text("text")
            if txt:
                parts.append(txt)
        return "\n".join(parts).strip()
    finally:
        doc.close()


def _extract_text_from_docx_bytes(data: bytes) -> str:
    doc = Document(io.BytesIO(data))
    parts = [p.text for p in doc.paragraphs if p.text and p.text.strip()]
    return "\n".join(parts).strip()


@app.post("/api/extract-prd")
async def extract_prd(file: UploadFile = File(...)) -> Dict[str, str]:
    """
    Extract PRD text from an uploaded PDF or DOCX file.
    """
    filename = (file.filename or "").lower()
    data = await file.read()

    if not data:
        raise HTTPException(status_code=400, detail="Empty file.")

    # Basic size guard (15 MB)
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 15MB).")

    try:
        if filename.endswith(".pdf") or file.content_type == "application/pdf":
            text = _extract_text_from_pdf_bytes(data)
        elif filename.endswith(".docx") or file.content_type in (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/octet-stream",
        ):
            text = _extract_text_from_docx_bytes(data)
        else:
            raise HTTPException(
                status_code=400,
                detail="Unsupported file type. Please upload a PDF or DOCX.",
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to extract text from file: {type(exc).__name__}",
        )

    if not text:
        raise HTTPException(
            status_code=400, detail="No extractable text found in the document."
        )

    return {"prd_text": text}


@app.post("/api/export-xlsx")
def export_xlsx(req: ExportRequest) -> StreamingResponse:
    """
    Build an in-memory XLSX file for download.
    """
    excel_bytes = build_excel_bytes(req.test_cases)
    return StreamingResponse(
        excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="generated_test_cases.xlsx"'
        },
    )


# Serve the built React frontend (after `npm run build`) from `/`
app.mount(
    "/",
    StaticFiles(directory="frontend/dist", html=True),
    name="frontend",
)
