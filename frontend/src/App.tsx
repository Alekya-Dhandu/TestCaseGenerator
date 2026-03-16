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

export const App: React.FC = () => {
  const [prdInputType, setPrdInputType] = useState<"text" | "pdf" | "docx">("text");
  const [prdText, setPrdText] = useState("");
  const [prdFile, setPrdFile] = useState<File | null>(null);
  const [impactedScreens, setImpactedScreens] = useState("");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("openai_api_key") || "");
  const [isGenerating, setIsGenerating] = useState(false);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [usedMock, setUsedMock] = useState(false);
  const [mockInfo, setMockInfo] = useState<string | null>(null);

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
          ...(apiKey.trim() ? { "X-OpenAI-Api-Key": apiKey.trim() } : {})
        },
        body: JSON.stringify({
          prd_text: prdTextToUse,
          impacted_screens: screens
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
        <p style={{ marginTop: "4px", color: "rgba(255, 255, 255, 0.8)" }}>
          Paste a PRD and list impacted screens to auto-generate end-to-end
          test cases, then export them to Excel for TestPad.
        </p>
      </header>

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
                background: "rgba(255, 255, 255, 0.1)",
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
                  background: "rgba(255, 255, 255, 0.1)",
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
                  background: "rgba(255, 255, 255, 0.1)",
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
                background: "rgba(255, 255, 255, 0.1)",
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
              OpenAI API key (optional)
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                const v = e.target.value;
                setApiKey(v);
                localStorage.setItem("openai_api_key", v);
              }}
              placeholder="sk-..."
              style={{
                borderRadius: "999px",
                padding: "8px 14px",
                border: "1px solid rgba(255, 255, 255, 0.3)",
                background: "rgba(255, 255, 255, 0.1)",
                color: "white",
                fontSize: "0.9rem"
              }}
            />
            <span style={{ fontSize: "0.75rem", color: "rgba(255, 255, 255, 0.7)" }}>
              Stored only in this browser (localStorage) and sent with generate requests.
              Leave blank to use the server's <code>OPENAI_API_KEY</code>.
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
    </div>
  );
};

