"use client";

import { useState, useRef } from "react";
import { Navigation } from "@/components";

// Database ID para los ejemplos
const DB_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID;

// Queries de ejemplo
const EXAMPLE_QUERIES = {
  listEntities: {
    label: "Listar Entidades",
    description: "Obtiene todas las entidades de la base de datos",
    query: `query ListEntities {
  tablesListRows(
    databaseId: "${DB_ID}"
    tableId: "entities"
  ) {
    total
    rows {
      $id
      label
      description
      aliases
      type
    }
  }
}`,
  },
  getEntity: {
    label: "Obtener Entidad",
    description: "Obtiene una entidad por su ID",
    query: `query GetEntity($rowId: String!) {
  tablesGetRow(
    databaseId: "${DB_ID}"
    tableId: "entities"
    rowId: $rowId
  ) {
    $id
    label
    description
    aliases
    type
  }
}`,
    variables: { rowId: "<ENTITY_ID>" },
  },
  listClaims: {
    label: "Listar Claims",
    description: "Obtiene todas las declaraciones/afirmaciones",
    query: `query ListClaims {
  tablesListRows(
    databaseId: "${DB_ID}"
    tableId: "claims"
  ) {
    total
    rows {
      $id
      subject
      property
      value_raw
      value_relation
      rank
    }
  }
}`,
  },
  searchEntities: {
    label: "Buscar Entidades",
    description: "Busca entidades que contengan un texto",
    query: `query SearchEntities {
  tablesListRows(
    databaseId: "${DB_ID}"
    tableId: "entities"
    queries: ["{\\"method\\":\\"contains\\",\\"column\\":\\"label\\",\\"values\\":[\\"Persona\\"]}"]
  ) {
    total
    rows {
      $id
      label
      description
    }
  }
}`,
  },
  entityWithClaims: {
    label: "Entidad con Claims",
    description: "Obtiene claims de una entidad específica",
    query: `query EntityClaims {
  tablesListRows(
    databaseId: "${DB_ID}"
    tableId: "claims"
    queries: ["{\\"method\\":\\"equal\\",\\"column\\":\\"subject\\",\\"values\\":[\\"<ENTITY_ID>\\"]}"]
  ) {
    total
    rows {
      $id
      property
      value_raw
      value_relation
      rank
    }
  }
}`,
  },
};

// Formatos de exportación
const EXPORT_FORMATS = [
  { id: "json", label: "JSON", icon: "📄" },
  { id: "csv", label: "CSV", icon: "📊" },
  { id: "tsv", label: "TSV", icon: "📋" },
];

// Convertir resultado a CSV
function convertToCSV(data, separator = ",") {
  if (!data || typeof data !== "object") return "";

  let rows = [];
  function findRows(obj) {
    if (Array.isArray(obj)) {
      rows = obj;
      return true;
    }
    if (typeof obj === "object" && obj !== null) {
      for (const key of Object.keys(obj)) {
        if (key === "rows" && Array.isArray(obj[key])) {
          rows = obj[key];
          return true;
        }
        if (findRows(obj[key])) return true;
      }
    }
    return false;
  }
  findRows(data);

  if (rows.length === 0 && data.data) {
    const values = Object.values(data.data);
    if (values.length > 0 && typeof values[0] === "object") {
      rows = [values[0]];
    }
  }

  if (rows.length === 0) return "";

  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const csvRows = [headers.join(separator)];
  
  for (const row of rows) {
    const values = headers.map((h) => {
      const val = row[h];
      if (val === null || val === undefined) return "";
      if (typeof val === "object") return JSON.stringify(val);
      const str = String(val);
      if (str.includes(separator) || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    csvRows.push(values.join(separator));
  }

  return csvRows.join("\n");
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function GraphQLPage() {
  const [query, setQuery] = useState(EXAMPLE_QUERIES.listEntities.query);
  const [variables, setVariables] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeExample, setActiveExample] = useState("listEntities");
  const [viewMode, setViewMode] = useState("table");
  const [showVariables, setShowVariables] = useState(false);
  const [executionTime, setExecutionTime] = useState(null);
  const [showExamples, setShowExamples] = useState(true);
  const queryRef = useRef(null);

  async function executeQuery() {
    setLoading(true);
    setError(null);
    setResult(null);
    setExecutionTime(null);

    const startTime = performance.now();

    try {
      let parsedVariables = {};
      if (variables.trim()) {
        try {
          parsedVariables = JSON.parse(variables);
        } catch (e) {
          throw new Error("Variables JSON inválido: " + e.message);
        }
      }

      const response = await fetch("/api/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: parsedVariables }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Error ejecutando query");
      }

      const endTime = performance.now();
      setExecutionTime(Math.round(endTime - startTime));
      setResult(data);
    } catch (err) {
      setError(err.message || "Error ejecutando query");
    } finally {
      setLoading(false);
    }
  }

  function loadExample(exampleKey) {
    setActiveExample(exampleKey);
    const example = EXAMPLE_QUERIES[exampleKey];
    setQuery(example.query);
    if (example.variables) {
      setVariables(JSON.stringify(example.variables, null, 2));
      setShowVariables(true);
    } else {
      setVariables("");
    }
    setResult(null);
    setError(null);
  }

  function handleExport(format) {
    if (!result) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    switch (format) {
      case "json":
        downloadFile(JSON.stringify(result, null, 2), `query-result-${timestamp}.json`, "application/json");
        break;
      case "csv":
        const csv = convertToCSV(result, ",");
        if (csv) downloadFile(csv, `query-result-${timestamp}.csv`, "text/csv");
        else alert("No se pudo convertir a CSV");
        break;
      case "tsv":
        const tsv = convertToCSV(result, "\t");
        if (tsv) downloadFile(tsv, `query-result-${timestamp}.tsv`, "text/tab-separated-values");
        else alert("No se pudo convertir a TSV");
        break;
    }
  }

  function getTableData() {
    if (!result) return { headers: [], rows: [] };

    let rows = [];
    function findRows(obj) {
      if (Array.isArray(obj)) { rows = obj; return true; }
      if (typeof obj === "object" && obj !== null) {
        for (const key of Object.keys(obj)) {
          if (key === "rows" && Array.isArray(obj[key])) { rows = obj[key]; return true; }
          if (findRows(obj[key])) return true;
        }
      }
      return false;
    }
    findRows(result);

    if (rows.length === 0 && result.data) {
      const values = Object.values(result.data);
      if (values.length > 0 && typeof values[0] === "object" && !Array.isArray(values[0])) {
        rows = [values[0]];
      }
    }

    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    return { headers, rows };
  }

  function getTotal() {
    if (!result) return null;
    function findTotal(obj) {
      if (typeof obj !== "object" || obj === null) return null;
      if ("total" in obj) return obj.total;
      for (const val of Object.values(obj)) {
        const found = findTotal(val);
        if (found !== null) return found;
      }
      return null;
    }
    return findTotal(result);
  }

  const tableData = getTableData();
  const resultCount = tableData.rows.length;
  const total = getTotal();

  return (
    <div className="explorer-layout">
      <Navigation />

      <main className="explorer-main">
        <div className="explorer-container graphql-page">
          <header className="wdqs-header">
            <div className="wdqs-title">
              <h1>🔍 GraphQL Query Service</h1>
              <span className="wdqs-subtitle">Consulta la base de datos de grafos usando GraphQL</span>
            </div>
            <div className="wdqs-actions">
              <button className={`wdqs-toggle ${showExamples ? "active" : ""}`} onClick={() => setShowExamples(!showExamples)}>
                {showExamples ? "◀ Ocultar" : "▶ Ejemplos"}
              </button>
            </div>
          </header>

          <div className={`wdqs-layout ${showExamples ? "" : "collapsed"}`}>
            {showExamples && (
              <aside className="wdqs-sidebar">
                <h3>📚 Consultas de Ejemplo</h3>
                <div className="wdqs-examples-list">
                  {Object.entries(EXAMPLE_QUERIES).map(([key, example]) => (
                    <button
                      key={key}
                      className={`wdqs-example-item ${activeExample === key ? "active" : ""}`}
                      onClick={() => loadExample(key)}
                    >
                      <span className="example-name">{example.label}</span>
                      <span className="example-desc">{example.description}</span>
                    </button>
                  ))}
                </div>
                <div className="wdqs-help">
                  <h4>💡 Ayuda Rápida</h4>
                  <ul>
                    <li><code>tablesListRows</code> - Listar registros</li>
                    <li><code>tablesGetRow</code> - Obtener un registro</li>
                    <li>Usa <code>queries</code> para filtrar</li>
                  </ul>
                </div>
              </aside>
            )}

            <div className="wdqs-main">
              <div className="wdqs-editor-container">
                <div className="wdqs-editor-toolbar">
                  <div className="toolbar-left">
                    <span className="toolbar-label">Query GraphQL</span>
                  </div>
                  <div className="toolbar-right">
                    <button className="toolbar-btn" onClick={() => setShowVariables(!showVariables)} title="Variables">
                      {showVariables ? "📦 Variables ▼" : "📦 Variables"}
                    </button>
                    <button className="wdqs-run-btn" onClick={executeQuery} disabled={loading || !query.trim()}>
                      {loading ? "⏳ Ejecutando..." : "▶ Ejecutar"}
                    </button>
                  </div>
                </div>

                <textarea
                  ref={queryRef}
                  className="wdqs-query-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Escribe tu query GraphQL aquí..."
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") executeQuery();
                  }}
                />

                {showVariables && (
                  <div className="wdqs-variables">
                    <label>Variables (JSON):</label>
                    <textarea
                      className="wdqs-variables-input"
                      value={variables}
                      onChange={(e) => setVariables(e.target.value)}
                      placeholder='{"variable": "valor"}'
                      spellCheck={false}
                    />
                  </div>
                )}

                <div className="wdqs-editor-footer">
                  <span className="keyboard-hint">Presiona <kbd>Ctrl</kbd>+<kbd>Enter</kbd> para ejecutar</span>
                </div>
              </div>

              <div className="wdqs-results-container">
                <div className="wdqs-results-toolbar">
                  <div className="toolbar-left">
                    <span className="toolbar-label">Resultados</span>
                    {result && (
                      <span className="result-stats">
                        {resultCount} resultado{resultCount !== 1 ? "s" : ""}
                        {total && total > resultCount && ` de ${total}`}
                        {executionTime && ` • ${executionTime}ms`}
                      </span>
                    )}
                  </div>
                  <div className="toolbar-right">
                    {result && (
                      <>
                        <div className="view-selector">
                          <button className={`view-btn ${viewMode === "table" ? "active" : ""}`} onClick={() => setViewMode("table")} title="Vista tabla">
                            📊 Tabla
                          </button>
                          <button className={`view-btn ${viewMode === "json" ? "active" : ""}`} onClick={() => setViewMode("json")} title="Vista JSON">
                            📄 JSON
                          </button>
                        </div>
                        <div className="export-dropdown">
                          <button className="export-btn">⬇️ Descargar</button>
                          <div className="export-menu">
                            {EXPORT_FORMATS.map((format) => (
                              <button key={format.id} onClick={() => handleExport(format.id)}>
                                {format.icon} {format.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="wdqs-results-content">
                  {loading && (
                    <div className="wdqs-loading">
                      <div className="loading-spinner"></div>
                      <span>Ejecutando consulta...</span>
                    </div>
                  )}

                  {error && (
                    <div className="wdqs-error">
                      <span className="error-icon">❌</span>
                      <div className="error-content">
                        <strong>Error en la consulta</strong>
                        <pre>{error}</pre>
                      </div>
                    </div>
                  )}

                  {result && !loading && viewMode === "table" && (
                    <div className="wdqs-table-wrapper">
                      {tableData.rows.length > 0 ? (
                        <table className="wdqs-results-table">
                          <thead>
                            <tr>
                              <th className="row-number">#</th>
                              {tableData.headers.map((h) => (<th key={h}>{h}</th>))}
                            </tr>
                          </thead>
                          <tbody>
                            {tableData.rows.map((row, i) => (
                              <tr key={i}>
                                <td className="row-number">{i + 1}</td>
                                {tableData.headers.map((h) => (
                                  <td key={h}>
                                    {row[h] === null || row[h] === undefined ? (
                                      <span className="null-value">null</span>
                                    ) : typeof row[h] === "object" ? (
                                      <code className="object-value">{JSON.stringify(row[h])}</code>
                                    ) : h === "$id" ? (
                                      <a href={`/entity/${row[h]}`} className="id-link">{row[h]}</a>
                                    ) : (
                                      String(row[h])
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="wdqs-empty">
                          <span>📭</span>
                          <p>La consulta no devolvió resultados tabulares.</p>
                          <button onClick={() => setViewMode("json")}>Ver respuesta JSON</button>
                        </div>
                      )}
                    </div>
                  )}

                  {result && !loading && viewMode === "json" && (
                    <pre className="wdqs-json-output">{JSON.stringify(result, null, 2)}</pre>
                  )}

                  {!result && !loading && !error && (
                    <div className="wdqs-placeholder">
                      <span className="placeholder-icon">🚀</span>
                      <p>Escribe una consulta GraphQL y presiona Ejecutar</p>
                      <p className="placeholder-hint">O selecciona un ejemplo del panel lateral</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="explorer-footer">
        <p>Graph DB Explorer — GraphQL Query Service</p>
      </footer>
    </div>
  );
}
