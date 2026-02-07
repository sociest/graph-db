"use client";

import { useState, useEffect, useCallback } from "react";

const DATATYPES = [
  { value: "string", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "date", label: "Fecha" },
  { value: "url", label: "URL" },
  { value: "boolean", label: "Booleano" },
  { value: "coordinate", label: "Coordenadas" },
  { value: "polygon", label: "Polígono" },
  { value: "color", label: "Color" },
  { value: "image", label: "Imagen (URL)" },
  { value: "json", label: "JSON" },
];

// Función para simplificar geometrías GeoJSON (algoritmo Douglas-Peucker simplificado)
function simplifyCoordinates(coords, tolerance) {
  if (!Array.isArray(coords) || coords.length < 3) return coords;
  
  // Si es un array de arrays de coordenadas (MultiPolygon, etc.)
  if (Array.isArray(coords[0]) && Array.isArray(coords[0][0])) {
    return coords.map(ring => simplifyCoordinates(ring, tolerance));
  }
  
  // Algoritmo simplificado: mantener cada N puntos
  const keepEvery = Math.max(1, Math.round(tolerance));
  const result = [coords[0]]; // Siempre mantener el primer punto
  
  for (let i = keepEvery; i < coords.length - 1; i += keepEvery) {
    result.push(coords[i]);
  }
  
  // Siempre mantener el último punto (para cerrar polígonos)
  if (coords.length > 1) {
    result.push(coords[coords.length - 1]);
  }
  
  return result;
}

function simplifyGeoJSON(geojson, tolerance) {
  if (!geojson || !geojson.type) return geojson;
  
  const simplified = { ...geojson };
  
  if (geojson.coordinates) {
    simplified.coordinates = simplifyCoordinates(geojson.coordinates, tolerance);
  }
  
  return simplified;
}

/**
 * Input para valores con tipo de dato (value_raw)
 * Permite seleccionar el tipo de dato y proporcionar el valor
 */
export default function ValueInput({
  value,
  onChange,
  label,
  required = false,
  disabled = false,
}) {
  const [datatype, setDatatype] = useState("string");
  const [data, setData] = useState("");
  const [simplifyLevel, setSimplifyLevel] = useState(1); // 1 = sin simplificar
  const [originalData, setOriginalData] = useState(null); // Para guardar el GeoJSON original

  // Calcular tamaño del texto
  const charCount = data ? data.length : 0;
  const sizeKB = (charCount / 1024).toFixed(2);

  // Parsear valor inicial
  useEffect(() => {
    if (value) {
      if (typeof value === "object" && value.datatype) {
        setDatatype(value.datatype);
        setData(formatDataForInput(value.data, value.datatype));
      } else if (typeof value === "string") {
        try {
          const parsed = JSON.parse(value);
          if (parsed.datatype) {
            setDatatype(parsed.datatype);
            setData(formatDataForInput(parsed.data, parsed.datatype));
          } else {
            setData(value);
          }
        } catch {
          setData(value);
        }
      }
    } else {
      setDatatype("string");
      setData("");
    }
  }, []);

  function formatDataForInput(data, type) {
    if (data === null || data === undefined) return "";
    
    switch (type) {
      case "date":
        // Si es timestamp, convertir a fecha
        if (typeof data === "number") {
          return new Date(data).toISOString().split("T")[0];
        }
        return data;
      case "coordinate":
        if (typeof data === "object" && data.lat !== undefined) {
          return `${data.lat}, ${data.lng}`;
        }
        return String(data);
      case "polygon":
        if (typeof data === "object") {
          return JSON.stringify(data, null, 2);
        }
        return String(data);
      case "boolean":
        return data ? "true" : "false";
      case "color":
        if (Array.isArray(data)) {
          return data.map((item) => normalizeColorString(item)).filter(Boolean).join(" | ");
        }
        return String(data);
      case "json":
        return typeof data === "object" ? JSON.stringify(data, null, 2) : String(data);
      default:
        return String(data);
    }
  }

  function normalizeColorString(value) {
    if (value === null || value === undefined) return "";
    let color = String(value).trim();
    if (!color) return "";
    if (!color.startsWith("#") && !color.startsWith("rgb")) {
      color = `#${color}`;
    }
    return color;
  }

  function parseColorList(value) {
    if (value === null || value === undefined) return [];

    if (Array.isArray(value)) {
      return value.map(normalizeColorString).filter(Boolean);
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return [];

      if (trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return parsed.map(normalizeColorString).filter(Boolean);
          }
        } catch {
          // Ignorar
        }
      }

      const parts = trimmed.split(/[|;\n]+/).map((item) => item.trim()).filter(Boolean);
      if (parts.length > 1) {
        return parts.map(normalizeColorString).filter(Boolean);
      }

      const single = normalizeColorString(trimmed);
      return single ? [single] : [];
    }

    const single = normalizeColorString(value);
    return single ? [single] : [];
  }

  function serializeColorList(colors) {
    if (!colors || colors.length === 0) return "";
    return colors.map(normalizeColorString).filter(Boolean).join(" | ");
  }

  function parseDataFromInput(inputValue, type) {
    if (!inputValue && inputValue !== 0 && inputValue !== false) return null;

    switch (type) {
      case "number":
        const num = parseFloat(inputValue);
        return isNaN(num) ? null : num;
      case "date":
        return inputValue; // Mantener como string ISO
      case "boolean":
        return inputValue === "true" || inputValue === true;
      case "coordinate":
        const parts = String(inputValue).split(",").map((s) => s.trim());
        if (parts.length === 2) {
          const lat = parseFloat(parts[0]);
          const lng = parseFloat(parts[1]);
          if (!isNaN(lat) && !isNaN(lng)) {
            return { lat, lng };
          }
        }
        return inputValue;
      case "polygon":
        try {
          return JSON.parse(inputValue);
        } catch {
          return inputValue;
        }
      case "json":
        try {
          return JSON.parse(inputValue);
        } catch {
          return inputValue;
        }
      default:
        return inputValue;
    }
  }

  function handleChange(newDatatype, newData) {
    setDatatype(newDatatype);
    setData(newData);

    const parsedData = parseDataFromInput(newData, newDatatype);
    onChange({
      datatype: newDatatype,
      data: parsedData,
    });
  }

  function renderInput() {
    const commonProps = {
      className: "form-input",
      value: data,
      onChange: (e) => handleChange(datatype, e.target.value),
      disabled,
      required,
    };

    switch (datatype) {
      case "number":
        return (
          <input
            type="number"
            step="any"
            placeholder="Ingrese un número"
            {...commonProps}
          />
        );

      case "date":
        return (
          <input
            type="date"
            {...commonProps}
          />
        );

      case "url":
      case "image":
        return (
          <input
            type="url"
            placeholder="https://ejemplo.com"
            {...commonProps}
          />
        );

      case "boolean":
        return (
          <select
            className="form-select"
            value={data}
            onChange={(e) => handleChange(datatype, e.target.value)}
            disabled={disabled}
          >
            <option value="">Seleccionar...</option>
            <option value="true">Verdadero</option>
            <option value="false">Falso</option>
          </select>
        );

      case "color":
        const colors = parseColorList(data);

        const updateColors = (nextColors) => {
          handleChange(datatype, serializeColorList(nextColors));
        };

        return (
          <div className="color-list-wrapper">
            <div className="color-list">
              {colors.length === 0 && (
                <div className="color-list-empty">Sin colores</div>
              )}
              {colors.map((color, index) => (
                <div key={`${color}-${index}`} className="color-list-item">
                  <input
                    type="color"
                    value={color || "#000000"}
                    onChange={(e) => {
                      const next = [...colors];
                      next[index] = normalizeColorString(e.target.value);
                      updateColors(next);
                    }}
                    disabled={disabled}
                  />
                  <input
                    type="text"
                    className="form-input"
                    placeholder="#000000"
                    value={color}
                    onChange={(e) => {
                      const next = [...colors];
                      next[index] = normalizeColorString(e.target.value);
                      updateColors(next);
                    }}
                    disabled={disabled}
                    required={required && index === 0}
                  />
                  <div className="color-list-actions">
                    <button
                      type="button"
                      className="btn-tool"
                      onClick={() => {
                        if (index === 0) return;
                        const next = [...colors];
                        [next[index - 1], next[index]] = [next[index], next[index - 1]];
                        updateColors(next);
                      }}
                      disabled={disabled || index === 0}
                      title="Subir"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn-tool"
                      onClick={() => {
                        if (index === colors.length - 1) return;
                        const next = [...colors];
                        [next[index + 1], next[index]] = [next[index], next[index + 1]];
                        updateColors(next);
                      }}
                      disabled={disabled || index === colors.length - 1}
                      title="Bajar"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn-tool"
                      onClick={() => {
                        const next = colors.filter((_, i) => i !== index);
                        updateColors(next);
                      }}
                      disabled={disabled}
                      title="Quitar"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="color-list-footer">
              <button
                type="button"
                className="btn-tool"
                onClick={() => updateColors([...colors, "#000000"])}
                disabled={disabled}
              >
                + Agregar color
              </button>
              <span className="color-list-hint">Separar con | o ;</span>
            </div>
          </div>
        );

      case "coordinate":
        return (
          <input
            type="text"
            placeholder="Latitud, Longitud (ej: 40.7128, -74.0060)"
            {...commonProps}
          />
        );

      case "polygon":
        return (
          <div className="polygon-input-wrapper">
            <div className="polygon-toolbar">
              <div className="polygon-actions">
                <button
                  type="button"
                  className="btn-tool"
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(data);
                      const compressed = JSON.stringify(parsed);
                      handleChange(datatype, compressed);
                    } catch (e) {
                      // JSON inválido, ignorar
                    }
                  }}
                  disabled={disabled}
                  title="Comprimir JSON (eliminar espacios)"
                >
                  📦 Comprimir
                </button>
                <button
                  type="button"
                  className="btn-tool"
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(data);
                      const formatted = JSON.stringify(parsed, null, 2);
                      handleChange(datatype, formatted);
                    } catch (e) {
                      // JSON inválido, ignorar
                    }
                  }}
                  disabled={disabled}
                  title="Formatear JSON"
                >
                  📝 Formatear
                </button>
              </div>
              <div className="polygon-simplify">
                <label>Simplificar:</label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={simplifyLevel}
                  onChange={(e) => {
                    const level = parseInt(e.target.value);
                    setSimplifyLevel(level);
                    
                    try {
                      // Guardar original si es la primera vez
                      if (!originalData && level > 1) {
                        setOriginalData(data);
                      }
                      
                      const sourceData = originalData || data;
                      const parsed = JSON.parse(sourceData);
                      
                      if (level === 1 && originalData) {
                        // Restaurar original
                        handleChange(datatype, originalData);
                      } else if (level > 1) {
                        const simplified = simplifyGeoJSON(parsed, level);
                        handleChange(datatype, JSON.stringify(simplified));
                      }
                    } catch (e) {
                      // JSON inválido, ignorar
                    }
                  }}
                  disabled={disabled}
                  title="Reducir cantidad de puntos"
                />
                <span className="simplify-label">{simplifyLevel === 1 ? 'Original' : `÷${simplifyLevel}`}</span>
              </div>
            </div>
            <textarea
              className="form-textarea form-textarea-code"
              placeholder='{"type": "Polygon", "coordinates": [[[lng, lat], [lng, lat], ...]]}'
              rows={6}
              {...commonProps}
            />
            <div className="char-count">
              <span className={charCount > 50000 ? 'char-count-warning' : ''}>
                {charCount.toLocaleString()} caracteres ({sizeKB} KB)
              </span>
              {charCount > 50000 && <span className="char-count-hint">⚠️ Considera simplificar la geometría</span>}
            </div>
          </div>
        );

      case "json":
        return (
          <div className="json-input-wrapper">
            <div className="json-toolbar">
              <button
                type="button"
                className="btn-tool"
                onClick={() => {
                  try {
                    const parsed = JSON.parse(data);
                    const compressed = JSON.stringify(parsed);
                    handleChange(datatype, compressed);
                  } catch (e) {
                    // JSON inválido, ignorar
                  }
                }}
                disabled={disabled}
                title="Comprimir JSON"
              >
                📦 Comprimir
              </button>
              <button
                type="button"
                className="btn-tool"
                onClick={() => {
                  try {
                    const parsed = JSON.parse(data);
                    const formatted = JSON.stringify(parsed, null, 2);
                    handleChange(datatype, formatted);
                  } catch (e) {
                    // JSON inválido, ignorar
                  }
                }}
                disabled={disabled}
                title="Formatear JSON"
              >
                📝 Formatear
              </button>
            </div>
            <textarea
              className="form-textarea form-textarea-code"
              placeholder='{"key": "value"}'
              rows={4}
              {...commonProps}
            />
            <div className="char-count">
              {charCount.toLocaleString()} caracteres ({sizeKB} KB)
            </div>
          </div>
        );

      default:
        return (
          <input
            type="text"
            placeholder="Ingrese un valor"
            {...commonProps}
          />
        );
    }
  }

  return (
    <div className="value-input">
      {label && (
        <label className="form-label">
          {label}
          {required && <span className="required">*</span>}
        </label>
      )}

      <div className="value-input-row">
        <select
          className="form-select value-type-select"
          value={datatype}
          onChange={(e) => handleChange(e.target.value, data)}
          disabled={disabled}
        >
          {DATATYPES.map((dt) => (
            <option key={dt.value} value={dt.value}>
              {dt.label}
            </option>
          ))}
        </select>

        <div className="value-data-input">{renderInput()}</div>
      </div>
    </div>
  );
}
