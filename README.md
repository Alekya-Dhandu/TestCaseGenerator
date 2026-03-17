## AI Test Case Generator

Python (FastAPI) + React app that takes a PRD and impacted screens/modules, generates platform-aware end-to-end test cases using AI (OpenAI, Anthropic, or Google), and lets you export them to `.xlsx` (for use with tools like TestPad).

### Features

- **AI-Powered Test Case Generation**: Generate comprehensive test cases from PRD documents using multiple AI providers (OpenAI, Anthropic, Google)
- **Knowledge Management**: Upload and manage training documents (PDFs and Excel files) to improve AI accuracy
- **Platform-Aware**: Considers device types, workflows, and existing automation coverage
- **Export to Excel**: Export generated test cases to Excel format compatible with TestPad and other test management tools
- **Fallback Support**: Gracefully falls back to mock test cases when AI services are unavailable

### Backend (FastAPI)

- Location: `src/`
- Main app: `src/main.py` (FastAPI app object = `app`)
- Core pieces:
  - `ai_generator.py`: wraps AI APIs (OpenAI, Anthropic, Google) and generates structured test case JSON.
  - `data_loader.py`: loads platform config from `config/platform_workflow.yaml`.
  - `formatter.py`: converts test cases to an Excel file (saved or in-memory bytes).
  - `knowledge_store.py`: manages the knowledge base of training documents and example test cases.
  - `ingest_prds.py`: processes uploaded PDF and Excel files for training.

#### Knowledge Management

The system supports uploading training documents to improve test case generation accuracy:

- **PDF Documents**: Upload PRD documents, requirements specifications, or any documentation
- **Excel Files**: Upload spreadsheets containing example test cases for the AI to learn from
- **Automatic Processing**: Documents are processed and added to a searchable knowledge base
- **Screen Association**: Associate uploaded documents with specific screens/modules for better context

### Setup

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
- Features two main tabs:
  - **Generate Test Cases**: Main interface for creating test cases from PRDs
  - **Manage Knowledge**: Upload and manage training documents (PDFs and Excel files)
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

#### Option 1: UI-Based Upload (Recommended)

1. Open the app and click the **"Manage Knowledge"** tab
2. Upload PDF documents containing PRDs, requirements, or documentation
3. Upload Excel files with example test cases
4. Specify related screens/modules for better context (optional)
5. Click **"Rebuild Knowledge Index"** to incorporate the uploaded files

#### Option 2: Manual File Placement

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

