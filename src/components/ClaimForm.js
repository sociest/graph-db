"use client";

import { useState } from "react";
import EditModal from "./EditModal";
import EntitySelector from "./EntitySelector";
import ValueInput from "./ValueInput";

/**
 * Formulario para crear/editar un claim
 */
export default function ClaimForm({
  isOpen,
  onClose,
  onSave,
  claim = null,
  subjectId,
}) {
  const isEditing = !!claim;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [property, setProperty] = useState(claim?.property?.$id || "");
  const [valueType, setValueType] = useState(
    claim?.value_relation ? "relation" : "raw"
  );
  const [valueRaw, setValueRaw] = useState(() => {
    const initialDatatype = claim?.datatype || claim?.property?.datatype || "string";
    return normalizeInitialValue(claim?.value_raw, initialDatatype);
  });
  const [valueRelation, setValueRelation] = useState(
    claim?.value_relation?.$id || ""
  );

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const resolvedDatatype =
        valueType === "relation"
          ? "entity"
          : valueRaw?.datatype || claim?.datatype || claim?.property?.datatype || "string";

      const data = {
        property: property || null,
        datatype: resolvedDatatype,
        value_raw: valueType === "raw" ? valueRaw?.data ?? null : null,
        value_relation: valueType === "relation" ? valueRelation : null,
      };

      if (!isEditing) {
        data.subject = subjectId;
      }

      await onSave(data, claim?.$id);
      onClose();
    } catch (err) {
      setError(err.message || "Error al guardar el claim");
    } finally {
      setLoading(false);
    }
  }

  return (
    <EditModal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? "Editar declaración" : "Nueva declaración"}
      onSubmit={handleSubmit}
      submitLabel={isEditing ? "Guardar cambios" : "Crear declaración"}
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
            excludeIds={[subjectId]}
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
