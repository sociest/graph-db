"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Navigation, LoadingState } from "@/components";
import { useAuth } from "@/context/AuthContext";
import * as database from "@/lib/database";
import { searchEntities, createEntity, createClaim, createQualifier, createReference, uploadGeoJSON, uploadJSON, BUCKETS } from "@/lib/database";
import { registry } from "@/plugins";
import * as XLSX from "xlsx";

// Configuración de rate limit y batching
const BATCH_SIZE = 10; // Número de operaciones por lote
const BATCH_DELAY = 100; // ms entre lotes
const RATE_LIMIT_RETRY_DELAY = 1000; // 1 segundo de espera si hay rate limit
const MAX_RETRIES = 3; // Máximo de reintentos por operación

/**
 * Ejecuta una función con reintentos en caso de rate limit
 */
async function withRetry(fn, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRateLimit = 
        error?.code === 429 || 
        error?.message?.toLowerCase().includes("rate limit") ||
        error?.message?.toLowerCase().includes("too many requests");
      
      if (isRateLimit && attempt < retries) {
        console.warn(`Rate limit alcanzado, esperando ${RATE_LIMIT_RETRY_DELAY / 1000}s (intento ${attempt}/${retries})...`);
        await sleep(RATE_LIMIT_RETRY_DELAY);
        continue;
      }
      throw error;
    }
  }
}

/**
 * Espera un tiempo determinado
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Procesa un array en lotes con delay entre cada lote
 */
async function processBatches(items, processFn, onProgress, batchSize = BATCH_SIZE) {
  const results = [];
  const total = items.length;
  
  for (let i = 0; i < total; i += batchSize) {
    const batch = items.slice(i, Math.min(i + batchSize, total));
    
    // Procesar el lote en paralelo
    const batchResults = await Promise.all(
      batch.map((item, idx) => processFn(item, i + idx))
    );
    
    results.push(...batchResults);
    
    // Actualizar progreso
    if (onProgress) {
      onProgress(Math.round(((i + batch.length) / total) * 100));
    }
    
    // Esperar entre lotes para evitar rate limit
    if (i + batchSize < total) {
      await sleep(BATCH_DELAY);
    }
  }
  
  return results;
}

/**
 * Normaliza un texto para comparación (minúsculas, sin espacios a los lados)
 */
function normalizeText(text) {
  if (!text) return "";
  return String(text).toLowerCase().trim();
}

/**
 * Compara dos textos normalizados
 */
function textMatches(a, b) {
  return normalizeText(a) === normalizeText(b);
}

// Tipos de datos disponibles para las columnas
const DATA_TYPES = [
  { id: "string", label: "Texto" },
  { id: "number", label: "Número" },
  { id: "boolean", label: "Booleano" },
  { id: "date", label: "Fecha" },
  { id: "url", label: "URL" },
  { id: "image", label: "Imagen (URL)" },
  { id: "coordinate", label: "Coordenadas" },
  { id: "polygon", label: "Polígono" },
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
  
  // Claims/Qualifiers/References estáticos (se aplican a todas las entidades)
  const [staticClaims, setStaticClaims] = useState([]);
  // Cada staticClaim: { id, propertyId, propertyLabel, dataType, value, createProperty }
  
  // Tipo de archivo importado
  const [fileType, setFileType] = useState(""); // "csv" | "xlsx" | "geojson"
  const [geometryColumn, setGeometryColumn] = useState(""); // Para GeoJSON: columna donde se guarda la geometría
  
  // Importación
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState({ created: 0, updated: 0, errors: [] });
  const [isImporting, setIsImporting] = useState(false);
  const importResultsRef = useRef(null); // Referencia para trackear resultados durante importación async
  
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
          // Detectar columna de geometría de GeoJSON
          if (col === "_geometry") {
            initialMapping[col] = {
              enabled: true,
              propertyId: null,
              propertyLabel: "Geometría",
              dataType: "polygon",
              createProperty: true,
            };
            setGeometryColumn(col);
          } else {
            initialMapping[col] = {
              enabled: true,
              propertyId: null,
              propertyLabel: col,
              dataType: guessDataType(data, col),
              createProperty: true,
            };
          }
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

  // Opciones de parseo
  const [parseOptions, setParseOptions] = useState({
    rawStrings: true, // Mantener valores como string (ej: 010101 no se convierte a 10101)
    dateNF: "", // Formato de fecha personalizado
    skipEmptyRows: true, // Omitir filas vacías
  });

  // Leer archivo CSV, XLSX o GeoJSON
  async function readFile(file, options = parseOptions) {
    const fileName = file.name.toLowerCase();
    
    // Detectar si es GeoJSON
    if (fileName.endsWith('.geojson') || fileName.endsWith('.json')) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = (e) => {
          try {
            const geojson = JSON.parse(e.target.result);
            
            // Verificar que sea un FeatureCollection válido
            if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
              // Podría ser un solo Feature
              if (geojson.type === 'Feature' && geojson.properties) {
                const row = { ...geojson.properties, _geometry: geojson.geometry };
                setFileType("geojson");
                resolve([row]);
                return;
              }
              reject(new Error('El archivo JSON no es un GeoJSON válido'));
              return;
            }
            
            // Convertir features a filas planas
            const rows = geojson.features.map((feature) => ({
              ...feature.properties,
              _geometry: feature.geometry, // Guardar la geometría como columna especial
            }));
            
            setFileType("geojson");
            resolve(rows);
          } catch (err) {
            reject(new Error('Error al parsear el archivo JSON: ' + err.message));
          }
        };
        
        reader.onerror = () => reject(new Error("Error al leer el archivo"));
        reader.readAsText(file);
      });
    }
    
    // CSV o XLSX
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const data = e.target.result;
          // Opciones de lectura: raw para mantener strings, dateNF para formato de fecha
          const readOptions = { 
            type: "array",
            raw: options.rawStrings, // Mantener valores crudos como strings
            dateNF: options.dateNF || undefined,
          };
          const workbook = XLSX.read(data, readOptions);
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          
          // Opciones de conversión a JSON
          const jsonOptions = { 
            defval: "",
            raw: options.rawStrings, // Mantener valores crudos
            blankrows: !options.skipEmptyRows,
          };
          const jsonData = XLSX.utils.sheet_to_json(firstSheet, jsonOptions);
          setFileType(fileName.endsWith('.csv') ? "csv" : "xlsx");
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

  // Añadir un claim estático
  function addStaticClaim() {
    setStaticClaims((prev) => [
      ...prev,
      {
        id: Date.now(),
        propertyId: null,
        propertyLabel: "",
        dataType: "string",
        value: "",
        createProperty: true,
      },
    ]);
  }

  // Actualizar un claim estático
  function updateStaticClaim(id, updates) {
    setStaticClaims((prev) =>
      prev.map((claim) =>
        claim.id === id ? { ...claim, ...updates } : claim
      )
    );
  }

  // Eliminar un claim estático
  function removeStaticClaim(id) {
    setStaticClaims((prev) => prev.filter((claim) => claim.id !== id));
  }

  // Buscar propiedades existentes (entidades que pueden ser usadas como propiedades)
  async function searchProperties(query) {
    try {
      // Si no hay query, devolver las entidades más recientes
      const results = await searchEntities(query || "", 15);
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
    // Extraer labels únicos primero
    const uniqueLabels = [...new Set(
      rawData
        .map((row) => String(row[labelColumn] || "").trim())
        .filter(Boolean)
    )];
    
    const results = {};
    
    // Procesar en lotes con retry
    await processBatches(
      uniqueLabels,
      async (label) => {
        try {
          const matches = await withRetry(() => searchEntities(label, 5));
          const matchList = matches.rows || [];
          
          // Buscar coincidencia por label o alias (normalizado)
          const bestMatch = matchList.find(
            (m) => textMatches(m.label, label) ||
                   m.aliases?.some(a => textMatches(a, label))
          );
          
          // Siempre permitir cambiar - selectedMatch es sugerencia, no obligatorio
          results[label] = {
            label,
            matches: matchList,
            selectedMatch: bestMatch || null,
            createNew: !bestMatch, // Sugerencia, el usuario puede cambiar
          };
        } catch (err) {
          console.error(`Error reconciliando "${label}":`, err);
          results[label] = { label, matches: [], selectedMatch: null, createNew: true };
        }
        return label;
      },
      (progress) => setReconcileProgress(progress),
      BATCH_SIZE
    );
    
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
    
    // Recopilar todos los valores únicos de las columnas entity como array plano
    const allValuesToReconcile = [];
    
    for (const col of entityColumns) {
      const valuesSet = new Set();
      for (const row of rawData) {
        const val = String(row[col] || "").trim();
        if (val && !valuesSet.has(val)) {
          valuesSet.add(val);
          allValuesToReconcile.push({ col, value: val });
        }
      }
    }
    
    // Reconciliar en lotes
    const relationResults = {};
    for (const col of entityColumns) {
      relationResults[col] = {};
    }
    
    await processBatches(
      allValuesToReconcile,
      async ({ col, value }) => {
        try {
          const matches = await withRetry(() => searchEntities(value, 5));
          const matchList = matches.rows || [];
          
          // Buscar coincidencia por label o alias (normalizado)
          const bestMatch = matchList.find(
            (m) => textMatches(m.label, value) ||
                   m.aliases?.some(a => textMatches(a, value))
          );
          
          // Siempre permitir cambiar - selectedMatch es sugerencia
          relationResults[col][value] = {
            value,
            matches: matchList,
            selectedMatch: bestMatch || null,
            createNew: !bestMatch, // Sugerencia, el usuario puede cambiar
            skip: false,
          };
        } catch (err) {
          console.error(`Error reconciliando relación "${value}":`, err);
          relationResults[col][value] = {
            value,
            matches: [],
            selectedMatch: null,
            createNew: true,
            skip: false,
          };
        }
        return { col, value };
      },
      (progress) => setReconcileProgress(progress),
      BATCH_SIZE
    );
    
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
    
    const results = { created: 0, updated: 0, claims: 0, qualifiers: 0, references: 0, filesUploaded: 0, relationsCreated: 0, errors: [] };
    importResultsRef.current = results; // Guardar referencia para uso en funciones async
    const total = rawData.length;
    const teamId = activeTeam?.$id || null;
    
    // Mapa para guardar entidades de relación creadas durante la importación
    const createdRelationEntities = {}; // { "column:value": entityId }
    
    // Primero crear las propiedades necesarias (en lotes)
    const propertyMap = {};
    const propertiesToCreate = Object.entries(columnMapping)
      .filter(([column, mapping]) => 
        mapping.enabled && 
        column !== labelColumn && 
        column !== descriptionColumn && 
        column !== aliasesColumn &&
        mapping.createProperty && 
        !mapping.propertyId
      );
    
    // Crear propiedades en lotes
    for (const [column, mapping] of propertiesToCreate) {
      try {
        const property = await withRetry(() => createEntity({
          label: mapping.propertyLabel || column,
          description: `Propiedad importada: ${column}`,
          aliases: [],
        }, teamId));
        propertyMap[column] = property.$id;
      } catch (err) {
        results.errors.push(`Error creando propiedad ${column}: ${err.message}`);
      }
      await sleep(BATCH_DELAY);
    }
    
    // Añadir propiedades existentes al mapa
    for (const [column, mapping] of Object.entries(columnMapping)) {
      if (mapping.propertyId && !propertyMap[column]) {
        propertyMap[column] = mapping.propertyId;
      }
    }
    
    // Crear propiedades para claims estáticos (en lotes)
    const staticPropertyMap = {};
    for (const claim of staticClaims) {
      if (!claim.propertyLabel && !claim.propertyId) continue;
      
      if (claim.createProperty && !claim.propertyId) {
        try {
          const property = await withRetry(() => createEntity({
            label: claim.propertyLabel,
            description: `Propiedad estática importada`,
            aliases: [],
          }, teamId));
          staticPropertyMap[claim.id] = property.$id;
        } catch (err) {
          results.errors.push(`Error creando propiedad estática ${claim.propertyLabel}: ${err.message}`);
        }
        await sleep(BATCH_DELAY);
      } else if (claim.propertyId) {
        staticPropertyMap[claim.id] = claim.propertyId;
      }
    }
    
    // Crear entidades de relación que deben crearse (createNew = true) - en lotes
    const relationEntitiesToCreate = [];
    for (const [column, values] of Object.entries(relationReconcile)) {
      for (const [value, info] of Object.entries(values)) {
        if (info.createNew && !info.skip && !info.selectedMatch) {
          relationEntitiesToCreate.push({ column, value });
        }
      }
    }
    
    // Procesar creación de entidades de relación en lotes
    await processBatches(
      relationEntitiesToCreate,
      async ({ column, value }) => {
        try {
          const entity = await withRetry(() => createEntity({
            label: value,
            description: null,
            aliases: [],
          }, teamId));
          createdRelationEntities[`${column}:${value}`] = entity.$id;
          results.relationsCreated++;
        } catch (err) {
          results.errors.push(`Error creando entidad de relación "${value}": ${err.message}`);
        }
        return { column, value };
      },
      null, // No actualizar progreso aquí
      BATCH_SIZE
    );
    
    // Importar cada fila (procesamiento secuencial pero con retry)
    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      const label = String(row[labelColumn] || "").trim();
      
      if (!label) {
        results.errors.push(`Fila ${i + 1}: Sin label, omitida`);
        setImportProgress(Math.round(((i + 1) / total) * 100));
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
          
          const entity = await withRetry(() => createEntity(entityData, teamId));
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
            let claimData;
            
            // Para columnas tipo entity, obtener el ID de la entidad relacionada
            if (mapping.dataType === "entity") {
              const valueStr = String(value).trim();
              const relationInfo = relationReconcile[column]?.[valueStr];
              
              let relationId = null;
              if (relationInfo?.skip) {
                continue; // Saltar este claim
              } else if (relationInfo?.selectedMatch) {
                relationId = relationInfo.selectedMatch.$id;
              } else if (createdRelationEntities[`${column}:${valueStr}`]) {
                relationId = createdRelationEntities[`${column}:${valueStr}`];
              }
              
              if (!relationId) {
                // No hay entidad, saltar
                continue;
              }
              
              // Para relaciones, usar value_relation
              claimData = {
                subject: entityId,
                property: propertyId,
                value_relation: relationId,
              };
            } else {
              // Para otros tipos de datos, usar value_raw con el formato {datatype, data}
              // Usar formatValueWithUpload para subir datos grandes a bucket
              const formattedValue = await formatValueWithUpload(value, mapping.dataType, label, teamId);
              claimData = {
                subject: entityId,
                property: propertyId,
                value_raw: {
                  datatype: mapping.dataType,
                  data: formattedValue,
                },
              };
            }
            
            const createdClaim = await withRetry(() => createClaim(claimData, teamId));
            results.claims++;
            
            // Crear qualificadores si existen
            if (mapping.qualifiers && mapping.qualifiers.length > 0) {
              for (const qualifier of mapping.qualifiers) {
                if (!qualifier.propertyId || !qualifier.value) continue;
                
                try {
                  let qualifierData;
                  
                  if (qualifier.dataType === "entity") {
                    qualifierData = {
                      claim: createdClaim.$id,
                      property: qualifier.propertyId,
                      value_relation: qualifier.value,
                    };
                  } else {
                    const formattedQualValue = await formatValueWithUpload(qualifier.value, qualifier.dataType, label, teamId);
                    qualifierData = {
                      claim: createdClaim.$id,
                      property: qualifier.propertyId,
                      value_raw: {
                        datatype: qualifier.dataType,
                        data: formattedQualValue,
                      },
                    };
                  }
                  
                  await withRetry(() => createQualifier(qualifierData, teamId));
                  results.qualifiers++;
                } catch (qErr) {
                  results.errors.push(`Fila ${i + 1}, columna ${column}, qualifier: ${qErr.message}`);
                }
              }
            }
            
            // Crear referencias si existen
            if (mapping.references && mapping.references.length > 0) {
              for (const reference of mapping.references) {
                if (!reference.referenceId && !reference.referenceLabel) continue;
                
                try {
                  let referenceEntityId = reference.referenceId;
                  
                  // Si no hay ID pero hay label, crear la entidad de referencia
                  if (!referenceEntityId && reference.referenceLabel && reference.createReference) {
                    const refEntity = await withRetry(() => createEntity({
                      label: reference.referenceLabel,
                      description: reference.details || null,
                      aliases: [],
                    }, teamId));
                    referenceEntityId = refEntity.$id;
                  }
                  
                  if (referenceEntityId) {
                    await withRetry(() => createReference({
                      claim: createdClaim.$id,
                      reference: referenceEntityId,
                      details: reference.details || null,
                    }, teamId));
                    results.references = (results.references || 0) + 1;
                  }
                } catch (refErr) {
                  results.errors.push(`Fila ${i + 1}, columna ${column}, referencia: ${refErr.message}`);
                }
              }
            }
          } catch (err) {
            results.errors.push(`Fila ${i + 1}, columna ${column}: ${err.message}`);
          }
        }
        
        // Crear claims estáticos para esta entidad
        for (const claim of staticClaims) {
          const staticPropertyId = staticPropertyMap[claim.id];
          if (!staticPropertyId || !claim.value) continue;
          
          try {
            let staticClaimData;
            
            if (claim.dataType === "entity") {
              // Claim de tipo relación con otra entidad
              staticClaimData = {
                subject: entityId,
                property: staticPropertyId,
                value_relation: claim.value, // ID de la entidad relacionada
              };
            } else {
              // Claim con valor raw (con subida a bucket si es necesario)
              const formattedValue = await formatValueWithUpload(claim.value, claim.dataType, label, teamId);
              staticClaimData = {
                subject: entityId,
                property: staticPropertyId,
                value_raw: {
                  datatype: claim.dataType,
                  data: formattedValue,
                },
              };
            }
            
            await withRetry(() => createClaim(staticClaimData, teamId));
            results.claims++;
          } catch (err) {
            results.errors.push(`Fila ${i + 1}, claim estático ${claim.propertyLabel}: ${err.message}`);
          }
        }
      } catch (err) {
        results.errors.push(`Fila ${i + 1}: ${err.message}`);
      }
      
      setImportProgress(Math.round(((i + 1) / total) * 100));
      
      // Pequeña pausa cada N filas para evitar rate limit
      if ((i + 1) % BATCH_SIZE === 0) {
        await sleep(BATCH_DELAY);
      }
    }
    
    setImportResults(results);
    setIsImporting(false);
    setCurrentStep(STEPS.COMPLETE);
  }

  // Umbral de caracteres para subir a bucket (10KB)
  const BUCKET_THRESHOLD = 10000;

  // Formatear valor según tipo de dato (versión síncrona para valores pequeños)
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
      case "polygon":
        // Para polígonos (GeoJSON), comprimir el JSON (sin espacios)
        if (typeof value === "object") {
          return JSON.stringify(value);
        }
        try {
          const parsed = JSON.parse(value);
          return JSON.stringify(parsed);
        } catch {
          return String(value);
        }
      case "json":
        // Comprimir JSON (sin espacios)
        if (typeof value === "object") {
          return JSON.stringify(value);
        }
        try {
          const parsed = JSON.parse(value);
          return JSON.stringify(parsed);
        } catch {
          return String(value);
        }
      default:
        return String(value);
    }
  }

  // Formatear valor y subir a bucket si es necesario (versión async)
  // Devuelve { value, uploaded: boolean }
  async function formatValueWithUpload(value, dataType, entityLabel, teamIdParam) {
    const formattedValue = formatValue(value, dataType);
    const valueStr = typeof formattedValue === "string" ? formattedValue : JSON.stringify(formattedValue);
    
    // Verificar si debe subirse a bucket según el tamaño
    if (valueStr.length > BUCKET_THRESHOLD) {
      try {
        if (dataType === "polygon" || dataType === "geojson") {
          // Subir GeoJSON a su bucket
          const uploaded = await uploadGeoJSON(formattedValue, entityLabel, teamIdParam);
          // Incrementar contador de archivos subidos
          if (importResultsRef.current) {
            importResultsRef.current.filesUploaded = (importResultsRef.current.filesUploaded || 0) + 1;
          }
          return {
            fileId: uploaded.fileId,
            bucketId: uploaded.bucketId,
            url: uploaded.url,
            size: uploaded.size,
          };
        } else if (dataType === "json") {
          // Subir JSON a su bucket
          const uploaded = await uploadJSON(formattedValue, entityLabel, teamIdParam);
          // Incrementar contador de archivos subidos
          if (importResultsRef.current) {
            importResultsRef.current.filesUploaded = (importResultsRef.current.filesUploaded || 0) + 1;
          }
          return {
            fileId: uploaded.fileId,
            bucketId: uploaded.bucketId,
            url: uploaded.url,
            size: uploaded.size,
          };
        }
      } catch (uploadErr) {
        console.error("Error uploading to bucket:", uploadErr);
        // Si falla la subida, devolver el valor formateado normal
        return formattedValue;
      }
    }
    
    return formattedValue;
  }

  // Reiniciar el wizard
  function resetWizard() {
    setCurrentStep(STEPS.UPLOAD);
    setFileName("");
    setFileType("");
    setRawData([]);
    setHeaders([]);
    setPreviewRows([]);
    setColumnMapping({});
    setLabelColumn("");
    setDescriptionColumn("");
    setAliasesColumn("");
    setGeometryColumn("");
    setReconcileResults({});
    setRelationReconcile({});
    setReconcileStep("entities");
    setStaticClaims([]);
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
                <p>Arrastra un archivo CSV, Excel o GeoJSON aquí, o haz clic para seleccionar</p>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls,.geojson,.json"
                  onChange={handleFileUpload}
                  className="file-input"
                />
                <div className="file-types">
                  Formatos soportados: CSV, XLSX, XLS, GeoJSON
                </div>
              </div>
              
              <div className="parse-options">
                <h3>Opciones de Lectura</h3>
                <div className="parse-options-grid">
                  <label className="checkbox-option">
                    <input
                      type="checkbox"
                      checked={parseOptions.rawStrings}
                      onChange={(e) => setParseOptions(prev => ({ ...prev, rawStrings: e.target.checked }))}
                    />
                    <div className="option-content">
                      <span className="option-label">Mantener valores como texto</span>
                      <span className="option-desc">Evita que códigos como "010101" se conviertan a números (10101)</span>
                    </div>
                  </label>
                  <label className="checkbox-option">
                    <input
                      type="checkbox"
                      checked={parseOptions.skipEmptyRows}
                      onChange={(e) => setParseOptions(prev => ({ ...prev, skipEmptyRows: e.target.checked }))}
                    />
                    <div className="option-content">
                      <span className="option-label">Omitir filas vacías</span>
                      <span className="option-desc">Ignora las filas que no tienen datos</span>
                    </div>
                  </label>
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

              {/* Claims estáticos */}
              <div className="mapping-section">
                <h3>Claims Estáticos</h3>
                <p className="section-desc">
                  Añade propiedades con valores fijos que se aplicarán a todas las entidades importadas
                </p>

                <div className="static-claims-list">
                  {staticClaims.map((claim) => (
                    <StaticClaimRow
                      key={claim.id}
                      claim={claim}
                      onUpdate={(updates) => updateStaticClaim(claim.id, updates)}
                      onRemove={() => removeStaticClaim(claim.id)}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  className="btn btn-secondary btn-add-static"
                  onClick={addStaticClaim}
                >
                  + Añadir claim estático
                </button>
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
                  {/* Tabs para cambiar entre entidades, relaciones y preview */}
                  <div className="reconcile-tabs">
                    <button
                      className={`reconcile-tab ${reconcileStep === "entities" ? "active" : ""}`}
                      onClick={() => setReconcileStep("entities")}
                    >
                      Entidades ({Object.keys(reconcileResults).length})
                    </button>
                    {Object.keys(relationReconcile).length > 0 && (
                      <button
                        className={`reconcile-tab ${reconcileStep === "relations" ? "active" : ""}`}
                        onClick={() => setReconcileStep("relations")}
                      >
                        Relaciones ({Object.values(relationReconcile).reduce((acc, col) => acc + Object.keys(col).length, 0)})
                      </button>
                    )}
                    <button
                      className={`reconcile-tab ${reconcileStep === "preview" ? "active" : ""}`}
                      onClick={() => setReconcileStep("preview")}
                    >
                      Vista Previa
                    </button>
                  </div>

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
                                <RelationReconcileItem
                                  key={value}
                                  column={column}
                                  value={value}
                                  info={info}
                                  occurrences={rawData.filter(row => String(row[column]).trim() === value).length}
                                  onUpdate={(updates) => updateRelationReconcile(column, value, updates)}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Vista previa de cómo quedará la importación */}
                  {reconcileStep === "preview" && (
                    <div className="reconcile-preview">
                      <div className="preview-info">
                        <p>Vista previa de cómo se importarán los datos. Las filas marcadas en amarillo requieren atención manual.</p>
                      </div>
                      
                      <div className="preview-table-container reconcile-preview-table">
                        <table className="preview-table">
                          <thead>
                            <tr>
                              <th className="status-col">Estado</th>
                              <th>{labelColumn || "Label"}</th>
                              {descriptionColumn && <th>Descripción</th>}
                              {headers
                                .filter((h) => h !== labelColumn && h !== descriptionColumn && h !== aliasesColumn && columnMapping[h]?.enabled)
                                .slice(0, 5)
                                .map((h) => (
                                  <th key={h}>{columnMapping[h]?.propertyLabel || h}</th>
                                ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rawData.slice(0, 20).map((row, i) => {
                              const label = String(row[labelColumn] || "").trim();
                              const reconcileInfo = reconcileResults[label];
                              const needsAttention = !label || 
                                (reconcileInfo?.matches?.length > 1 && !reconcileInfo?.selectedMatch && !reconcileInfo?.createNew);
                              const isExisting = reconcileInfo?.selectedMatch && !reconcileInfo?.createNew;
                              const isNew = reconcileInfo?.createNew;
                              
                              return (
                                <tr key={i} className={needsAttention ? "needs-attention" : (isExisting ? "is-existing" : "is-new")}>
                                  <td className="status-col">
                                    {!label && <span className="status-error" title="Sin label">⚠️</span>}
                                    {needsAttention && label && <span className="status-warning" title="Requiere revisión">⚡</span>}
                                    {isExisting && <span className="status-existing" title="Entidad existente">🔗</span>}
                                    {isNew && <span className="status-new" title="Se creará nueva">✚</span>}
                                  </td>
                                  <td>
                                    <div className="preview-cell-content">
                                      <span className="label-value">{label || "(vacío)"}</span>
                                      {isExisting && (
                                        <span className="linked-to">→ {reconcileInfo.selectedMatch.label}</span>
                                      )}
                                    </div>
                                  </td>
                                  {descriptionColumn && (
                                    <td title={String(row[descriptionColumn] || "")}>
                                      {truncate(String(row[descriptionColumn] || ""), 30)}
                                    </td>
                                  )}
                                  {headers
                                    .filter((h) => h !== labelColumn && h !== descriptionColumn && h !== aliasesColumn && columnMapping[h]?.enabled)
                                    .slice(0, 5)
                                    .map((h) => {
                                      const value = row[h];
                                      const mapping = columnMapping[h];
                                      const isEntityCol = mapping?.dataType === "entity";
                                      let cellStatus = "";
                                      let cellContent = truncate(String(value || ""), 25);
                                      
                                      if (isEntityCol && value) {
                                        const valueStr = String(value).trim();
                                        const relInfo = relationReconcile[h]?.[valueStr];
                                        if (relInfo?.skip) {
                                          cellStatus = "skipped";
                                          cellContent = <span className="cell-skipped">{valueStr} (omitido)</span>;
                                        } else if (relInfo?.selectedMatch) {
                                          cellStatus = "linked";
                                          cellContent = <span className="cell-linked">→ {relInfo.selectedMatch.label}</span>;
                                        } else if (relInfo?.createNew) {
                                          cellStatus = "new";
                                          cellContent = <span className="cell-new">✚ {valueStr}</span>;
                                        }
                                      }
                                      
                                      return (
                                        <td key={h} className={`cell-${cellStatus}`} title={String(value || "")}>
                                          {cellContent}
                                        </td>
                                      );
                                    })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      
                      {rawData.length > 20 && (
                        <p className="preview-note">Mostrando 20 de {rawData.length} filas</p>
                      )}
                      
                      <div className="preview-legend">
                        <div className="legend-item">
                          <span className="status-new">✚</span>
                          <span>Nueva entidad</span>
                        </div>
                        <div className="legend-item">
                          <span className="status-existing">🔗</span>
                          <span>Vinculada a existente</span>
                        </div>
                        <div className="legend-item">
                          <span className="status-warning">⚡</span>
                          <span>Requiere revisión</span>
                        </div>
                        <div className="legend-item">
                          <span className="status-error">⚠️</span>
                          <span>Error / Sin datos</span>
                        </div>
                      </div>
                    </div>
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
                {importResults.qualifiers > 0 && (
                  <div className="summary-stat">
                    <span className="stat-value">{importResults.qualifiers}</span>
                    <span className="stat-label">Qualificadores creados</span>
                  </div>
                )}
                {importResults.references > 0 && (
                  <div className="summary-stat">
                    <span className="stat-value success">{importResults.references}</span>
                    <span className="stat-label">Referencias creadas</span>
                  </div>
                )}
                {importResults.filesUploaded > 0 && (
                  <div className="summary-stat">
                    <span className="stat-value info">{importResults.filesUploaded}</span>
                    <span className="stat-label">Archivos en bucket</span>
                  </div>
                )}
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

        /* Opciones de parseo */
        .parse-options {
          margin-top: 2rem;
          padding: 1.5rem;
          background: var(--color-bg, #f8f9fa);
          border-radius: var(--radius-md, 4px);
          border: 1px solid var(--color-border-light, #c8ccd1);
        }

        .parse-options h3 {
          margin: 0 0 1rem 0;
          font-size: 1rem;
          color: var(--color-text, #202122);
        }

        .parse-options-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1rem;
        }

        .checkbox-option {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          padding: 0.75rem;
          background: var(--color-bg-card, #ffffff);
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
          cursor: pointer;
          transition: all 0.2s;
        }

        .checkbox-option:hover {
          border-color: var(--color-primary, #0645ad);
        }

        .checkbox-option input[type="checkbox"] {
          margin-top: 0.125rem;
          width: 18px;
          height: 18px;
          cursor: pointer;
        }

        .option-content {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .option-label {
          font-weight: 600;
          font-size: 0.875rem;
          color: var(--color-text, #202122);
        }

        .option-desc {
          font-size: 0.75rem;
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

        .static-claims-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }

        .btn-add-static {
          display: inline-flex;
          align-items: center;
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

        /* Vista previa de reconciliación */
        .reconcile-preview {
          margin-top: 1rem;
        }

        .preview-info {
          padding: 1rem;
          background: rgba(6, 69, 173, 0.05);
          border: 1px solid rgba(6, 69, 173, 0.2);
          border-radius: var(--radius-md, 4px);
          margin-bottom: 1rem;
        }

        .preview-info p {
          margin: 0;
          font-size: 0.875rem;
          color: var(--color-text-secondary, #54595d);
        }

        .reconcile-preview-table {
          max-height: 500px;
          overflow: auto;
        }

        .reconcile-preview-table .status-col {
          width: 50px;
          text-align: center;
        }

        .reconcile-preview-table tr.needs-attention {
          background: rgba(255, 204, 51, 0.15);
        }

        .reconcile-preview-table tr.is-existing {
          background: rgba(6, 69, 173, 0.05);
        }

        .reconcile-preview-table tr.is-new {
          background: rgba(20, 134, 109, 0.05);
        }

        .preview-cell-content {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .label-value {
          font-weight: 500;
        }

        .linked-to {
          font-size: 0.75rem;
          color: var(--color-primary, #0645ad);
        }

        .cell-linked {
          color: var(--color-primary, #0645ad);
          font-size: 0.8125rem;
        }

        .cell-new {
          color: var(--color-success, #14866d);
          font-size: 0.8125rem;
          font-weight: 500;
        }

        .cell-skipped {
          color: var(--color-text-muted, #72777d);
          font-style: italic;
          font-size: 0.8125rem;
        }

        .status-error {
          color: var(--color-error, #d33);
        }

        .status-warning {
          color: #b58105;
        }

        .status-existing {
          color: var(--color-primary, #0645ad);
        }

        .status-new {
          color: var(--color-success, #14866d);
        }

        .preview-legend {
          display: flex;
          gap: 1.5rem;
          margin-top: 1rem;
          padding: 0.75rem 1rem;
          background: var(--color-bg, #f8f9fa);
          border-radius: var(--radius-md, 4px);
          flex-wrap: wrap;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.8125rem;
          color: var(--color-text-secondary, #54595d);
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
  const [isLoading, setIsLoading] = useState(false);
  const [showQualifiers, setShowQualifiers] = useState(false);
  const [showReferences, setShowReferences] = useState(false);

  // Cargar entidades al montar el componente
  useEffect(() => {
    loadInitialEntities();
  }, []);

  async function loadInitialEntities() {
    setIsLoading(true);
    try {
      const results = await onSearchProperties("");
      setSearchResults(results);
    } catch (err) {
      console.error("Error loading entities:", err);
    }
    setIsLoading(false);
  }

  async function handleSearch(query) {
    setSearchQuery(query);
    setIsLoading(true);
    try {
      const results = await onSearchProperties(query);
      setSearchResults(results);
    } catch (err) {
      console.error("Error searching entities:", err);
      setSearchResults([]);
    }
    setIsLoading(false);
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

  function addQualifier() {
    const qualifiers = mapping?.qualifiers || [];
    onUpdate({
      qualifiers: [...qualifiers, {
        id: Date.now(),
        propertyId: null,
        propertyLabel: "",
        dataType: "string",
        value: "",
        createProperty: true,
      }]
    });
  }

  function updateQualifier(qualifierId, updates) {
    const qualifiers = (mapping?.qualifiers || []).map(q =>
      q.id === qualifierId ? { ...q, ...updates } : q
    );
    onUpdate({ qualifiers });
  }

  function removeQualifier(qualifierId) {
    const qualifiers = (mapping?.qualifiers || []).filter(q => q.id !== qualifierId);
    onUpdate({ qualifiers });
  }

  function addReference() {
    const references = mapping?.references || [];
    onUpdate({
      references: [...references, {
        id: Date.now(),
        referenceId: null,
        referenceLabel: "",
        details: "",
        createReference: true,
      }]
    });
  }

  function updateReference(referenceId, updates) {
    const references = (mapping?.references || []).map(r =>
      r.id === referenceId ? { ...r, ...updates } : r
    );
    onUpdate({ references });
  }

  function removeReference(referenceId) {
    const references = (mapping?.references || []).filter(r => r.id !== referenceId);
    onUpdate({ references });
  }

  return (
    <div className="column-mapping-row-container">
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
          <div className="property-selector">
            <div className="property-input-wrapper">
              {mapping?.createProperty ? (
                <input
                  type="text"
                  value={mapping?.propertyLabel || column}
                  onChange={(e) => onUpdate({ propertyLabel: e.target.value })}
                  placeholder="Nombre de nueva propiedad"
                  className="property-input"
                />
              ) : (
                <div className="property-selected-inline">
                  <span className="property-label">{mapping?.propertyLabel}</span>
                </div>
              )}
              <button 
                className={`btn-toggle-list ${showSearch ? 'active' : ''}`}
                onClick={() => setShowSearch(!showSearch)}
                title="Ver lista de entidades"
              >
                ▼
              </button>
              {!mapping?.createProperty && (
                <button 
                  className="btn-unlink"
                  onClick={() => onUpdate({ propertyId: null, createProperty: true })}
                  title="Crear nueva propiedad"
                >
                  ✕
                </button>
              )}
            </div>
            
            {showSearch && (
              <div className="entities-dropdown">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Buscar entidad..."
                  className="search-input"
                  autoFocus
                />
                <div className="entities-list">
                  {isLoading && <p className="loading-text">Cargando...</p>}
                  {!isLoading && searchResults.length > 0 && searchResults.map((entity) => (
                    <button 
                      key={entity.$id} 
                      onClick={() => selectProperty(entity)} 
                      className={`entity-option ${mapping?.propertyId === entity.$id ? 'selected' : ''}`}
                    >
                      <span className="entity-label">{entity.label}</span>
                      {entity.description && (
                        <span className="entity-desc">{truncate(entity.description, 40)}</span>
                      )}
                    </button>
                  ))}
                  {!isLoading && searchResults.length === 0 && (
                    <p className="no-entities">No se encontraron entidades</p>
                  )}
                </div>
              </div>
            )}
          </div>
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

        <div className="column-extras">
          <button 
            className={`btn-extras ${(mapping?.qualifiers?.length > 0) ? 'has-items' : ''}`}
            onClick={() => setShowQualifiers(!showQualifiers)}
            title="Añadir qualificadores"
          >
            {showQualifiers ? '−' : '+'} Q
            {mapping?.qualifiers?.length > 0 && <span className="extras-count">{mapping.qualifiers.length}</span>}
          </button>
          <button 
            className={`btn-extras btn-refs ${(mapping?.references?.length > 0) ? 'has-items' : ''}`}
            onClick={() => setShowReferences(!showReferences)}
            title="Añadir referencias"
          >
            {showReferences ? '−' : '+'} R
            {mapping?.references?.length > 0 && <span className="extras-count">{mapping.references.length}</span>}
          </button>
        </div>
      </div>

      {/* Qualificadores expandibles */}
      {showQualifiers && (
        <div className="qualifiers-section">
          <div className="qualifiers-header">
            <span>Qualificadores (se aplican a cada claim de esta columna)</span>
            <button className="btn-add-qualifier" onClick={addQualifier}>+ Añadir</button>
          </div>
          {(mapping?.qualifiers || []).map((qualifier) => (
            <QualifierMappingRow
              key={qualifier.id}
              qualifier={qualifier}
              onUpdate={(updates) => updateQualifier(qualifier.id, updates)}
              onRemove={() => removeQualifier(qualifier.id)}
              onSearchProperties={onSearchProperties}
              availableColumns={[]}
            />
          ))}
          {(!mapping?.qualifiers || mapping.qualifiers.length === 0) && (
            <p className="no-qualifiers">No hay qualificadores definidos</p>
          )}
        </div>
      )}

      {/* Referencias expandibles */}
      {showReferences && (
        <div className="references-section">
          <div className="references-header">
            <span>Referencias (fuentes de información)</span>
            <button className="btn-add-reference" onClick={addReference}>+ Añadir</button>
          </div>
          {(mapping?.references || []).map((reference) => (
            <ReferenceMappingRow
              key={reference.id}
              reference={reference}
              onUpdate={(updates) => updateReference(reference.id, updates)}
              onRemove={() => removeReference(reference.id)}
              onSearchProperties={onSearchProperties}
            />
          ))}
          {(!mapping?.references || mapping.references.length === 0) && (
            <p className="no-references">No hay referencias definidas</p>
          )}
        </div>
      )}

      <style jsx>{`
        .column-mapping-row-container {
          margin-bottom: 0.5rem;
        }

        .column-mapping-row {
          display: grid;
          grid-template-columns: 40px 1fr 1.5fr 140px 50px;
          gap: 0.75rem;
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
          font-size: 0.875rem;
        }

        .column-samples {
          display: flex;
          gap: 0.375rem;
          flex-wrap: wrap;
        }

        .sample-value {
          font-size: 0.6875rem;
          padding: 0.125rem 0.375rem;
          background: var(--color-bg-card, #ffffff);
          border-radius: var(--radius-sm, 2px);
          color: var(--color-text-muted, #72777d);
        }

        .column-property {
          position: relative;
        }

        .property-selector {
          position: relative;
        }

        .property-input-wrapper {
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }

        .property-input {
          flex: 1;
          padding: 0.5rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
          font-size: 0.8125rem;
        }

        .property-selected-inline {
          flex: 1;
          padding: 0.5rem;
          background: rgba(6, 69, 173, 0.1);
          border-radius: var(--radius-sm, 2px);
        }

        .property-label {
          font-weight: 500;
          color: var(--color-primary, #0645ad);
          font-size: 0.8125rem;
        }

        .btn-toggle-list,
        .btn-unlink {
          padding: 0.375rem 0.5rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          background: var(--color-bg-card, #ffffff);
          border-radius: var(--radius-sm, 2px);
          cursor: pointer;
          font-size: 0.75rem;
        }

        .btn-toggle-list.active {
          background: var(--color-primary, #0645ad);
          color: white;
          border-color: var(--color-primary, #0645ad);
        }

        .btn-unlink:hover {
          background: rgba(211, 51, 51, 0.1);
          border-color: var(--color-error, #d33);
          color: var(--color-error, #d33);
        }

        .entities-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: var(--color-bg-card, #ffffff);
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-md, 4px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          z-index: 100;
          margin-top: 0.25rem;
        }

        .search-input {
          width: 100%;
          padding: 0.625rem;
          border: none;
          border-bottom: 1px solid var(--color-border-light, #c8ccd1);
          font-size: 0.8125rem;
        }

        .entities-list {
          max-height: 200px;
          overflow-y: auto;
        }

        .entity-option {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          width: 100%;
          text-align: left;
          padding: 0.5rem 0.625rem;
          border: none;
          background: none;
          cursor: pointer;
          transition: background 0.15s;
        }

        .entity-option:hover {
          background: var(--color-bg-alt, #eaecf0);
        }

        .entity-option.selected {
          background: rgba(6, 69, 173, 0.1);
        }

        .entity-label {
          font-weight: 500;
          color: var(--color-text, #202122);
          font-size: 0.8125rem;
        }

        .entity-desc {
          font-size: 0.6875rem;
          color: var(--color-text-muted, #72777d);
        }

        .loading-text,
        .no-entities {
          padding: 0.75rem;
          text-align: center;
          color: var(--color-text-muted, #72777d);
          font-size: 0.8125rem;
          margin: 0;
        }

        .column-datatype select {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
          font-size: 0.8125rem;
          background: var(--color-bg-card, #ffffff);
        }

        .column-extras {
          display: flex;
          justify-content: center;
          gap: 0.25rem;
        }

        .btn-extras {
          padding: 0.375rem 0.5rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          background: var(--color-bg-card, #ffffff);
          border-radius: var(--radius-sm, 2px);
          cursor: pointer;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--color-text-secondary, #54595d);
          position: relative;
        }

        .btn-extras.btn-refs {
          color: var(--color-success, #14866d);
        }

        .btn-extras:hover {
          background: var(--color-bg-alt, #eaecf0);
        }

        .btn-extras.has-items {
          background: rgba(6, 69, 173, 0.1);
          border-color: var(--color-primary, #0645ad);
          color: var(--color-primary, #0645ad);
        }

        .btn-extras.btn-refs.has-items {
          background: rgba(20, 134, 109, 0.1);
          border-color: var(--color-success, #14866d);
          color: var(--color-success, #14866d);
        }

        .extras-count {
          position: absolute;
          top: -6px;
          right: -6px;
          background: var(--color-primary, #0645ad);
          color: white;
          font-size: 0.625rem;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .qualifiers-section {
          margin-left: 40px;
          margin-top: 0.5rem;
          padding: 0.75rem;
          background: var(--color-bg-card, #ffffff);
          border: 1px dashed var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-md, 4px);
        }

        .qualifiers-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
          font-size: 0.75rem;
          color: var(--color-text-secondary, #54595d);
        }

        .btn-add-qualifier {
          padding: 0.25rem 0.5rem;
          border: 1px solid var(--color-primary, #0645ad);
          background: none;
          color: var(--color-primary, #0645ad);
          border-radius: var(--radius-sm, 2px);
          cursor: pointer;
          font-size: 0.75rem;
        }

        .no-qualifiers {
          font-size: 0.75rem;
          color: var(--color-text-muted, #72777d);
          text-align: center;
          padding: 0.5rem;
          margin: 0;
        }

        .references-section {
          margin-left: 40px;
          margin-top: 0.5rem;
          padding: 0.75rem;
          background: rgba(20, 134, 109, 0.05);
          border: 1px dashed var(--color-success, #14866d);
          border-radius: var(--radius-md, 4px);
        }

        .references-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.5rem;
          font-size: 0.75rem;
          color: var(--color-success, #14866d);
        }

        .btn-add-reference {
          padding: 0.25rem 0.5rem;
          border: 1px solid var(--color-success, #14866d);
          background: none;
          color: var(--color-success, #14866d);
          border-radius: var(--radius-sm, 2px);
          cursor: pointer;
          font-size: 0.75rem;
        }

        .no-references {
          font-size: 0.75rem;
          color: var(--color-text-muted, #72777d);
          text-align: center;
          padding: 0.5rem;
          margin: 0;
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

// Componente para qualificador en mapeo
function QualifierMappingRow({ qualifier, onUpdate, onRemove, onSearchProperties, availableColumns }) {
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Estado para selector de valor tipo entidad
  const [valueEntities, setValueEntities] = useState([]);
  const [valueSearch, setValueSearch] = useState("");
  const [showValueDropdown, setShowValueDropdown] = useState(false);

  async function loadEntities() {
    setIsLoading(true);
    try {
      const results = await onSearchProperties("");
      setSearchResults(results);
    } catch (err) {
      console.error("Error loading entities:", err);
    }
    setIsLoading(false);
  }

  async function handleSearch(query) {
    setSearchQuery(query);
    setIsLoading(true);
    try {
      const results = await onSearchProperties(query);
      setSearchResults(results);
    } catch (err) {
      setSearchResults([]);
    }
    setIsLoading(false);
  }

  async function handleValueSearch(query) {
    setValueSearch(query);
    try {
      const results = await onSearchProperties(query);
      setValueEntities(results);
    } catch (err) {
      setValueEntities([]);
    }
  }

  function selectProperty(entity) {
    onUpdate({
      propertyId: entity.$id,
      propertyLabel: entity.label,
      createProperty: false,
    });
    setShowSearch(false);
    setSearchQuery("");
  }

  function selectValueEntity(entity) {
    onUpdate({
      value: entity.$id,
      valueLabel: entity.label,
    });
    setShowValueDropdown(false);
    setValueSearch("");
  }

  function renderValueInput() {
    if (qualifier.dataType === "entity") {
      return (
        <div className="entity-value-container">
          {qualifier.value ? (
            <div className="entity-value-selected">
              <span>{qualifier.valueLabel || qualifier.value}</span>
              <button className="btn-clear" onClick={() => onUpdate({ value: "", valueLabel: "" })}>✕</button>
            </div>
          ) : (
            <button 
              className="btn-select-entity"
              onClick={async () => {
                setShowValueDropdown(true);
                const results = await onSearchProperties("");
                setValueEntities(results);
              }}
            >
              Seleccionar...
            </button>
          )}
          
          {showValueDropdown && (
            <div className="entities-mini-dropdown value-dropdown">
              <input
                type="text"
                value={valueSearch}
                onChange={(e) => handleValueSearch(e.target.value)}
                placeholder="Buscar..."
                className="mini-search"
                autoFocus
              />
              <div className="mini-list">
                {valueEntities.map((e) => (
                  <button key={e.$id} onClick={() => selectValueEntity(e)} className="mini-option">
                    {e.label}
                  </button>
                ))}
              </div>
              <button className="mini-close" onClick={() => setShowValueDropdown(false)}>Cerrar</button>
            </div>
          )}
        </div>
      );
    }
    
    return (
      <input
        type="text"
        value={qualifier.value || ""}
        onChange={(e) => onUpdate({ value: e.target.value })}
        placeholder="Valor"
        className="qualifier-value"
      />
    );
  }

  return (
    <div className="qualifier-row">
      <div className="qualifier-property">
        <div className="property-input-group">
          {qualifier.createProperty ? (
            <input
              type="text"
              value={qualifier.propertyLabel}
              onChange={(e) => onUpdate({ propertyLabel: e.target.value })}
              placeholder="Propiedad del qualificador"
              className="qualifier-input"
            />
          ) : (
            <div className="qualifier-selected">
              <span>{qualifier.propertyLabel}</span>
            </div>
          )}
          <button 
            className="btn-sm"
            onClick={() => {
              if (!showSearch) loadEntities();
              setShowSearch(!showSearch);
            }}
          >
            {showSearch ? '−' : '▼'}
          </button>
          {!qualifier.createProperty && (
            <button 
              className="btn-sm btn-unlink"
              onClick={() => onUpdate({ propertyId: null, createProperty: true })}
            >
              ✕
            </button>
          )}
        </div>
        
        {showSearch && (
          <div className="entities-mini-dropdown">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Buscar..."
              className="mini-search"
            />
            <div className="mini-list">
              {isLoading && <span className="mini-loading">Cargando...</span>}
              {!isLoading && searchResults.map((e) => (
                <button key={e.$id} onClick={() => selectProperty(e)} className="mini-option">
                  {e.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <select
        value={qualifier.dataType}
        onChange={(e) => onUpdate({ dataType: e.target.value, value: "", valueLabel: "" })}
        className="qualifier-type"
      >
        {DATA_TYPES.map((dt) => (
          <option key={dt.id} value={dt.id}>{dt.label}</option>
        ))}
      </select>

      {renderValueInput()}

      <button className="btn-remove" onClick={onRemove}>🗑️</button>

      <style jsx>{`
        .qualifier-row {
          display: grid;
          grid-template-columns: 1.5fr 120px 1fr 32px;
          gap: 0.5rem;
          align-items: start;
          padding: 0.5rem;
          background: var(--color-bg, #f8f9fa);
          border-radius: var(--radius-sm, 2px);
          margin-bottom: 0.375rem;
        }

        .qualifier-property {
          position: relative;
        }

        .property-input-group {
          display: flex;
          gap: 0.25rem;
        }

        .qualifier-input,
        .qualifier-selected {
          flex: 1;
          padding: 0.375rem 0.5rem;
          font-size: 0.75rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
        }

        .qualifier-selected {
          background: rgba(6, 69, 173, 0.1);
          color: var(--color-primary, #0645ad);
          font-weight: 500;
        }

        .btn-sm {
          padding: 0.25rem 0.5rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          background: var(--color-bg-card, #ffffff);
          border-radius: var(--radius-sm, 2px);
          cursor: pointer;
          font-size: 0.6875rem;
        }

        .btn-sm.btn-unlink:hover {
          color: var(--color-error, #d33);
        }

        .entities-mini-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: var(--color-bg-card, #ffffff);
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          z-index: 50;
          margin-top: 0.25rem;
        }

        .mini-search {
          width: 100%;
          padding: 0.375rem;
          border: none;
          border-bottom: 1px solid var(--color-border-light, #c8ccd1);
          font-size: 0.75rem;
        }

        .mini-list {
          max-height: 120px;
          overflow-y: auto;
        }

        .mini-loading {
          display: block;
          padding: 0.5rem;
          font-size: 0.6875rem;
          color: var(--color-text-muted, #72777d);
        }

        .mini-option {
          display: block;
          width: 100%;
          text-align: left;
          padding: 0.375rem 0.5rem;
          border: none;
          background: none;
          cursor: pointer;
          font-size: 0.75rem;
        }

        .mini-option:hover {
          background: var(--color-bg-alt, #eaecf0);
        }

        .qualifier-type,
        .qualifier-value {
          padding: 0.375rem 0.5rem;
          font-size: 0.75rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
        }

        .entity-value-container {
          position: relative;
        }

        .entity-value-selected {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.375rem 0.5rem;
          background: rgba(6, 69, 173, 0.1);
          border-radius: var(--radius-sm, 2px);
          font-size: 0.75rem;
        }

        .entity-value-selected span {
          flex: 1;
          color: var(--color-primary, #0645ad);
          font-weight: 500;
        }

        .btn-clear {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 0.625rem;
          opacity: 0.6;
          padding: 0;
        }

        .btn-clear:hover {
          opacity: 1;
        }

        .btn-select-entity {
          width: 100%;
          padding: 0.375rem 0.5rem;
          background: var(--color-bg-card, #ffffff);
          border: 1px dashed var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
          cursor: pointer;
          font-size: 0.75rem;
          color: var(--color-text-muted, #72777d);
        }

        .btn-select-entity:hover {
          border-color: var(--color-primary, #0645ad);
          color: var(--color-primary, #0645ad);
        }

        .value-dropdown {
          z-index: 60;
        }

        .mini-close {
          width: 100%;
          padding: 0.375rem;
          border: none;
          border-top: 1px solid var(--color-border-light, #c8ccd1);
          background: none;
          cursor: pointer;
          font-size: 0.6875rem;
          color: var(--color-text-muted, #72777d);
        }

        .btn-remove {
          padding: 0.25rem;
          border: none;
          background: none;
          cursor: pointer;
          font-size: 0.875rem;
          opacity: 0.6;
        }

        .btn-remove:hover {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}

// Componente para referencia en mapeo
function ReferenceMappingRow({ reference, onUpdate, onRemove, onSearchProperties }) {
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  async function loadEntities() {
    setIsLoading(true);
    try {
      const results = await onSearchProperties("");
      setSearchResults(results);
    } catch (err) {
      console.error("Error loading entities:", err);
    }
    setIsLoading(false);
  }

  async function handleSearch(query) {
    setSearchQuery(query);
    setIsLoading(true);
    try {
      const results = await onSearchProperties(query);
      setSearchResults(results);
    } catch (err) {
      setSearchResults([]);
    }
    setIsLoading(false);
  }

  function selectEntity(entity) {
    onUpdate({
      referenceId: entity.$id,
      referenceLabel: entity.label,
      createReference: false,
    });
    setShowSearch(false);
    setSearchQuery("");
  }

  return (
    <div className="reference-row">
      <div className="reference-entity">
        <div className="ref-input-group">
          {reference.createReference ? (
            <input
              type="text"
              value={reference.referenceLabel}
              onChange={(e) => onUpdate({ referenceLabel: e.target.value })}
              placeholder="Nueva referencia o URL"
              className="reference-input"
            />
          ) : (
            <div className="reference-selected">
              <span>{reference.referenceLabel}</span>
            </div>
          )}
          <button 
            className="btn-sm"
            onClick={() => {
              if (!showSearch) loadEntities();
              setShowSearch(!showSearch);
            }}
            title="Seleccionar entidad existente"
          >
            {showSearch ? '−' : '▼'}
          </button>
          {!reference.createReference && (
            <button 
              className="btn-sm btn-unlink"
              onClick={() => onUpdate({ referenceId: null, createReference: true })}
            >
              ✕
            </button>
          )}
        </div>
        
        {showSearch && (
          <div className="entities-mini-dropdown">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Buscar entidad..."
              className="mini-search"
            />
            <div className="mini-list">
              {isLoading && <span className="mini-loading">Cargando...</span>}
              {!isLoading && searchResults.map((e) => (
                <button key={e.$id} onClick={() => selectEntity(e)} className="mini-option">
                  {e.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <input
        type="text"
        value={reference.details || ""}
        onChange={(e) => onUpdate({ details: e.target.value })}
        placeholder="Detalles (ej: página, fecha consultada)"
        className="reference-details"
      />

      <button className="btn-remove" onClick={onRemove}>🗑️</button>

      <style jsx>{`
        .reference-row {
          display: grid;
          grid-template-columns: 1.5fr 1fr 32px;
          gap: 0.5rem;
          align-items: start;
          padding: 0.5rem;
          background: var(--color-bg, #f8f9fa);
          border-radius: var(--radius-sm, 2px);
          margin-bottom: 0.375rem;
        }

        .reference-entity {
          position: relative;
        }

        .ref-input-group {
          display: flex;
          gap: 0.25rem;
        }

        .reference-input,
        .reference-selected {
          flex: 1;
          padding: 0.375rem 0.5rem;
          font-size: 0.75rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
        }

        .reference-selected {
          background: rgba(6, 69, 173, 0.1);
          color: var(--color-primary, #0645ad);
          font-weight: 500;
        }

        .reference-details {
          padding: 0.375rem 0.5rem;
          font-size: 0.75rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
        }

        .btn-sm {
          padding: 0.25rem 0.5rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          background: var(--color-bg-card, #ffffff);
          border-radius: var(--radius-sm, 2px);
          cursor: pointer;
          font-size: 0.6875rem;
        }

        .btn-sm.btn-unlink:hover {
          color: var(--color-error, #d33);
        }

        .entities-mini-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: var(--color-bg-card, #ffffff);
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          z-index: 50;
          margin-top: 0.25rem;
        }

        .mini-search {
          width: 100%;
          padding: 0.375rem;
          border: none;
          border-bottom: 1px solid var(--color-border-light, #c8ccd1);
          font-size: 0.75rem;
        }

        .mini-list {
          max-height: 120px;
          overflow-y: auto;
        }

        .mini-loading {
          display: block;
          padding: 0.5rem;
          font-size: 0.6875rem;
          color: var(--color-text-muted, #72777d);
        }

        .mini-option {
          display: block;
          width: 100%;
          text-align: left;
          padding: 0.375rem 0.5rem;
          border: none;
          background: none;
          cursor: pointer;
          font-size: 0.75rem;
        }

        .mini-option:hover {
          background: var(--color-bg-alt, #eaecf0);
        }

        .btn-remove {
          padding: 0.25rem;
          border: none;
          background: none;
          cursor: pointer;
          font-size: 0.875rem;
          opacity: 0.6;
        }

        .btn-remove:hover {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}

// Componente para claim estático
function StaticClaimRow({ claim, onUpdate, onRemove }) {
  const [entities, setEntities] = useState([]);
  const [entitySearch, setEntitySearch] = useState("");
  const [showEntityDropdown, setShowEntityDropdown] = useState(false);
  const [loadingEntities, setLoadingEntities] = useState(false);
  
  // Estado para selector de valor tipo entidad
  const [valueEntities, setValueEntities] = useState([]);
  const [valueEntitySearch, setValueEntitySearch] = useState("");
  const [showValueEntityDropdown, setShowValueEntityDropdown] = useState(false);

  // Cargar entidades al montar
  useEffect(() => {
    async function loadInitialEntities() {
      setLoadingEntities(true);
      try {
        const result = await database.listEntities(100, 0);
        setEntities(result.rows || []);
      } catch (err) {
        console.error("Error loading entities:", err);
      } finally {
        setLoadingEntities(false);
      }
    }
    loadInitialEntities();
  }, []);

  // Buscar entidades para el valor
  async function searchValueEntities(query) {
    setValueEntitySearch(query);
    if (query.length >= 2) {
      try {
        const result = await database.searchEntities(query, 50, 0);
        setValueEntities(result.rows || []);
      } catch (err) {
        console.error("Error searching entities:", err);
        setValueEntities([]);
      }
    } else if (query.length === 0) {
      try {
        const result = await database.listEntities(50, 0);
        setValueEntities(result.rows || []);
      } catch (err) {
        console.error("Error listing entities:", err);
        setValueEntities([]);
      }
    }
  }

  function selectProperty(entity) {
    onUpdate({
      propertyId: entity.$id,
      propertyLabel: entity.label,
      createProperty: false,
    });
    setShowEntityDropdown(false);
    setEntitySearch("");
  }

  function selectValueEntity(entity) {
    onUpdate({ 
      value: entity.$id,
      valueLabel: entity.label 
    });
    setShowValueEntityDropdown(false);
    setValueEntitySearch("");
  }

  const filteredEntities = entitySearch.length >= 2
    ? entities.filter(e => e.label?.toLowerCase().includes(entitySearch.toLowerCase()))
    : entities;

  // Buscar entidades para la propiedad
  async function handlePropertySearch(query) {
    setEntitySearch(query);
    if (query.length >= 2) {
      setLoadingEntities(true);
      try {
        const result = await database.searchEntities(query, 50, 0);
        setEntities(result.rows || []);
      } catch (err) {
        console.error("Error searching entities:", err);
      } finally {
        setLoadingEntities(false);
      }
    }
  }

  function renderValueInput() {
    switch (claim.dataType) {
      case "entity":
        return (
          <div className="entity-value-selector">
            {claim.value ? (
              <div className="selected-entity-value">
                <span>{claim.valueLabel || claim.value}</span>
                <button 
                  className="clear-btn"
                  onClick={() => onUpdate({ value: "", valueLabel: "" })}
                >
                  ✕
                </button>
              </div>
            ) : (
              <button 
                className="select-entity-btn"
                onClick={async () => {
                  setShowValueEntityDropdown(true);
                  try {
                    const result = await database.listEntities(50, 0);
                    setValueEntities(result.rows || []);
                  } catch (err) {
                    console.error("Error loading entities:", err);
                  }
                }}
              >
                Seleccionar entidad...
              </button>
            )}
            
            {showValueEntityDropdown && (
              <div className="entity-dropdown">
                <input
                  type="text"
                  value={valueEntitySearch}
                  onChange={(e) => searchValueEntities(e.target.value)}
                  placeholder="Buscar entidad..."
                  autoFocus
                />
                <div className="entity-list">
                  {valueEntities.map((entity) => (
                    <button
                      key={entity.$id}
                      className="entity-option"
                      onClick={() => selectValueEntity(entity)}
                    >
                      {entity.label}
                    </button>
                  ))}
                  {valueEntitySearch.length >= 2 && valueEntities.length === 0 && (
                    <p className="no-results">No se encontraron entidades</p>
                  )}
                </div>
                <button 
                  className="close-dropdown"
                  onClick={() => setShowValueEntityDropdown(false)}
                >
                  Cerrar
                </button>
              </div>
            )}
          </div>
        );
      case "boolean":
        return (
          <select
            value={claim.value}
            onChange={(e) => onUpdate({ value: e.target.value })}
          >
            <option value="">-- Seleccionar --</option>
            <option value="true">Verdadero</option>
            <option value="false">Falso</option>
          </select>
        );
      case "number":
        return (
          <input
            type="number"
            step="any"
            value={claim.value}
            onChange={(e) => onUpdate({ value: e.target.value })}
            placeholder="Valor numérico"
          />
        );
      case "date":
        return (
          <input
            type="date"
            value={claim.value}
            onChange={(e) => onUpdate({ value: e.target.value })}
          />
        );
      case "color":
        return (
          <input
            type="color"
            value={claim.value || "#000000"}
            onChange={(e) => onUpdate({ value: e.target.value })}
          />
        );
      case "json":
      case "polygon":
        return (
          <textarea
            value={claim.value}
            onChange={(e) => onUpdate({ value: e.target.value })}
            placeholder={claim.dataType === "polygon" ? '{"type": "Polygon", ...}' : '{"key": "value"}'}
            rows={3}
          />
        );
      default:
        return (
          <input
            type="text"
            value={claim.value}
            onChange={(e) => onUpdate({ value: e.target.value })}
            placeholder="Valor"
          />
        );
    }
  }

  return (
    <div className="static-claim-row">
      <div className="claim-property">
        {claim.createProperty ? (
          <div className="property-new">
            <input
              type="text"
              value={claim.propertyLabel}
              onChange={(e) => onUpdate({ propertyLabel: e.target.value })}
              placeholder="Nombre de la propiedad"
            />
            <button 
              className="link-btn"
              onClick={() => setShowEntityDropdown(true)}
              title="Seleccionar de entidades existentes"
            >
              🔗
            </button>
          </div>
        ) : (
          <div className="property-selected">
            <span className="property-label">{claim.propertyLabel}</span>
            <button 
              className="unlink-btn"
              onClick={() => onUpdate({ propertyId: null, createProperty: true })}
              title="Desvincular"
            >
              ✕
            </button>
          </div>
        )}
        
        {showEntityDropdown && (
          <div className="property-search-dropdown">
            <input
              type="text"
              value={entitySearch}
              onChange={(e) => handlePropertySearch(e.target.value)}
              placeholder="Buscar entidad..."
              autoFocus
            />
            <div className="search-results">
              {loadingEntities ? (
                <p className="loading-msg">Cargando...</p>
              ) : (
                <>
                  {entities.slice(0, 30).map((entity) => (
                    <button key={entity.$id} onClick={() => selectProperty(entity)}>
                      {entity.label}
                    </button>
                  ))}
                  {entitySearch.length >= 2 && entities.length === 0 && (
                    <p className="no-results">No se encontraron entidades</p>
                  )}
                  {entities.length > 30 && (
                    <p className="more-results">+{entities.length - 30} más...</p>
                  )}
                </>
              )}
            </div>
            <button className="close-search" onClick={() => setShowEntityDropdown(false)}>
              Cancelar
            </button>
          </div>
        )}
      </div>
      
      <div className="claim-datatype">
        <select
          value={claim.dataType}
          onChange={(e) => onUpdate({ dataType: e.target.value, value: "", valueLabel: "" })}
        >
          {DATA_TYPES.map((dt) => (
            <option key={dt.id} value={dt.id}>{dt.label}</option>
          ))}
        </select>
      </div>
      
      <div className="claim-value">
        {renderValueInput()}
      </div>
      
      <button className="remove-btn" onClick={onRemove} title="Eliminar">
        🗑️
      </button>

      <style jsx>{`
        .static-claim-row {
          display: grid;
          grid-template-columns: 1fr 150px 1fr 40px;
          gap: 1rem;
          align-items: start;
          padding: 0.75rem;
          background: var(--color-bg, #f8f9fa);
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-md, 4px);
          margin-bottom: 0.5rem;
        }

        .claim-property {
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

        .claim-datatype select,
        .claim-value input,
        .claim-value select,
        .claim-value textarea {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
          font-size: 0.875rem;
          background: var(--color-bg-card, #ffffff);
        }

        .claim-value textarea {
          resize: vertical;
          min-height: 60px;
        }

        .remove-btn {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 1.25rem;
          padding: 0.5rem;
          opacity: 0.6;
        }

        .remove-btn:hover {
          opacity: 1;
        }

        .loading-msg, .more-results {
          font-size: 0.75rem;
          color: var(--color-text-muted, #72777d);
          text-align: center;
          padding: 0.5rem;
        }

        .entity-value-selector {
          position: relative;
        }

        .selected-entity-value {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem;
          background: rgba(6, 69, 173, 0.1);
          border-radius: var(--radius-sm, 2px);
          font-size: 0.875rem;
        }

        .selected-entity-value span {
          flex: 1;
          color: var(--color-primary, #0645ad);
          font-weight: 500;
        }

        .selected-entity-value .clear-btn {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 0.875rem;
          opacity: 0.6;
          padding: 0;
        }

        .selected-entity-value .clear-btn:hover {
          opacity: 1;
        }

        .select-entity-btn {
          width: 100%;
          padding: 0.5rem;
          background: var(--color-bg-card, #ffffff);
          border: 1px dashed var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
          cursor: pointer;
          font-size: 0.875rem;
          color: var(--color-text-muted, #72777d);
        }

        .select-entity-btn:hover {
          border-color: var(--color-primary, #0645ad);
          color: var(--color-primary, #0645ad);
        }

        .entity-dropdown {
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

        .entity-dropdown input {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
          margin-bottom: 0.5rem;
          font-size: 0.875rem;
        }

        .entity-list {
          max-height: 150px;
          overflow-y: auto;
        }

        .entity-option {
          display: block;
          width: 100%;
          text-align: left;
          padding: 0.5rem;
          border: none;
          background: none;
          cursor: pointer;
          border-radius: var(--radius-sm, 2px);
          font-size: 0.875rem;
        }

        .entity-option:hover {
          background: var(--color-bg-alt, #eaecf0);
        }

        .close-dropdown {
          width: 100%;
          padding: 0.5rem;
          margin-top: 0.5rem;
          background: none;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
          cursor: pointer;
          font-size: 0.875rem;
        }

        @media (max-width: 768px) {
          .static-claim-row {
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
          
          {/* Selector de entidad personalizado */}
          <div className="custom-entity-selector">
            <span className="selector-label">O seleccionar otra entidad:</span>
            <EntitySelectorInline
              onSelect={(entity) => onUpdate({ selectedMatch: entity, createNew: false })}
              placeholder="Buscar entidad..."
            />
          </div>
        </div>
      )}
      
      {/* Mostrar opciones aunque no haya matches */}
      {expanded && result.matches.length === 0 && (
        <div className="reconcile-options">
          <div className="option-header">No se encontraron coincidencias</div>
          <label className="match-option create-new">
            <input
              type="radio"
              name={`reconcile-${result.label}`}
              checked={result.createNew}
              onChange={() => onUpdate({ selectedMatch: null, createNew: true })}
            />
            <span className="match-label">Crear nueva entidad</span>
          </label>
          
          {/* Selector de entidad personalizado */}
          <div className="custom-entity-selector">
            <span className="selector-label">O seleccionar entidad existente:</span>
            <EntitySelectorInline
              onSelect={(entity) => onUpdate({ selectedMatch: entity, createNew: false })}
              placeholder="Buscar entidad..."
            />
          </div>
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
        
        .custom-entity-selector {
          margin-top: 0.75rem;
          padding-top: 0.75rem;
          border-top: 1px dashed var(--color-border-light, #c8ccd1);
        }
        
        .selector-label {
          display: block;
          font-size: 0.75rem;
          color: var(--color-text-muted, #72777d);
          margin-bottom: 0.5rem;
        }
      `}</style>
    </div>
  );
}

// Selector de entidad inline para reconciliación
function EntitySelectorInline({ onSelect, placeholder = "Buscar entidad..." }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef(null);
  
  async function handleSearch(searchQuery) {
    if (!searchQuery || searchQuery.length < 2) {
      setResults([]);
      return;
    }
    
    setLoading(true);
    try {
      const response = await searchEntities(searchQuery, 10);
      setResults(response.rows || []);
    } catch (err) {
      console.error("Error buscando entidades:", err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }
  
  function handleInputChange(e) {
    const value = e.target.value;
    setQuery(value);
    setShowResults(true);
    
    // Debounce la búsqueda
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      handleSearch(value);
    }, 300);
  }
  
  function handleSelect(entity) {
    onSelect(entity);
    setQuery(entity.label);
    setShowResults(false);
    setResults([]);
  }
  
  return (
    <div className="entity-selector-inline">
      <input
        type="text"
        value={query}
        onChange={handleInputChange}
        onFocus={() => setShowResults(true)}
        onBlur={() => setTimeout(() => setShowResults(false), 200)}
        placeholder={placeholder}
        className="entity-search-input"
      />
      {loading && <span className="search-loading">Buscando...</span>}
      {showResults && results.length > 0 && (
        <div className="entity-results-dropdown">
          {results.map((entity) => (
            <div
              key={entity.$id}
              className="entity-result-item"
              onMouseDown={() => handleSelect(entity)}
            >
              <span className="entity-result-label">{entity.label}</span>
              {entity.description && (
                <span className="entity-result-desc">{truncate(entity.description, 50)}</span>
              )}
              {entity.aliases?.length > 0 && (
                <span className="entity-result-aliases">
                  Aliases: {entity.aliases.slice(0, 3).join(", ")}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      
      <style jsx>{`
        .entity-selector-inline {
          position: relative;
        }
        
        .entity-search-input {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid var(--color-border, #a2a9b1);
          border-radius: var(--radius-sm, 2px);
          font-size: 0.875rem;
        }
        
        .entity-search-input:focus {
          outline: none;
          border-color: var(--color-primary, #0645ad);
          box-shadow: 0 0 0 2px rgba(6, 69, 173, 0.1);
        }
        
        .search-loading {
          position: absolute;
          right: 0.5rem;
          top: 50%;
          transform: translateY(-50%);
          font-size: 0.75rem;
          color: var(--color-text-muted, #72777d);
        }
        
        .entity-results-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: white;
          border: 1px solid var(--color-border, #a2a9b1);
          border-top: none;
          border-radius: 0 0 var(--radius-sm, 2px) var(--radius-sm, 2px);
          max-height: 200px;
          overflow-y: auto;
          z-index: 100;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }
        
        .entity-result-item {
          padding: 0.5rem;
          cursor: pointer;
          border-bottom: 1px solid var(--color-border-light, #c8ccd1);
        }
        
        .entity-result-item:last-child {
          border-bottom: none;
        }
        
        .entity-result-item:hover {
          background: var(--color-bg, #f8f9fa);
        }
        
        .entity-result-label {
          font-weight: 500;
          display: block;
        }
        
        .entity-result-desc {
          font-size: 0.75rem;
          color: var(--color-text-secondary, #54595d);
          display: block;
        }
        
        .entity-result-aliases {
          font-size: 0.7rem;
          color: var(--color-text-muted, #72777d);
          display: block;
          font-style: italic;
        }
      `}</style>
    </div>
  );
}

// Componente para reconciliación de relaciones con buscador
function RelationReconcileItem({ column, value, info, occurrences, onUpdate }) {
  const [showSearch, setShowSearch] = useState(false);
  
  return (
    <div className="reconcile-row relation-reconcile-row">
      <div className="reconcile-label">
        <span className="label-text">{value}</span>
        <span className="occurrences">{occurrences} ocurrencias</span>
      </div>
      
      <div className="reconcile-actions">
        {/* Selector principal */}
        <select
          className="match-select"
          value={info.skip ? "skip" : (info.createNew ? "new" : (info.selectedMatch?.$id || "search"))}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "skip") {
              onUpdate({ skip: true, createNew: false, selectedMatch: null });
              setShowSearch(false);
            } else if (val === "new") {
              onUpdate({ createNew: true, skip: false, selectedMatch: null });
              setShowSearch(false);
            } else if (val === "search") {
              setShowSearch(true);
            } else {
              const match = info.matches?.find((m) => m.$id === val);
              if (match) {
                onUpdate({ selectedMatch: match, createNew: false, skip: false });
                setShowSearch(false);
              }
            }
          }}
        >
          {info.matches?.map((match) => (
            <option key={match.$id} value={match.$id}>
              {match.label}
              {match.aliases?.length > 0 && ` (${match.aliases.slice(0, 2).join(", ")})`}
            </option>
          ))}
          <option value="search">🔍 Buscar otra entidad...</option>
          <option value="new">✚ Crear nueva entidad</option>
          <option value="skip">⊘ Omitir</option>
        </select>
        
        {/* Badges de estado */}
        {info.selectedMatch && !showSearch && (
          <span className="match-badge">✓ {info.selectedMatch.label}</span>
        )}
        {info.createNew && !info.skip && (
          <span className="create-badge">✚ Nueva</span>
        )}
        {info.skip && (
          <span className="skip-badge">⊘ Omitir</span>
        )}
      </div>
      
      {/* Buscador expandido */}
      {showSearch && (
        <div className="relation-search-container">
          <EntitySelectorInline
            onSelect={(entity) => {
              onUpdate({ selectedMatch: entity, createNew: false, skip: false });
              setShowSearch(false);
            }}
            placeholder="Buscar entidad por nombre o alias..."
          />
          <button
            type="button"
            className="cancel-search-btn"
            onClick={() => setShowSearch(false)}
          >
            Cancelar
          </button>
        </div>
      )}
      
      <style jsx>{`
        .relation-reconcile-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          padding: 0.75rem;
          border-bottom: 1px solid var(--color-border-light, #c8ccd1);
        }
        
        .reconcile-label {
          flex: 1;
          min-width: 150px;
        }
        
        .label-text {
          font-weight: 500;
        }
        
        .occurrences {
          font-size: 0.75rem;
          color: var(--color-text-muted, #72777d);
          margin-left: 0.5rem;
        }
        
        .reconcile-actions {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        
        .match-select {
          padding: 0.25rem 0.5rem;
          border: 1px solid var(--color-border, #a2a9b1);
          border-radius: var(--radius-sm, 2px);
          font-size: 0.875rem;
          min-width: 200px;
        }
        
        .match-badge {
          font-size: 0.75rem;
          padding: 0.125rem 0.5rem;
          background: rgba(20, 134, 109, 0.1);
          color: var(--color-success, #14866d);
          border-radius: var(--radius-sm, 2px);
        }
        
        .create-badge {
          font-size: 0.75rem;
          padding: 0.125rem 0.5rem;
          background: rgba(6, 69, 173, 0.1);
          color: var(--color-primary, #0645ad);
          border-radius: var(--radius-sm, 2px);
        }
        
        .skip-badge {
          font-size: 0.75rem;
          padding: 0.125rem 0.5rem;
          background: rgba(114, 119, 125, 0.1);
          color: var(--color-text-muted, #72777d);
          border-radius: var(--radius-sm, 2px);
        }
        
        .relation-search-container {
          width: 100%;
          margin-top: 0.5rem;
          display: flex;
          gap: 0.5rem;
          align-items: flex-start;
        }
        
        .relation-search-container > :first-child {
          flex: 1;
        }
        
        .cancel-search-btn {
          padding: 0.5rem 1rem;
          background: var(--color-bg-alt, #eaecf0);
          border: 1px solid var(--color-border, #a2a9b1);
          border-radius: var(--radius-sm, 2px);
          cursor: pointer;
          font-size: 0.75rem;
        }
        
        .cancel-search-btn:hover {
          background: var(--color-border-light, #c8ccd1);
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
