"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Navigation, LoadingState, ErrorState } from "@/components";
import { useAuth } from "@/context/AuthContext";
import {
  createTeam,
  getTeamMembers,
  inviteToTeam,
  updateMemberRoles,
  removeMember,
  deleteTeam,
  DEFAULT_TEAM_ROLES,
} from "@/lib/auth";

export default function TeamsPage() {
  const router = useRouter();
  const {
    user,
    userTeams,
    activeTeam,
    isAuthenticated,
    authEnabled,
    loading: authLoading,
    refreshUser,
    switchTeam,
  } = useAuth();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  
  // Estados para crear team
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  
  // Estados para ver miembros
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  
  // Estados para invitar
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");

  useEffect(() => {
    if (!authLoading && authEnabled && !isAuthenticated) {
      router.push("/");
    }
  }, [authLoading, authEnabled, isAuthenticated, router]);

  useEffect(() => {
    if (selectedTeam) {
      loadTeamMembers(selectedTeam.$id);
    }
  }, [selectedTeam]);

  async function loadTeamMembers(teamId) {
    setLoadingMembers(true);
    try {
      const members = await getTeamMembers(teamId);
      setTeamMembers(members);
    } catch (err) {
      console.error("Error loading members:", err);
      setTeamMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  }

  async function handleCreateTeam(e) {
    e.preventDefault();
    if (!newTeamName.trim()) return;

    setLoading(true);
    setError(null);
    try {
      await createTeam(newTeamName.trim());
      setNewTeamName("");
      setShowCreateForm(false);
      setSuccess("Equipo creado exitosamente");
      await refreshUser();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err.message || "Error al crear el equipo");
    } finally {
      setLoading(false);
    }
  }

  async function handleInvite(e) {
    e.preventDefault();
    if (!inviteEmail.trim() || !selectedTeam) return;

    setLoading(true);
    setError(null);
    try {
      await inviteToTeam(selectedTeam.$id, inviteEmail.trim(), [inviteRole]);
      setInviteEmail("");
      setShowInviteForm(false);
      setSuccess("Invitación enviada exitosamente");
      await loadTeamMembers(selectedTeam.$id);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err.message || "Error al enviar la invitación");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateRole(membershipId, newRoles) {
    if (!selectedTeam) return;

    setLoading(true);
    setError(null);
    try {
      await updateMemberRoles(selectedTeam.$id, membershipId, newRoles);
      setSuccess("Roles actualizados");
      await loadTeamMembers(selectedTeam.$id);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err.message || "Error al actualizar los roles");
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveMember(membershipId) {
    if (!selectedTeam) return;
    if (!confirm("¿Estás seguro de que deseas eliminar este miembro?")) return;

    setLoading(true);
    setError(null);
    try {
      await removeMember(selectedTeam.$id, membershipId);
      setSuccess("Miembro eliminado");
      await loadTeamMembers(selectedTeam.$id);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err.message || "Error al eliminar el miembro");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteTeam(teamId) {
    if (!confirm("¿Estás seguro de que deseas eliminar este equipo? Esta acción no se puede deshacer.")) return;

    setLoading(true);
    setError(null);
    try {
      await deleteTeam(teamId);
      setSuccess("Equipo eliminado");
      setSelectedTeam(null);
      await refreshUser();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err.message || "Error al eliminar el equipo");
    } finally {
      setLoading(false);
    }
  }

  function isTeamOwner(team) {
    return team?.roles?.includes("owner");
  }

  function isTeamAdmin(team) {
    return team?.roles?.includes("owner") || team?.roles?.includes("admin");
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

  if (!authEnabled) {
    return (
      <div className="explorer-layout">
        <Navigation />
        <main className="explorer-main">
          <div className="explorer-container">
            <div className="empty-state">
              <p>La autenticación no está habilitada</p>
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
        <div className="explorer-container">
          <div className="page-header">
            <h1>Gestión de Equipos</h1>
            <button
              className="btn btn-primary"
              onClick={() => setShowCreateForm(true)}
            >
              + Crear Equipo
            </button>
          </div>

          {error && (
            <div className="alert alert-error">
              {error}
              <button onClick={() => setError(null)}>×</button>
            </div>
          )}

          {success && (
            <div className="alert alert-success">
              {success}
            </div>
          )}

          {/* Formulario de crear equipo */}
          {showCreateForm && (
            <div className="modal-overlay" onClick={() => setShowCreateForm(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h2>Crear Nuevo Equipo</h2>
                  <button className="close-btn" onClick={() => setShowCreateForm(false)}>×</button>
                </div>
                <form onSubmit={handleCreateTeam}>
                  <div className="form-group">
                    <label>Nombre del equipo</label>
                    <input
                      type="text"
                      value={newTeamName}
                      onChange={(e) => setNewTeamName(e.target.value)}
                      placeholder="Ej: Mi Equipo de Trabajo"
                      required
                      autoFocus
                    />
                  </div>
                  <div className="form-group">
                    <label>Roles disponibles</label>
                    <div className="roles-preview">
                      {DEFAULT_TEAM_ROLES.map((role) => (
                        <span key={role} className={`role-badge ${role}`}>
                          {role}
                        </span>
                      ))}
                    </div>
                    <small>Estos son los roles predeterminados para el equipo</small>
                  </div>
                  <div className="modal-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowCreateForm(false)}>
                      Cancelar
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                      {loading ? "Creando..." : "Crear Equipo"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Lista de equipos */}
          <div className="teams-layout">
            <div className="teams-list-panel">
              <h2>Mis Equipos ({userTeams.length})</h2>
              {userTeams.length === 0 ? (
                <div className="empty-state">
                  <p>No perteneces a ningún equipo</p>
                  <button className="btn btn-primary" onClick={() => setShowCreateForm(true)}>
                    Crear tu primer equipo
                  </button>
                </div>
              ) : (
                <ul className="teams-list">
                  {userTeams.map((team) => (
                    <li
                      key={team.$id}
                      className={`team-item ${selectedTeam?.$id === team.$id ? "selected" : ""} ${activeTeam?.$id === team.$id ? "active" : ""}`}
                      onClick={() => setSelectedTeam(team)}
                    >
                      <div className="team-item-info">
                        <span className="team-name">{team.name}</span>
                        <div className="team-meta">
                          <span className="team-members-count">{team.total} miembros</span>
                          <span className={`role-badge small ${team.roles?.[0] || "viewer"}`}>
                            {team.roles?.[0] || "viewer"}
                          </span>
                        </div>
                      </div>
                      {activeTeam?.$id === team.$id && (
                        <span className="active-indicator">Activo</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Panel de detalles del equipo */}
            <div className="team-details-panel">
              {selectedTeam ? (
                <>
                  <div className="team-details-header">
                    <div>
                      <h2>{selectedTeam.name}</h2>
                      <p className="team-id">ID: {selectedTeam.$id}</p>
                    </div>
                    <div className="team-actions">
                      {activeTeam?.$id !== selectedTeam.$id && (
                        <button
                          className="btn btn-secondary"
                          onClick={() => switchTeam(selectedTeam)}
                        >
                          Activar
                        </button>
                      )}
                      {isTeamOwner(selectedTeam) && (
                        <button
                          className="btn btn-danger"
                          onClick={() => handleDeleteTeam(selectedTeam.$id)}
                        >
                          Eliminar
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Sección de miembros */}
                  <div className="team-members-section">
                    <div className="section-header">
                      <h3>Miembros</h3>
                      {isTeamAdmin(selectedTeam) && (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => setShowInviteForm(true)}
                        >
                          + Invitar
                        </button>
                      )}
                    </div>

                    {loadingMembers ? (
                      <LoadingState message="Cargando miembros..." />
                    ) : (
                      <div className="members-list">
                        {teamMembers.map((member) => (
                          <div key={member.$id} className="member-item">
                            <div className="member-info">
                              <div className="member-avatar">
                                {member.userName?.charAt(0).toUpperCase() || member.userEmail?.charAt(0).toUpperCase() || "?"}
                              </div>
                              <div className="member-details">
                                <span className="member-name">
                                  {member.userName || member.userEmail}
                                </span>
                                <span className="member-email">{member.userEmail}</span>
                                {!member.confirm && (
                                  <span className="pending-badge">Pendiente</span>
                                )}
                              </div>
                            </div>
                            <div className="member-roles">
                              <span className={`role-badge ${member.roles?.[0] || "viewer"}`}>
                                {member.roles?.[0] || "viewer"}
                              </span>
                            </div>
                            {isTeamAdmin(selectedTeam) && member.userId !== user?.$id && !member.roles?.includes("owner") && (
                              <div className="member-actions">
                                <select
                                  value={member.roles?.[0] || "viewer"}
                                  onChange={(e) => handleUpdateRole(member.$id, [e.target.value])}
                                  disabled={loading}
                                >
                                  {DEFAULT_TEAM_ROLES.filter(r => r !== "owner").map((role) => (
                                    <option key={role} value={role}>
                                      {role}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className="btn btn-danger btn-sm"
                                  onClick={() => handleRemoveMember(member.$id)}
                                  disabled={loading}
                                >
                                  Eliminar
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Formulario de invitación */}
                  {showInviteForm && (
                    <div className="modal-overlay" onClick={() => setShowInviteForm(false)}>
                      <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                          <h2>Invitar a {selectedTeam.name}</h2>
                          <button className="close-btn" onClick={() => setShowInviteForm(false)}>×</button>
                        </div>
                        <form onSubmit={handleInvite}>
                          <div className="form-group">
                            <label>Email del usuario</label>
                            <input
                              type="email"
                              value={inviteEmail}
                              onChange={(e) => setInviteEmail(e.target.value)}
                              placeholder="usuario@ejemplo.com"
                              required
                              autoFocus
                            />
                          </div>
                          <div className="form-group">
                            <label>Rol</label>
                            <select
                              value={inviteRole}
                              onChange={(e) => setInviteRole(e.target.value)}
                            >
                              {DEFAULT_TEAM_ROLES.filter(r => r !== "owner").map((role) => (
                                <option key={role} value={role}>
                                  {role}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setShowInviteForm(false)}>
                              Cancelar
                            </button>
                            <button type="submit" className="btn btn-primary" disabled={loading}>
                              {loading ? "Enviando..." : "Enviar Invitación"}
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <p>Selecciona un equipo para ver sus detalles</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <style jsx>{`
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2rem;
        }

        .teams-layout {
          display: grid;
          grid-template-columns: 350px 1fr;
          gap: 2rem;
          min-height: 500px;
        }

        .teams-list-panel {
          background: var(--color-bg-card, #ffffff);
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-lg, 8px);
          padding: 1.5rem;
        }

        .teams-list-panel h2 {
          margin-bottom: 1rem;
          font-size: 1.1rem;
          color: var(--color-text, #202122);
        }

        .teams-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .team-item {
          padding: 1rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-md, 4px);
          margin-bottom: 0.5rem;
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          transition: all 0.2s;
          background: var(--color-bg-card, #ffffff);
        }

        .team-item:hover {
          background: var(--color-bg-alt, #eaecf0);
          border-color: var(--color-border, #a2a9b1);
        }

        .team-item.selected {
          border-color: var(--color-primary, #0645ad);
          background: rgba(6, 69, 173, 0.05);
        }

        .team-item.active {
          border-left: 3px solid var(--color-success, #14866d);
        }

        .team-item-info {
          flex: 1;
        }

        .team-name {
          font-weight: 600;
          display: block;
          color: var(--color-text, #202122);
        }

        .team-meta {
          display: flex;
          gap: 0.5rem;
          align-items: center;
          margin-top: 0.25rem;
          font-size: 0.85rem;
          color: var(--color-text-secondary, #54595d);
        }

        .active-indicator {
          background: var(--color-success, #14866d);
          color: white;
          padding: 0.25rem 0.5rem;
          border-radius: var(--radius-sm, 2px);
          font-size: 0.75rem;
        }

        .team-details-panel {
          background: var(--color-bg-card, #ffffff);
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-lg, 8px);
          padding: 1.5rem;
        }

        .team-details-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 2rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid var(--color-border-light, #c8ccd1);
        }

        .team-details-header h2 {
          margin: 0;
          color: var(--color-text, #202122);
        }

        .team-id {
          color: var(--color-text-muted, #72777d);
          font-size: 0.85rem;
          font-family: var(--font-mono, monospace);
        }

        .team-actions {
          display: flex;
          gap: 0.5rem;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }

        .section-header h3 {
          margin: 0;
          color: var(--color-text, #202122);
        }

        .members-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .member-item {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem;
          background: var(--color-bg, #f8f9fa);
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-md, 4px);
        }

        .member-info {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          flex: 1;
        }

        .member-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: var(--color-primary, #0645ad);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 1rem;
        }

        .member-details {
          display: flex;
          flex-direction: column;
        }

        .member-name {
          font-weight: 600;
          color: var(--color-text, #202122);
        }

        .member-email {
          font-size: 0.85rem;
          color: var(--color-text-secondary, #54595d);
        }

        .pending-badge {
          background: var(--color-warning, #fc3);
          color: #333;
          padding: 0.125rem 0.5rem;
          border-radius: var(--radius-sm, 2px);
          font-size: 0.75rem;
          margin-top: 0.25rem;
          width: fit-content;
        }

        .member-roles {
          display: flex;
          gap: 0.25rem;
        }

        .member-actions {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        .member-actions select {
          padding: 0.375rem 0.5rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-sm, 2px);
          background: var(--color-bg-card, #ffffff);
          font-size: 0.875rem;
          color: var(--color-text, #202122);
        }

        .role-badge {
          padding: 0.25rem 0.5rem;
          border-radius: var(--radius-sm, 2px);
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: capitalize;
        }

        .role-badge.small {
          padding: 0.125rem 0.375rem;
          font-size: 0.7rem;
        }

        .role-badge.owner {
          background: #ffd700;
          color: #333;
        }

        .role-badge.admin {
          background: #d33;
          color: white;
        }

        .role-badge.editor {
          background: var(--color-success, #14866d);
          color: white;
        }

        .role-badge.viewer {
          background: var(--color-secondary, #54595d);
          color: white;
        }

        .roles-preview {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
          margin-bottom: 0.5rem;
        }

        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .modal {
          background: var(--color-bg-card, #ffffff);
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-lg, 8px);
          width: 100%;
          max-width: 500px;
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: var(--shadow-lg, 0 4px 16px rgba(0, 0, 0, 0.15));
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 1.5rem;
          border-bottom: 1px solid var(--color-border-light, #c8ccd1);
          background: var(--color-bg, #f8f9fa);
        }

        .modal-header h2 {
          margin: 0;
          font-size: 1.25rem;
          color: var(--color-text, #202122);
        }

        .close-btn {
          background: none;
          border: none;
          font-size: 1.5rem;
          cursor: pointer;
          color: var(--color-text-secondary, #54595d);
          padding: 0;
          line-height: 1;
        }

        .close-btn:hover {
          color: var(--color-text, #202122);
        }

        .modal form {
          padding: 1.5rem;
          background: var(--color-bg-card, #ffffff);
        }

        .form-group {
          margin-bottom: 1.25rem;
        }

        .form-group label {
          display: block;
          margin-bottom: 0.5rem;
          font-weight: 600;
          color: var(--color-text, #202122);
        }

        .form-group input,
        .form-group select {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid var(--color-border-light, #c8ccd1);
          border-radius: var(--radius-md, 4px);
          font-size: 1rem;
          background: var(--color-bg-card, #ffffff);
          color: var(--color-text, #202122);
        }

        .form-group input:focus,
        .form-group select:focus {
          outline: none;
          border-color: var(--color-primary, #0645ad);
          box-shadow: 0 0 0 2px rgba(6, 69, 173, 0.1);
        }

        .form-group small {
          color: var(--color-text-muted, #72777d);
          font-size: 0.85rem;
          display: block;
          margin-top: 0.25rem;
        }

        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.75rem;
          padding-top: 1rem;
          margin-top: 0.5rem;
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

        .alert-success {
          background: rgba(20, 134, 109, 0.1);
          color: var(--color-success, #14866d);
          border: 1px solid var(--color-success, #14866d);
        }

        .alert button {
          background: none;
          border: none;
          font-size: 1.25rem;
          cursor: pointer;
          color: inherit;
          padding: 0;
          line-height: 1;
        }

        .empty-state {
          text-align: center;
          padding: 3rem;
          color: var(--color-text-secondary, #54595d);
        }

        .empty-state p {
          margin: 0 0 1rem 0;
        }

        .btn {
          padding: 0.5rem 1rem;
          border: none;
          border-radius: var(--radius-md, 4px);
          cursor: pointer;
          font-weight: 600;
          transition: all 0.2s;
          font-size: 0.875rem;
        }

        .btn-sm {
          padding: 0.25rem 0.75rem;
          font-size: 0.8rem;
        }

        .btn-primary {
          background: var(--color-primary, #0645ad);
          color: white;
        }

        .btn-primary:hover {
          background: var(--color-primary-hover, #0b0080);
        }

        .btn-secondary {
          background: var(--color-bg-card, #ffffff);
          border: 1px solid var(--color-border, #a2a9b1);
          color: var(--color-text, #202122);
        }

        .btn-secondary:hover {
          background: var(--color-bg-alt, #eaecf0);
        }

        .btn-danger {
          background: var(--color-error, #d33);
          color: white;
        }

        .btn-danger:hover {
          background: #b02828;
        }

        .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        @media (max-width: 768px) {
          .teams-layout {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
