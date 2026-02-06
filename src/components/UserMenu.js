"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

export default function UserMenu({ onLoginClick }) {
  const {
    user,
    userTeams,
    activeTeam,
    isAuthenticated,
    isAdmin,
    isMainTeamMember,
    logout,
    authEnabled,
    loading,
    switchTeam,
  } = useAuth();

  const [showTeamSelector, setShowTeamSelector] = useState(false);

  if (!authEnabled) {
    return null;
  }

  if (loading) {
    return <div className="user-menu-loading">...</div>;
  }

  if (!isAuthenticated) {
    return (
      <button className="login-btn" onClick={onLoginClick}>
        <span className="icon-user"></span>
        Iniciar Sesión
      </button>
    );
  }

  function handleTeamSwitch(team) {
    switchTeam(team);
    setShowTeamSelector(false);
  }

  return (
    <div className="user-menu">
      <div className="user-info">
        <div className="user-avatar">
          {user.name?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase()}
        </div>
        <div className="user-details">
          <span className="user-name">{user.name || user.email}</span>
          <button
            className="user-team-btn"
            onClick={() => setShowTeamSelector(!showTeamSelector)}
            title={userTeams.length > 0 ? "Cambiar equipo" : "Sin equipos"}
          >
            <span className="team-indicator">
              {isMainTeamMember && <span className="admin-badge">★</span>}
              {activeTeam ? activeTeam.name : "Sin equipo"}
            </span>
            <span className="team-switch-icon">▾</span>
          </button>
        </div>
      </div>

      {/* Selector de Team */}
      {showTeamSelector && (
        <div className="team-selector-dropdown">
          <div className="dropdown-header">
            <span>Cambiar equipo</span>
            <Link href="/teams" className="manage-teams-link" onClick={() => setShowTeamSelector(false)}>
              Gestionar
            </Link>
          </div>
          {userTeams.length === 0 ? (
            <div className="no-teams-message">
              <p>No perteneces a ningún equipo</p>
              <Link href="/teams" className="create-team-link" onClick={() => setShowTeamSelector(false)}>
                + Crear equipo
              </Link>
            </div>
          ) : (
            userTeams.map((team) => (
              <button
                key={team.$id}
                className={`team-option ${activeTeam?.$id === team.$id ? "active" : ""}`}
                onClick={() => handleTeamSwitch(team)}
              >
                <span className="team-option-name">{team.name}</span>
                {team.roles?.includes("owner") && <span className="role-badge owner">Owner</span>}
                {team.roles?.includes("admin") && !team.roles?.includes("owner") && (
                  <span className="role-badge admin">Admin</span>
                )}
                {activeTeam?.$id === team.$id && <span className="check-icon">✓</span>}
              </button>
            ))
          )}
        </div>
      )}

      <div className="user-dropdown">
        {activeTeam && (
          <div className="user-teams-section">
            <span className="dropdown-label">Equipo Activo</span>
            <div className="active-team-info">
              <span className="team-name">{activeTeam.name}</span>
              <span className="team-role">
                {activeTeam.roles?.join(", ") || "Miembro"}
              </span>
            </div>
          </div>
        )}

        {userTeams.length > 0 && (
          <>
            <div className="dropdown-divider"></div>
            <div className="user-teams-section">
              <span className="dropdown-label">Mis Equipos ({userTeams.length})</span>
              {userTeams.map((team) => (
                <button
                  key={team.$id}
                  className={`team-item ${activeTeam?.$id === team.$id ? "active" : ""}`}
                  onClick={() => handleTeamSwitch(team)}
                >
                  <span className="team-name">{team.name}</span>
                  <span className="team-members">{team.total} miembros</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="dropdown-divider"></div>

        <Link href="/teams" className="dropdown-item">
          <span className="icon-team"></span>
          Gestionar Equipos
        </Link>

        {isAuthenticated && (
          <Link href="/import" className="dropdown-item">
            <span className="icon-import"></span>
            <span>Importar</span>
          </Link>
        )}

        {isAdmin && (
          <Link href="/admin" className="dropdown-item">
            <span className="icon-settings"></span>
            Administración
          </Link>
        )}

        <div className="dropdown-divider"></div>
        <button className="dropdown-item logout-btn" onClick={logout}>
          <span className="icon-logout"></span>
          Cerrar Sesión
        </button>
      </div>
    </div>
  );
}
