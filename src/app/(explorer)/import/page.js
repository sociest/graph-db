"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { EntitySelector, Navigation } from "@/components";
import { runImportFromConfigWithFile } from "@/lib/database";
import "./style.css";

const DEFAULT_FIELDS = [
  { id: "field-1", name: "label", source: "Columna A", type: "text", required: true },
  { id: "field-2", name: "descripcion", source: "Columna B", type: "text", required: false },
];

const DEFAULT_MATCH_RULES = [
  { id: "rule-1", propertyId: null, value: "", matchMode: "contains" },
];

const DEFAULT_COMPUTED = [
  { id: "calc-1", name: "slug", language: "formula", expression: "LOWER(REPLACE({{label}}, ' ', '-'))" },
];

const DEFAULT_CLAIMS = [
  {
    id: "claim-1",
    property: "P1",
    valueExpr: "{{descripcion}}",
    qualifiers: [{ id: "qual-1", property: "P2", valueExpr: "{{fecha}}" }],
    references: [{ id: "ref-1", property: "P3", valueExpr: "{{fuente}}" }],
  },
];

export default function ImportPage() {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [format, setFormat] = useState("csv");
  const [delimiter, setDelimiter] = useState(",");
  const [hasHeader, setHasHeader] = useState(true);
  const [encoding, setEncoding] = useState("utf-8");
  const [dateFormat, setDateFormat] = useState("YYYY-MM-DD");
  const [fields, setFields] = useState(DEFAULT_FIELDS);
  const [detectedColumns, setDetectedColumns] = useState([]);
  const [isDetectingColumns, setIsDetectingColumns] = useState(false);
  const [detectError, setDetectError] = useState("");
  const [matchRules, setMatchRules] = useState(DEFAULT_MATCH_RULES);
  const [basicSearchText, setBasicSearchText] = useState("");
  const [basicSearchFields, setBasicSearchFields] = useState({
    label: true,
    aliases: true,
    description: true,
  });
  const [onMissingEntity, setOnMissingEntity] = useState("create");
  const [newEntityTemplate, setNewEntityTemplate] = useState({
    label: "{{label}}",
    description: "{{descripcion}}",
    aliases: "{{aliases}}",
  });
  const [computedFields, setComputedFields] = useState(DEFAULT_COMPUTED);
  const [claims, setClaims] = useState(DEFAULT_CLAIMS);
  const [reconciliationMode, setReconciliationMode] = useState("manual");
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.8);
  const [reconciliationActions, setReconciliationActions] = useState({
    autoMergeHigh: true,
    autoCreateNoMatch: false,
    autoSkipLow: false,
  });
  const [exampleClaimTemplate, setExampleClaimTemplate] = useState({
    property: "P1",
    valueExpr: "{{descripcion}}",
    qualifiers: [{ property: "P2", valueExpr: "{{fecha}}" }],
    references: [{ property: "P3", valueExpr: "{{fuente}}" }],
  });
  const [importResult, setImportResult] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [reconciliationItems, setReconciliationItems] = useState([]);
  const [reconciliationDecisions, setReconciliationDecisions] = useState({});
  const [importFinalized, setImportFinalized] = useState(false);

  const steps = [
    {
      title: "Archivo y estructura",
      description: "Sube el archivo, define el formato y los campos de lectura.",
    },
    {
      title: "Búsqueda de entidad",
      description: "Define condiciones para identificar entidades existentes.",
    },
    {
      title: "Reconciliación",
      description: "Valida coincidencias y decide cómo resolver duplicados.",
    },
    {
      title: "Claims y fórmulas",
      description: "Modela claims, qualifiers y references con expresiones.",
    },
  ];

  function getFileFormat(fileObject) {
    const extension = fileObject?.name?.split(".").pop()?.toLowerCase();
    if (!extension) return null;
    if (extension === "tsv") return "tsv";
    if (extension === "csv") return "csv";
    if (extension === "json") return "json";
    if (extension === "xlsx" || extension === "xls") return "xlsx";
    return null;
  }

  function indexToColumnName(index) {
    let value = "";
    let n = index + 1;
    while (n > 0) {
      const remainder = (n - 1) % 26;
      value = String.fromCharCode(65 + remainder) + value;
      n = Math.floor((n - 1) / 26);
    }
    return `Columna ${value}`;
  }

  function sanitizeHeader(name, index) {
    if (!name || typeof name !== "string") return `col_${index + 1}`;
    const cleaned = name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
    return cleaned || `col_${index + 1}`;
  }

  function parseDelimitedLine(line, separator) {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];
      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === separator && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  function buildFieldsFromColumns(columns, headerBased) {
    return columns.map((column, index) => ({
      id: `field-${Date.now()}-${index}`,
      name: sanitizeHeader(column, index),
      source: headerBased ? column : indexToColumnName(index),
      type: "text",
      required: false,
    }));
  }

  async function detectColumnsFromFile(fileObject) {
    if (!fileObject) return;
    setIsDetectingColumns(true);
    setDetectError("");

    const guessedFormat = getFileFormat(fileObject);
    if (guessedFormat && guessedFormat !== format) {
      setFormat(guessedFormat);
      setIsDetectingColumns(false);
      return;
    }

    try {
      let columns = [];
      let headerBased = hasHeader;

      if (format === "csv" || format === "tsv") {
        const separator = format === "tsv" ? "\t" : delimiter || ",";
        const text = await fileObject.slice(0, 65536).text();
        const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
        if (!lines.length) {
          throw new Error("El archivo no contiene filas detectables.");
        }
        const firstRow = parseDelimitedLine(lines[0], separator);
        columns = headerBased ? firstRow : firstRow.map((_, index) => indexToColumnName(index));
      } else if (format === "json") {
        const text = await fileObject.text();
        const parsed = JSON.parse(text);
        const data = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.data)
          ? parsed.data
          : Array.isArray(parsed?.items)
          ? parsed.items
          : null;

        if (!data || data.length === 0) {
          throw new Error("No se encontró una colección JSON válida.");
        }

        const first = data[0];
        if (Array.isArray(first)) {
          columns = headerBased
            ? first.map((value) => `${value}`)
            : first.map((_, index) => indexToColumnName(index));
        } else if (typeof first === "object" && first !== null) {
          columns = Object.keys(first);
          headerBased = true;
        } else {
          throw new Error("No se pudieron determinar columnas desde JSON.");
        }
      } else if (format === "xlsx") {
        const buffer = await fileObject.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          throw new Error("No se encontraron hojas en el archivo XLSX.");
        }
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
        const firstRow = rows[0] || [];
        columns = headerBased
          ? firstRow.map((value) => `${value}`)
          : firstRow.map((_, index) => indexToColumnName(index));
      }

      if (!columns.length) {
        throw new Error("No se pudieron detectar columnas.");
      }

      setDetectedColumns(columns);
      setFields(buildFieldsFromColumns(columns, headerBased));
    } catch (error) {
      setDetectError(error?.message || "Error detectando columnas.");
    } finally {
      setIsDetectingColumns(false);
    }
  }

  useEffect(() => {
    if (!file) return;
    detectColumnsFromFile(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, format, delimiter, hasHeader]);

  function updateField(id, updates) {
    setFields((prev) => prev.map((field) => (field.id === id ? { ...field, ...updates } : field)));
  }

  function addField() {
    setFields((prev) => [
      ...prev,
      {
        id: `field-${Date.now()}`,
        name: "",
        source: "",
        type: "text",
        required: false,
      },
    ]);
  }

  function removeField(id) {
    setFields((prev) => prev.filter((field) => field.id !== id));
  }

  function updateMatchRule(id, updates) {
    setMatchRules((prev) => prev.map((rule) => (rule.id === id ? { ...rule, ...updates } : rule)));
  }

  function addMatchRule() {
    setMatchRules((prev) => [
      ...prev,
      { id: `rule-${Date.now()}`, propertyId: null, value: "", matchMode: "contains" },
    ]);
  }

  function removeMatchRule(id) {
    setMatchRules((prev) => prev.filter((rule) => rule.id !== id));
  }

  function updateComputed(id, updates) {
    setComputedFields((prev) => prev.map((field) => (field.id === id ? { ...field, ...updates } : field)));
  }

  function addComputed() {
    setComputedFields((prev) => [
      ...prev,
      { id: `calc-${Date.now()}`, name: "", language: "formula", expression: "" },
    ]);
  }

  function removeComputed(id) {
    setComputedFields((prev) => prev.filter((field) => field.id !== id));
  }

  function updateClaim(id, updates) {
    setClaims((prev) => prev.map((claim) => (claim.id === id ? { ...claim, ...updates } : claim)));
  }

  function addClaim() {
    setClaims((prev) => [
      ...prev,
      {
        id: `claim-${Date.now()}`,
        property: "",
        valueExpr: "",
        qualifiers: [],
        references: [],
      },
    ]);
  }

  function removeClaim(id) {
    setClaims((prev) => prev.filter((claim) => claim.id !== id));
  }

  function addQualifier(claimId) {
    setClaims((prev) =>
      prev.map((claim) =>
        claim.id === claimId
          ? {
              ...claim,
              qualifiers: [
                ...claim.qualifiers,
                { id: `qual-${Date.now()}`, property: "", valueExpr: "" },
              ],
            }
          : claim
      )
    );
  }

  function updateQualifier(claimId, qualId, updates) {
    setClaims((prev) =>
      prev.map((claim) =>
        claim.id === claimId
          ? {
              ...claim,
              qualifiers: claim.qualifiers.map((qual) =>
                qual.id === qualId ? { ...qual, ...updates } : qual
              ),
            }
          : claim
      )
    );
  }

  function removeQualifier(claimId, qualId) {
    setClaims((prev) =>
      prev.map((claim) =>
        claim.id === claimId
          ? {
              ...claim,
              qualifiers: claim.qualifiers.filter((qual) => qual.id !== qualId),
            }
          : claim
      )
    );
  }

  function addReference(claimId) {
    setClaims((prev) =>
      prev.map((claim) =>
        claim.id === claimId
          ? {
              ...claim,
              references: [
                ...claim.references,
                { id: `ref-${Date.now()}`, property: "", valueExpr: "" },
              ],
            }
          : claim
      )
    );
  }

  function updateReference(claimId, refId, updates) {
    setClaims((prev) =>
      prev.map((claim) =>
        claim.id === claimId
          ? {
              ...claim,
              references: claim.references.map((ref) =>
                ref.id === refId ? { ...ref, ...updates } : ref
              ),
            }
          : claim
      )
    );
  }

  function removeReference(claimId, refId) {
    setClaims((prev) =>
      prev.map((claim) =>
        claim.id === claimId
          ? {
              ...claim,
              references: claim.references.filter((ref) => ref.id !== refId),
            }
          : claim
      )
    );
  }

  const configObject = useMemo(
    () => ({
      format,
      delimiter,
      hasHeader,
      encoding,
      dateFormat,
      fields,
      matchRules,
      basicSearchText,
      basicSearchFields,
      onMissingEntity,
      newEntityTemplate,
      reconciliationMode,
      confidenceThreshold,
      reconciliationActions,
      computedFields,
      claims,
    }),
    [
      format,
      delimiter,
      hasHeader,
      encoding,
      dateFormat,
      fields,
      matchRules,
      basicSearchText,
      basicSearchFields,
      onMissingEntity,
      newEntityTemplate,
      reconciliationMode,
      confidenceThreshold,
      reconciliationActions,
      computedFields,
      claims,
    ]
  );

  const configPreview = useMemo(() => JSON.stringify(configObject, null, 2), [configObject]);

  function applyConfig(config) {
    if (!config || typeof config !== "object") return;
    setFormat(config.format ?? "csv");
    setDelimiter(config.delimiter ?? ",");
    setHasHeader(Boolean(config.hasHeader ?? true));
    setEncoding(config.encoding ?? "utf-8");
    setDateFormat(config.dateFormat ?? "YYYY-MM-DD");
    setFields(Array.isArray(config.fields) ? config.fields : DEFAULT_FIELDS);
    setMatchRules(Array.isArray(config.matchRules) ? config.matchRules : DEFAULT_MATCH_RULES);
    setBasicSearchText(config.basicSearchText ?? "");
    setBasicSearchFields({
      label: config.basicSearchFields?.label ?? true,
      aliases: config.basicSearchFields?.aliases ?? true,
      description: config.basicSearchFields?.description ?? true,
    });
    setOnMissingEntity(config.onMissingEntity ?? "create");
    setNewEntityTemplate({
      label: config.newEntityTemplate?.label ?? "{{label}}",
      description: config.newEntityTemplate?.description ?? "{{descripcion}}",
      aliases: config.newEntityTemplate?.aliases ?? "{{aliases}}",
    });
    setReconciliationMode(config.reconciliationMode ?? "manual");
    setConfidenceThreshold(
      typeof config.confidenceThreshold === "number" ? config.confidenceThreshold : 0.8
    );
    setReconciliationActions({
      autoMergeHigh: config.reconciliationActions?.autoMergeHigh ?? true,
      autoCreateNoMatch: config.reconciliationActions?.autoCreateNoMatch ?? false,
      autoSkipLow: config.reconciliationActions?.autoSkipLow ?? false,
    });
    setComputedFields(Array.isArray(config.computedFields) ? config.computedFields : DEFAULT_COMPUTED);
    setClaims(Array.isArray(config.claims) ? config.claims : DEFAULT_CLAIMS);
  }

  async function handleRunImport() {
    setImportLoading(true);
    setImportError("");
    setImportResult(null);
    setImportFinalized(false);
    try {
      if (!file) {
        throw new Error("Debes seleccionar un archivo para importar");
      }
      const result = await runImportFromConfigWithFile(configObject, file);
      const resultItems = Array.isArray(result?.reconciliationItems) ? result.reconciliationItems : [];
      const initialDecisions = resultItems.reduce((acc, item) => {
        acc[item.id] = item.suggested || "review";
        return acc;
      }, {});
      setImportResult(result);
      setReconciliationItems(resultItems);
      setReconciliationDecisions(initialDecisions);
      setStep(2);
    } catch (error) {
      setImportError(error?.message || "Error al ejecutar la importación.");
    } finally {
      setImportLoading(false);
    }
  }

  function handleDecisionChange(itemId, value) {
    setReconciliationDecisions((prev) => ({
      ...prev,
      [itemId]: value,
    }));
  }

  function handleFinalizeImport() {
    setImportFinalized(true);
  }

  function handleDownloadConfig() {
    const blob = new Blob([JSON.stringify(configObject, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `import-config-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function handleLoadConfig(event) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    try {
      const text = await selected.text();
      const parsed = JSON.parse(text);
      applyConfig(parsed);
    } catch (error) {
      setDetectError(error?.message || "No se pudo leer la configuración.");
    } finally {
      event.target.value = "";
    }
  }

  return (
    <div className="explorer-layout">
      <Navigation />

      <main className="explorer-main">
        <div className="explorer-container import-page">
          <header className="page-header">
            <div>
              <h1 className="page-title">Importación de datos</h1>
              <p className="page-subtitle">
                Configura cómo se leen los datos, cómo se buscan entidades y cómo se crean claims.
              </p>
            </div>
            <div className="page-header-actions">
              <label className="btn btn-secondary file-button">
                Cargar JSON
                <input type="file" accept="application/json,.json" onChange={handleLoadConfig} />
              </label>
              <button type="button" className="btn btn-secondary" onClick={handleDownloadConfig}>
                Descargar JSON
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleRunImport}
                disabled={importLoading}
              >
                {importLoading ? "Ejecutando..." : "Ejecutar importación"}
              </button>
            </div>
            {(importLoading || importError || importResult) && (
              <div className="import-status">
                {importLoading && <span>Ejecutando importación...</span>}
                {importError && <span className="error">{importError}</span>}
                {importResult && !importLoading && !importError && (
                  <span className="success">Importación configurada.</span>
                )}
              </div>
            )}
          </header>

          <section className="stepper">
            {steps.map((item, index) => (
              <button
                key={item.title}
                type="button"
                className={`stepper-item ${index === step ? "active" : ""}`}
                onClick={() => setStep(index)}
              >
                <div className="stepper-index">{index + 1}</div>
                <div>
                  <div className="stepper-title">{item.title}</div>
                  <div className="stepper-description">{item.description}</div>
                </div>
              </button>
            ))}
          </section>

          {step === 0 && (
            <section className="step-section">
              <div className="section-card">
                <h2 className="section-title">1. Archivo y estructura</h2>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Archivo</label>
                    <input
                      type="file"
                      accept=".csv,.tsv,.json,.xlsx"
                      onChange={(event) => {
                        const selected = event.target.files?.[0] || null;
                        setFile(selected);
                      }}
                    />
                    <span className="helper-text">
                      {file ? `Archivo seleccionado: ${file.name}` : "Sube CSV, TSV, JSON o XLSX"}
                    </span>
                    {isDetectingColumns && (
                      <span className="helper-text">Detectando columnas automáticamente...</span>
                    )}
                    {detectError && (
                      <span className="helper-text error">{detectError}</span>
                    )}
                    {detectedColumns.length > 0 && !isDetectingColumns && !detectError && (
                      <div className="columns-preview">
                        {detectedColumns.map((column) => (
                          <span key={column} className="column-pill">
                            {column}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="form-group">
                    <label>Formato</label>
                    <select value={format} onChange={(event) => setFormat(event.target.value)}>
                      <option value="csv">CSV</option>
                      <option value="tsv">TSV</option>
                      <option value="json">JSON</option>
                      <option value="xlsx">XLSX</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Delimitador</label>
                    <input
                      type="text"
                      value={delimiter}
                      onChange={(event) => setDelimiter(event.target.value)}
                      placeholder="," 
                    />
                  </div>
                  <div className="form-group checkbox">
                    <label>
                      <input
                        type="checkbox"
                        checked={hasHeader}
                        onChange={(event) => setHasHeader(event.target.checked)}
                      />
                      Contiene encabezados
                    </label>
                  </div>
                  <div className="form-group">
                    <label>Codificación</label>
                    <select value={encoding} onChange={(event) => setEncoding(event.target.value)}>
                      <option value="utf-8">UTF-8</option>
                      <option value="latin-1">Latin-1</option>
                      <option value="utf-16">UTF-16</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Formato de fecha</label>
                    <input
                      type="text"
                      value={dateFormat}
                      onChange={(event) => setDateFormat(event.target.value)}
                      placeholder="YYYY-MM-DD"
                    />
                  </div>
                </div>
              </div>

              <div className="section-card">
                <div className="section-header">
                  <h3 className="section-title">Campos de lectura</h3>
                  <button type="button" className="btn btn-secondary" onClick={addField}>
                    + Añadir campo
                  </button>
                </div>

                <div className="fields-table">
                  <div className="fields-header">
                    <span>Campo</span>
                    <span>Columna / Ruta</span>
                    <span>Tipo</span>
                    <span>Requerido</span>
                    <span></span>
                  </div>
                  {fields.map((field) => (
                    <div key={field.id} className="fields-row">
                      <input
                        type="text"
                        value={field.name}
                        placeholder="nombre_campo"
                        onChange={(event) => updateField(field.id, { name: event.target.value })}
                      />
                      <input
                        type="text"
                        value={field.source}
                        placeholder="Columna A / $.items[*].name"
                        onChange={(event) => updateField(field.id, { source: event.target.value })}
                      />
                      <select
                        value={field.type}
                        onChange={(event) => updateField(field.id, { type: event.target.value })}
                      >
                        <option value="text">Texto</option>
                        <option value="number">Número</option>
                        <option value="date">Fecha</option>
                        <option value="boolean">Booleano</option>
                        <option value="entity">Entidad</option>
                      </select>
                      <label className="toggle">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(event) => updateField(field.id, { required: event.target.checked })}
                        />
                        <span></span>
                      </label>
                      <button type="button" className="btn-icon" onClick={() => removeField(field.id)}>
                        <span className="icon-trash"></span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {step === 1 && (
            <section className="step-section">
              <div className="section-card">
                <h2 className="section-title">2. Búsqueda de entidad</h2>
                <p className="section-subtitle">
                  Define cómo identificar entidades existentes usando campos del archivo o campos calculados.
                </p>

                <div className="conditions-header">
                  <h3>Condiciones de búsqueda</h3>
                  <button type="button" className="btn btn-secondary" onClick={addMatchRule}>
                    + Añadir condición
                  </button>
                </div>

                <div className="form-grid">
                  <div className="form-group full">
                    <label>Búsqueda convencional</label>
                    <input
                      type="text"
                      value={basicSearchText}
                      onChange={(event) => setBasicSearchText(event.target.value)}
                      placeholder="Buscar por label, aliases o descripción"
                    />
                  </div>
                  <div className="form-group full">
                    <label>Campos a incluir</label>
                    <div className="checkbox-group">
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={basicSearchFields.label}
                          onChange={(event) =>
                            setBasicSearchFields((prev) => ({
                              ...prev,
                              label: event.target.checked,
                            }))
                          }
                        />
                        Label
                      </label>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={basicSearchFields.aliases}
                          onChange={(event) =>
                            setBasicSearchFields((prev) => ({
                              ...prev,
                              aliases: event.target.checked,
                            }))
                          }
                        />
                        Aliases
                      </label>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={basicSearchFields.description}
                          onChange={(event) =>
                            setBasicSearchFields((prev) => ({
                              ...prev,
                              description: event.target.checked,
                            }))
                          }
                        />
                        Description
                      </label>
                    </div>
                  </div>
                </div>

                {matchRules.length === 0 ? (
                  <div className="empty-state">Agrega condiciones para buscar coincidencias.</div>
                ) : (
                  <div className="conditions-list">
                    {matchRules.map((rule, index) => (
                      <div key={rule.id} className="condition-row">
                        {index > 0 && <span className="condition-pill">AND</span>}
                        <div className="condition-field">
                          <label>Propiedad</label>
                          <EntitySelector
                            value={rule.propertyId}
                            onChange={(value) => updateMatchRule(rule.id, { propertyId: value })}
                            placeholder="Buscar propiedad..."
                          />
                        </div>
                        <div className="condition-field">
                          <label>Valor</label>
                          <input
                            type="text"
                            value={rule.value}
                            onChange={(event) => updateMatchRule(rule.id, { value: event.target.value })}
                            placeholder="Ej: 2026 o {{campo}}"
                            disabled={!rule.propertyId}
                          />
                        </div>
                        <div className="condition-field">
                          <label>Operador</label>
                          <select
                            value={rule.matchMode || "contains"}
                            onChange={(event) => updateMatchRule(rule.id, { matchMode: event.target.value })}
                          >
                            <option value="contains">Contiene</option>
                            <option value="equal">Igual</option>
                          </select>
                        </div>
                        <button
                          type="button"
                          className="btn-remove-condition"
                          onClick={() => removeMatchRule(rule.id)}
                          title="Eliminar condición"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="form-group">
                  <label>Si no se encuentra la entidad</label>
                  <select
                    value={onMissingEntity}
                    onChange={(event) => setOnMissingEntity(event.target.value)}
                  >
                    <option value="create">Crear nueva entidad</option>
                    <option value="skip">Omitir fila</option>
                  </select>
                </div>

                {onMissingEntity === "create" && (
                  <div className="section-card light">
                    <h3 className="section-title">Nueva entidad (valores por defecto)</h3>
                    <div className="form-grid">
                      <div className="form-group">
                        <label>Label</label>
                        <input
                          type="text"
                          value={newEntityTemplate.label}
                          onChange={(event) =>
                            setNewEntityTemplate((prev) => ({
                              ...prev,
                              label: event.target.value,
                            }))
                          }
                          placeholder="{{label}}"
                        />
                      </div>
                      <div className="form-group">
                        <label>Descripción</label>
                        <textarea
                          rows={2}
                          value={newEntityTemplate.description}
                          onChange={(event) =>
                            setNewEntityTemplate((prev) => ({
                              ...prev,
                              description: event.target.value,
                            }))
                          }
                          placeholder="{{descripcion}}"
                        />
                      </div>
                      <div className="form-group full">
                        <label>Aliases</label>
                        <textarea
                          rows={3}
                          value={newEntityTemplate.aliases}
                          onChange={(event) =>
                            setNewEntityTemplate((prev) => ({
                              ...prev,
                              aliases: event.target.value,
                            }))
                          }
                          placeholder="{{alias_1}}\n{{alias_2}}"
                        />
                        <span className="helper-text">
                          Separar aliases por comas o nuevas líneas.
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="step-section">
              <div className="section-card">
                <h2 className="section-title">3. Reconciliación de entidades</h2>
                <p className="section-subtitle">
                  Define cómo resolver coincidencias, duplicados y casos ambiguos antes de crear claims.
                </p>

                <div className="form-grid">
                  <div className="form-group">
                    <label>Modo de reconciliación</label>
                    <select
                      value={reconciliationMode}
                      onChange={(event) => setReconciliationMode(event.target.value)}
                    >
                      <option value="manual">Manual (revisar caso por caso)</option>
                      <option value="semi">Semi-automático</option>
                      <option value="auto">Automático</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Umbral de confianza</label>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={confidenceThreshold}
                      onChange={(event) => setConfidenceThreshold(Number(event.target.value))}
                    />
                    <span className="helper-text">0 = permisivo, 1 = estricto</span>
                  </div>
                </div>

                <div className="section-card light">
                  <h3 className="section-title">Acciones automáticas</h3>
                  <div className="form-grid">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={reconciliationActions.autoMergeHigh}
                        onChange={(event) =>
                          setReconciliationActions((prev) => ({
                            ...prev,
                            autoMergeHigh: event.target.checked,
                          }))
                        }
                      />
                      Fusionar coincidencias con alta confianza
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={reconciliationActions.autoCreateNoMatch}
                        onChange={(event) =>
                          setReconciliationActions((prev) => ({
                            ...prev,
                            autoCreateNoMatch: event.target.checked,
                          }))
                        }
                      />
                      Crear entidad cuando no haya coincidencias
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={reconciliationActions.autoSkipLow}
                        onChange={(event) =>
                          setReconciliationActions((prev) => ({
                            ...prev,
                            autoSkipLow: event.target.checked,
                          }))
                        }
                      />
                      Omitir registros con baja confianza
                    </label>
                  </div>
                </div>

                {importResult?.reconciliation && (
                  <div className="section-card light reconciliation-summary">
                    <h3 className="section-title">Reconciliación configurada</h3>
                    <div className="summary-grid">
                      <div>
                        <span className="summary-label">Modo</span>
                        <span>{importResult.reconciliation.mode}</span>
                      </div>
                      <div>
                        <span className="summary-label">Umbral</span>
                        <span>{importResult.reconciliation.confidenceThreshold}</span>
                      </div>
                      <div>
                        <span className="summary-label">Acción sin match</span>
                        <span>{importResult.reconciliation.onMissingEntity}</span>
                      </div>
                      <div>
                        <span className="summary-label">Auto merge</span>
                        <span>
                          {importResult.reconciliation.actions.autoMergeHigh ? "Sí" : "No"}
                        </span>
                      </div>
                      <div>
                        <span className="summary-label">Auto crear</span>
                        <span>
                          {importResult.reconciliation.actions.autoCreateNoMatch ? "Sí" : "No"}
                        </span>
                      </div>
                      <div>
                        <span className="summary-label">Auto omitir</span>
                        <span>
                          {importResult.reconciliation.actions.autoSkipLow ? "Sí" : "No"}
                        </span>
                      </div>
                    </div>
                    <div className="summary-meta">
                      Condiciones: {importResult.reconciliation.matchRules.length} ·
                      Búsqueda básica: {importResult.reconciliation.basicSearch.text || "(vacío)"}
                    </div>
                  </div>
                )}

                {importResult && reconciliationItems.length > 0 && (
                  <div className="section-card reconciliation-decisions">
                    <div className="section-header">
                      <div>
                        <h3 className="section-title">Reconciliación de registros</h3>
                        <p className="section-subtitle">
                          Ajusta la decisión por registro antes de finalizar.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleFinalizeImport}
                        disabled={importFinalized}
                      >
                        {importFinalized ? "Importación finalizada" : "Finalizar importación"}
                      </button>
                    </div>

                    <div className="reconcile-list">
                      <div className="reconcile-header">
                        <span>Registro</span>
                        <span>Mejor coincidencia</span>
                        <span>Confianza</span>
                        <span>Decisión</span>
                      </div>
                      {reconciliationItems.map((item) => (
                        <div key={item.id} className="reconcile-row">
                          <div>
                            <strong>{item.recordLabel}</strong>
                          </div>
                          <div>{item.matchLabel || "—"}</div>
                          <div>{item.confidence.toFixed(2)}</div>
                          <div>
                            <select
                              value={reconciliationDecisions[item.id] || "review"}
                              onChange={(event) => handleDecisionChange(item.id, event.target.value)}
                              disabled={importFinalized}
                            >
                              <option value="merge">Fusionar</option>
                              <option value="create">Crear</option>
                              <option value="skip">Omitir</option>
                              <option value="review">Revisar</option>
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>

                    {importFinalized && (
                      <div className="finalize-note">
                        Se aplicaron las decisiones de reconciliación. Puedes continuar con los claims.
                      </div>
                    )}
                  </div>
                )}
                {importResult && reconciliationItems.length === 0 && (
                  <div className="section-card light reconciliation-empty">
                    <h3 className="section-title">Sin registros para reconciliar</h3>
                    <p className="section-subtitle">
                      Ejecuta la importación con datos para ver coincidencias reales.
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="step-section">
              <div className="section-card">
                <div className="section-header">
                  <div>
                    <h2 className="section-title">4. Campos calculados</h2>
                    <p className="section-subtitle">
                      Define fórmulas o scripts JS reutilizables para claims, qualifiers y references.
                    </p>
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={addComputed}>
                    + Añadir campo calculado
                  </button>
                </div>

                <div className="computed-list">
                  {computedFields.map((field) => (
                    <div key={field.id} className="computed-card">
                      <div className="form-group">
                        <label>Nombre</label>
                        <input
                          type="text"
                          value={field.name}
                          placeholder="campo_calculado"
                          onChange={(event) => updateComputed(field.id, { name: event.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label>Lenguaje</label>
                        <select
                          value={field.language}
                          onChange={(event) => updateComputed(field.id, { language: event.target.value })}
                        >
                          <option value="formula">Fórmula</option>
                          <option value="javascript">JavaScript</option>
                        </select>
                      </div>
                      <div className="form-group full">
                        <label>Expresión</label>
                        <textarea
                          rows={3}
                          value={field.expression}
                          onChange={(event) => updateComputed(field.id, { expression: event.target.value })}
                          placeholder="Ej: CONCAT({{label}}, ' - ', {{categoria}})"
                        />
                      </div>
                      <button type="button" className="btn-icon" onClick={() => removeComputed(field.id)}>
                        <span className="icon-trash"></span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="section-card">
                <div className="section-header">
                  <div>
                    <h2 className="section-title">Claims, qualifiers y referencias</h2>
                    <p className="section-subtitle">
                      Usa expresiones con campos del archivo o calculados.
                    </p>
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={addClaim}>
                    + Añadir claim
                  </button>
                </div>

                {claims.length === 0 ? (
                  <div className="empty-state">Agrega al menos un claim para continuar.</div>
                ) : (
                  <div className="claims-list">
                    {claims.map((claim) => (
                      <div key={claim.id} className="claim-card">
                        <div className="claim-header">
                          <h3>Claim</h3>
                          <button type="button" className="btn-icon" onClick={() => removeClaim(claim.id)}>
                            <span className="icon-trash"></span>
                          </button>
                        </div>
                        <div className="form-grid">
                          <div className="form-group">
                            <label>Propiedad</label>
                            <input
                              type="text"
                              value={claim.property}
                              placeholder="P123"
                              onChange={(event) => updateClaim(claim.id, { property: event.target.value })}
                            />
                          </div>
                          <div className="form-group">
                            <label>Valor</label>
                            <input
                              type="text"
                              value={claim.valueExpr}
                              placeholder="{{campo}}"
                              onChange={(event) => updateClaim(claim.id, { valueExpr: event.target.value })}
                            />
                          </div>
                        </div>

                        <div className="subsection">
                          <div className="subsection-header">
                            <h4>Qualifiers</h4>
                            <button type="button" className="btn btn-secondary" onClick={() => addQualifier(claim.id)}>
                              + Añadir qualifier
                            </button>
                          </div>
                          {claim.qualifiers.length === 0 ? (
                            <div className="empty-state">Sin qualifiers.</div>
                          ) : (
                            claim.qualifiers.map((qualifier) => (
                              <div key={qualifier.id} className="inline-row">
                                <input
                                  type="text"
                                  value={qualifier.property}
                                  placeholder="P456"
                                  onChange={(event) => updateQualifier(claim.id, qualifier.id, { property: event.target.value })}
                                />
                                <input
                                  type="text"
                                  value={qualifier.valueExpr}
                                  placeholder="{{campo}}"
                                  onChange={(event) => updateQualifier(claim.id, qualifier.id, { valueExpr: event.target.value })}
                                />
                                <button
                                  type="button"
                                  className="btn-icon"
                                  onClick={() => removeQualifier(claim.id, qualifier.id)}
                                >
                                  <span className="icon-trash"></span>
                                </button>
                              </div>
                            ))
                          )}
                        </div>

                        <div className="subsection">
                          <div className="subsection-header">
                            <h4>References</h4>
                            <button type="button" className="btn btn-secondary" onClick={() => addReference(claim.id)}>
                              + Añadir referencia
                            </button>
                          </div>
                          {claim.references.length === 0 ? (
                            <div className="empty-state">Sin referencias.</div>
                          ) : (
                            claim.references.map((reference) => (
                              <div key={reference.id} className="inline-row">
                                <input
                                  type="text"
                                  value={reference.property}
                                  placeholder="P789"
                                  onChange={(event) => updateReference(claim.id, reference.id, { property: event.target.value })}
                                />
                                <input
                                  type="text"
                                  value={reference.valueExpr}
                                  placeholder="{{campo}}"
                                  onChange={(event) => updateReference(claim.id, reference.id, { valueExpr: event.target.value })}
                                />
                                <button
                                  type="button"
                                  className="btn-icon"
                                  onClick={() => removeReference(claim.id, reference.id)}
                                >
                                  <span className="icon-trash"></span>
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="section-card">
                <div className="section-header">
                  <div>
                    <h2 className="section-title">Ejemplo de claim final</h2>
                    <p className="section-subtitle">
                      Este ejemplo usa tus expresiones para visualizar el resultado final.
                    </p>
                  </div>
                </div>

                <div className="form-grid">
                  <div className="form-group">
                    <label>Propiedad</label>
                    <input
                      type="text"
                      value={exampleClaimTemplate.property}
                      onChange={(event) =>
                        setExampleClaimTemplate((prev) => ({
                          ...prev,
                          property: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Valor</label>
                    <input
                      type="text"
                      value={exampleClaimTemplate.valueExpr}
                      onChange={(event) =>
                        setExampleClaimTemplate((prev) => ({
                          ...prev,
                          valueExpr: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="example-box">
                  <div>
                    <strong>Claim:</strong> {exampleClaimTemplate.property} → {exampleClaimTemplate.valueExpr}
                  </div>
                  <div>
                    <strong>Qualifiers:</strong>{" "}
                    {exampleClaimTemplate.qualifiers
                      .map((item) => `${item.property} → ${item.valueExpr}`)
                      .join(" · ")}
                  </div>
                  <div>
                    <strong>References:</strong>{" "}
                    {exampleClaimTemplate.references
                      .map((item) => `${item.property} → ${item.valueExpr}`)
                      .join(" · ")}
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className="step-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setStep((prev) => Math.max(prev - 1, 0))}
              disabled={step === 0}
            >
              Anterior
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setStep((prev) => Math.min(prev + 1, steps.length - 1))}
              disabled={step === steps.length - 1}
            >
              Siguiente
            </button>
          </section>

          <details className="section-card preview-card config-summary">
            <summary>
              <div className="summary-header">
                <h2 className="section-title">Resumen de configuración</h2>
                <span className="badge">Solo lectura</span>
              </div>
              <span className="summary-hint">Click para expandir</span>
            </summary>
            <pre>{configPreview}</pre>
          </details>
        </div>
      </main>

      <footer className="explorer-footer">
        <p>Graph DB Explorer</p>
      </footer>
    </div>
  );
}