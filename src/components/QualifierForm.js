"use client";

import { useState } from "react";
import EditModal from "./EditModal";
import EntitySelector from "./EntitySelector";
import ValueInput from "./ValueInput";

/**
 * Formulario para crear/editar un qualifier
 */
export default function QualifierForm({
  isOpen,
  onClose,
  onSave,
  qualifier = null,
  claimId,
}) {
  const isEditing = !!qualifier;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [property, setProperty] = useState(qualifier?.property?.$id || "");
  const [valueType, setValueType] = useState(
    qualifier?.value_relation ? "relation" : "raw"
  );
  const [valueRaw, setValueRaw] = useState(() => {
    const initialDatatype = qualifier?.datatype || qualifier?.property?.datatype || "string";
    return normalizeInitialValue(qualifier?.value_raw, initialDatatype);
  });
  const [valueRelation, setValueRelation] = useState(
    qualifier?.value_relation?.$id || ""
  );

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const resolvedDatatype =
        valueType === "relation"
          ? "entity"
          : valueRaw?.datatype || qualifier?.datatype || qualifier?.property?.datatype || "string";

      const data = {
        property: property || null,
        datatype: resolvedDatatype,
        value_raw: valueType === "raw" ? valueRaw?.data ?? null : null,
        value_relation: valueType === "relation" ? valueRelation : null,
      };

      if (!isEditing) {
        data.claim = claimId;
      }

      await onSave(data, qualifier?.$id);
      onClose();
    } catch (err) {
      setError(err.message || "Error al guardar el qualifier");
    } finally {
      setLoading(false);
    }
  }

  return (
    <EditModal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? "Editar calificador" : "Nuevo calificador"}
      onSubmit={handleSubmit}
      submitLabel={isEditing ? "Guardar cambios" : "Crear calificador"}
      loading={loading}
      size="medium"
    >
      {error && <div className="form-error">{error}</div>}

      <div className="form-group">
        <EntitySelector
          label="Propiedad"
          value={property}
          onChange={setProperty}
          placeholder="Buscar propiedad..."
          required
        />
      </div>

      <div className="form-group">
        <label className="form-label">Tipo de valor</label>
        <div className="radio-group">
          <label className="radio-label">
            <input
              type="radio"
              name="valueType"
              value="raw"
              checked={valueType === "raw"}
              onChange={() => setValueType("raw")}
            />
            Valor literal
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="valueType"
              value="relation"
              checked={valueType === "relation"}
              onChange={() => setValueType("relation")}
            />
            Relación a entidad
          </label>
        </div>
      </div>

      {valueType === "raw" ? (
        <div className="form-group">
          <ValueInput
            label="Valor"
            value={valueRaw}
            onChange={setValueRaw}
            required
          />
        </div>
      ) : (
        <div className="form-group">
          <EntitySelector
            label="Entidad relacionada"
            value={valueRelation}
            onChange={setValueRelation}
            placeholder="Buscar entidad..."
            required
          />
        </div>
      )}
    </EditModal>
  );
}

function normalizeInitialValue(valueRaw, fallbackDatatype) {
  if (valueRaw === undefined || valueRaw === null) {
    return { datatype: fallbackDatatype, data: "" };
  }

  if (typeof valueRaw === "object" && valueRaw.datatype !== undefined && valueRaw.data !== undefined) {
    return { datatype: valueRaw.datatype || fallbackDatatype, data: valueRaw.data };
  }

  if (typeof valueRaw === "string") {
    try {
      const parsed = JSON.parse(valueRaw);
      if (parsed && typeof parsed === "object" && parsed.datatype !== undefined && parsed.data !== undefined) {
        return { datatype: parsed.datatype || fallbackDatatype, data: parsed.data };
      }
    } catch {
      // Ignorar
    }
  }

  return { datatype: fallbackDatatype, data: valueRaw };
}
