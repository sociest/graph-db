"use client";

import { useState } from "react";
import Link from "next/link";
import ValueRenderer from "./ValueRenderer";
import QualifierForm from "./QualifierForm";
import ReferenceForm from "./ReferenceForm";
import { ConfirmModal } from "./EditModal";
import PermissionsModal from "./PermissionsModal";
import {
  updateClaimPermissions,
  updateQualifierPermissions,
  updateReferencePermissions,
} from "@/lib/database";

/**
 * Muestra un claim individual con su propiedad, valor, qualifiers y referencias
 */
export default function ClaimItem({ 
  claim, 
  showQualifiers = true, 
  showReferences = true,
  editable = false,
  onEdit,
  onDelete,
  onQualifierCreate,
  onQualifierUpdate,
  onQualifierDelete,
  onReferenceCreate,
  onReferenceUpdate,
  onReferenceDelete,
}) {
  if (!claim) return null;

  const { $id, property, value_raw, value_relation, qualifiersList, referencesList } = claim;

  // Parsear value_raw si es string
  let parsedValue = null;
  if (value_raw) {
    try {
      parsedValue = typeof value_raw === "string" ? JSON.parse(value_raw) : value_raw;
    } catch (e) {
      parsedValue = { datatype: "string", data: value_raw };
    }
  }

  // Estados para modales
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete?.(claim.$id);
      setShowDeleteConfirm(false);
    } catch (e) {
      console.error("Error deleting claim:", e);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="claim-item">
      <div className="claim-main">
        {/* Propiedad */}
        <div className="claim-property">
          {property ? (
            <Link href={`/entity/${property.$id}`} className="property-link">
              {property.label || property.$id}
            </Link>
          ) : (
            <span className="property-unknown">(Propiedad desconocida)</span>
          )}
        </div>

        {/* Valor */}
        <div className="claim-value">
          {value_relation ? (
            <Link href={`/entity/${value_relation.$id}`} className="value-entity-link">
              {value_relation.label || value_relation.$id}
            </Link>
          ) : parsedValue ? (
            <ValueRenderer value={parsedValue} />
          ) : (
            <span className="value-empty">(Sin valor)</span>
          )}
        </div>

        {/* Acciones del claim */}
        {editable && (
          <div className="claim-actions">
            <button
              type="button"
              className="btn-icon btn-edit"
              onClick={() => onEdit?.(claim)}
              title="Editar declaración"
            >
              ✎
            </button>
            <button
              type="button"
              className="btn-icon btn-edit"
              onClick={() => setShowPermissions(true)}
              title="Permisos"
            >
              🔐
            </button>
            <button
              type="button"
              className="btn-icon btn-delete"
              onClick={() => setShowDeleteConfirm(true)}
              title="Eliminar declaración"
            >
              🗑
            </button>
          </div>
        )}
      </div>

      {/* Qualifiers */}
      {showQualifiers && (
        <div className="claim-qualifiers">
          {qualifiersList && qualifiersList.length > 0 && (
            qualifiersList.map((qualifier) => (
              <QualifierItem 
                key={qualifier.$id} 
                qualifier={qualifier}
                editable={editable}
                onEdit={onQualifierUpdate}
                onDelete={onQualifierDelete}
              />
            ))
          )}
          {editable && (
            <AddQualifierButton 
              claimId={$id} 
              onSave={onQualifierCreate}
            />
          )}
        </div>
      )}

      {/* Referencias */}
      {showReferences && (
        <div className="claim-references">
          <details className="references-toggle">
            <summary>
              <span className="icon-info"></span>
              {referencesList?.length || 0} referencia{(referencesList?.length || 0) !== 1 ? "s" : ""}
            </summary>
            <div className="references-list">
              {referencesList?.map((ref) => (
                <ReferenceItem 
                  key={ref.$id} 
                  reference={ref}
                  editable={editable}
                  onEdit={onReferenceUpdate}
                  onDelete={onReferenceDelete}
                />
              ))}
              {editable && (
                <AddReferenceButton 
                  claimId={$id} 
                  onSave={onReferenceCreate}
                />
              )}
            </div>
          </details>
        </div>
      )}

      {/* Modal de confirmación de eliminación */}
      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Eliminar declaración"
        message="¿Estás seguro de que deseas eliminar esta declaración? También se eliminarán todos sus calificadores y referencias."
        loading={deleting}
      />

      <PermissionsModal
        isOpen={showPermissions}
        onClose={() => setShowPermissions(false)}
        title="Permisos del claim"
        permissions={claim.$permissions || []}
        onSave={async (permissions) => {
          await updateClaimPermissions(claim.$id, permissions);
        }}
      />
    </div>
  );
}

/**
 * Muestra un qualifier
 */
function QualifierItem({ qualifier, editable, onEdit, onDelete }) {
  const { property, value_raw, value_relation } = qualifier;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const [deleting, setDeleting] = useState(false);

  let parsedValue = null;
  if (value_raw) {
    try {
      parsedValue = typeof value_raw === "string" ? JSON.parse(value_raw) : value_raw;
    } catch (e) {
      parsedValue = { datatype: "string", data: value_raw };
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete?.(qualifier.$id);
      setShowDeleteConfirm(false);
    } catch (e) {
      console.error("Error deleting qualifier:", e);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="qualifier-item">
      <span className="qualifier-property">
        {property ? (
          <Link href={`/entity/${property.$id}`}>
            {property.label || property.$id}
          </Link>
        ) : (
          "(Propiedad)"
        )}
      </span>
      <span className="qualifier-value">
        {value_relation ? (
          <Link href={`/entity/${value_relation.$id}`}>
            {value_relation.label || value_relation.$id}
          </Link>
        ) : parsedValue ? (
          <ValueRenderer value={parsedValue} compact />
        ) : (
          "(Sin valor)"
        )}
      </span>

      {editable && (
        <div className="qualifier-actions">
          <button
            type="button"
            className="btn-icon-sm btn-edit"
            onClick={() => setShowEditForm(true)}
            title="Editar calificador"
          >
            ✎
          </button>
          <button
            type="button"
            className="btn-icon-sm btn-edit"
            onClick={() => setShowPermissions(true)}
            title="Permisos"
          >
            🔐
          </button>
          <button
            type="button"
            className="btn-icon-sm btn-delete"
            onClick={() => setShowDeleteConfirm(true)}
            title="Eliminar calificador"
          >
            🗑
          </button>
        </div>
      )}

      {showEditForm && (
        <QualifierForm
          isOpen={showEditForm}
          onClose={() => setShowEditForm(false)}
          onSave={async (data) => {
            await onEdit?.(data, qualifier.$id);
          }}
          qualifier={qualifier}
          claimId={qualifier.claim}
        />
      )}

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Eliminar calificador"
        message="¿Estás seguro de que deseas eliminar este calificador?"
        loading={deleting}
      />

      <PermissionsModal
        isOpen={showPermissions}
        onClose={() => setShowPermissions(false)}
        title="Permisos del calificador"
        permissions={qualifier.$permissions || []}
        onSave={async (permissions) => {
          await updateQualifierPermissions(qualifier.$id, permissions);
        }}
      />
    </div>
  );
}

/**
 * Muestra una referencia
 */
function ReferenceItem({ reference, editable, onEdit, onDelete }) {
  const { details, reference: refEntity } = reference;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete?.(reference.$id);
      setShowDeleteConfirm(false);
    } catch (e) {
      console.error("Error deleting reference:", e);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="reference-item">
      {refEntity && (
        <Link href={`/entity/${refEntity.$id}`} className="reference-entity">
          {refEntity.label || refEntity.$id}
        </Link>
      )}
      {details && <span className="reference-details">{details}</span>}

      {editable && (
        <div className="reference-actions">
          <button
            type="button"
            className="btn-icon-sm btn-edit"
            onClick={() => setShowEditForm(true)}
            title="Editar referencia"
          >
            ✎
          </button>
          <button
            type="button"
            className="btn-icon-sm btn-edit"
            onClick={() => setShowPermissions(true)}
            title="Permisos"
          >
            🔐
          </button>
          <button
            type="button"
            className="btn-icon-sm btn-delete"
            onClick={() => setShowDeleteConfirm(true)}
            title="Eliminar referencia"
          >
            🗑
          </button>
        </div>
      )}

      {showEditForm && (
        <ReferenceForm
          isOpen={showEditForm}
          onClose={() => setShowEditForm(false)}
          onSave={async (data) => {
            await onEdit?.(data, reference.$id);
          }}
          reference={reference}
          claimId={reference.claim}
        />
      )}

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Eliminar referencia"
        message="¿Estás seguro de que deseas eliminar esta referencia?"
        loading={deleting}
      />

      <PermissionsModal
        isOpen={showPermissions}
        onClose={() => setShowPermissions(false)}
        title="Permisos de la referencia"
        permissions={reference.$permissions || []}
        onSave={async (permissions) => {
          await updateReferencePermissions(reference.$id, permissions);
        }}
      />
    </div>
  );
}

/**
 * Botón para añadir un qualifier
 */
function AddQualifierButton({ claimId, onSave }) {
  const [showForm, setShowForm] = useState(false);

  return (
    <>
      <button
        type="button"
        className="btn-add-inline"
        onClick={() => setShowForm(true)}
      >
        + Añadir calificador
      </button>

      {showForm && (
        <QualifierForm
          isOpen={showForm}
          onClose={() => setShowForm(false)}
          onSave={async (data) => {
            await onSave?.(data);
            setShowForm(false);
          }}
          claimId={claimId}
        />
      )}
    </>
  );
}

/**
 * Botón para añadir una referencia
 */
function AddReferenceButton({ claimId, onSave }) {
  const [showForm, setShowForm] = useState(false);

  return (
    <>
      <button
        type="button"
        className="btn-add-inline"
        onClick={() => setShowForm(true)}
      >
        + Añadir referencia
      </button>

      {showForm && (
        <ReferenceForm
          isOpen={showForm}
          onClose={() => setShowForm(false)}
          onSave={async (data) => {
            await onSave?.(data);
            setShowForm(false);
          }}
          claimId={claimId}
        />
      )}
    </>
  );
}
