## AI Test Case Generator

Python (FastAPI) + React app that takes a PRD and impacted screens/modules, generates platform-aware end-to-end test cases using AI (OpenAI, Anthropic, or Google), and lets you export them to `.xlsx` (for use with tools like TestPad).

### Backend (FastAPI)

- Location: `src/`
- Main app: `src/main.py` (FastAPI app object = `app`)
- Core pieces:
  - `ai_generator.py`: wraps AI APIs (OpenAI, Anthropic, Google) and generates structured test case JSON.
  - `data_loader.py`: loads platform config from `config/platform_workflow.yaml`.
  - `formatter.py`: converts test cases to an Excel file (saved or in-memory bytes).

#### Setup

```bash
cd TestCaseGenerator
python -m venv venv
venv\Scripts\activate  # Windows
pip install -r requirements.txt
```

Set your AI API key via the appropriate environment variable (OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY) based on your configured provider.

If you want a local config file, copy `config/llm_config.example.yaml` to `config/llm_config.yaml` and keep `api_key` blank (the file is git-ignored).

Alternatively, the UI includes an optional "AI API key" field; if provided, it is stored only in your browser and sent with generate requests.

Run the API:

```bash
uvicorn src.main:app --reload --port 8000
```

### Frontend (React + Vite)

- Location: `frontend/`
- Entry: `frontend/src/main.tsx`, `frontend/src/App.tsx`
- Proxy is configured so `/api/*` requests go to `http://localhost:8000`.

Install and run:

```bash
cd frontend
npm install
npm run dev
```

Open the printed `http://localhost:5173` URL in your browser.

### Typical Flow

1. Paste PRD text into the UI.
2. Enter impacted screens/modules (comma-separated).
3. Click **Generate test cases**.
4. Review the generated table.
5. Click **Export to Excel** to download `generated_test_cases.xlsx` and import into TestPad or other tools.

### Training the app with your PRDs (knowledge index)

You can "train" the app on your historical PRDs + test cases via a lightweight knowledge index. Conceptually this is RAG: the generator looks up similar past PRDs and example test cases and uses them as guidance when creating new ones.

#### 1. Prepare folders and drop your files

Create these folders (if they don't exist already):

```bash
mkdir -p data/prds
mkdir -p data/testcases
```

- Put all your **PRD PDFs** into `data/prds/`, for example:
  - `data/prds/prd_login_flow.pdf`
  - `data/prds/prd_checkout_flow.pdf`
- (Optional but recommended) Put matching **Excel test case files** into `data/testcases/` with the **same base name**:
  - `data/testcases/prd_login_flow.xlsx`
  - `data/testcases/prd_checkout_flow.xlsx`

The ingestion script will automatically attach up to a small number of example rows from each Excel file to the corresponding PRD.

#### 2. Build / refresh the knowledge index

From the project root:

```bash
.\venv\Scripts\python -m src.ingest_prds
```

This will:

- Read all PDFs in `data/prds/`.
- Optionally link `data/testcases/*.xlsx` rows if a matching filename exists.
- Write a lightweight index to `data/knowledge_index.json`.

You can re-run this command any time you add or update PRDs/test cases.

#### 3. How the index is used during generation

When you click **Generate test cases** in the app:

- The backend now calls `retrieve_similar_prds(...)` to find the most similar historical PRDs based on your current PRD text + impacted screens.
- It injects a compact summary of those PRDs and example test case titles into the LLM prompt.
- If AI quota is unavailable, the app falls back to deterministic mock test cases, but the retrieval setup is already in place for when you enable a real model again.

