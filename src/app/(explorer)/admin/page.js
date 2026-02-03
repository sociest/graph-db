"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Navigation, LoadingState, ErrorState } from "@/components";
import { useAuth } from "@/context/AuthContext";
import { getAuditLog } from "@/lib/database";

const ITEMS_PER_PAGE = 25;

const ACTION_LABELS = {
  create: "Creado",
  update: "Actualizado",
  delete: "Eliminado",
};

const ENTITY_TYPE_LABELS = {
  entity: "Entidad",
  claim: "Declaración",
  qualifier: "Calificador",
  reference: "Referencia",
};

const ACTION_COLORS = {
  create: "action-create",
  update: "action-update",
  delete: "action-delete",
};

export default function AdminPage() {
  const router = useRouter();
  const { 
    user, 
    isAuthenticated, 
    authEnabled, 
    isAdmin,
    isMainTeamMember,
    permissions, 
    userTeams,
    activeTeam,
    mainTeamId,
    loading: authLoading 
  } = useAuth();

  const [auditLogs, setAuditLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filtros
  const [filterAction, setFilterAction] = useState("");
  const [filterEntityType, setFilterEntityType] = useState("");

  // Debug log
  useEffect(() => {
    console.log("[AdminPage] Auth state:", {
      authLoading,
      authEnabled,
      isAuthenticated,
      isAdmin,
      isMainTeamMember,
      userTeams: userTeams?.length,
      activeTeam: activeTeam?.name,
      mainTeamId,
      permissions
    });
  }, [authLoading, authEnabled, isAuthenticated, isAdmin, isMainTeamMember, userTeams, activeTeam, mainTeamId, permissions]);

  useEffect(() => {
    if (!authLoading) {
      // Si la autenticación está habilitada y el usuario no es admin, redirigir
      if (authEnabled && !isAdmin) {
        console.log("[AdminPage] Redirigiendo porque no es admin. isAdmin:", isAdmin);
        router.push("/");
        return;
      }
      loadAuditLog();
    }
  }, [authLoading, authEnabled, isAdmin, page, filterAction, filterEntityType]);

  async function loadAuditLog() {
    setLoading(true);
    setError(null);
    try {
      const filters = {};
      if (filterAction) filters.action = filterAction;
      if (filterEntityType) filters.entityType = filterEntityType;

      const result = await getAuditLog(
        ITEMS_PER_PAGE, 
        page * ITEMS_PER_PAGE, 
        filters
      );
      setAuditLogs(result.logs);
      setTotal(result.total);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  function nextPage() {
    if ((page + 1) * ITEMS_PER_PAGE < total) {
      setPage((p) => p + 1);
    }
  }

  function prevPage() {
    if (page > 0) {
      setPage((p) => p - 1);
    }
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

  // Verificar permisos
  if (authEnabled && !isAdmin) {
    return null; // Se redirigirá en el useEffect
  }

  return (
    <div className="explorer-layout">
      <Navigation />

      <main className="explorer-main">
        <div className="explorer-container">
          <header className="page-header">
            <div className="page-header-content">
              <h1 className="page-title">Panel de Administración</h1>
              <p className="page-subtitle">
                Gestión de permisos e historial de cambios
              </p>
            </div>
          </header>

          {/* Sección de Permisos */}
          <section className="admin-section">
            <h2 className="section-title">
              <span className="icon-shield"></span>
              Permisos del Usuario
            </h2>

            <div className="permissions-card">
              {authEnabled && user ? (
                <>
                  <div className="user-info">
                    <div className="user-avatar">
                      {user.name?.charAt(0)?.toUpperCase() || user.email?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="user-details">
                      <h3 className="user-name">{user.name || "Usuario"}</h3>
                      <p className="user-email">{user.email}</p>
                      <p className="user-id">ID: {user.$id}</p>
                    </div>
                  </div>

                  <div className="permissions-grid">
                    <div className="permission-item">
                      <span className={`permission-badge ${permissions.canView ? "active" : "inactive"}`}>
                        {permissions.canView ? "✓" : "✗"}
                      </span>
                      <span className="permission-label">Ver</span>
                    </div>
                    <div className="permission-item">
                      <span className={`permission-badge ${permissions.canCreate ? "active" : "inactive"}`}>
                        {permissions.canCreate ? "✓" : "✗"}
                      </span>
                      <span className="permission-label">Crear</span>
                    </div>
                    <div className="permission-item">
                      <span className={`permission-badge ${permissions.canEdit ? "active" : "inactive"}`}>
                        {permissions.canEdit ? "✓" : "✗"}
                      </span>
                      <span className="permission-label">Editar</span>
                    </div>
                    <div className="permission-item">
                      <span className={`permission-badge ${permissions.canDelete ? "active" : "inactive"}`}>
                        {permissions.canDelete ? "✓" : "✗"}
                      </span>
                      <span className="permission-label">Eliminar</span>
                    </div>
                    <div className="permission-item">
                      <span className={`permission-badge ${permissions.isAdmin ? "active" : "inactive"}`}>
                        {permissions.isAdmin ? "✓" : "✗"}
                      </span>
                      <span className="permission-label">Administrador</span>
                    </div>
                  </div>

                  {permissions.roles.length > 0 && (
                    <div className="roles-section">
                      <h4>Roles asignados:</h4>
                      <div className="roles-list">
                        {permissions.roles.map((role, index) => (
                          <span key={index} className="role-badge">{role}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {userTeams.length > 0 && (
                    <div className="teams-section">
                      <h4>Equipos:</h4>
                      <div className="teams-list">
                        {userTeams.map((team) => (
                          <div 
                            key={team.$id} 
                            className={`team-card ${team.$id === mainTeamId ? "main-team" : ""} ${activeTeam?.$id === team.$id ? "active" : ""}`}
                          >
                            <div className="team-card-header">
                              <span className="team-name">
                                {team.$id === mainTeamId && <span className="main-badge">★ Main</span>}
                                {team.name}
                              </span>
                              {activeTeam?.$id === team.$id && (
                                <span className="active-badge">Activo</span>
                              )}
                            </div>
                            <div className="team-card-details">
                              <span className="team-id">ID: {team.$id}</span>
                              <span className="team-members-count">{team.total} miembros</span>
                            </div>
                            {team.roles && team.roles.length > 0 && (
                              <div className="team-roles">
                                {team.roles.map((role, idx) => (
                                  <span key={idx} className={`role-tag ${role}`}>{role}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {isMainTeamMember && (
                    <div className="main-team-notice">
                      <span className="notice-icon">★</span>
                      <span>Eres miembro del Main Team. Tienes permisos de administrador.</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="no-auth-message">
                  <p>
                    {authEnabled 
                      ? "No hay usuario autenticado"
                      : "La autenticación está deshabilitada. Todos los usuarios tienen permisos completos."
                    }
                  </p>
                  {!authEnabled && (
                    <div className="permissions-grid">
                      <div className="permission-item">
                        <span className="permission-badge active">✓</span>
                        <span className="permission-label">Todos los permisos activos</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Sección de Historial */}
          <section className="admin-section">
            <h2 className="section-title">
              <span className="icon-history"></span>
              Historial de Cambios
            </h2>

            {/* Filtros */}
            <div className="audit-filters">
              <div className="filter-group">
                <label className="form-label">Acción</label>
                <select
                  className="form-select"
                  value={filterAction}
                  onChange={(e) => {
                    setFilterAction(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">Todas</option>
                  <option value="create">Crear</option>
                  <option value="update">Actualizar</option>
                  <option value="delete">Eliminar</option>
                </select>
              </div>
              <div className="filter-group">
                <label className="form-label">Tipo</label>
                <select
                  className="form-select"
                  value={filterEntityType}
                  onChange={(e) => {
                    setFilterEntityType(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">Todos</option>
                  <option value="entity">Entidades</option>
                  <option value="claim">Declaraciones</option>
                  <option value="qualifier">Calificadores</option>
                  <option value="reference">Referencias</option>
                </select>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setFilterAction("");
                  setFilterEntityType("");
                  setPage(0);
                }}
              >
                Limpiar filtros
              </button>
            </div>

            {loading ? (
              <LoadingState message="Cargando historial..." />
            ) : error ? (
              <ErrorState error={error} onRetry={loadAuditLog} />
            ) : auditLogs.length === 0 ? (
              <div className="empty-state">
                <p>No hay registros en el historial.</p>
                <p className="text-muted">
                  Los cambios realizados en entidades, declaraciones, calificadores y referencias aparecerán aquí.
                </p>
              </div>
            ) : (
              <>
                <div className="audit-log-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Acción</th>
                        <th>Tipo</th>
                        <th>ID</th>
                        <th>Usuario</th>
                        <th>Detalles</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((log) => (
                        <tr key={log.$id}>
                          <td className="log-date">
                            {new Date(log.$createdAt).toLocaleString()}
                          </td>
                          <td>
                            <span className={`action-badge ${ACTION_COLORS[log.action] || ""}`}>
                              {ACTION_LABELS[log.action] || log.action}
                            </span>
                          </td>
                          <td>
                            {ENTITY_TYPE_LABELS[log.entity_type] || log.entity_type}
                          </td>
                          <td className="log-entity-id">
                            {log.entity_type === "entity" ? (
                              <Link href={`/entity/${log.entity_id}`}>
                                {log.entity_id}
                              </Link>
                            ) : (
                              <span>{log.entity_id}</span>
                            )}
                          </td>
                          <td>
                            {log.user_name || log.user_id || "Sistema"}
                          </td>
                          <td>
                            <LogDetails log={log} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Paginación */}
                <nav className="pagination">
                  <button
                    onClick={prevPage}
                    disabled={page === 0}
                    className="pagination-button"
                  >
                    Anterior
                  </button>
                  <span className="pagination-info">
                    Página {page + 1} de {Math.ceil(total / ITEMS_PER_PAGE) || 1}
                  </span>
                  <button
                    onClick={nextPage}
                    disabled={(page + 1) * ITEMS_PER_PAGE >= total}
                    className="pagination-button"
                  >
                    Siguiente
                  </button>
                </nav>
              </>
            )}
          </section>
        </div>
      </main>

      <footer className="explorer-footer">
        <p>Graph DB Explorer — Panel de Administración</p>
      </footer>
    </div>
  );
}

/**
 * Componente para mostrar detalles del log
 */
function LogDetails({ log }) {
  const [expanded, setExpanded] = useState(false);

  const hasDetails = log.previous_data || log.new_data || log.metadata;

  if (!hasDetails) {
    return <span className="text-muted">—</span>;
  }

  return (
    <div className="log-details">
      <button
        type="button"
        className="btn-link"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "Ocultar" : "Ver detalles"}
      </button>
      
      {expanded && (
        <div className="log-details-content">
          {log.previous_data && (
            <div className="log-data-section">
              <strong>Datos anteriores:</strong>
              <pre>{JSON.stringify(log.previous_data, null, 2)}</pre>
            </div>
          )}
          {log.new_data && (
            <div className="log-data-section">
              <strong>Datos nuevos:</strong>
              <pre>{JSON.stringify(log.new_data, null, 2)}</pre>
            </div>
          )}
          {log.metadata && (
            <div className="log-data-section">
              <strong>Metadata:</strong>
              <pre>{JSON.stringify(log.metadata, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
