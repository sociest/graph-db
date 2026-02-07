"use client";

import { useState } from "react";
import Link from "next/link";
import EntityForm from "./EntityForm";
import { ConfirmModal } from "./EditModal";
import PermissionsModal from "./PermissionsModal";
import { updateEntityPermissions } from "@/lib/database";

/**
 * Encabezado de entidad
 */
export default function EntityHeader({ 
  entity, 
  editable = false,
  onUpdate,
  onDelete,
  onPermissionsUpdated,
}) {
  const [showEditForm, setShowEditForm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!entity) return null;

  const { $id, label, description, aliases, $createdAt, $updatedAt } = entity;

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete?.();
      setShowDeleteConfirm(false);
    } catch (e) {
      console.error("Error deleting entity:", e);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <header className="entity-header">
      <div className="entity-header-main">
        <div className="entity-header-top">
          <div className="entity-id-badge">
            <span className="id-prefix">ID:</span>
            <span className="id-value">{$id}</span>
          </div>

          {editable && (
            <div className="entity-header-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowEditForm(true)}
                title="Editar entidad"
              >
                ✎ Editar
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowPermissions(true)}
                title="Permisos"
              >
                🔐 Permisos
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => setShowDeleteConfirm(true)}
                title="Eliminar entidad"
              >
                🗑 Eliminar
              </button>
            </div>
          )}
        </div>

        <h1 className="entity-title">
          {label || <span className="no-label">(Sin etiqueta)</span>}
        </h1>

        {description && (
          <p className="entity-description-full">{description}</p>
        )}

        {aliases && aliases.length > 0 && (
          <div className="entity-aliases-full">
            <span className="aliases-label">También conocido como:</span>
            <ul className="aliases-list">
              {aliases.map((alias, index) => (
                <li key={index}>{alias}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="entity-header-meta">
        <div className="meta-item">
          <span className="meta-label">Creado:</span>
          <span className="meta-value">
            {new Date($createdAt).toLocaleDateString()}
          </span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Modificado:</span>
          <span className="meta-value">
            {new Date($updatedAt).toLocaleDateString()}
          </span>
        </div>
      </div>

      {/* Modal de edición */}
      {showEditForm && (
        <EntityForm
          isOpen={showEditForm}
          onClose={() => setShowEditForm(false)}
          onSave={async (data) => {
            await onUpdate?.(data);
            setShowEditForm(false);
          }}
          entity={entity}
        />
      )}

      <PermissionsModal
        isOpen={showPermissions}
        onClose={() => setShowPermissions(false)}
        title="Permisos de la entidad"
        permissions={entity.$permissions || []}
        onSave={async (permissions) => {
          await updateEntityPermissions(entity.$id, permissions);
          await onPermissionsUpdated?.();
        }}
      />

      {/* Modal de confirmación de eliminación */}
      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Eliminar entidad"
        message={`¿Estás seguro de que deseas eliminar la entidad "${label || $id}"? También se eliminarán todas sus declaraciones, calificadores y referencias.`}
        loading={deleting}
      />
    </header>
  );
}
