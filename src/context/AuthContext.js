"use client";

import { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import {
  getCurrentUser,
  getUserTeams,
  getAllTeams,
  joinTeam,
  leaveTeam,
  login as authLogin,
  logout as authLogout,
  register as authRegister,
  isAuthEnabled,
} from "@/lib/auth";

const AuthContext = createContext(null);

// ID del Main Team (equipo de administradores)
// Si no está configurado, usará el primer team del usuario como Main Team
const MAIN_TEAM_ID = process.env.NEXT_PUBLIC_MAIN_TEAM_ID;

// Roles de equipo que tienen permisos de edición
const EDITOR_ROLES = ["owner", "admin", "editor", "member"];
// Roles de equipo que tienen permisos de administrador
const ADMIN_ROLES = ["owner", "admin"];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userTeams, setUserTeams] = useState([]);
  const [allTeams, setAllTeams] = useState([]);
  const [activeTeam, setActiveTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authEnabled] = useState(isAuthEnabled());
  const [mainTeamId, setMainTeamId] = useState(MAIN_TEAM_ID);

  // Cargar team activo desde localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedTeamId = localStorage.getItem("activeTeamId");
      if (savedTeamId && userTeams.length > 0) {
        const team = userTeams.find((t) => t.$id === savedTeamId);
        if (team) {
          setActiveTeam(team);
        }
      }
    }
  }, [userTeams]);

  useEffect(() => {
    if (authEnabled) {
      checkUser();
    } else {
      setLoading(false);
    }
  }, [authEnabled]);

  async function checkUser() {
    try {
      const currentUser = await getCurrentUser();
      console.log("[Auth] Current user:", currentUser);
      setUser(currentUser);

      if (currentUser) {
        const teamsData = await getUserTeams();
        console.log("[Auth] User teams with roles:", teamsData);
        setUserTeams(teamsData);

        // Obtener todos los teams disponibles
        const available = await getAllTeams();
        setAllTeams(available);

        // Si no hay team activo, usar el primero o el Main Team
        if (!activeTeam && teamsData.length > 0) {
          const mainTeam = teamsData.find((t) => t.$id === MAIN_TEAM_ID);
          console.log("[Auth] Main team ID:", MAIN_TEAM_ID, "Found:", mainTeam);
          setActiveTeam(mainTeam || teamsData[0]);
        }
      }
    } catch (error) {
      console.error("[Auth] Error checking user:", error);
      setUser(null);
      setUserTeams([]);
      setAllTeams([]);
    } finally {
      setLoading(false);
    }
  }

  async function login(email, password) {
    const session = await authLogin(email, password);
    await checkUser();
    return session;
  }

  async function register(email, password, name) {
    const result = await authRegister(email, password, name);
    await checkUser();
    return result;
  }

  async function logout() {
    await authLogout();
    setUser(null);
    setUserTeams([]);
    setAllTeams([]);
    setActiveTeam(null);
    if (typeof window !== "undefined") {
      localStorage.removeItem("activeTeamId");
    }
  }

  // Cambiar el team activo
  const switchTeam = useCallback((team) => {
    setActiveTeam(team);
    if (typeof window !== "undefined") {
      localStorage.setItem("activeTeamId", team.$id);
    }
  }, []);

  // Unirse a un team
  const handleJoinTeam = useCallback(async (teamId) => {
    try {
      await joinTeam(teamId);
      await checkUser();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }, []);

  // Salir de un team
  const handleLeaveTeam = useCallback(async (teamId, membershipId) => {
    try {
      await leaveTeam(teamId, membershipId);
      await checkUser();
      // Si salimos del team activo, cambiar a otro
      if (activeTeam?.$id === teamId) {
        const remainingTeams = userTeams.filter((t) => t.$id !== teamId);
        setActiveTeam(remainingTeams[0] || null);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }, [activeTeam, userTeams]);

  // Calcular permisos basados en las membresías del usuario
  const permissions = useMemo(() => {
    // Si la autenticación no está habilitada, permitir todo
    if (!authEnabled) {
      return {
        canView: true,
        canEdit: true,
        canDelete: true,
        canCreate: true,
        isAdmin: true,
        isMainTeamMember: true,
        roles: ["admin"],
      };
    }

    // Si no hay usuario autenticado, solo permisos de lectura
    if (!user) {
      return {
        canView: true,
        canEdit: false,
        canDelete: false,
        canCreate: false,
        isAdmin: false,
        isMainTeamMember: false,
        roles: [],
      };
    }

    // Verificar si es miembro del Main Team
    // Si MAIN_TEAM_ID no está configurado, el primer team del usuario se considera el Main Team
    const effectiveMainTeamId = MAIN_TEAM_ID || (userTeams.length > 0 ? userTeams[0].$id : null);
    const mainTeam = effectiveMainTeamId 
      ? userTeams.find((t) => t.$id === effectiveMainTeamId)
      : null;
    const isMainTeamMember = !!mainTeam;

    // Actualizar el mainTeamId en el estado si no está configurado
    if (!MAIN_TEAM_ID && effectiveMainTeamId) {
      console.log("[Auth] No MAIN_TEAM_ID configurado. Usando el primer team como Main Team:", effectiveMainTeamId);
    }

    // Recopilar todos los roles del usuario en todos sus teams
    const allUserRoles = [];
    for (const team of userTeams) {
      if (team.roles && team.roles.length > 0) {
        allUserRoles.push(...team.roles);
      }
    }

    console.log("[Auth] Teams del usuario:", userTeams.map(t => ({
      id: t.$id,
      name: t.name,
      roles: t.roles
    })));
    console.log("[Auth] Main Team ID efectivo:", effectiveMainTeamId);
    console.log("[Auth] Todos los roles del usuario:", allUserRoles);

    // Obtener roles del usuario en el team activo
    const activeTeamRoles = activeTeam?.roles || [];

    // Verificar si tiene rol de editor en algún team
    const hasEditorRole = allUserRoles.some((role) => 
      EDITOR_ROLES.includes(role.toLowerCase())
    );

    // Verificar si tiene rol de admin en algún team
    const hasAdminRole = allUserRoles.some((role) => 
      ADMIN_ROLES.includes(role.toLowerCase())
    );

    // Si es miembro de un team (cualquier rol), tiene permisos de edición
    const isMemberOfAnyTeam = userTeams.length > 0;

    // Los miembros del Main Team O usuarios con rol admin en cualquier team son administradores
    const isAdminUser = isMainTeamMember || hasAdminRole;

    // Si es miembro de cualquier team, tiene permisos de edición
    const hasEditPermission = isMemberOfAnyTeam;

    const result = {
      canView: true,
      canEdit: hasEditPermission,
      canDelete: hasEditPermission,
      canCreate: hasEditPermission,
      isAdmin: isAdminUser,
      isMainTeamMember,
      roles: [...new Set(allUserRoles)],
      activeTeamRoles: [...new Set(activeTeamRoles)],
    };

    console.log("[Auth] Permisos calculados:", {
      isMainTeamMember,
      hasEditorRole,
      hasAdminRole,
      isMemberOfAnyTeam,
      isAdminUser,
      canEdit: hasEditPermission,
      result,
    });

    return result;
  }, [authEnabled, user, userTeams, activeTeam]);

  const value = {
    user,
    userTeams,
    allTeams,
    activeTeam,
    loading,
    authEnabled,
    isAuthenticated: !!user,
    permissions,
    mainTeamId: MAIN_TEAM_ID,
    // Helpers de permisos
    canEdit: permissions.canEdit,
    canDelete: permissions.canDelete,
    canCreate: permissions.canCreate,
    isAdmin: permissions.isAdmin,
    isMainTeamMember: permissions.isMainTeamMember,
    // Funciones
    login,
    register,
    logout,
    refreshUser: checkUser,
    switchTeam,
    joinTeam: handleJoinTeam,
    leaveTeam: handleLeaveTeam,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
