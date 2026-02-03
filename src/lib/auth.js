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
 * Obtiene los teams del usuario actual
 */
export async function getUserTeams() {
  try {
    const result = await teams.list();
    return result.teams || [];
  } catch (error) {
    console.error("Error getting user teams:", error);
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
