from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Header
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


class ExportRequest(BaseModel):
    test_cases: List[Dict[str, Any]]


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/api/generate")
def generate(
    req: GenerateRequest, x_openai_api_key: Optional[str] = Header(default=None)
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
        api_key_override=x_openai_api_key,
    )
    # result already has shape: {"test_cases": [...], "used_mock": bool, "error": str|None}
    return result


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
