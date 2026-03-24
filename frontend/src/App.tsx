import React, { useState } from "react";

type TestCase = {
  ID: string;
  Title: string;
  Type: string;
  Priority: string;
  Preconditions: string;
  Steps: string | string[];
  ExpectedResult: string;
  Screen: string;
  Tags: string | string[];
  [key: string]: unknown;
};

type KnowledgeDocument = {
  id: string;
  filename: string;
  screens: string[];
  text_length: number;
  example_testcases_count: number;
};

type TabType = "generate" | "knowledge";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>("generate");
  const [prdInputType, setPrdInputType] = useState<"text" | "pdf" | "docx">("text");
  const [prdText, setPrdText] = useState("");
  const [prdFile, setPrdFile] = useState<File | null>(null);
  const [impactedScreens, setImpactedScreens] = useState("");
  const [provider, setProvider] = useState(() => localStorage.getItem("ai_provider") || "openai");
  const [model, setModel] = useState(() => localStorage.getItem("ai_model") || "");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("api_key") || "");
  const [isGenerating, setIsGenerating] = useState(false);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [usedMock, setUsedMock] = useState(false);
  const [mockInfo, setMockInfo] = useState<string | null>(null);

  // Knowledge management state
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isRebuildingIndex, setIsRebuildingIndex] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");

  // Configuration state
  const [config, setConfig] = useState<any>(null);

  const loadConfig = async () => {
    try {
      const response = await fetch(`/api/config?provider=${provider}`);
      if (response.ok) {
        const data = await response.json();
        setConfig(data);
        // Set model to the provider's default if not already set
        if (!model) {
          setModel(data.current_model);
        }
      }
    } catch (e) {
      console.error("Failed to load config:", e);
    }
  };

  // Load config when provider changes
  React.useEffect(() => {
    loadConfig();
  }, [provider]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    setUsedMock(false);
    setMockInfo(null);
    try {
      const screens = impactedScreens
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      let prdTextToUse = prdText;
      if (prdInputType !== "text") {
        if (!prdFile) {
          throw new Error("Please upload a PRD file first.");
        }
        const form = new FormData();
        form.append("file", prdFile);
        const extractRes = await fetch("/api/extract-prd", {
          method: "POST",
          body: form
        });
        if (!extractRes.ok) {
          const msg = await extractRes.text();
          throw new Error(`PRD extract failed (${extractRes.status}): ${msg}`);
        }
        const extracted = (await extractRes.json()) as { prd_text: string };
        prdTextToUse = extracted.prd_text || "";
        if (!prdTextToUse.trim()) {
          throw new Error("Extracted PRD text is empty.");
        }
      }

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey.trim() ? { "X-API-Key": apiKey.trim() } : {})
        },
        body: JSON.stringify({
          prd_text: prdTextToUse,
          impacted_screens: screens,
          provider: provider
        })
      });

      if (!res.ok) {
        throw new Error(`Generate failed with status ${res.status}`);
      }

      const data = (await res.json()) as {
        test_cases: TestCase[];
        used_mock?: boolean;
        error?: string | null;
      };
      setTestCases(data.test_cases || []);
      const mock = !!data.used_mock;
      setUsedMock(mock);
      setMockInfo(
        mock
          ? data.error ||
              "AI generation failed; showing mock test cases instead."
          : null
      );
    } catch (e: any) {
      setError(e.message ?? "Unknown error while generating");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExport = async () => {
    try {
      const res = await fetch("/api/export-xlsx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test_cases: testCases })
      });
      if (!res.ok) {
        throw new Error(`Export failed with status ${res.status}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "generated_test_cases.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message ?? "Unknown error while exporting");
    }
  };

  // Knowledge management functions
  const loadKnowledgeDocuments = async () => {
    try {
      const res = await fetch("/api/knowledge/documents");
      if (!res.ok) throw new Error(`Failed to load documents: ${res.status}`);
      const data = await res.json();
      setKnowledgeDocuments(data.documents || []);
    } catch (e: any) {
      setError(e.message ?? "Failed to load knowledge documents");
    }
  };

  const handleFileUpload = async (file: File, fileType: "pdf" | "excel", screens: string) => {
    setIsUploading(true);
    setUploadProgress(`Uploading ${file.name}...`);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("file_type", fileType);
      formData.append("screens", screens);

      const res = await fetch("/api/knowledge/upload", {
        method: "POST",
        body: formData
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || `Upload failed: ${res.status}`);
      }

      const data = await res.json();
      setUploadProgress(data.message);
      await loadKnowledgeDocuments(); // Refresh the list
    } catch (e: any) {
      setError(e.message ?? "Upload failed");
    } finally {
      setIsUploading(false);
      setTimeout(() => setUploadProgress(""), 3000);
    }
  };

  const handleDeleteDocument = async (documentId: string) => {
    if (!confirm("Are you sure you want to delete this document?")) return;

    try {
      const res = await fetch(`/api/knowledge/documents/${documentId}`, {
        method: "DELETE"
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || `Delete failed: ${res.status}`);
      }

      await loadKnowledgeDocuments(); // Refresh the list
    } catch (e: any) {
      setError(e.message ?? "Delete failed");
    }
  };

  const handleRebuildIndex = async () => {
    setIsRebuildingIndex(true);
    try {
      const res = await fetch("/api/knowledge/rebuild-index", {
        method: "POST"
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || `Rebuild failed: ${res.status}`);
      }

      const data = await res.json();
      setUploadProgress(`Index rebuilt with ${data.documents_count} documents`);
      setTimeout(() => setUploadProgress(""), 3000);
    } catch (e: any) {
      setError(e.message ?? "Rebuild failed");
    } finally {
      setIsRebuildingIndex(false);
    }
  };

  // Load knowledge documents when switching to knowledge tab
  React.useEffect(() => {
    if (activeTab === "knowledge") {
      loadKnowledgeDocuments();
    }
  }, [activeTab]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        background: "linear-gradient(90deg, #102845 0%, #286389 100%)",
        color: "white",
        padding: "24px"
      }}
    >
      <header style={{ marginBottom: "24px" }}>
        <h2 style={{ margin: 0, fontSize: "1.75rem", fontWeight: 600 }}>
          AI Test Case Generator
        </h2>
        <div style={{ marginTop: "16px", display: "flex", gap: "8px" }}>
          <button
            onClick={() => setActiveTab("generate")}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              background: activeTab === "generate" ? "#22c55e" : "rgba(255, 255, 255, 0.1)",
              color: "white",
              fontSize: "0.9rem",
              fontWeight: 500,
              cursor: "pointer"
            }}
          >
            Generate Test Cases
          </button>
          <button
            onClick={() => setActiveTab("knowledge")}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              background: activeTab === "knowledge" ? "#22c55e" : "rgba(255, 255, 255, 0.1)",
              color: "white",
              fontSize: "0.9rem",
              fontWeight: 500,
              cursor: "pointer"
            }}
          >
            Manage Knowledge
          </button>
        </div>
        <p style={{ marginTop: "8px", color: "rgba(255, 255, 255, 0.8)" }}>
          {activeTab === "generate"
            ? "Paste a PRD and list impacted screens to auto-generate end-to-end test cases, then export them to Excel for TestPad."
            : "Upload PDF documents and Excel files with example test cases to train the AI for better test case generation."
          }
        </p>
      </header>

      {activeTab === "generate" ? (
        <main style={{ display: "grid", gridTemplateColumns: "1.2fr 1.8fr", gap: "24px", flex: 1 }}>
        <section
          style={{
            background: "rgba(255, 255, 255, 0.1)",
            borderRadius: "16px",
            padding: "20px",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            display: "flex",
            flexDirection: "column",
            gap: "12px"
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>PRD input type</span>
            <select
              value={prdInputType}
              onChange={(e) => {
                const v = e.target.value as "text" | "pdf" | "docx";
                setPrdInputType(v);
                setError(null);
                setTestCases([]);
                if (v === "text") {
                  setPrdFile(null);
                } else {
                  setPrdText("");
                }
              }}
              style={{
                borderRadius: "999px",
                padding: "8px 14px",
                border: "1px solid rgba(255, 255, 255, 0.3)",
                background: "rgba(0, 0, 0, 0.3)",
                color: "white",
                fontSize: "0.9rem"
              }}
            >
              <option value="text">Paste text</option>
              <option value="pdf">Upload PDF</option>
              <option value="docx">Upload Word (.docx)</option>
            </select>
          </label>

          {prdInputType === "text" ? (
            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>PRD</span>
              <textarea
                value={prdText}
                onChange={(e) => setPrdText(e.target.value)}
                placeholder="Paste product requirements here..."
                style={{
                  minHeight: "200px",
                  resize: "vertical",
                  borderRadius: "12px",
                  padding: "10px 12px",
                  border: "1px solid rgba(255, 255, 255, 0.3)",
                  background: "rgba(0, 0, 0, 0.3)",
                  color: "white",
                  fontFamily: "inherit",
                  fontSize: "0.9rem"
                }}
              />
            </label>
          ) : (
            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>
                Upload PRD {prdInputType === "pdf" ? "(PDF)" : "(DOCX)"}
              </span>
              <input
                type="file"
                accept={prdInputType === "pdf" ? ".pdf,application/pdf" : ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setPrdFile(f);
                }}
                style={{
                  borderRadius: "12px",
                  padding: "10px 12px",
                  border: "1px solid rgba(255, 255, 255, 0.3)",
                  background: "rgba(0, 0, 0, 0.3)",
                  color: "white",
                  fontSize: "0.9rem"
                }}
              />
            <span style={{ fontSize: "0.75rem", color: "rgba(255, 255, 255, 0.7)" }}>
                The file is uploaded to the backend only for text extraction.
              </span>
            </label>
          )}

          <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>
              Impacted screens / modules
            </span>
            <input
              type="text"
              value={impactedScreens}
              onChange={(e) => setImpactedScreens(e.target.value)}
              placeholder="e.g. Login, Checkout, Order Summary"
              style={{
                borderRadius: "999px",
                padding: "8px 14px",
                border: "1px solid rgba(255, 255, 255, 0.3)",
                background: "rgba(0, 0, 0, 0.3)",
                color: "white",
                fontSize: "0.9rem"
              }}
            />
            <span style={{ fontSize: "0.75rem", color: "rgba(255, 255, 255, 0.7)" }}>
              Comma-separated list. The generator will bias test cases towards
              these areas.
            </span>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>
              AI Provider
            </span>
            <select
              value={provider}
              onChange={(e) => {
                const v = e.target.value;
                setProvider(v);
                localStorage.setItem("ai_provider", v);
              }}
              style={{
                borderRadius: "999px",
                padding: "8px 14px",
                border: "1px solid rgba(255, 255, 255, 0.3)",
                background: "rgba(0, 0, 0, 0.3)",
                color: "white",
                fontSize: "0.9rem"
              }}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="google">Google</option>
            </select>
            <span style={{ fontSize: "0.75rem", color: "rgba(255, 255, 255, 0.7)" }}>
              Choose which AI provider to use for generating test cases.
            </span>
            {config && (
              <div style={{ fontSize: "0.75rem", color: "rgba(255, 255, 255, 0.6)", marginTop: "4px" }}>
                Current: {config.current_provider} ({config.current_model}) • 
                API Keys: {Object.entries(config.api_keys_configured).map(([k, v]) => `${k}: ${v ? '✓' : '✗'}`).join(', ')}
              </div>
            )}
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>
              AI API key (optional)
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                const v = e.target.value;
                setApiKey(v);
                localStorage.setItem("api_key", v);
              }}
              placeholder="sk-..."
              style={{
                borderRadius: "999px",
                padding: "8px 14px",
                border: "1px solid rgba(255, 255, 255, 0.3)",
                background: "rgba(0, 0, 0, 0.3)",
                color: "white",
                fontSize: "0.9rem"
              }}
            />
            <span style={{ fontSize: "0.75rem", color: "rgba(255, 255, 255, 0.7)" }}>
              Stored only in this browser (localStorage) and sent with generate requests.
              Leave blank to use the server's configured API key.
            </span>
          </label>

          <button
            onClick={handleGenerate}
            disabled={
              isGenerating ||
              (prdInputType === "text" ? !prdText.trim() : !prdFile)
            }
            style={{
              marginTop: "8px",
              alignSelf: "flex-start",
              borderRadius: "999px",
              padding: "8px 18px",
              border: "none",
              cursor: isGenerating || !prdText.trim() ? "not-allowed" : "pointer",
              background: isGenerating || !prdText.trim() ? "#4b5563" : "#22c55e",
              color: "#020617",
              fontWeight: 600,
              fontSize: "0.9rem",
              display: "flex",
              alignItems: "center",
              gap: "8px"
            }}
          >
            {isGenerating ? "Generating..." : "Generate test cases"}
          </button>

          {error && (
            <div
              style={{
                marginTop: "8px",
                padding: "8px 12px",
                borderRadius: "10px",
                background: "#7f1d1d",
                color: "#fee2e2",
                fontSize: "0.8rem"
              }}
            >
              {error}
            </div>
          )}
        </section>

        <section
          style={{
            background: "rgba(255, 255, 255, 0.1)",
            borderRadius: "16px",
            padding: "16px",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0
          }}
        >
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "8px"
            }}
          >
            <div>
              <h3
                style={{
                  margin: 0,
                  fontSize: "1rem",
                  fontWeight: 600
                }}
              >
                Generated test cases
              </h3>
              <p style={{ margin: 0, fontSize: "0.8rem", color: "rgba(255, 255, 255, 0.7)" }}>
                {testCases.length
                  ? `${testCases.length} test cases ready to review or export.`
                  : "Run a generation to see suggested cases."}
              </p>
              {usedMock && (
                <div
                  style={{
                    marginTop: "6px",
                    padding: "6px 10px",
                    borderRadius: "999px",
                    background: "#78350f",
                    color: "#fef3c7",
                    fontSize: "0.75rem",
                    maxWidth: "480px"
                  }}
                >
                  <strong>Note:</strong> An error occurred while calling the AI
                  model, so these are <strong>mock test cases</strong>.{" "}
                  {mockInfo}
                </div>
              )}
            </div>

            <button
              onClick={handleExport}
              disabled={!testCases.length}
              style={{
                borderRadius: "999px",
                padding: "6px 14px",
                border: "1px solid #22c55e",
                background: testCases.length ? "#022c22" : "#111827",
                color: testCases.length ? "#bbf7d0" : "#4b5563",
                cursor: testCases.length ? "pointer" : "not-allowed",
                fontSize: "0.8rem",
                fontWeight: 500
              }}
            >
              Export to Excel
            </button>
          </header>

          <div
            style={{
              flex: 1,
              overflow: "auto",
              borderRadius: "12px",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              background: "rgba(255, 255, 255, 0.05)"
            }}
          >
            {testCases.length === 0 ? (
              <div
                style={{
                  padding: "24px",
                  textAlign: "center",
                  fontSize: "0.85rem",
                  color: "rgba(255, 255, 255, 0.6)"
                }}
              >
                Generated test cases will appear here in a compact table view.
              </div>
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.8rem"
                }}
              >
                <thead style={{ background: "rgba(255, 255, 255, 0.1)" }}>
                  <tr>
                    {["ID", "Title", "Type", "Priority", "Screen"].map((col) => (
                      <th
                        key={col}
                        style={{
                          textAlign: "left",
                          padding: "8px 10px",
                          borderBottom: "1px solid rgba(255, 255, 255, 0.2)",
                          position: "sticky",
                          top: 0,
                          background: "rgba(255, 255, 255, 0.1)",
                          zIndex: 1
                        }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {testCases.map((tc, idx) => (
                    <tr
                      key={tc.ID || idx}
                      style={{
                        borderBottom: "1px solid rgba(255, 255, 255, 0.1)"
                      }}
                    >
                      <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                        {tc.ID || `TC-${idx + 1}`}
                      </td>
                      <td style={{ padding: "6px 10px" }}>{tc.Title}</td>
                      <td style={{ padding: "6px 10px" }}>{tc.Type}</td>
                      <td style={{ padding: "6px 10px" }}>{tc.Priority}</td>
                      <td style={{ padding: "6px 10px" }}>{tc.Screen}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
      ) : (
        <main style={{ display: "flex", flexDirection: "column", gap: "24px", flex: 1 }}>
          {/* Upload Section */}
          <section
            style={{
              background: "rgba(255, 255, 255, 0.1)",
              borderRadius: "16px",
              padding: "20px",
              border: "1px solid rgba(255, 255, 255, 0.2)"
            }}
          >
            <h3 style={{ margin: "0 0 16px 0", fontSize: "1.25rem", fontWeight: 600 }}>
              Upload Training Documents
            </h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              {/* PDF Upload */}
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <h4 style={{ margin: 0, fontSize: "1rem", fontWeight: 500 }}>PDF Documents</h4>
                <p style={{ margin: 0, fontSize: "0.8rem", color: "rgba(255, 255, 255, 0.7)" }}>
                  Upload PRD documents, requirements specs, or any documentation to train the AI.
                </p>
                <FileUploadArea
                  accept=".pdf"
                  fileType="pdf"
                  onUpload={handleFileUpload}
                  disabled={isUploading}
                />
              </div>

              {/* Excel Upload */}
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <h4 style={{ margin: 0, fontSize: "1rem", fontWeight: 500 }}>Excel Test Cases</h4>
                <p style={{ margin: 0, fontSize: "0.8rem", color: "rgba(255, 255, 255, 0.7)" }}>
                  Upload spreadsheets with example test cases for the AI to learn from.
                </p>
                <FileUploadArea
                  accept=".xlsx,.xls"
                  fileType="excel"
                  onUpload={handleFileUpload}
                  disabled={isUploading}
                />
              </div>
            </div>

            {uploadProgress && (
              <div
                style={{
                  marginTop: "16px",
                  padding: "12px",
                  borderRadius: "8px",
                  background: "rgba(34, 197, 94, 0.1)",
                  border: "1px solid rgba(34, 197, 94, 0.3)",
                  color: "#22c55e"
                }}
              >
                {uploadProgress}
              </div>
            )}

            <div style={{ marginTop: "20px", display: "flex", gap: "12px" }}>
              <button
                onClick={handleRebuildIndex}
                disabled={isRebuildingIndex}
                style={{
                  padding: "10px 20px",
                  borderRadius: "8px",
                  border: "none",
                  background: isRebuildingIndex ? "#4b5563" : "#22c55e",
                  color: "white",
                  fontWeight: 600,
                  cursor: isRebuildingIndex ? "not-allowed" : "pointer"
                }}
              >
                {isRebuildingIndex ? "Rebuilding..." : "Rebuild Knowledge Index"}
              </button>
              <span style={{ fontSize: "0.8rem", color: "rgba(255, 255, 255, 0.7)", alignSelf: "center" }}>
                Run this after uploading files to incorporate them into the AI's knowledge base
              </span>
            </div>
          </section>

          {/* Documents List Section */}
          <section
            style={{
              background: "rgba(255, 255, 255, 0.1)",
              borderRadius: "16px",
              padding: "20px",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              flex: 1
            }}
          >
            <h3 style={{ margin: "0 0 16px 0", fontSize: "1.25rem", fontWeight: 600 }}>
              Knowledge Documents ({knowledgeDocuments.length})
            </h3>

            {knowledgeDocuments.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px",
                  color: "rgba(255, 255, 255, 0.6)"
                }}
              >
                <p>No documents uploaded yet.</p>
                <p style={{ fontSize: "0.9rem" }}>Upload PDF and Excel files above to train the AI.</p>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "0.9rem"
                  }}
                >
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.2)" }}>
                      <th style={{ padding: "12px", textAlign: "left" }}>Filename</th>
                      <th style={{ padding: "12px", textAlign: "left" }}>Screens</th>
                      <th style={{ padding: "12px", textAlign: "center" }}>Text Length</th>
                      <th style={{ padding: "12px", textAlign: "center" }}>Test Cases</th>
                      <th style={{ padding: "12px", textAlign: "center" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {knowledgeDocuments.map((doc) => (
                      <tr key={doc.id} style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.1)" }}>
                        <td style={{ padding: "12px" }}>{doc.filename}</td>
                        <td style={{ padding: "12px" }}>
                          {doc.screens.length > 0 ? doc.screens.join(", ") : "Not specified"}
                        </td>
                        <td style={{ padding: "12px", textAlign: "center" }}>{doc.text_length.toLocaleString()}</td>
                        <td style={{ padding: "12px", textAlign: "center" }}>{doc.example_testcases_count}</td>
                        <td style={{ padding: "12px", textAlign: "center" }}>
                          <button
                            onClick={() => handleDeleteDocument(doc.id)}
                            style={{
                              padding: "4px 8px",
                              borderRadius: "4px",
                              border: "none",
                              background: "#dc2626",
                              color: "white",
                              fontSize: "0.8rem",
                              cursor: "pointer"
                            }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </main>
      )}

      {error && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            padding: "16px",
            borderRadius: "8px",
            background: "#dc2626",
            color: "white",
            maxWidth: "400px",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)"
          }}
        >
          {error}
          <button
            onClick={() => setError(null)}
            style={{
              marginLeft: "12px",
              padding: "4px 8px",
              borderRadius: "4px",
              border: "none",
              background: "rgba(255, 255, 255, 0.2)",
              color: "white",
              cursor: "pointer"
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};

// File Upload Component
const FileUploadArea: React.FC<{
  accept: string;
  fileType: "pdf" | "excel";
  onUpload: (file: File, fileType: "pdf" | "excel", screens: string) => void;
  disabled: boolean;
}> = ({ accept, fileType, onUpload, disabled }) => {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [screens, setScreens] = useState("");

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      setSelectedFile(files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setSelectedFile(files[0]);
    }
  };

  const handleUpload = () => {
    if (selectedFile && screens.trim()) {
      onUpload(selectedFile, fileType, screens.trim());
      setSelectedFile(null);
      setScreens("");
    }
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      style={{
        border: `2px dashed ${dragOver ? "#22c55e" : "rgba(255, 255, 255, 0.3)"}`,
        borderRadius: "8px",
        padding: "20px",
        textAlign: "center",
        background: dragOver ? "rgba(34, 197, 94, 0.1)" : "rgba(255, 255, 255, 0.05)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1
      }}
    >
      <input
        type="file"
        accept={accept}
        onChange={handleFileSelect}
        disabled={disabled}
        style={{ display: "none" }}
        id={`file-upload-${fileType}`}
      />
      <label htmlFor={`file-upload-${fileType}`} style={{ cursor: disabled ? "not-allowed" : "pointer" }}>
        <div style={{ fontSize: "1rem", marginBottom: "8px" }}>
          📎 Drop {fileType.toUpperCase()} file here or click to browse
        </div>
        <div style={{ fontSize: "0.8rem", color: "rgba(255, 255, 255, 0.7)" }}>
          {selectedFile ? selectedFile.name : `Select a ${fileType} file`}
        </div>
      </label>
      {selectedFile && (
        <div style={{ marginTop: "12px" }}>
          <input
            type="text"
            placeholder="Associated screens (comma-separated)"
            value={screens}
            onChange={(e) => setScreens(e.target.value)}
            style={{
              width: "100%",
              padding: "8px",
              borderRadius: "4px",
              border: "1px solid rgba(255, 255, 255, 0.3)",
              background: "rgba(0, 0, 0, 0.3)",
              color: "white",
              fontSize: "0.8rem",
              marginBottom: "8px"
            }}
          />
          <button
            onClick={handleUpload}
            disabled={!screens.trim() || disabled}
            style={{
              padding: "8px 16px",
              borderRadius: "4px",
              border: "none",
              background: "#22c55e",
              color: "white",
              cursor: (!screens.trim() || disabled) ? "not-allowed" : "pointer",
              opacity: (!screens.trim() || disabled) ? 0.5 : 1
            }}
          >
            Upload
          </button>
        </div>
      )}
    </div>
  );
};

