"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Navigation, LoadingState } from "@/components";
import { useAuth } from "@/context/AuthContext";

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

  const [loading, setLoading] = useState(true);

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
      setLoading(false);
    }
  }, [authLoading, authEnabled, isAdmin]);

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

        </div>
      </main>

      <footer className="explorer-footer">
        <p>Graph DB Explorer — Panel de Administración</p>
      </footer>
    </div>
  );
}
