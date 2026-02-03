"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Navigation, LoadingState } from "@/components";
import { useAuth } from "@/context/AuthContext";
import { searchEntities, createEntity, createClaim } from "@/lib/database";
import * as XLSX from "xlsx";

// Tipos de datos disponibles para las columnas
const DATA_TYPES = [
  { id: "string", label: "Texto" },
  { id: "number", label: "Número" },
  { id: "boolean", label: "Booleano" },
  { id: "date", label: "Fecha" },
  { id: "url", label: "URL" },
  { id: "image", label: "Imagen (URL)" },
  { id: "coordinate", label: "Coordenadas" },
  { id: "color", label: "Color" },
  { id: "json", label: "JSON" },
  { id: "entity", label: "Entidad (relación)" },
];

// Pasos del wizard de importación
const STEPS = {
  UPLOAD: 1,
  PREVIEW: 2,
  MAPPING: 3,
  RECONCILE: 4,
  IMPORT: 5,
  COMPLETE: 6,
};

export default function ImportPage() {
  const router = useRouter();
  const { user, activeTeam, canCreate, isAuthenticated, authEnabled, loading: authLoading } = useAuth();

  // Estado del wizard
  const [currentStep, setCurrentStep] = useState(STEPS.UPLOAD);
  
  // Estado de datos
  const [fileName, setFileName] = useState("");
  const [rawData, setRawData] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  
  // Configuración de mapeo
  const [columnMapping, setColumnMapping] = useState({});
  const [labelColumn, setLabelColumn] = useState("");
  const [descriptionColumn, setDescriptionColumn] = useState("");
  const [aliasesColumn, setAliasesColumn] = useState("");
  
  // Reconciliación de entidades principales
  const [reconcileResults, setReconcileResults] = useState({});
  const [reconcileProgress, setReconcileProgress] = useState(0);
  
  // Reconciliación de relaciones (columnas tipo entity)
  const [relationReconcile, setRelationReconcile] = useState({});
  const [reconcileStep, setReconcileStep] = useState("entities"); // "entities" | "relations"
  
  // Importación
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState({ created: 0, updated: 0, errors: [] });
  const [isImporting, setIsImporting] = useState(false);
  
  // UI
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && authEnabled && !isAuthenticated) {
      router.push("/");
    }
  }, [authLoading, authEnabled, isAuthenticated, router]);

  // Manejar subida de archivo
  async function handleFileUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const data = await readFile(file);
      setFileName(file.name);
      setRawData(data);
      
      if (data.length > 0) {
        const cols = Object.keys(data[0]);
        setHeaders(cols);
        setPreviewRows(data.slice(0, 10));
        
        // Inicializar mapeo de columnas
        const initialMapping = {};
        cols.forEach((col) => {
          initialMapping[col] = {
            enabled: true,
            propertyId: null,
            propertyLabel: col,
            dataType: guessDataType(data, col),
            createProperty: true,
          };
        });
        setColumnMapping(initialMapping);
        
        // Intentar detectar columnas especiales
        const labelCol = cols.find((c) => 
          /^(name|nombre|label|título|title|entity|entidad)$/i.test(c)
        );
        if (labelCol) setLabelColumn(labelCol);
        
        const descCol = cols.find((c) => 
          /^(description|descripción|desc|about|acerca)$/i.test(c)
        );
        if (descCol) setDescriptionColumn(descCol);
        
        setCurrentStep(STEPS.PREVIEW);
      }
    } catch (err) {
      setError("Error al leer el archivo: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  // Leer archivo CSV o XLSX
  async function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const data = e.target.result;
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
          resolve(jsonData);
        } catch (err) {
          reject(err);
        }
      };
      
      reader.onerror = () => reject(new Error("Error al leer el archivo"));
      reader.readAsArrayBuffer(file);
    });
  }

  // Adivinar el tipo de dato de una columna
  function guessDataType(data, column) {
    const sample = data.slice(0, 100).map((row) => row[column]).filter(Boolean);
    if (sample.length === 0) return "string";
    
    // Verificar URL
    if (sample.every((v) => /^https?:\/\//i.test(String(v)))) {
      if (sample.every((v) => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(String(v)))) {
        return "image";
      }
      return "url";
    }
    
    // Verificar número
    if (sample.every((v) => !isNaN(Number(v)) && String(v).trim() !== "")) {
      return "number";
    }
    
    // Verificar booleano
    if (sample.every((v) => /^(true|false|si|no|yes|1|0)$/i.test(String(v)))) {
      return "boolean";
    }
    
    // Verificar fecha
    if (sample.every((v) => !isNaN(Date.parse(String(v))))) {
      return "date";
    }
    
    // Verificar coordenadas
    if (sample.every((v) => /^-?\d+\.?\d*,\s*-?\d+\.?\d*$/.test(String(v)))) {
      return "coordinate";
    }
    
    // Verificar color hex
    if (sample.every((v) => /^#[0-9a-f]{3,8}$/i.test(String(v)))) {
      return "color";
    }
    
    return "string";
  }

  // Actualizar mapeo de columna
  function updateColumnMapping(column, updates) {
    setColumnMapping((prev) => ({
      ...prev,
      [column]: { ...prev[column], ...updates },
    }));
  }

  // Buscar propiedades existentes
  async function searchProperties(query) {
    if (!query || query.length < 2) return [];
    try {
      const results = await searchEntities(query, 10);
      return results.rows || [];
    } catch (err) {
      console.error("Error searching properties:", err);
      return [];
    }
  }

  // Proceso de reconciliación
  async function startReconciliation() {
    if (!labelColumn) {
      setError("Debes seleccionar una columna para el label de la entidad");
      return;
    }
    
    setCurrentStep(STEPS.RECONCILE);
    setLoading(true);
    setReconcileProgress(0);
    setReconcileStep("entities");
    
    // Fase 1: Reconciliar entidades principales
    const results = {};
    const total = rawData.length;
    
    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      const label = String(row[labelColumn] || "").trim();
      
      if (label && !results[label]) {
        try {
          const matches = await searchEntities(label, 5);
          results[label] = {
            label,
            matches: matches.rows || [],
            selectedMatch: null,
            createNew: true,
          };
          
          // Auto-seleccionar si hay coincidencia exacta (por label o alias)
          const exactMatch = (matches.rows || []).find(
            (m) => m.label?.toLowerCase() === label.toLowerCase() ||
                   m.aliases?.some(a => a.toLowerCase() === label.toLowerCase())
          );
          if (exactMatch) {
            results[label].selectedMatch = exactMatch;
            results[label].createNew = false;
          }
        } catch (err) {
          results[label] = { label, matches: [], selectedMatch: null, createNew: true };
        }
      }
      
      setReconcileProgress(Math.round(((i + 1) / total) * 100));
    }
    
    setReconcileResults(results);
    
    // Fase 2: Reconciliar columnas de tipo entity (relaciones)
    await reconcileRelationColumns();
    
    setLoading(false);
  }
  
  // Reconciliar valores de columnas tipo "entity"
  async function reconcileRelationColumns() {
    setReconcileStep("relations");
    setReconcileProgress(0);
    
    // Obtener columnas de tipo entity
    const entityColumns = Object.entries(columnMapping)
      .filter(([col, mapping]) => 
        mapping.enabled && 
        mapping.dataType === "entity" && 
        col !== labelColumn && 
        col !== descriptionColumn && 
        col !== aliasesColumn
      )
      .map(([col]) => col);
    
    if (entityColumns.length === 0) {
      return;
    }
    
    // Recopilar todos los valores únicos de las columnas entity
    const uniqueValues = new Map(); // Map<columnName, Set<value>>
    
    for (const col of entityColumns) {
      const values = new Set();
      for (const row of rawData) {
        const val = String(row[col] || "").trim();
        if (val) values.add(val);
      }
      uniqueValues.set(col, values);
    }
    
    // Reconciliar cada valor único
    const relationResults = {};
    let processed = 0;
    let totalValues = 0;
    
    for (const values of uniqueValues.values()) {
      totalValues += values.size;
    }
    
    for (const [col, values] of uniqueValues.entries()) {
      relationResults[col] = {};
      
      for (const value of values) {
        try {
          const matches = await searchEntities(value, 5);
          const matchList = matches.rows || [];
          
          // Auto-seleccionar coincidencia exacta (por label o alias)
          const exactMatch = matchList.find(
            (m) => m.label?.toLowerCase() === value.toLowerCase() ||
                   m.aliases?.some(a => a.toLowerCase() === value.toLowerCase())
          );
          
          relationResults[col][value] = {
            value,
            matches: matchList,
            selectedMatch: exactMatch || null,
            createNew: !exactMatch,
            skip: false,
          };
        } catch (err) {
          relationResults[col][value] = {
            value,
            matches: [],
            selectedMatch: null,
            createNew: true,
            skip: false,
          };
        }
        
        processed++;
        setReconcileProgress(Math.round((processed / totalValues) * 100));
      }
    }
    
    setRelationReconcile(relationResults);
  }

  // Actualizar resultado de reconciliación de entidades
  function updateReconcileResult(label, updates) {
    setReconcileResults((prev) => ({
      ...prev,
      [label]: { ...prev[label], ...updates },
    }));
  }
  
  // Actualizar resultado de reconciliación de relaciones
  function updateRelationReconcile(column, value, updates) {
    setRelationReconcile((prev) => ({
      ...prev,
      [column]: {
        ...prev[column],
        [value]: { ...prev[column]?.[value], ...updates },
      },
    }));
  }
  
  // Obtener el ID de entidad para un valor de relación
  function getRelationEntityId(column, value) {
    const info = relationReconcile[column]?.[value];
    if (!info || info.skip) return null;
    if (info.selectedMatch) return info.selectedMatch.$id;
    return null; // Si createNew es true, se creará durante la importación
  }

  // Proceso de importación
  async function startImport() {
    setCurrentStep(STEPS.IMPORT);
    setIsImporting(true);
    setImportProgress(0);
    
    const results = { created: 0, updated: 0, claims: 0, relationsCreated: 0, errors: [] };
    const total = rawData.length;
    const teamId = activeTeam?.$id || null;
    
    // Mapa para guardar entidades de relación creadas durante la importación
    const createdRelationEntities = {}; // { "column:value": entityId }
    
    // Primero crear las propiedades necesarias
    const propertyMap = {};
    for (const [column, mapping] of Object.entries(columnMapping)) {
      if (!mapping.enabled || column === labelColumn || column === descriptionColumn || column === aliasesColumn) {
        continue;
      }
      
      if (mapping.createProperty && !mapping.propertyId) {
        try {
          const property = await createEntity({
            label: mapping.propertyLabel || column,
            description: `Propiedad importada: ${column}`,
            aliases: [],
          }, teamId);
          propertyMap[column] = property.$id;
        } catch (err) {
          results.errors.push(`Error creando propiedad ${column}: ${err.message}`);
        }
      } else if (mapping.propertyId) {
        propertyMap[column] = mapping.propertyId;
      }
    }
    
    // Crear entidades de relación que deben crearse (createNew = true)
    for (const [column, values] of Object.entries(relationReconcile)) {
      for (const [value, info] of Object.entries(values)) {
        if (info.createNew && !info.skip && !info.selectedMatch) {
          try {
            const entity = await createEntity({
              label: value,
              description: null,
              aliases: [],
            }, teamId);
            createdRelationEntities[`${column}:${value}`] = entity.$id;
            results.relationsCreated++;
          } catch (err) {
            results.errors.push(`Error creando entidad de relación "${value}": ${err.message}`);
          }
        }
      }
    }
    
    // Importar cada fila
    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      const label = String(row[labelColumn] || "").trim();
      
      if (!label) {
        results.errors.push(`Fila ${i + 1}: Sin label, omitida`);
        continue;
      }
      
      try {
        let entityId;
        const reconcileInfo = reconcileResults[label];
        
        // Crear o usar entidad existente
        if (reconcileInfo?.createNew || !reconcileInfo?.selectedMatch) {
          const entityData = {
            label,
            description: descriptionColumn ? String(row[descriptionColumn] || "") : null,
            aliases: aliasesColumn 
              ? String(row[aliasesColumn] || "").split(",").map((a) => a.trim()).filter(Boolean)
              : [],
          };
          
          const entity = await createEntity(entityData, teamId);
          entityId = entity.$id;
          results.created++;
        } else {
          entityId = reconcileInfo.selectedMatch.$id;
          results.updated++;
        }
        
        // Crear claims para cada columna mapeada
        for (const [column, mapping] of Object.entries(columnMapping)) {
          if (!mapping.enabled || column === labelColumn || column === descriptionColumn || column === aliasesColumn) {
            continue;
          }
          
          const value = row[column];
          if (value === "" || value === null || value === undefined) continue;
          
          const propertyId = propertyMap[column];
          if (!propertyId) continue;
          
          try {
            let claimValue;
            
            // Para columnas tipo entity, obtener el ID de la entidad relacionada
            if (mapping.dataType === "entity") {
              const valueStr = String(value).trim();
              const relationInfo = relationReconcile[column]?.[valueStr];
              
              if (relationInfo?.skip) {
                continue; // Saltar este claim
              } else if (relationInfo?.selectedMatch) {
                claimValue = relationInfo.selectedMatch.$id;
              } else if (createdRelationEntities[`${column}:${valueStr}`]) {
                claimValue = createdRelationEntities[`${column}:${valueStr}`];
              } else {
                // No hay entidad, saltar
                continue;
              }
            } else {
              claimValue = formatValue(value, mapping.dataType);
            }
            
            const claimData = {
              subject: entityId,
              property: propertyId,
              datatype: mapping.dataType,
              value: claimValue,
            };
            
            await createClaim(claimData, teamId);
            results.claims++;
          } catch (err) {
            results.errors.push(`Fila ${i + 1}, columna ${column}: ${err.message}`);
          }
        }
      } catch (err) {
        results.errors.push(`Fila ${i + 1}: ${err.message}`);
      }
      
      setImportProgress(Math.round(((i + 1) / total) * 100));
    }
    
    setImportResults(results);
    setIsImporting(false);
    setCurrentStep(STEPS.COMPLETE);
  }

  // Formatear valor según tipo de dato
  function formatValue(value, dataType) {
    switch (dataType) {
      case "number":
        return Number(value);
      case "boolean":
        return /^(true|si|yes|1)$/i.test(String(value));
      case "date":
        return new Date(value).toISOString();
      case "coordinate":
        const parts = String(value).split(",").map((p) => parseFloat(p.trim()));
        return JSON.stringify({ lat: parts[0], lng: parts[1] });
      case "json":
        try {
          return typeof value === "string" ? value : JSON.stringify(value);
        } catch {
          return String(value);
        }
      default:
        return String(value);
    }
  }

  // Reiniciar el wizard
  function resetWizard() {
    setCurrentStep(STEPS.UPLOAD);
    setFileName("");
    setRawData([]);
    setHeaders([]);
    setPreviewRows([]);
    setColumnMapping({});
    setLabelColumn("");
    setDescriptionColumn("");
    setAliasesColumn("");
    setReconcileResults({});
    setRelationReconcile({});
    setReconcileStep("entities");
    setReconcileProgress(0);
    setImportProgress(0);
    setImportResults({ created: 0, updated: 0, relationsCreated: 0, claims: 0, errors: [] });
    setError(null);
  }

  if (authLoading) {
    return (
      <div className="explorer-layout">
        <Navigation />
        <main className="explorer-main">
          <div className="explorer-container">
            <LoadingState message="Cargando..." />
          </div>
        </main>
      </div>
    );
  }

  if (!canCreate) {
    return (
      <div className="explorer-layout">
        <Navigation />
        <main className="explorer-main">
          <div className="explorer-container">
            <div className="empty-state">
              <h2>Acceso Denegado</h2>
              <p>No tienes permisos para importar datos</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="explorer-layout">
      <Navigation />
      <main className="explorer-main">
        <div className="explorer-container import-page">
          <div className="import-header">
            <h1>Importar Datos</h1>
            <p className="import-subtitle">
              Importa datos desde archivos CSV o Excel y mapéalos a entidades y propiedades
            </p>
          </div>

          {/* Indicador de pasos */}
          <div className="steps-indicator">
            {Object.entries(STEPS).map(([name, step]) => (
              <div
                key={step}
                className={`step ${currentStep === step ? "active" : ""} ${currentStep > step ? "completed" : ""}`}
              >
                <div className="step-number">{step}</div>
                <div className="step-label">{getStepLabel(name)}</div>
              </div>
            ))}
          </div>

          {error && (
            <div className="alert alert-error">
              {error}
              <button onClick={() => setError(null)}>×</button>
            </div>
          )}

          {/* PASO 1: SUBIR ARCHIVO */}
          {currentStep === STEPS.UPLOAD && (
            <div className="import-step">
              <div className="upload-zone">
                <div className="upload-icon">📁</div>
                <h3>Subir archivo</h3>
                <p>Arrastra un archivo CSV o Excel aquí, o haz clic para seleccionar</p>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileUpload}
                  className="file-input"
                />
                <div className="file-types">
                  Formatos soportados: CSV, XLSX, XLS
                </div>
              </div>
            </div>
          )}

          {/* PASO 2: VISTA PREVIA */}
          {currentStep === STEPS.PREVIEW && (
            <div className="import-step">
              <div className="step-header">
                <h2>Vista Previa</h2>
                <p>Se encontraron <strong>{rawData.length}</strong> filas en <strong>{fileName}</strong></p>
              </div>

              <div className="preview-table-container">
                <table className="preview-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      {headers.map((header) => (
                        <th key={header}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i}>
                        <td className="row-number">{i + 1}</td>
                        {headers.map((header) => (
                          <td key={header} title={String(row[header] || "")}>
                            {truncate(String(row[header] || ""), 50)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {rawData.length > 10 && (
                <p className="preview-note">Mostrando 10 de {rawData.length} filas</p>
              )}

              <div className="step-actions">
                <button className="btn btn-secondary" onClick={resetWizard}>
                  ← Volver
                </button>
                <button className="btn btn-primary" onClick={() => setCurrentStep(STEPS.MAPPING)}>
                  Continuar al Mapeo →
                </button>
              </div>
            </div>
          )}

          {/* PASO 3: MAPEO DE COLUMNAS */}
          {currentStep === STEPS.MAPPING && (
            <div className="import-step">
              <div className="step-header">
                <h2>Mapeo de Columnas</h2>
                <p>Configura cómo se importarán los datos</p>
              </div>

              <div className="mapping-section">
                <h3>Columnas Especiales</h3>
                <p className="section-desc">Selecciona qué columnas contienen información básica de la entidad</p>
                
                <div className="special-columns">
                  <div className="form-group">
                    <label>Columna de Label (nombre) *</label>
                    <select
                      value={labelColumn}
                      onChange={(e) => setLabelColumn(e.target.value)}
                      required
                    >
                      <option value="">-- Seleccionar --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Columna de Descripción</label>
                    <select
                      value={descriptionColumn}
                      onChange={(e) => setDescriptionColumn(e.target.value)}
                    >
                      <option value="">-- Ninguna --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Columna de Alias (separados por coma)</label>
                    <select
                      value={aliasesColumn}
                      onChange={(e) => setAliasesColumn(e.target.value)}
                    >
                      <option value="">-- Ninguna --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="mapping-section">
                <h3>Mapeo de Propiedades</h3>
                <p className="section-desc">Configura cada columna como una propiedad</p>

                <div className="column-mapping-list">
                  {headers
                    .filter((h) => h !== labelColumn && h !== descriptionColumn && h !== aliasesColumn)
                    .map((column) => (
                      <ColumnMappingRow
                        key={column}
                        column={column}
                        mapping={columnMapping[column]}
                        onUpdate={(updates) => updateColumnMapping(column, updates)}
                        onSearchProperties={searchProperties}
                        sampleValues={rawData.slice(0, 3).map((r) => r[column])}
                      />
                    ))}
                </div>
              </div>

              <div className="step-actions">
                <button className="btn btn-secondary" onClick={() => setCurrentStep(STEPS.PREVIEW)}>
                  ← Volver
                </button>
                <button 
                  className="btn btn-primary" 
                  onClick={startReconciliation}
                  disabled={!labelColumn}
                >
                  Continuar a Reconciliación →
                </button>
              </div>
            </div>
          )}

          {/* PASO 4: RECONCILIACIÓN */}
          {currentStep === STEPS.RECONCILE && (
            <div className="import-step">
              <div className="step-header">
                <h2>Reconciliación de Entidades</h2>
                <p>Verifica si las entidades ya existen en la base de datos</p>
              </div>

              {loading ? (
                <div className="progress-container">
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${reconcileProgress}%` }}></div>
                  </div>
                  <p>Buscando coincidencias... {reconcileProgress}%</p>
                </div>
              ) : (
                <>
                  {/* Tabs para cambiar entre entidades y relaciones */}
                  {Object.keys(relationReconcile).length > 0 && (
                    <div className="reconcile-tabs">
                      <button
                        className={`reconcile-tab ${reconcileStep === "entities" ? "active" : ""}`}
                        onClick={() => setReconcileStep("entities")}
                      >
                        Entidades Principales ({Object.keys(reconcileResults).length})
                      </button>
                      <button
                        className={`reconcile-tab ${reconcileStep === "relations" ? "active" : ""}`}
                        onClick={() => setReconcileStep("relations")}
                      >
                        Relaciones ({Object.values(relationReconcile).reduce((acc, col) => acc + Object.keys(col).length, 0)})
                      </button>
                    </div>
                  )}

                  {/* Sección de entidades principales */}
                  {reconcileStep === "entities" && (
                    <>
                      <div className="reconcile-stats">
                        <div className="stat">
                          <span className="stat-value">
                            {Object.values(reconcileResults).filter((r) => r.createNew).length}
                          </span>
                          <span className="stat-label">Nuevas entidades</span>
                        </div>
                        <div className="stat">
                          <span className="stat-value">
                            {Object.values(reconcileResults).filter((r) => !r.createNew && r.selectedMatch).length}
                          </span>
                          <span className="stat-label">Coincidencias encontradas</span>
                        </div>
                      </div>

                      <div className="reconcile-list">
                        {Object.entries(reconcileResults).map(([label, result]) => (
                          <ReconcileRow
                            key={label}
                            result={result}
                            onUpdate={(updates) => updateReconcileResult(label, updates)}
                          />
                        ))}
                      </div>
                    </>
                  )}

                  {/* Sección de reconciliación de relaciones */}
                  {reconcileStep === "relations" && (
                    <>
                      <div className="reconcile-stats">
                        <div className="stat">
                          <span className="stat-value">
                            {Object.values(relationReconcile).reduce(
                              (acc, col) => acc + Object.values(col).filter((r) => r.createNew).length,
                              0
                            )}
                          </span>
                          <span className="stat-label">Nuevas entidades</span>
                        </div>
                        <div className="stat">
                          <span className="stat-value">
                            {Object.values(relationReconcile).reduce(
                              (acc, col) => acc + Object.values(col).filter((r) => r.selectedMatch).length,
                              0
                            )}
                          </span>
                          <span className="stat-label">Coincidencias</span>
                        </div>
                        <div className="stat">
                          <span className="stat-value">
                            {Object.values(relationReconcile).reduce(
                              (acc, col) => acc + Object.values(col).filter((r) => r.skip).length,
                              0
                            )}
                          </span>
                          <span className="stat-label">Omitidas</span>
                        </div>
                      </div>

                      <div className="relation-reconcile-sections">
                        {Object.entries(relationReconcile).map(([column, values]) => (
                          <div key={column} className="relation-column-section">
                            <h3 className="relation-column-title">
                              Columna: <strong>{column}</strong>
                              <span className="relation-column-count">
                                ({Object.keys(values).length} valores únicos)
                              </span>
                            </h3>
                            <div className="reconcile-list">
                              {Object.entries(values).map(([value, info]) => (
                                <div key={value} className="reconcile-row relation-reconcile-row">
                                  <div className="reconcile-label">
                                    <span className="label-text">{value}</span>
                                    <span className="occurrences">
                                      {rawData.filter(row => String(row[column]).trim() === value).length} ocurrencias
                                    </span>
                                  </div>
                                  
                                  <div className="reconcile-actions">
                                    {info.matches && info.matches.length > 0 ? (
                                      <select
                                        className="match-select"
                                        value={info.skip ? "skip" : (info.createNew ? "new" : (info.selectedMatch?.$id || ""))}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          if (val === "skip") {
                                            updateRelationReconcile(column, value, { skip: true, createNew: false, selectedMatch: null });
                                          } else if (val === "new") {
                                            updateRelationReconcile(column, value, { createNew: true, skip: false, selectedMatch: null });
                                          } else {
                                            const match = info.matches.find((m) => m.$id === val);
                                            updateRelationReconcile(column, value, { selectedMatch: match, createNew: false, skip: false });
                                          }
                                        }}
                                      >
                                        {info.matches.map((match) => (
                                          <option key={match.$id} value={match.$id}>
                                            {match.label}
                                            {match.aliases?.length > 0 && ` (alias: ${match.aliases.slice(0, 2).join(", ")})`}
                                          </option>
                                        ))}
                                        <option value="new">✚ Crear nueva entidad</option>
                                        <option value="skip">⊘ Omitir</option>
                                      </select>
                                    ) : (
                                      <div className="no-match-actions">
                                        <label className="radio-option">
                                          <input
                                            type="radio"
                                            checked={info.createNew && !info.skip}
                                            onChange={() => updateRelationReconcile(column, value, { createNew: true, skip: false })}
                                          />
                                          <span>Crear nueva</span>
                                        </label>
                                        <label className="radio-option">
                                          <input
                                            type="radio"
                                            checked={info.skip}
                                            onChange={() => updateRelationReconcile(column, value, { skip: true, createNew: false })}
                                          />
                                          <span>Omitir</span>
                                        </label>
                                      </div>
                                    )}
                                    
                                    {info.selectedMatch && (
                                      <span className="match-badge">✓ {info.selectedMatch.label}</span>
                                    )}
                                    {info.createNew && !info.skip && (
                                      <span className="create-badge">✚ Nueva</span>
                                    )}
                                    {info.skip && (
                                      <span className="skip-badge">⊘ Omitir</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <div className="step-actions">
                    <button className="btn btn-secondary" onClick={() => setCurrentStep(STEPS.MAPPING)}>
                      ← Volver
                    </button>
                    <button className="btn btn-primary" onClick={startImport}>
                      Iniciar Importación →
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* PASO 5: IMPORTACIÓN */}
          {currentStep === STEPS.IMPORT && (
            <div className="import-step">
              <div className="step-header">
                <h2>Importando Datos</h2>
                <p>Por favor espera mientras se importan los datos</p>
              </div>

              <div className="progress-container">
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${importProgress}%` }}></div>
                </div>
                <p>Importando... {importProgress}%</p>
              </div>
            </div>
          )}

          {/* PASO 6: COMPLETADO */}
          {currentStep === STEPS.COMPLETE && (
            <div className="import-step">
              <div className="step-header complete-header">
                <div className="complete-icon">✓</div>
                <h2>¡Importación Completada!</h2>
              </div>

              <div className="import-summary">
                <div className="summary-stat">
                  <span className="stat-value success">{importResults.created}</span>
                  <span className="stat-label">Entidades creadas</span>
                </div>
                <div className="summary-stat">
                  <span className="stat-value info">{importResults.updated}</span>
                  <span className="stat-label">Entidades actualizadas</span>
                </div>
                {importResults.relationsCreated > 0 && (
                  <div className="summary-stat">
                    <span className="stat-value info">{importResults.relationsCreated}</span>
                    <span className="stat-label">Relaciones creadas</span>
                  </div>
                )}
                <div className="summary-stat">
                  <span className="stat-value">{importResults.claims}</span>
                  <span className="stat-label">Claims creados</span>
                </div>
                {importResults.errors.length > 0 && (
                  <div className="summary-stat">
                    <span className="stat-value error">{importResults.errors.length}</span>
                    <span className="stat-label">Errores</span>
                  </div>
                )}
              </div>

              {importResults.errors.length > 0 && (
                <div className="errors-section">
                  <h3>Errores durante la importación</h3>
                  <div className="errors-list">
                    {importResults.errors.slice(0, 20).map((err, i) => (
                      <div key={i} className="error-item">{err}</div>
                    ))}
                    {importResults.errors.length > 20 && (
                      <p className="more-errors">
                        Y {importResults.errors.length - 20} errores más...
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="step-actions">
                <button className="btn btn-secondary" onClick={resetWizard}>
                  Importar otro archivo
                </button>
                <button className="btn btn-primary" onClick={() => router.push("/entities")}>
                  Ver Entidades →
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      <style jsx>{`
        .import-page {
          max-width: 1200px;
        }

        .import-header {
          margin-bottom: 2rem;
        }

        .import-header h1 {
          margin: 0 0 0.5rem 0;
          font-size: 2rem;
          color: var(--color-text, #202122);
        }

        .import-subtitle {
          color: var(--color-text-secondary, #54595d);
          margin: 0;
        }

        .steps-indicator {
          display: flex;
          justify-content: space-between;
          margin-bottom: 2rem;
          padding: 1rem 0;
          border-bottom: 1px solid var(--color-border-light, #c8ccd1);
        }

        .step {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex: 1;
          position: relative;
        }

        .step::after {
          content: "";
          position: absolute;
          top: 15px;
          left: 50%;
          width: 100%;
          height: 2px;
          background: var(--color-border-light, #c8ccd1);
          z-index: 0;
        }

        .step:last-child::after {
          display: none;
        }

        .step-number {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--color-bg-alt, #eaecf0);
          color: var(--color-text-secondary, #54595d);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 0.875rem;
          position: relative;
          z-index: 1;
        }

        .step.active .step-number {
          background: var(--color-primary, #0645ad);
          color: white;
        }

        .step.completed .step-number {
          background: var(--color-success, #14866d);
          color: white;
        }

        .step-label {
          font-size: 0.75rem;
          color: var(--color-text-muted, #72777d);
          margin-top: 0.5rem;
          text-align: center;
        }

        .step.active .step-label {
          color: var(--color-primary, #0645ad);
          font-weight: 600;
        }

        .import-step {
          background: var(--color-bg-card, #ffffff);
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-lg, 8px);
          padding: 2rem;
        }

        .step-header {
          margin-bottom: 1.5rem;
        }

        .step-header h2 {
          margin: 0 0 0.5rem 0;
          color: var(--color-text, #202122);
        }

        .step-header p {
          margin: 0;
          color: var(--color-text-secondary, #54595d);
        }

        .upload-zone {
          border: 2px dashed var(--color-border, #a2a9b1);
          border-radius: var(--radius-lg, 8px);
          padding: 3rem;
          text-align: center;
          position: relative;
          cursor: pointer;
          transition: all 0.2s;
        }

        .upload-zone:hover {
          border-color: var(--color-primary, #0645ad);
          background: rgba(6, 69, 173, 0.02);
        }

        .upload-icon {
          font-size: 3rem;
          margin-bottom: 1rem;
        }

        .upload-zone h3 {
          margin: 0 0 0.5rem 0;
          color: var(--color-text, #202122);
        }

        .upload-zone p {
          margin: 0 0 1rem 0;
          color: var(--color-text-secondary, #54595d);
        }

        .file-input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
        }

        .file-types {
          font-size: 0.875rem;
          color: var(--color-text-muted, #72777d);
        }

        .preview-table-container {
          overflow-x: auto;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-md, 4px);
          margin-bottom: 1rem;
        }

        .preview-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.875rem;
        }

        .preview-table th,
        .preview-table td {
          padding: 0.75rem;
          text-align: left;
          border-bottom: 1px solid var(--color-border-light, #c8ccd1);
          white-space: nowrap;
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .preview-table th {
          background: var(--color-bg-alt, #eaecf0);
          font-weight: 600;
          position: sticky;
          top: 0;
        }

        .preview-table .row-number {
          color: var(--color-text-muted, #72777d);
          font-size: 0.75rem;
          width: 40px;
        }

        .preview-note {
          text-align: center;
          color: var(--color-text-muted, #72777d);
          font-size: 0.875rem;
        }

        .mapping-section {
          margin-bottom: 2rem;
        }

        .mapping-section h3 {
          margin: 0 0 0.25rem 0;
          color: var(--color-text, #202122);
        }

        .section-desc {
          margin: 0 0 1rem 0;
          color: var(--color-text-secondary, #54595d);
          font-size: 0.875rem;
        }

        .special-columns {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 1rem;
          background: var(--color-bg, #f8f9fa);
          padding: 1rem;
          border-radius: var(--radius-md, 4px);
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .form-group label {
          font-weight: 600;
          font-size: 0.875rem;
          color: var(--color-text, #202122);
        }

        .form-group select,
        .form-group input {
          padding: 0.625rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-md, 4px);
          font-size: 0.875rem;
          background: var(--color-bg-card, #ffffff);
        }

        .column-mapping-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .progress-container {
          text-align: center;
          padding: 2rem;
        }

        .progress-bar {
          height: 8px;
          background: var(--color-bg-alt, #eaecf0);
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 1rem;
        }

        .progress-fill {
          height: 100%;
          background: var(--color-primary, #0645ad);
          transition: width 0.3s ease;
        }

        .reconcile-stats {
          display: flex;
          gap: 2rem;
          justify-content: center;
          margin-bottom: 2rem;
        }

        .stat {
          text-align: center;
        }

        .stat-value {
          display: block;
          font-size: 2rem;
          font-weight: 700;
          color: var(--color-text, #202122);
        }

        .stat-label {
          font-size: 0.875rem;
          color: var(--color-text-secondary, #54595d);
        }

        .reconcile-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          max-height: 400px;
          overflow-y: auto;
          margin-bottom: 1.5rem;
        }

        /* Tabs de reconciliación */
        .reconcile-tabs {
          display: flex;
          gap: 0;
          margin-bottom: 1.5rem;
          border-bottom: 2px solid var(--color-border-light, #c8ccd1);
        }

        .reconcile-tab {
          padding: 0.75rem 1.5rem;
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          margin-bottom: -2px;
          cursor: pointer;
          font-size: 0.9375rem;
          color: var(--color-text-secondary, #54595d);
          transition: all 0.2s;
        }

        .reconcile-tab:hover {
          color: var(--color-text, #202122);
          background: var(--color-bg-alt, #eaecf0);
        }

        .reconcile-tab.active {
          color: var(--color-primary, #0645ad);
          border-bottom-color: var(--color-primary, #0645ad);
          font-weight: 600;
        }

        /* Secciones de relaciones */
        .relation-reconcile-sections {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .relation-column-section {
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-md, 4px);
          overflow: hidden;
        }

        .relation-column-title {
          margin: 0;
          padding: 0.75rem 1rem;
          background: var(--color-bg-alt, #eaecf0);
          font-size: 0.9375rem;
          font-weight: 500;
          border-bottom: 1px solid var(--color-border-light, #c8ccd1);
        }

        .relation-column-count {
          font-weight: normal;
          color: var(--color-text-muted, #72777d);
          margin-left: 0.5rem;
        }

        .relation-column-section .reconcile-list {
          margin: 0;
          padding: 0.5rem;
          max-height: 300px;
        }

        /* Filas de reconciliación de relaciones */
        .relation-reconcile-row {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 0.75rem 1rem;
          background: var(--color-bg-card, #ffffff);
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
        }

        .relation-reconcile-row .reconcile-label {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .relation-reconcile-row .label-text {
          font-weight: 500;
          color: var(--color-text, #202122);
        }

        .relation-reconcile-row .occurrences {
          font-size: 0.75rem;
          color: var(--color-text-muted, #72777d);
        }

        .reconcile-actions {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .match-select {
          padding: 0.375rem 0.75rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
          background: var(--color-bg-card, #ffffff);
          font-size: 0.875rem;
          min-width: 200px;
          max-width: 300px;
        }

        .no-match-actions {
          display: flex;
          gap: 1rem;
        }

        .radio-option {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          cursor: pointer;
          font-size: 0.875rem;
          color: var(--color-text-secondary, #54595d);
        }

        .radio-option input {
          margin: 0;
        }

        .match-badge,
        .create-badge,
        .skip-badge {
          padding: 0.25rem 0.5rem;
          border-radius: var(--radius-sm, 2px);
          font-size: 0.75rem;
          font-weight: 600;
          white-space: nowrap;
        }

        .match-badge {
          background: rgba(6, 69, 173, 0.1);
          color: var(--color-primary, #0645ad);
        }

        .create-badge {
          background: var(--color-success, #14866d);
          color: white;
        }

        .skip-badge {
          background: var(--color-bg-alt, #eaecf0);
          color: var(--color-text-muted, #72777d);
        }

        .complete-header {
          text-align: center;
        }

        .complete-icon {
          width: 64px;
          height: 64px;
          background: var(--color-success, #14866d);
          color: white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 2rem;
          margin: 0 auto 1rem;
        }

        .import-summary {
          display: flex;
          gap: 2rem;
          justify-content: center;
          margin: 2rem 0;
          flex-wrap: wrap;
        }

        .summary-stat {
          text-align: center;
          padding: 1rem 2rem;
          background: var(--color-bg, #f8f9fa);
          border-radius: var(--radius-md, 4px);
        }

        .summary-stat .stat-value {
          font-size: 2.5rem;
        }

        .summary-stat .stat-value.success {
          color: var(--color-success, #14866d);
        }

        .summary-stat .stat-value.info {
          color: var(--color-primary, #0645ad);
        }

        .summary-stat .stat-value.error {
          color: var(--color-error, #d33);
        }

        .errors-section {
          margin-top: 2rem;
          padding: 1rem;
          background: rgba(211, 51, 51, 0.05);
          border: 1px solid var(--color-error, #d33);
          border-radius: var(--radius-md, 4px);
        }

        .errors-section h3 {
          margin: 0 0 1rem 0;
          color: var(--color-error, #d33);
        }

        .errors-list {
          max-height: 200px;
          overflow-y: auto;
        }

        .error-item {
          padding: 0.5rem;
          font-size: 0.875rem;
          color: var(--color-error, #d33);
          border-bottom: 1px solid rgba(211, 51, 51, 0.1);
        }

        .more-errors {
          margin: 0.5rem 0 0;
          font-size: 0.875rem;
          color: var(--color-text-muted, #72777d);
        }

        .step-actions {
          display: flex;
          justify-content: space-between;
          margin-top: 2rem;
          padding-top: 1.5rem;
          border-top: 1px solid var(--color-border-light, #c8ccd1);
        }

        .alert {
          padding: 1rem;
          border-radius: var(--radius-md, 4px);
          margin-bottom: 1rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .alert-error {
          background: rgba(211, 51, 51, 0.1);
          color: var(--color-error, #d33);
          border: 1px solid var(--color-error, #d33);
        }

        .alert button {
          background: none;
          border: none;
          font-size: 1.25rem;
          cursor: pointer;
          color: inherit;
        }

        .btn {
          padding: 0.625rem 1.25rem;
          border: none;
          border-radius: var(--radius-md, 4px);
          cursor: pointer;
          font-weight: 600;
          font-size: 0.875rem;
          transition: all 0.2s;
        }

        .btn-primary {
          background: var(--color-primary, #0645ad);
          color: white;
        }

        .btn-primary:hover {
          background: var(--color-primary-hover, #0b0080);
        }

        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-secondary {
          background: var(--color-bg-card, #ffffff);
          border: 1px solid var(--color-border, #a2a9b1);
          color: var(--color-text, #202122);
        }

        .btn-secondary:hover {
          background: var(--color-bg-alt, #eaecf0);
        }

        @media (max-width: 768px) {
          .steps-indicator {
            flex-wrap: wrap;
            gap: 1rem;
          }

          .step::after {
            display: none;
          }

          .special-columns {
            grid-template-columns: 1fr;
          }

          .import-summary {
            flex-direction: column;
            align-items: center;
          }
        }
      `}</style>
    </div>
  );
}

// Componente para fila de mapeo de columna
function ColumnMappingRow({ column, mapping, onUpdate, onSearchProperties, sampleValues }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);

  async function handleSearch(query) {
    setSearchQuery(query);
    if (query.length >= 2) {
      const results = await onSearchProperties(query);
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
  }

  function selectProperty(property) {
    onUpdate({
      propertyId: property.$id,
      propertyLabel: property.label,
      createProperty: false,
    });
    setShowSearch(false);
    setSearchQuery("");
  }

  return (
    <div className="column-mapping-row">
      <div className="column-toggle">
        <input
          type="checkbox"
          checked={mapping?.enabled !== false}
          onChange={(e) => onUpdate({ enabled: e.target.checked })}
        />
      </div>
      
      <div className="column-info">
        <span className="column-name">{column}</span>
        <span className="column-samples">
          {sampleValues.filter(Boolean).slice(0, 2).map((v, i) => (
            <span key={i} className="sample-value">{truncate(String(v), 20)}</span>
          ))}
        </span>
      </div>
      
      <div className="column-property">
        {mapping?.createProperty ? (
          <div className="property-new">
            <input
              type="text"
              value={mapping?.propertyLabel || column}
              onChange={(e) => onUpdate({ propertyLabel: e.target.value })}
              placeholder="Nombre de la propiedad"
            />
            <button 
              className="link-btn"
              onClick={() => setShowSearch(true)}
              title="Buscar propiedad existente"
            >
              🔗
            </button>
          </div>
        ) : (
          <div className="property-selected">
            <span className="property-label">{mapping?.propertyLabel}</span>
            <button 
              className="unlink-btn"
              onClick={() => onUpdate({ propertyId: null, createProperty: true })}
              title="Desvincular"
            >
              ✕
            </button>
          </div>
        )}
        
        {showSearch && (
          <div className="property-search-dropdown">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Buscar propiedad..."
              autoFocus
            />
            <div className="search-results">
              {searchResults.map((p) => (
                <button key={p.$id} onClick={() => selectProperty(p)}>
                  {p.label}
                </button>
              ))}
              {searchQuery.length >= 2 && searchResults.length === 0 && (
                <p className="no-results">No se encontraron propiedades</p>
              )}
            </div>
            <button className="close-search" onClick={() => setShowSearch(false)}>
              Cancelar
            </button>
          </div>
        )}
      </div>
      
      <div className="column-datatype">
        <select
          value={mapping?.dataType || "string"}
          onChange={(e) => onUpdate({ dataType: e.target.value })}
          disabled={!mapping?.enabled}
        >
          {DATA_TYPES.map((dt) => (
            <option key={dt.id} value={dt.id}>{dt.label}</option>
          ))}
        </select>
      </div>

      <style jsx>{`
        .column-mapping-row {
          display: grid;
          grid-template-columns: 40px 1fr 1fr 150px;
          gap: 1rem;
          align-items: center;
          padding: 0.75rem;
          background: var(--color-bg, #f8f9fa);
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-md, 4px);
        }

        .column-toggle input {
          width: 18px;
          height: 18px;
          cursor: pointer;
        }

        .column-info {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .column-name {
          font-weight: 600;
          color: var(--color-text, #202122);
        }

        .column-samples {
          display: flex;
          gap: 0.5rem;
        }

        .sample-value {
          font-size: 0.75rem;
          padding: 0.125rem 0.375rem;
          background: var(--color-bg-card, #ffffff);
          border-radius: var(--radius-sm, 2px);
          color: var(--color-text-muted, #72777d);
        }

        .column-property {
          position: relative;
        }

        .property-new {
          display: flex;
          gap: 0.5rem;
        }

        .property-new input {
          flex: 1;
          padding: 0.5rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
          font-size: 0.875rem;
        }

        .link-btn, .unlink-btn {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 1rem;
          padding: 0.5rem;
        }

        .property-selected {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem;
          background: rgba(6, 69, 173, 0.1);
          border-radius: var(--radius-sm, 2px);
        }

        .property-label {
          flex: 1;
          font-weight: 500;
          color: var(--color-primary, #0645ad);
        }

        .property-search-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: var(--color-bg-card, #ffffff);
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-md, 4px);
          box-shadow: var(--shadow-lg, 0 4px 16px rgba(0,0,0,0.15));
          z-index: 100;
          padding: 0.5rem;
        }

        .property-search-dropdown input {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
          margin-bottom: 0.5rem;
        }

        .search-results {
          max-height: 150px;
          overflow-y: auto;
        }

        .search-results button {
          display: block;
          width: 100%;
          text-align: left;
          padding: 0.5rem;
          border: none;
          background: none;
          cursor: pointer;
          border-radius: var(--radius-sm, 2px);
        }

        .search-results button:hover {
          background: var(--color-bg-alt, #eaecf0);
        }

        .no-results {
          font-size: 0.875rem;
          color: var(--color-text-muted, #72777d);
          text-align: center;
          padding: 0.5rem;
        }

        .close-search {
          width: 100%;
          padding: 0.5rem;
          margin-top: 0.5rem;
          background: none;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
          cursor: pointer;
          font-size: 0.875rem;
        }

        .column-datatype select {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
          font-size: 0.875rem;
          background: var(--color-bg-card, #ffffff);
        }

        @media (max-width: 768px) {
          .column-mapping-row {
            grid-template-columns: 1fr;
            gap: 0.5rem;
          }
        }
      `}</style>
    </div>
  );
}

// Componente para fila de reconciliación
function ReconcileRow({ result, onUpdate }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="reconcile-row">
      <div className="reconcile-main" onClick={() => setExpanded(!expanded)}>
        <span className="reconcile-label">{result.label}</span>
        <div className="reconcile-status">
          {result.createNew ? (
            <span className="status-badge new">Nueva</span>
          ) : result.selectedMatch ? (
            <span className="status-badge matched">
              → {result.selectedMatch.label}
            </span>
          ) : (
            <span className="status-badge pending">Pendiente</span>
          )}
        </div>
        <button className="expand-btn">{expanded ? "▲" : "▼"}</button>
      </div>
      
      {expanded && result.matches.length > 0 && (
        <div className="reconcile-options">
          <div className="option-header">Coincidencias encontradas:</div>
          {result.matches.map((match) => (
            <label key={match.$id} className="match-option">
              <input
                type="radio"
                name={`reconcile-${result.label}`}
                checked={result.selectedMatch?.$id === match.$id}
                onChange={() => onUpdate({ selectedMatch: match, createNew: false })}
              />
              <span className="match-label">{match.label}</span>
              {match.description && (
                <span className="match-desc">{truncate(match.description, 60)}</span>
              )}
            </label>
          ))}
          <label className="match-option create-new">
            <input
              type="radio"
              name={`reconcile-${result.label}`}
              checked={result.createNew}
              onChange={() => onUpdate({ selectedMatch: null, createNew: true })}
            />
            <span className="match-label">Crear nueva entidad</span>
          </label>
        </div>
      )}

      <style jsx>{`
        .reconcile-row {
          background: var(--color-bg, #f8f9fa);
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-md, 4px);
          overflow: hidden;
        }

        .reconcile-main {
          display: flex;
          align-items: center;
          padding: 0.75rem 1rem;
          cursor: pointer;
          gap: 1rem;
        }

        .reconcile-main:hover {
          background: var(--color-bg-alt, #eaecf0);
        }

        .reconcile-label {
          flex: 1;
          font-weight: 500;
          color: var(--color-text, #202122);
        }

        .reconcile-status {
          flex: 1;
        }

        .status-badge {
          padding: 0.25rem 0.5rem;
          border-radius: var(--radius-sm, 2px);
          font-size: 0.75rem;
          font-weight: 600;
        }

        .status-badge.new {
          background: var(--color-success, #14866d);
          color: white;
        }

        .status-badge.matched {
          background: rgba(6, 69, 173, 0.1);
          color: var(--color-primary, #0645ad);
        }

        .status-badge.pending {
          background: var(--color-warning, #fc3);
          color: #333;
        }

        .expand-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--color-text-muted, #72777d);
          font-size: 0.75rem;
        }

        .reconcile-options {
          padding: 1rem;
          border-top: 1px solid var(--color-border-light, #c8ccd1);
          background: var(--color-bg-card, #ffffff);
        }

        .option-header {
          font-size: 0.75rem;
          color: var(--color-text-muted, #72777d);
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          font-weight: 600;
        }

        .match-option {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          padding: 0.5rem;
          cursor: pointer;
          border-radius: var(--radius-sm, 2px);
        }

        .match-option:hover {
          background: var(--color-bg, #f8f9fa);
        }

        .match-option input {
          margin-top: 0.125rem;
        }

        .match-label {
          font-weight: 500;
          color: var(--color-text, #202122);
        }

        .match-desc {
          font-size: 0.875rem;
          color: var(--color-text-secondary, #54595d);
          display: block;
        }

        .match-option.create-new {
          border-top: 1px solid var(--color-border-light, #c8ccd1);
          margin-top: 0.5rem;
          padding-top: 0.75rem;
        }
      `}</style>
    </div>
  );
}

// Helpers
function truncate(str, length) {
  if (!str) return "";
  return str.length > length ? str.substring(0, length) + "..." : str;
}

function getStepLabel(name) {
  const labels = {
    UPLOAD: "Subir",
    PREVIEW: "Vista Previa",
    MAPPING: "Mapeo",
    RECONCILE: "Reconciliar",
    IMPORT: "Importar",
    COMPLETE: "Completado",
  };
  return labels[name] || name;
}
