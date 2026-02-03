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
  tablesDBListRows(
    databaseId: "${DB_ID}"
    tableId: "entities"
  ) {
    total
    rows {
      _id
      data
    }
  }
}`,
  },
  getEntity: {
    label: "Obtener Entidad",
    description: "Obtiene una entidad por su ID (reemplaza ENTITY_ID)",
    query: `query GetEntity {
  tablesDBGetRow(
    databaseId: "${DB_ID}"
    tableId: "entities"
    rowId: "<ENTITY_ID>"
  ) {
    _id
    _tableId
    _databaseId
    _createdAt
    _updatedAt
    data
  }
}`,
  },
  listClaims: {
    label: "Listar Claims",
    description: "Obtiene todas las declaraciones/afirmaciones",
    query: `query ListClaims {
  tablesDBListRows(
    databaseId: "${DB_ID}"
    tableId: "claims"
  ) {
    total
    rows {
      _id
      data
    }
  }
}`,
  },
  searchEntities: {
    label: "Buscar Entidades",
    description: "Busca entidades que contengan 'Persona' en label",
    query: `query SearchEntities {
  tablesDBListRows(
    databaseId: "${DB_ID}"
    tableId: "entities"
    queries: ["{\\"method\\":\\"contains\\",\\"column\\":\\"label\\",\\"values\\":[\\"Persona\\"]}"]
  ) {
    total
    rows {
      _id
      data
    }
  }
}`,
  },
  entityWithClaims: {
    label: "Claims de Entidad",
    description: "Obtiene claims de una entidad específica (reemplaza ENTITY_ID)",
    query: `query EntityClaims {
  tablesDBListRows(
    databaseId: "${DB_ID}"
    tableId: "claims"
    queries: ["{\\"method\\":\\"equal\\",\\"column\\":\\"subject\\",\\"values\\":[\\"<ENTITY_ID>\\"]}"]
  ) {
    total
    rows {
      _id
      data
    }
  }
}`,
  },
};

// Mutations de ejemplo para CRUD
const MUTATION_EXAMPLES = {
  createEntity: {
    label: "Crear Entidad",
    description: "Crea una nueva entidad (ítem o propiedad)",
    query: `mutation CreateEntity {
  tablesCreateRow(
    databaseId: "${DB_ID}"
    tableId: "entities"
    rowId: "unique()"
    data: "{\\"type\\":\\"item\\",\\"label\\":\\"Nueva Entidad\\",\\"description\\":\\"Descripción de la entidad\\",\\"aliases\\":[],\\"sitelinks\\":{}}"
  ) {
    _id
    _createdAt
    _updatedAt
    data
  }
}`,
  },
  createProperty: {
    label: "Crear Propiedad",
    description: "Crea una nueva propiedad para usar en claims",
    query: `mutation CreateProperty {
  tablesCreateRow(
    databaseId: "${DB_ID}"
    tableId: "entities"
    rowId: "unique()"
    data: "{\\"type\\":\\"property\\",\\"label\\":\\"Nueva Propiedad\\",\\"description\\":\\"Describe esta propiedad\\",\\"datatype\\":\\"string\\",\\"aliases\\":[],\\"sitelinks\\":{}}"
  ) {
    _id
    _createdAt
    _updatedAt
    data
  }
}`,
  },
  createClaim: {
    label: "Crear Claim",
    description: "Añade una declaración a una entidad (reemplaza IDs)",
    query: `mutation CreateClaim {
  tablesCreateRow(
    databaseId: "${DB_ID}"
    tableId: "claims"
    rowId: "unique()"
    data: "{\\"subject\\":\\"<ENTITY_ID>\\",\\"property\\":\\"<PROPERTY_ID>\\",\\"value\\":\\"Valor del claim\\",\\"rank\\":\\"normal\\"}"
  ) {
    _id
    _createdAt
    _updatedAt
    data
  }
}`,
  },
  createQualifier: {
    label: "Crear Qualifier",
    description: "Añade un calificador a un claim (reemplaza IDs)",
    query: `mutation CreateQualifier {
  tablesCreateRow(
    databaseId: "${DB_ID}"
    tableId: "qualifiers"
    rowId: "unique()"
    data: "{\\"claim\\":\\"<CLAIM_ID>\\",\\"property\\":\\"<PROPERTY_ID>\\",\\"value\\":\\"Valor del qualifier\\"}"
  ) {
    _id
    _createdAt
    _updatedAt
    data
  }
}`,
  },
  createReference: {
    label: "Crear Referencia",
    description: "Añade una referencia/fuente a un claim (reemplaza IDs)",
    query: `mutation CreateReference {
  tablesCreateRow(
    databaseId: "${DB_ID}"
    tableId: "references"
    rowId: "unique()"
    data: "{\\"claim\\":\\"<CLAIM_ID>\\",\\"property\\":\\"<PROPERTY_ID>\\",\\"value\\":\\"https://example.com/source\\"}"
  ) {
    _id
    _createdAt
    _updatedAt
    data
  }
}`,
  },
  updateEntity: {
    label: "Actualizar Entidad",
    description: "Actualiza los datos de una entidad existente",
    query: `mutation UpdateEntity {
  tablesDBUpdateRow(
    databaseId: "${DB_ID}"
    tableId: "entities"
    rowId: "<ENTITY_ID>"
    data: "{\\"label\\":\\"Nombre actualizado\\",\\"description\\":\\"Nueva descripción\\"}"
  ) {
    _id
    _updatedAt
    data
  }
}`,
  },
  deleteRow: {
    label: "Eliminar Registro",
    description: "Elimina un registro por su ID (¡cuidado!)",
    query: `mutation DeleteRow {
  tablesDBDeleteRow(
    databaseId: "${DB_ID}"
    tableId: "entities"
    rowId: "<ROW_ID>"
  ) {
    status
  }
}`,
  },
};

// Tipos de datos para propiedades
const PROPERTY_DATATYPES = [
  { id: "string", label: "Texto", icon: "📝" },
  { id: "entity", label: "Entidad", icon: "🔗" },
  { id: "url", label: "URL", icon: "🌐" },
  { id: "datetime", label: "Fecha/Hora", icon: "📅" },
  { id: "quantity", label: "Cantidad", icon: "🔢" },
  { id: "coordinates", label: "Coordenadas", icon: "📍" },
  { id: "media", label: "Archivo", icon: "📎" },
];

// Tablas disponibles
const TABLES = [
  { id: "entities", label: "Entidades", icon: "📦" },
  { id: "claims", label: "Claims", icon: "📋" },
  { id: "qualifiers", label: "Qualifiers", icon: "🏷️" },
  { id: "references", label: "Referencias", icon: "📚" },
];

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

  // Procesar rows para expandir el campo "data" si existe (formato TablesDB)
  const processedRows = rows.map(row => {
    if (row && row.data && typeof row.data === "string") {
      try {
        const parsed = JSON.parse(row.data);
        return { _id: row._id, ...parsed };
      } catch {
        return row;
      }
    } else if (row && row.data && typeof row.data === "object") {
      return { _id: row._id, ...row.data };
    }
    return row;
  });

  const headers = [...new Set(processedRows.flatMap((row) => Object.keys(row)))];
  const csvRows = [headers.join(separator)];
  
  for (const row of processedRows) {
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
  const [queryType, setQueryType] = useState("query"); // "query" | "mutation"
  const [showCrudModal, setShowCrudModal] = useState(false);
  const [crudMode, setCrudMode] = useState("create"); // "create" | "update" | "delete"
  const [crudTable, setCrudTable] = useState("entities");
  const [crudData, setCrudData] = useState({});
  const [crudRowId, setCrudRowId] = useState("");
  const [crudSuccess, setCrudSuccess] = useState(null);
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

  function loadExample(exampleKey, isMutation = false) {
    setActiveExample(exampleKey);
    const examples = isMutation ? MUTATION_EXAMPLES : EXAMPLE_QUERIES;
    const example = examples[exampleKey];
    setQuery(example.query);
    setQueryType(isMutation ? "mutation" : "query");
    if (example.variables) {
      setVariables(JSON.stringify(example.variables, null, 2));
      setShowVariables(true);
    } else {
      setVariables("");
    }
    setResult(null);
    setError(null);
  }

  // Funciones CRUD visual
  function openCrudModal(mode, table = "entities") {
    setCrudMode(mode);
    setCrudTable(table);
    setCrudData(getDefaultCrudData(table));
    setCrudRowId("");
    setCrudSuccess(null);
    setShowCrudModal(true);
  }

  function getDefaultCrudData(table) {
    switch (table) {
      case "entities":
        return { type: "item", label: "", description: "", aliases: [], datatype: "string", sitelinks: {} };
      case "claims":
        return { subject: "", property: "", value: "", rank: "normal" };
      case "qualifiers":
        return { claim: "", property: "", value: "" };
      case "references":
        return { claim: "", property: "", value: "" };
      default:
        return {};
    }
  }

  async function executeCrud() {
    setLoading(true);
    setError(null);
    setCrudSuccess(null);

    try {
      let mutation;
      const dataStr = JSON.stringify(JSON.stringify(crudData));

      if (crudMode === "create") {
        mutation = `mutation {
  tablesCreateRow(
    databaseId: "${DB_ID}"
    tableId: "${crudTable}"
    rowId: "unique()"
    data: ${dataStr}
  ) {
    _id
    _createdAt
    data
  }
}`;
      } else if (crudMode === "update") {
        if (!crudRowId) throw new Error("Debes especificar el ID del registro a actualizar");
        mutation = `mutation {
  tablesDBUpdateRow(
    databaseId: "${DB_ID}"
    tableId: "${crudTable}"
    rowId: "${crudRowId}"
    data: ${dataStr}
  ) {
    _id
    _updatedAt
    data
  }
}`;
      } else if (crudMode === "delete") {
        if (!crudRowId) throw new Error("Debes especificar el ID del registro a eliminar");
        mutation = `mutation {
  tablesDBDeleteRow(
    databaseId: "${DB_ID}"
    tableId: "${crudTable}"
    rowId: "${crudRowId}"
  ) {
    status
  }
}`;
      }

      const response = await fetch("/api/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: mutation }),
      });

      const data = await response.json();

      if (!response.ok || data.errors) {
        throw new Error(data.errors?.[0]?.message || data.error || "Error ejecutando operación");
      }

      setCrudSuccess(data);
      setTimeout(() => setShowCrudModal(false), 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function updateCrudField(field, value) {
    setCrudData(prev => ({ ...prev, [field]: value }));
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

    // Si no encontramos rows, buscar en result.data para getRow
    if (rows.length === 0 && result.data) {
      const values = Object.values(result.data);
      if (values.length > 0 && typeof values[0] === "object" && !Array.isArray(values[0])) {
        rows = [values[0]];
      }
    }

    // Procesar rows para expandir el campo "data" si existe (formato TablesDB)
    const processedRows = rows.map(row => {
      if (row && row.data && typeof row.data === "string") {
        try {
          const parsed = JSON.parse(row.data);
          return { _id: row._id, ...parsed };
        } catch {
          return row;
        }
      } else if (row && row.data && typeof row.data === "object") {
        return { _id: row._id, ...row.data };
      }
      return row;
    });

    const headers = [...new Set(processedRows.flatMap((row) => Object.keys(row)))];
    return { headers, rows: processedRows };
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
                <h3>📚 Consultas (Query)</h3>
                <div className="wdqs-examples-list">
                  {Object.entries(EXAMPLE_QUERIES).map(([key, example]) => (
                    <button
                      key={key}
                      className={`wdqs-example-item ${activeExample === key && queryType === "query" ? "active" : ""}`}
                      onClick={() => loadExample(key, false)}
                    >
                      <span className="example-name">{example.label}</span>
                      <span className="example-desc">{example.description}</span>
                    </button>
                  ))}
                </div>

                <h3>✏️ Mutaciones (CRUD)</h3>
                <div className="wdqs-examples-list">
                  {Object.entries(MUTATION_EXAMPLES).map(([key, example]) => (
                    <button
                      key={key}
                      className={`wdqs-example-item mutation ${activeExample === key && queryType === "mutation" ? "active" : ""}`}
                      onClick={() => loadExample(key, true)}
                    >
                      <span className="example-name">{example.label}</span>
                      <span className="example-desc">{example.description}</span>
                    </button>
                  ))}
                </div>

                <h3>🛠️ Acciones Rápidas</h3>
                <div className="wdqs-crud-buttons">
                  <button className="crud-btn create" onClick={() => openCrudModal("create", "entities")}>
                    ➕ Nueva Entidad
                  </button>
                  <button className="crud-btn create" onClick={() => openCrudModal("create", "claims")}>
                    ➕ Nuevo Claim
                  </button>
                  <button className="crud-btn update" onClick={() => openCrudModal("update", "entities")}>
                    ✏️ Editar Registro
                  </button>
                  <button className="crud-btn delete" onClick={() => openCrudModal("delete", "entities")}>
                    🗑️ Eliminar Registro
                  </button>
                </div>

                <div className="wdqs-help">
                  <h4>💡 Ayuda Rápida</h4>
                  <ul>
                    <li><code>tablesDBListRows</code> - Listar registros</li>
                    <li><code>tablesDBGetRow</code> - Obtener un registro</li>
                    <li><code>tablesCreateRow</code> - Crear registro</li>
                    <li><code>tablesDBUpdateRow</code> - Actualizar</li>
                    <li><code>tablesDBDeleteRow</code> - Eliminar</li>
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

      {/* Modal CRUD */}
      {showCrudModal && (
        <div className="crud-modal-overlay" onClick={() => setShowCrudModal(false)}>
          <div className="crud-modal" onClick={(e) => e.stopPropagation()}>
            <div className="crud-modal-header">
              <h2>
                {crudMode === "create" && "➕ Crear Registro"}
                {crudMode === "update" && "✏️ Actualizar Registro"}
                {crudMode === "delete" && "🗑️ Eliminar Registro"}
              </h2>
              <button className="crud-close-btn" onClick={() => setShowCrudModal(false)}>✕</button>
            </div>

            <div className="crud-modal-body">
              {/* Selector de tabla */}
              <div className="crud-field">
                <label>Tabla:</label>
                <select 
                  value={crudTable} 
                  onChange={(e) => {
                    setCrudTable(e.target.value);
                    setCrudData(getDefaultCrudData(e.target.value));
                  }}
                >
                  {TABLES.map(t => (
                    <option key={t.id} value={t.id}>{t.icon} {t.label}</option>
                  ))}
                </select>
              </div>

              {/* ID para update/delete */}
              {(crudMode === "update" || crudMode === "delete") && (
                <div className="crud-field">
                  <label>ID del Registro: *</label>
                  <input
                    type="text"
                    value={crudRowId}
                    onChange={(e) => setCrudRowId(e.target.value)}
                    placeholder="Ingresa el ID del registro"
                    required
                  />
                </div>
              )}

              {/* Campos según tabla */}
              {crudMode !== "delete" && (
                <>
                  {crudTable === "entities" && (
                    <>
                      <div className="crud-field">
                        <label>Tipo:</label>
                        <select value={crudData.type || "item"} onChange={(e) => updateCrudField("type", e.target.value)}>
                          <option value="item">📦 Ítem</option>
                          <option value="property">🏷️ Propiedad</option>
                        </select>
                      </div>
                      <div className="crud-field">
                        <label>Etiqueta (label): *</label>
                        <input
                          type="text"
                          value={crudData.label || ""}
                          onChange={(e) => updateCrudField("label", e.target.value)}
                          placeholder="Nombre de la entidad"
                        />
                      </div>
                      <div className="crud-field">
                        <label>Descripción:</label>
                        <textarea
                          value={crudData.description || ""}
                          onChange={(e) => updateCrudField("description", e.target.value)}
                          placeholder="Descripción de la entidad"
                        />
                      </div>
                      {crudData.type === "property" && (
                        <div className="crud-field">
                          <label>Tipo de dato:</label>
                          <select value={crudData.datatype || "string"} onChange={(e) => updateCrudField("datatype", e.target.value)}>
                            {PROPERTY_DATATYPES.map(dt => (
                              <option key={dt.id} value={dt.id}>{dt.icon} {dt.label}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className="crud-field">
                        <label>Aliases (separados por coma):</label>
                        <input
                          type="text"
                          value={(crudData.aliases || []).join(", ")}
                          onChange={(e) => updateCrudField("aliases", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                          placeholder="alias1, alias2, alias3"
                        />
                      </div>
                    </>
                  )}

                  {crudTable === "claims" && (
                    <>
                      <div className="crud-field">
                        <label>Subject (Entity ID): *</label>
                        <input
                          type="text"
                          value={crudData.subject || ""}
                          onChange={(e) => updateCrudField("subject", e.target.value)}
                          placeholder="ID de la entidad sujeto"
                        />
                      </div>
                      <div className="crud-field">
                        <label>Property (Property ID): *</label>
                        <input
                          type="text"
                          value={crudData.property || ""}
                          onChange={(e) => updateCrudField("property", e.target.value)}
                          placeholder="ID de la propiedad"
                        />
                      </div>
                      <div className="crud-field">
                        <label>Valor: *</label>
                        <input
                          type="text"
                          value={crudData.value || ""}
                          onChange={(e) => updateCrudField("value", e.target.value)}
                          placeholder="Valor del claim"
                        />
                      </div>
                      <div className="crud-field">
                        <label>Rango:</label>
                        <select value={crudData.rank || "normal"} onChange={(e) => updateCrudField("rank", e.target.value)}>
                          <option value="preferred">⭐ Preferido</option>
                          <option value="normal">➖ Normal</option>
                          <option value="deprecated">⚠️ Obsoleto</option>
                        </select>
                      </div>
                    </>
                  )}

                  {crudTable === "qualifiers" && (
                    <>
                      <div className="crud-field">
                        <label>Claim ID: *</label>
                        <input
                          type="text"
                          value={crudData.claim || ""}
                          onChange={(e) => updateCrudField("claim", e.target.value)}
                          placeholder="ID del claim"
                        />
                      </div>
                      <div className="crud-field">
                        <label>Property ID: *</label>
                        <input
                          type="text"
                          value={crudData.property || ""}
                          onChange={(e) => updateCrudField("property", e.target.value)}
                          placeholder="ID de la propiedad"
                        />
                      </div>
                      <div className="crud-field">
                        <label>Valor: *</label>
                        <input
                          type="text"
                          value={crudData.value || ""}
                          onChange={(e) => updateCrudField("value", e.target.value)}
                          placeholder="Valor del qualifier"
                        />
                      </div>
                    </>
                  )}

                  {crudTable === "references" && (
                    <>
                      <div className="crud-field">
                        <label>Claim ID: *</label>
                        <input
                          type="text"
                          value={crudData.claim || ""}
                          onChange={(e) => updateCrudField("claim", e.target.value)}
                          placeholder="ID del claim"
                        />
                      </div>
                      <div className="crud-field">
                        <label>Property ID: *</label>
                        <input
                          type="text"
                          value={crudData.property || ""}
                          onChange={(e) => updateCrudField("property", e.target.value)}
                          placeholder="ID de la propiedad (ej: URL de referencia)"
                        />
                      </div>
                      <div className="crud-field">
                        <label>Valor (URL/Fuente): *</label>
                        <input
                          type="text"
                          value={crudData.value || ""}
                          onChange={(e) => updateCrudField("value", e.target.value)}
                          placeholder="https://ejemplo.com/fuente"
                        />
                      </div>
                    </>
                  )}
                </>
              )}

              {crudMode === "delete" && (
                <div className="crud-warning">
                  ⚠️ <strong>Advertencia:</strong> Esta acción eliminará permanentemente el registro. 
                  Esta operación no se puede deshacer.
                </div>
              )}

              {error && (
                <div className="crud-error">
                  ❌ {error}
                </div>
              )}

              {crudSuccess && (
                <div className="crud-success">
                  ✅ Operación completada exitosamente
                  <pre>{JSON.stringify(crudSuccess, null, 2)}</pre>
                </div>
              )}
            </div>

            <div className="crud-modal-footer">
              <button className="crud-cancel-btn" onClick={() => setShowCrudModal(false)}>
                Cancelar
              </button>
              <button 
                className={`crud-submit-btn ${crudMode}`} 
                onClick={executeCrud} 
                disabled={loading}
              >
                {loading ? "⏳ Procesando..." : (
                  crudMode === "create" ? "➕ Crear" :
                  crudMode === "update" ? "✏️ Actualizar" :
                  "🗑️ Eliminar"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="explorer-footer">
        <p>Graph DB Explorer — GraphQL Query Service</p>
      </footer>
    </div>
  );
}
