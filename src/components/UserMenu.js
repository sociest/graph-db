"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

export default function UserMenu({ onLoginClick }) {
  const { user, userTeams, isAuthenticated, logout, authEnabled, loading } = useAuth();

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

  return (
    <div className="user-menu">
      <div className="user-info">
        <div className="user-avatar">
          {user.name?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase()}
        </div>
        <div className="user-details">
          <span className="user-name">{user.name || user.email}</span>
          {userTeams.length > 0 && (
            <span className="user-team">
              {userTeams[0].name}
              {userTeams.length > 1 && ` +${userTeams.length - 1}`}
            </span>
          )}
        </div>
      </div>
      
      <div className="user-dropdown">
        {userTeams.length > 0 && (
          <div className="user-teams-section">
            <span className="dropdown-label">Equipos</span>
            {userTeams.map((team) => (
              <div key={team.$id} className="team-item">
                <span className="team-name">{team.name}</span>
                <span className="team-members">{team.total} miembros</span>
              </div>
            ))}
          </div>
        )}
        <div className="dropdown-divider"></div>
        <Link href="/graphql" className="dropdown-item">
          <span className="icon-code"></span>
          GraphQL Playground
        </Link>
        <div className="dropdown-divider"></div>
        <button className="dropdown-item logout-btn" onClick={logout}>
          <span className="icon-logout"></span>
          Cerrar Sesión
        </button>
      </div>
    </div>
  );
}
