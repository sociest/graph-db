"use client";

import { useState, useEffect } from "react";
import { uploadGeoJSON } from "@/lib/database";

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
  const [polygonMode, setPolygonMode] = useState("upload");
  const [polygonUploading, setPolygonUploading] = useState(false);
  const [polygonError, setPolygonError] = useState(null);

  // Calcular tamaño del texto
  const charCount = typeof data === "string" ? data.length : 0;
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

  useEffect(() => {
    if (datatype !== "polygon") return;
    if (data === "" || data === null || data === undefined) return;
    const nextMode = getPolygonModeFromData(data);
    setPolygonMode(nextMode);
  }, [datatype, data]);

  function isUrl(value) {
    if (typeof value !== "string") return false;
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  function getPolygonModeFromData(value) {
    if (value && typeof value === "object") {
      if (value.url && !value.fileId) return "url";
      return "upload";
    }
    if (typeof value === "string" && isUrl(value)) {
      return "url";
    }
    return "upload";
  }

  function getPolygonUrl(value) {
    if (!value) return "";
    if (typeof value === "string" && isUrl(value)) return value;
    if (typeof value === "object" && value.url) return value.url;
    return "";
  }

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
          return data;
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
        if (typeof inputValue === "object") {
          if (inputValue?.url && isUrl(inputValue.url)) return inputValue.url;
          try {
            return JSON.stringify(inputValue);
          } catch {
            return String(inputValue);
          }
        }
        if (typeof inputValue === "string" && isUrl(inputValue)) {
          return inputValue;
        }
        try {
          const parsed = JSON.parse(inputValue);
          return JSON.stringify(parsed);
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

  function normalizeDataForDatatype(nextDatatype, nextData) {
    if (nextData === null || nextData === undefined) return "";
    if (typeof nextData === "object") {
      if (nextDatatype === "polygon" || nextDatatype === "json") return nextData;
      try {
        return JSON.stringify(nextData);
      } catch {
        return "";
      }
    }
    return nextData;
  }

  function handleChange(newDatatype, newData) {
    setDatatype(newDatatype);
    const safeData = normalizeDataForDatatype(newDatatype, newData);
    setData(safeData);

    const parsedData = parseDataFromInput(safeData, newDatatype);
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
        const polygonUrl = getPolygonUrl(data);
        const hasUpload = typeof data === "object" && data?.fileId && data?.bucketId;

        return (
          <div className="polygon-input-wrapper">
            <div className="polygon-mode">
              <label className="radio-label">
                <input
                  type="radio"
                  name="polygonMode"
                  value="upload"
                  checked={polygonMode === "upload"}
                  onChange={() => setPolygonMode("upload")}
                  disabled={disabled}
                />
                Subir GeoJSON
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  name="polygonMode"
                  value="url"
                  checked={polygonMode === "url"}
                  onChange={() => setPolygonMode("url")}
                  disabled={disabled}
                />
                Enlace
              </label>
            </div>

            {polygonMode === "upload" ? (
              <div className="polygon-upload">
                <input
                  type="file"
                  accept=".geojson,application/geo+json,application/json"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;

                    setPolygonError(null);
                    setPolygonUploading(true);
                    try {
                      const content = await file.text();
                      const parsed = JSON.parse(content);
                      const uploaded = await uploadGeoJSON(parsed, file.name || "polygon");
                      handleChange(datatype, {
                        fileId: uploaded.fileId,
                        bucketId: uploaded.bucketId,
                        url: uploaded.url,
                        name: uploaded.name,
                        size: uploaded.size,
                        mimeType: uploaded.mimeType,
                      });
                    } catch (err) {
                      setPolygonError("El archivo no es un GeoJSON válido o no se pudo subir.");
                    } finally {
                      setPolygonUploading(false);
                      e.target.value = "";
                    }
                  }}
                  disabled={disabled || polygonUploading}
                />

                {polygonUploading && (
                  <span className="polygon-upload-status">Subiendo...</span>
                )}

                {hasUpload && (
                  <div className="polygon-file-info">
                    <span>Archivo subido</span>
                    {data?.url && (
                      <a href={data.url} target="_blank" rel="noopener noreferrer">
                        Ver archivo
                      </a>
                    )}
                    <button
                      type="button"
                      className="btn-tool"
                      onClick={() => handleChange(datatype, "")}
                      disabled={disabled}
                    >
                      Quitar
                    </button>
                  </div>
                )}

                {polygonError && (
                  <div className="form-error">{polygonError}</div>
                )}
              </div>
            ) : (
              <div className="polygon-url-input">
                <input
                  type="url"
                  className="form-input"
                  placeholder="https://ejemplo.com/archivo.geojson"
                  value={polygonUrl}
                  onChange={(e) => handleChange(datatype, e.target.value)}
                  disabled={disabled}
                  required={required}
                />
                {polygonUrl && (
                  <a href={polygonUrl} target="_blank" rel="noopener noreferrer">
                    Ver enlace
                  </a>
                )}
              </div>
            )}
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
