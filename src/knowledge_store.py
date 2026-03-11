from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple


INDEX_PATH = Path("data/knowledge_index.json")


@dataclass
class PRDDocument:
    id: str
    filename: str
    text: str
    screens: List[str]
    example_testcases: List[Dict[str, Any]]


def _tokenize(text: str) -> List[str]:
    return [t for t in re.findall(r"[a-zA-Z0-9]+", text.lower()) if len(t) > 2]


def _load_index() -> List[PRDDocument]:
    if not INDEX_PATH.exists():
        return []
    data = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    docs: List[PRDDocument] = []
    for raw in data.get("documents", []):
        docs.append(
            PRDDocument(
                id=raw.get("id", ""),
                filename=raw.get("filename", ""),
                text=raw.get("text", ""),
                screens=raw.get("screens", []),
                example_testcases=raw.get("example_testcases", []),
            )
        )
    return docs


def _similarity_score(query_tokens: Sequence[str], doc: PRDDocument) -> float:
    if not query_tokens:
        return 0.0
    doc_tokens = _tokenize(doc.text) + [s.lower() for s in doc.screens]
    doc_set = set(doc_tokens)
    q_set = set(query_tokens)
    inter = len(doc_set & q_set)
    if inter == 0:
        return 0.0
    return inter / float(len(q_set) + 1e-6)


def retrieve_similar_prds(
    prd_text: str,
    impacted_screens: Optional[Sequence[str]] = None,
    top_k: int = 3,
) -> List[PRDDocument]:
    """
    Lightweight lexical retrieval over previously ingested PRDs.
    No external services or heavy ML deps required.
    """
    docs = _load_index()
    if not docs:
        return []

    screens_text = " ".join(impacted_screens or [])
    query = (prd_text or "")[:4000] + " " + screens_text
    query_tokens = _tokenize(query)

    scored: List[Tuple[float, PRDDocument]] = []
    for d in docs:
        score = _similarity_score(query_tokens, d)
        if score > 0:
            scored.append((score, d))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [d for _, d in scored[:top_k]]


def format_prd_context_for_prompt(prds: Sequence[PRDDocument]) -> str:
    """
    Build a compact, prompt-friendly summary of similar PRDs and their example test cases.
    """
    if not prds:
        return "No past PRDs were found in the knowledge index."

    lines: List[str] = []
    for idx, d in enumerate(prds, start=1):
        lines.append(f"PRD {idx}: {d.filename} (id={d.id})")
        if d.screens:
            lines.append(f"  Screens: {', '.join(d.screens)}")
        snippet = d.text[:600].replace("\n", " ")
        lines.append(f"  Summary snippet: {snippet}...")
        if d.example_testcases:
            example = d.example_testcases[0]
            title = example.get("Title") or example.get("name") or ""
            lines.append(f"  Example test case title: {title}")
        lines.append("")  # blank line between docs

    return "\n".join(lines)

