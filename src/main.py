from typing import Any, Dict, List, Optional

import io
import json
import shutil
from pathlib import Path

import fitz  # PyMuPDF
from docx import Document
from fastapi import FastAPI, File, Header, HTTPException, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from src.ai_generator import generate_test_cases
from src.data_loader import load_platform_data, load_prd
from src.formatter import build_excel_bytes
from src.knowledge_store import INDEX_PATH, PRDDocument, _load_index
from src.ingest_prds import build_index, _load_example_testcases


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


# Knowledge Management Endpoints

@app.get("/api/knowledge/documents")
def list_knowledge_documents() -> Dict[str, Any]:
    """
    List all documents in the knowledge base.
    """
    try:
        print(f"Loading knowledge documents from: {INDEX_PATH}")  # Debug logging
        docs = _load_index()
        print(f"Successfully loaded {len(docs)} documents")  # Debug logging
        return {
            "documents": [
                {
                    "id": doc.id,
                    "filename": doc.filename,
                    "screens": doc.screens,
                    "text_length": len(doc.text),
                    "example_testcases_count": len(doc.example_testcases)
                }
                for doc in docs
            ]
        }
    except Exception as exc:
        print(f"Error loading knowledge documents: {exc}")  # Debug logging
        import traceback
        traceback.print_exc()  # Debug logging
        raise HTTPException(status_code=500, detail=f"Failed to load knowledge documents: {exc}")


@app.post("/api/knowledge/upload")
async def upload_knowledge_file(
    file: UploadFile = File(...),
    file_type: str = Form(...),  # "pdf" or "excel"
    screens: str = Form("")  # comma-separated screen names
) -> Dict[str, Any]:
    """
    Upload a PDF or Excel file to the knowledge base.
    """
    if file_type not in ["pdf", "excel"]:
        raise HTTPException(status_code=400, detail="file_type must be 'pdf' or 'excel'")

    # Validate file extension
    if file_type == "pdf" and not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="PDF files must have .pdf extension")
    elif file_type == "excel" and not file.filename.lower().endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Excel files must have .xlsx or .xls extension")

    try:
        # Create directories if they don't exist
        prd_dir = Path(__file__).parent.parent / "data" / "prds"
        testcase_dir = Path(__file__).parent.parent / "data" / "testcases"
        prd_dir.mkdir(parents=True, exist_ok=True)
        testcase_dir.mkdir(parents=True, exist_ok=True)

        # Read file content
        content = await file.read()

        if file_type == "pdf":
            # Save PDF to prds directory
            file_path = prd_dir / file.filename
            with open(file_path, "wb") as f:
                f.write(content)

            # Extract text to verify it's readable
            try:
                text = load_prd(str(file_path))
                if not text.strip():
                    file_path.unlink()  # Remove the file if no text
                    raise HTTPException(status_code=400, detail="PDF contains no extractable text")
            except Exception:
                if file_path.exists():
                    file_path.unlink()
                raise HTTPException(status_code=400, detail="Failed to extract text from PDF")

        else:  # excel
            # Save Excel to testcases directory
            file_path = testcase_dir / file.filename
            with open(file_path, "wb") as f:
                f.write(content)

            # Verify it's readable
            try:
                _load_example_testcases(file_path, max_rows=1)
            except Exception:
                if file_path.exists():
                    file_path.unlink()
                raise HTTPException(status_code=400, detail="Failed to read Excel file")

        # Parse screens
        screen_list = [s.strip() for s in screens.split(",") if s.strip()]

        return {
            "message": f"Successfully uploaded {file.filename}",
            "file_type": file_type,
            "screens": screen_list,
            "note": "Run 'Rebuild Knowledge Index' to incorporate this file into the AI's knowledge base"
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}")


@app.delete("/api/knowledge/documents/{document_id}")
def delete_knowledge_document(document_id: str) -> Dict[str, Any]:
    """
    Delete a document from the knowledge base.
    """
    try:
        docs = _load_index()
        doc_to_delete = None
        for doc in docs:
            if doc.id == document_id:
                doc_to_delete = doc
                break

        if not doc_to_delete:
            raise HTTPException(status_code=404, detail="Document not found")

        # Remove the document from the index
        docs.remove(doc_to_delete)

        # Try to delete the actual files
        prd_dir = Path(__file__).parent.parent / "data" / "prds"
        testcase_dir = Path(__file__).parent.parent / "data" / "testcases"

        prd_file = prd_dir / doc_to_delete.filename
        if prd_file.exists():
            prd_file.unlink()

        # Also try to delete any associated Excel file (same stem name)
        stem = Path(doc_to_delete.filename).stem.lower()
        for excel_file in testcase_dir.glob("*.xlsx"):
            if excel_file.stem.lower() == stem:
                excel_file.unlink()
                break

        # Save updated index
        INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
        INDEX_PATH.write_text(json.dumps({"documents": [
            {
                "id": doc.id,
                "filename": doc.filename,
                "text": doc.text,
                "screens": doc.screens,
                "example_testcases": doc.example_testcases
            }
            for doc in docs
        ]}, ensure_ascii=False, indent=2), encoding="utf-8")

        return {"message": f"Successfully deleted document {document_id}"}

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Delete failed: {exc}")


@app.post("/api/knowledge/rebuild-index")
def rebuild_knowledge_index() -> Dict[str, Any]:
    """
    Rebuild the knowledge index from all uploaded files.
    """
    try:
        build_index()
        docs = _load_index()
        return {
            "message": "Knowledge index rebuilt successfully",
            "documents_count": len(docs)
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Rebuild failed: {exc}")


# Serve the built React frontend (after `npm run build`) from `/`
app.mount(
    "/",
    StaticFiles(directory="frontend/dist", html=True),
    name="frontend",
)
