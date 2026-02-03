import { account, teams } from "./appwrite";
import { ID } from "appwrite";

/**
 * Verifica si la autenticación está habilitada
 */
export function isAuthEnabled() {
  return process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";
}

/**
 * Registra un nuevo usuario
 */
export async function register(email, password, name) {
  const result = await account.create({
    userId: ID.unique(),
    email,
    password,
    name,
  });

  // Auto-login después del registro
  await login(email, password);

  return result;
}

/**
 * Inicia sesión con email y contraseña
 */
export async function login(email, password) {
  const session = await account.createEmailPasswordSession({
    email,
    password,
  });

  return session;
}

/**
 * Cierra la sesión actual
 */
export async function logout() {
  await account.deleteSession({ sessionId: "current" });
}

/**
 * Obtiene el usuario actual
 */
export async function getCurrentUser() {
  try {
    const user = await account.get();
    return user;
  } catch (error) {
    return null;
  }
}

/**
 * Obtiene los teams del usuario actual con sus roles (membresías)
 * Retorna los teams enriquecidos con la información de la membresía del usuario
 */
export async function getUserTeams() {
  try {
    const user = await getCurrentUser();
    console.log("[Auth/getUserTeams] User:", user?.$id);
    if (!user) return [];

    const result = await teams.list();
    console.log("[Auth/getUserTeams] Teams list:", result.teams?.length);
    const teamsWithRoles = [];

    // Para cada team, obtener la membresía del usuario para conocer sus roles
    for (const team of result.teams || []) {
      try {
        const memberships = await teams.listMemberships({ teamId: team.$id });
        console.log(`[Auth/getUserTeams] Team ${team.$id} memberships:`, memberships.memberships?.length);
        
        // Buscar la membresía del usuario actual
        const userMembership = memberships.memberships?.find(
          (m) => m.userId === user.$id
        );
        console.log(`[Auth/getUserTeams] User membership in ${team.$id}:`, userMembership?.roles);
        
        teamsWithRoles.push({
          ...team,
          // Incluir la información de la membresía
          membership: userMembership || null,
          roles: userMembership?.roles || [],
          membershipId: userMembership?.$id || null,
          confirm: userMembership?.confirm || false,
        });
      } catch (err) {
        // Si no podemos obtener las membresías, añadir el team sin roles
        console.error(`Error getting memberships for team ${team.$id}:`, err);
        teamsWithRoles.push({
          ...team,
          membership: null,
          roles: [],
          membershipId: null,
          confirm: false,
        });
      }
    }

    return teamsWithRoles;
  } catch (error) {
    console.error("Error getting user teams:", error);
    return [];
  }
}

/**
 * Obtiene todos los teams disponibles en el proyecto
 * Nota: Esto requiere permisos de lectura en los teams
 */
export async function getAllTeams() {
  try {
    const result = await teams.list();
    return result.teams || [];
  } catch (error) {
    console.error("Error getting all teams:", error);
    return [];
  }
}

/**
 * Obtiene un team específico por ID
 */
export async function getTeam(teamId) {
  try {
    const team = await teams.get({ teamId });
    return team;
  } catch (error) {
    console.error("Error getting team:", error);
    return null;
  }
}

/**
 * Obtiene los miembros de un team
 */
export async function getTeamMembers(teamId) {
  try {
    const result = await teams.listMemberships({ teamId });
    return result.memberships || [];
  } catch (error) {
    console.error("Error getting team members:", error);
    return [];
  }
}

/**
 * Unirse a un team (requiere invitación o permisos)
 */
export async function joinTeam(teamId, roles = ["member"]) {
  try {
    // Para unirse a un team, normalmente se necesita una invitación
    // Esta función crea una membresía directa (requiere permisos de admin del team)
    const user = await getCurrentUser();
    if (!user) throw new Error("Usuario no autenticado");

    const result = await teams.createMembership({
      teamId,
      roles,
      email: user.email,
      userId: user.$id,
    });
    return result;
  } catch (error) {
    console.error("Error joining team:", error);
    throw error;
  }
}

/**
 * Salir de un team
 */
export async function leaveTeam(teamId, membershipId) {
  try {
    await teams.deleteMembership({
      teamId,
      membershipId,
    });
    return true;
  } catch (error) {
    console.error("Error leaving team:", error);
    throw error;
  }
}

/**
 * Obtiene la membresía del usuario actual en un team
 */
export async function getUserMembershipInTeam(teamId) {
  try {
    const user = await getCurrentUser();
    if (!user) return null;

    const memberships = await getTeamMembers(teamId);
    return memberships.find((m) => m.userId === user.$id) || null;
  } catch (error) {
    console.error("Error getting user membership:", error);
    return null;
  }
}
