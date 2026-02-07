"use client";

import { useEffect, useState } from "react";
import EditModal from "./EditModal";

export default function PermissionsModal({
  isOpen,
  onClose,
  title = "Permisos",
  permissions = [],
  onSave,
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setValue((permissions || []).join("\n"));
      setError(null);
    }
  }, [isOpen, permissions]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const nextPermissions = value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      await onSave?.(nextPermissions);
      onClose?.();
    } catch (err) {
      setError(err?.message || "Error al actualizar permisos");
    } finally {
      setSaving(false);
    }
  }

  return (
    <EditModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      onSubmit={handleSubmit}
      submitLabel="Guardar permisos"
      loading={saving}
      size="medium"
    >
      <div className="permissions-modal">
        <p className="permissions-help">
          Ingresa un permiso por línea. Ejemplos: <br />
          <code>update(\"team:TEAM_ID\")</code>, <code>delete(\"team:TEAM_ID\")</code>
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        <textarea
          className="permissions-textarea"
          rows={8}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`read("any")
update("team:...")
delete("team:...")`}
        />
      </div>
    </EditModal>
  );
}
