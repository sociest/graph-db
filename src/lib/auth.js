import { account, teams, ID } from "./appwrite";

// Roles predeterminados para los teams
export const DEFAULT_TEAM_ROLES = ["owner", "admin", "editor", "viewer"];

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

function getAccountMethod(...names) {
  for (const name of names) {
    if (typeof account?.[name] === "function") {
      return account[name].bind(account);
    }
  }
  return null;
}

async function tryAccountCall(fn, argsObject, argsArray = []) {
  if (!fn) throw new Error("Función de cuenta no disponible en el SDK");
  try {
    if (argsObject !== undefined) {
      return await fn(argsObject);
    }
    return await fn(...argsArray);
  } catch (error) {
    if (argsArray?.length) {
      return await fn(...argsArray);
    }
    throw error;
  }
}

/**
 * Actualiza el nombre del usuario
 */
export async function updateUserName(name) {
  const fn = getAccountMethod("updateName");
  return tryAccountCall(fn, { name }, [name]);
}

/**
 * Actualiza el email del usuario
 */
export async function updateUserEmail(email, password) {
  const fn = getAccountMethod("updateEmail");
  return tryAccountCall(fn, { email, password }, [email, password]);
}

/**
 * Actualiza el teléfono del usuario
 */
export async function updateUserPhone(phone, password) {
  const fn = getAccountMethod("updatePhone");
  return tryAccountCall(fn, { phone, password }, [phone, password]);
}

/**
 * Actualiza la contraseña del usuario
 */
export async function updateUserPassword(oldPassword, newPassword) {
  const fn = getAccountMethod("updatePassword");
  return tryAccountCall(fn, { password: newPassword, oldPassword }, [newPassword, oldPassword]);
}

/**
 * Actualiza preferencias del usuario
 */
export async function updateUserPrefs(prefs = {}) {
  const fn = getAccountMethod("updatePrefs", "updatePreferences");
  return tryAccountCall(fn, { prefs }, [prefs]);
}

/**
 * Lista sesiones activas
 */
export async function listUserSessions() {
  const fn = getAccountMethod("listSessions", "getSessions");
  if (!fn) return [];
  const result = await tryAccountCall(fn);
  return result?.sessions || result?.items || [];
}

/**
 * Cierra una sesión específica
 */
export async function deleteUserSession(sessionId) {
  const fn = getAccountMethod("deleteSession");
  return tryAccountCall(fn, { sessionId }, [sessionId]);
}

/**
 * Cierra todas las sesiones
 */
export async function deleteAllSessions() {
  const fn = getAccountMethod("deleteSessions");
  if (!fn) return null;
  return tryAccountCall(fn);
}

/**
 * Lista identidades (métodos de autenticación vinculados)
 */
export async function listUserIdentities() {
  const fn = getAccountMethod("listIdentities", "getIdentities");
  if (!fn) return [];
  const result = await tryAccountCall(fn);
  return result?.identities || result?.items || [];
}

/**
 * Elimina una identidad vinculada
 */
export async function deleteUserIdentity(identityId) {
  const fn = getAccountMethod("deleteIdentity");
  return tryAccountCall(fn, { identityId }, [identityId]);
}

/**
 * Inicia un OAuth2 para vincular un proveedor
 */
export async function createOAuthSession(provider, success, failure, scopes) {
  const fn = getAccountMethod("createOAuth2Session");
  if (!fn) throw new Error("OAuth no disponible en este SDK");
  const argsObject = { provider, success, failure };
  if (scopes?.length) argsObject.scopes = scopes;
  return tryAccountCall(fn, argsObject, [provider, success, failure, scopes]);
}

/**
 * Genera una API Key (JWT/Token) para el usuario actual
 */
export async function createUserApiKey() {
  const jwtFn = getAccountMethod("createJWT");
  if (jwtFn) {
    const result = await tryAccountCall(jwtFn);
    return result?.jwt || result?.token || result;
  }

  const tokenFn = getAccountMethod("createToken");
  if (tokenFn) {
    const result = await tryAccountCall(tokenFn, {});
    return result?.secret || result?.token || result;
  }

  throw new Error("Generación de API Key no disponible en este SDK");
}

/**
 * Verifica si el SDK soporta generación de API Key
 */
export function isApiKeySupported() {
  return !!getAccountMethod("createJWT", "createToken");
}

/**
 * Verifica si está permitido generar API Keys por configuración
 */
export function isApiKeyGenerationEnabled() {
  return process.env.NEXT_PUBLIC_ALLOW_API_KEY_GENERATION === "true";
}

/**
 * Lista API Keys (tokens) generadas
 */
export async function listUserApiKeys() {
  const fn = getAccountMethod("listTokens", "getTokens", "listUserTokens");
  if (!fn) return [];
  const result = await tryAccountCall(fn);
  return result?.tokens || result?.items || [];
}

/**
 * Revoca una API Key (token)
 */
export async function deleteUserApiKey(tokenId) {
  const fn = getAccountMethod("deleteToken", "deleteUserToken");
  if (!fn) throw new Error("Revocación de API Key no disponible en este SDK");
  return tryAccountCall(fn, { tokenId }, [tokenId]);
}

/**
 * Verifica si el SDK soporta listado/revocación de API Keys
 */
export function isApiKeyListSupported() {
  return !!getAccountMethod("listTokens", "getTokens", "listUserTokens") &&
    !!getAccountMethod("deleteToken", "deleteUserToken");
}

/**
 * Lista factores MFA disponibles/estado
 */
export async function listMfaFactors() {
  const fn = getAccountMethod("listMfaFactors", "listMFAFactors");
  if (!fn) return null;
  return tryAccountCall(fn);
}

/**
 * Actualiza estado MFA de un factor (si el SDK lo permite)
 */
export async function updateMfaStatus(factor, status) {
  const fn = getAccountMethod("updateMfaStatus", "updateMFAStatus", "updateMfa");
  if (!fn) throw new Error("Actualización MFA no disponible en este SDK");
  return tryAccountCall(fn, { factor, status }, [factor, status]);
}

/**
 * Verifica si el SDK soporta actualización de MFA
 */
export function isMfaUpdateSupported() {
  return !!getAccountMethod("updateMfaStatus", "updateMFAStatus", "updateMfa");
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
 * Obtiene las membresías del usuario actual (incluye invitaciones)
 */
export async function listUserMemberships() {
  try {
    const listFn = account.listMemberships || account.getMemberships;
    if (typeof listFn !== "function") {
      console.warn("Account memberships API not available in current SDK");
      return [];
    }

    const result = await listFn.call(account);
    return result.memberships || [];
  } catch (error) {
    console.error("Error listing user memberships:", error);
    return [];
  }
}

/**
 * Obtiene invitaciones pendientes del usuario actual
 */
export async function getPendingInvitations() {
  const memberships = await listUserMemberships();
  return memberships.filter((membership) => membership.confirm === false);
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

/**
 * Crea un nuevo team con roles predeterminados
 * @param {string} name - Nombre del team
 * @param {string[]} roles - Roles permitidos en el team (opcional)
 */
export async function createTeam(name, roles = DEFAULT_TEAM_ROLES) {
  try {
    const result = await teams.create({
      teamId: ID.unique(),
      name,
      roles,
    });
    return result;
  } catch (error) {
    console.error("Error creating team:", error);
    throw error;
  }
}

/**
 * Actualiza el nombre de un team
 */
export async function updateTeamName(teamId, name) {
  try {
    const result = await teams.updateName({
      teamId,
      name,
    });
    return result;
  } catch (error) {
    console.error("Error updating team name:", error);
    throw error;
  }
}

/**
 * Elimina un team
 */
export async function deleteTeam(teamId) {
  try {
    await teams.delete({ teamId });
    return true;
  } catch (error) {
    console.error("Error deleting team:", error);
    throw error;
  }
}

/**
 * Invita a un usuario a un team
 * @param {string} teamId - ID del team
 * @param {string} email - Email del usuario a invitar
 * @param {string[]} roles - Roles a asignar
 * @param {string} url - URL de redirección después de aceptar
 */
export async function inviteToTeam(teamId, email, roles = ["viewer"], url) {
  try {
    const redirectUrl = url || `${window.location.origin}/teams/accept`;
    const result = await teams.createMembership({
      teamId,
      roles,
      email,
      url: redirectUrl,
    });
    return result;
  } catch (error) {
    console.error("Error inviting to team:", error);
    throw error;
  }
}

/**
 * Actualiza los roles de un miembro
 */
export async function updateMemberRoles(teamId, membershipId, roles) {
  try {
    const result = await teams.updateMembership({
      teamId,
      membershipId,
      roles,
    });
    return result;
  } catch (error) {
    console.error("Error updating member roles:", error);
    throw error;
  }
}

/**
 * Elimina un miembro del team
 */
export async function removeMember(teamId, membershipId) {
  try {
    await teams.deleteMembership({
      teamId,
      membershipId,
    });
    return true;
  } catch (error) {
    console.error("Error removing member:", error);
    throw error;
  }
}

/**
 * Acepta una invitación a un team
 */
export async function acceptTeamInvite(teamId, membershipId, userId, secret) {
  try {
    const result = await teams.updateMembershipStatus({
      teamId,
      membershipId,
      userId,
      secret,
    });
    return result;
  } catch (error) {
    console.error("Error accepting team invite:", error);
    throw error;
  }
}
