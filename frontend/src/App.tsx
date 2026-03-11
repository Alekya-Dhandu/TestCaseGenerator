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
  const [prdText, setPrdText] = useState("");
  const [impactedScreens, setImpactedScreens] = useState("");
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

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prd_text: prdText,
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
        background: "#0f172a",
        color: "#e5e7eb",
        padding: "24px"
      }}
    >
      <header style={{ marginBottom: "24px" }}>
        <h2 style={{ margin: 0, fontSize: "1.75rem", fontWeight: 600 }}>
          AI Test Case Generator
        </h2>
        <p style={{ marginTop: "4px", color: "#9ca3af" }}>
          Paste a PRD and list impacted screens to auto-generate end-to-end
          test cases, then export them to Excel for TestPad.
        </p>
      </header>

      <main style={{ display: "grid", gridTemplateColumns: "1.2fr 1.8fr", gap: "24px", flex: 1 }}>
        <section
          style={{
            background: "#020617",
            borderRadius: "16px",
            padding: "20px",
            border: "1px solid #1f2937",
            display: "flex",
            flexDirection: "column",
            gap: "12px"
          }}
        >
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
                border: "1px solid #374151",
                background: "#020617",
                color: "#e5e7eb",
                fontFamily: "inherit",
                fontSize: "0.9rem"
              }}
            />
          </label>

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
                border: "1px solid #374151",
                background: "#020617",
                color: "#e5e7eb",
                fontSize: "0.9rem"
              }}
            />
            <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
              Comma-separated list. The generator will bias test cases towards
              these areas.
            </span>
          </label>

          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prdText.trim()}
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
            background: "#020617",
            borderRadius: "16px",
            padding: "16px",
            border: "1px solid #1f2937",
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
              <p style={{ margin: 0, fontSize: "0.8rem", color: "#9ca3af" }}>
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
              border: "1px solid #111827",
              background: "#020617"
            }}
          >
            {testCases.length === 0 ? (
              <div
                style={{
                  padding: "24px",
                  textAlign: "center",
                  fontSize: "0.85rem",
                  color: "#6b7280"
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
                <thead style={{ background: "#020617" }}>
                  <tr>
                    {["ID", "Title", "Type", "Priority", "Screen"].map((col) => (
                      <th
                        key={col}
                        style={{
                          textAlign: "left",
                          padding: "8px 10px",
                          borderBottom: "1px solid #111827",
                          position: "sticky",
                          top: 0,
                          background: "#020617",
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
                        borderBottom: "1px solid #111827"
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

