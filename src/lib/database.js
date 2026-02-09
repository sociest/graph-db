import { tablesDB, Query, Permission, Role, storage, ID } from "./appwrite";
import { getCurrentUser } from "./auth";

// Configuración de la base de datos
const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID;
const TABLES = {
  ENTITIES: "entities",
  CLAIMS: "claims",
  QUALIFIERS: "qualifiers",
  REFERENCES: "references",
};

const AUDIT_TABLE_ID = process.env.NEXT_PUBLIC_AUDIT_TABLE_ID;
const MAIN_TEAM_ID = process.env.NEXT_PUBLIC_MAIN_TEAM_ID;

const SYSTEM_FIELDS = new Set([
  "$id",
  "$createdAt",
  "$updatedAt",
  "$permissions",
  "$databaseId",
  "$tableId",
  "$collectionId",
]);

// Configuración de buckets para diferentes tipos de datos
export const BUCKETS = {
  IMAGES: process.env.NEXT_PUBLIC_BUCKET_IMAGES || "images",
  GEOJSON: process.env.NEXT_PUBLIC_BUCKET_GEOJSON || "geojson",
  JSON: process.env.NEXT_PUBLIC_BUCKET_JSON || "json",
  FILES: process.env.NEXT_PUBLIC_BUCKET_FILES || "files",
};

/**
 * Genera los permisos para un registro basándose en el team
 * @param {string} teamId - ID del team que crea el registro
 * @param {Object} options - Opciones adicionales
 * @returns {string[]} Array de permisos de Appwrite
 */
function generatePermissions(teamId, options = {}) {
  const permissions = [];
  
  // Permisos de lectura: cualquiera puede leer (datos públicos)
  // permissions.push(Permission.read(Role.any()));
  
  if (teamId) {
    // Solo el team creador puede actualizar y eliminar
    permissions.push(Permission.update(Role.team(teamId)));
    permissions.push(Permission.delete(Role.team(teamId)));
  } else {
    // Si no hay team, solo usuarios autenticados pueden editar
    // permissions.push(Permission.update(Role.users()));
    // permissions.push(Permission.delete(Role.users()));
  }
  
  return permissions;
}

function stripSystemFields(row) {
  const data = { ...row };
  for (const key of Object.keys(data)) {
    if (SYSTEM_FIELDS.has(key)) {
      delete data[key];
    }
  }
  return data;
}

const TRANSACTION_LOG_KEY = "graphdb_transaction_logs";

function wrapTransactionResult(result, changes = []) {
  return { __changes: changes, result };
}

function getLocalTransactionLogs() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TRANSACTION_LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.warn("[DB] Failed to read transaction logs:", error);
    return [];
  }
}

function saveLocalTransactionLogs(logs) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TRANSACTION_LOG_KEY, JSON.stringify(logs));
  } catch (error) {
    console.warn("[DB] Failed to save transaction logs:", error);
  }
}

function addLocalTransactionLog(entry) {
  const logs = getLocalTransactionLogs();
  const next = [entry, ...logs].slice(0, 200);
  saveLocalTransactionLogs(next);
}

export function listLocalTransactionLogs() {
  return getLocalTransactionLogs();
}

function isAuditEnabled() {
  return !!AUDIT_TABLE_ID;
}

function buildAuditPermissions() {
  if (MAIN_TEAM_ID) {
    return [
      Permission.read(Role.team(MAIN_TEAM_ID)),
      Permission.update(Role.team(MAIN_TEAM_ID)),
      Permission.delete(Role.team(MAIN_TEAM_ID)),
    ];
  }
  return undefined;
}

async function createAuditEntry({
  action,
  tableId,
  rowId,
  before,
  after,
  status = "pending",
  transactionId,
  changes,
  note,
  relatedAuditId,
}) {
  if (!isAuditEnabled()) return null;

  const user = await getCurrentUser();
  const permissions = buildAuditPermissions();

  return tablesDB.createRow({
    databaseId: DATABASE_ID,
    tableId: AUDIT_TABLE_ID,
    rowId: "unique()",
    data: {
      action,
      tableId,
      rowId,
      before: before ?? null,
      after: after ?? null,
      status,
      transactionId: transactionId || null,
      changes: changes || [],
      userId: user?.$id || null,
      userEmail: user?.email || null,
      note: note || null,
      relatedAuditId: relatedAuditId || null,
    },
    permissions,
  });
}

async function updateRowPermissions(tableId, rowId, permissions, transactionId = null) {
  const row = await tablesDB.getRow({
    databaseId: DATABASE_ID,
    tableId,
    rowId,
  });
  const data = stripSystemFields(row);
  return tablesDB.updateRow({
    databaseId: DATABASE_ID,
    tableId,
    rowId,
    data,
    permissions,
    transactionId: transactionId || undefined,
  });
}

async function runWithTransaction(label, handler) {
  const tx = await tablesDB.createTransaction();
  console.log(`[DB] Transaction started: ${tx.$id} - ${label}`);
  try {
    const output = await handler(tx.$id);
    const changes = output?.__changes || [];
    const result = output?.__changes ? output.result : output;
    await tablesDB.updateTransaction({
      transactionId: tx.$id,
      commit: true,
    });
    console.log(`[DB] Transaction committed: ${tx.$id} - ${label}`);
    addLocalTransactionLog({
      id: tx.$id,
      label,
      status: "committed",
      createdAt: new Date().toISOString(),
      changes,
    });
    return result;
  } catch (error) {
    try {
      await tablesDB.updateTransaction({
        transactionId: tx.$id,
        rollback: true,
      });
      console.log(`[DB] Transaction rolled back: ${tx.$id} - ${label}`);
      addLocalTransactionLog({
        id: tx.$id,
        label,
        status: "rolledback",
        createdAt: new Date().toISOString(),
        changes: [],
      });
    } catch (rollbackError) {
      console.error("[DB] Transaction rollback failed:", rollbackError);
    }
    throw error;
  }
}

// ============================================
// ENTITIES
// ============================================

/**
 * Obtiene una entidad por su ID con todas sus relaciones
 */
export async function getEntity(entityId, includeRelations = true) {
  const result = await tablesDB.getRow({
    databaseId: DATABASE_ID,
    tableId: TABLES.ENTITIES,
    rowId: entityId,
  });

  if (includeRelations) {
    // Obtener claims donde esta entidad es el sujeto
    const claims = await getClaimsBySubject(entityId);
    result.claims = claims;
  }

  return result;
}

/**
 * Busca entidades por texto (label, description, aliases)
 */
export async function searchEntities(searchTerm, limit = 20, offset = 0) {
  const queries = [
    Query.limit(limit),
    Query.offset(offset),
    Query.orderDesc("$createdAt"),
  ];

  if (searchTerm) {
    queries.push(Query.or([
      Query.contains("label", searchTerm),
      Query.contains("description", searchTerm),
      Query.contains("aliases", searchTerm),
    ]));
  }

  const result = await tablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: TABLES.ENTITIES,
    queries,
  });

  return result;
}

/**
 * Busca entidades que tengan un claim con una propiedad específica y un valor determinado
 * @param {string} propertyId - ID de la propiedad
 * @param {string} value - Valor a buscar (se busca en value_raw como texto)
 * @param {number} limit - Límite de resultados
 * @returns {Promise<Array>} - Lista de entidades que coinciden
 */
export async function searchEntitiesByPropertyValue(propertyId, value, limit = 10) {
  if (!propertyId || !value) return [];
  
  try {
    // Buscar claims que tengan esa propiedad
    const claimsResult = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: TABLES.CLAIMS,
      queries: [
        Query.equal("property", propertyId),
        Query.limit(100), // Obtener suficientes para filtrar
      ],
    });

    if (!claimsResult.rows || claimsResult.rows.length === 0) {
      return [];
    }

    // Filtrar en el cliente por valor (normalizado)
    const searchValue = String(value).toLowerCase().trim();
    const matchingClaims = claimsResult.rows.filter(claim => {
      if (claim.value_raw === null || claim.value_raw === undefined) return false;
      try {
        const rawValue = claim.value_raw;
        const claimValue = typeof rawValue === "string"
          ? rawValue
          : JSON.stringify(rawValue);
        const normalized = String(claimValue).toLowerCase().trim();
        return normalized.includes(searchValue) || searchValue.includes(normalized);
      } catch {
        return false;
      }
    });

    // Extraer IDs únicos de las entidades
    const entityIds = [...new Set(matchingClaims.map(c => c.subject?.$id || c.subject).filter(Boolean))];
    
    if (entityIds.length === 0) return [];

    // Obtener las entidades una por una
    const entities = [];
    for (const id of entityIds.slice(0, limit)) {
      try {
        const entity = await tablesDB.getRow({
          databaseId: DATABASE_ID,
          tableId: TABLES.ENTITIES,
          rowId: id,
        });
        if (entity) entities.push(entity);
      } catch (e) {
        // Entidad no encontrada, ignorar
        console.warn(`Entidad ${id} no encontrada`);
      }
    }

    return entities;
  } catch (err) {
    console.error("Error buscando entidades por propiedad:", err);
    return [];
  }
}

/**
 * Busca entidades usando múltiples condiciones (label/alias + propiedades)
 * @param {Object} conditions - Condiciones de búsqueda
 * @param {string} conditions.text - Texto para buscar en label/alias
 * @param {Array} conditions.properties - Array de {propertyId, value} para buscar por claims
 * @param {number} limit - Límite de resultados
 * @returns {Promise<Array>} - Lista de entidades que coinciden con TODAS las condiciones
 */
export async function searchEntitiesAdvanced(conditions, limit = 10) {
  const { text, properties = [] } = conditions;
  
  let candidates = null;
  
  // Si hay texto, buscar primero por label/alias
  if (text && text.trim()) {
    const textResult = await searchEntities(text, limit * 2);
    candidates = textResult.rows || [];
  }
  
  // Para cada propiedad, buscar y hacer intersección
  for (const prop of properties) {
    if (!prop.propertyId || !prop.value) continue;
    
    const propMatches = await searchEntitiesByPropertyValue(prop.propertyId, prop.value, limit * 3);
    
    if (candidates === null) {
      // Primera condición
      candidates = propMatches;
    } else {
      // Intersección: solo mantener los que aparecen en ambos
      const propIds = new Set(propMatches.map(e => e.$id));
      candidates = candidates.filter(e => propIds.has(e.$id));
    }
    
    // Si no hay candidatos, no tiene sentido seguir
    if (candidates.length === 0) break;
  }
  
  return (candidates || []).slice(0, limit);
}

/**
 * Lista todas las entidades con paginación
 */
export async function listEntities(limit = 25, offset = 0) {
  const result = await tablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: TABLES.ENTITIES,
    queries: [
      Query.limit(limit),
      Query.offset(offset),
      Query.orderDesc("$createdAt"),
    ],
  });

  return result;
}

/**
 * Crea una nueva entidad
 * @param {Object} data - Datos de la entidad
 * @param {string} teamId - ID del team que crea la entidad (opcional)
 */
export async function createEntity(data, teamId = null) {
  const permissions = generatePermissions(teamId);

  return runWithTransaction("createEntity", async (transactionId) => {
    const result = await tablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.ENTITIES,
      rowId: "unique()",
      data: {
        label: data.label || null,
        description: data.description || null,
        aliases: data.aliases || [],
      },
      permissions,
      transactionId,
    });

    const after = stripSystemFields(result);
    await createAuditEntry({
      action: "create",
      tableId: TABLES.ENTITIES,
      rowId: result?.$id,
      before: null,
      after,
      transactionId,
    });

    return wrapTransactionResult(result, [
      { action: "create", table: TABLES.ENTITIES, rowId: result?.$id || "" },
    ]);
  });
}

/**
 * Actualiza una entidad existente
 */
export async function updateEntity(entityId, data) {
  return runWithTransaction("updateEntity", async (transactionId) => {
    const beforeRow = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.ENTITIES,
      rowId: entityId,
    });

    const result = await tablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.ENTITIES,
      rowId: entityId,
      data,
      transactionId,
    });

    await createAuditEntry({
      action: "update",
      tableId: TABLES.ENTITIES,
      rowId: entityId,
      before: stripSystemFields(beforeRow),
      after: stripSystemFields(result),
      transactionId,
    });

    return wrapTransactionResult(result, [
      { action: "update", table: TABLES.ENTITIES, rowId: entityId },
    ]);
  });
}

/**
 * Actualiza permisos de una entidad
 */
export async function updateEntityPermissions(entityId, permissions) {
  return runWithTransaction("updateEntityPermissions", async (transactionId) => {
    const beforeRow = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.ENTITIES,
      rowId: entityId,
    });

    const result = await updateRowPermissions(TABLES.ENTITIES, entityId, permissions, transactionId);

    await createAuditEntry({
      action: "updatePermissions",
      tableId: TABLES.ENTITIES,
      rowId: entityId,
      before: stripSystemFields(beforeRow),
      after: stripSystemFields(result),
      transactionId,
    });

    return wrapTransactionResult(result, [
      { action: "updatePermissions", table: TABLES.ENTITIES, rowId: entityId },
    ]);
  });
}

// ============================================
// CLAIMS
// ============================================

/**
 * Obtiene todos los claims de un sujeto (entidad)
 * Incluye los datos expandidos de property y value_relation
 */
export async function getClaimsBySubject(subjectId) {
  const result = await tablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: TABLES.CLAIMS,
    queries: [
      Query.equal("subject", subjectId),
      Query.select(["*", "subject.*", "property.*", "value_relation.*"]),
      Query.limit(100),
    ],
  });

  return result.rows;
}

/**
 * Obtiene todos los claims donde esta entidad es el value_relation (relaciones inversas)
 * Es decir, otras entidades que apuntan a esta entidad
 */
export async function getClaimsByValueRelation(entityId) {
  const result = await tablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: TABLES.CLAIMS,
    queries: [
      Query.equal("value_relation", entityId),
      Query.select(["*", "subject.*", "property.*", "value_relation.*"]),
      Query.limit(100),
    ],
  });

  return result.rows;
}

/**
 * Obtiene todos los claims donde esta entidad es usada como propiedad
 */
export async function getClaimsByProperty(propertyId) {
  const result = await tablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: TABLES.CLAIMS,
    queries: [
      Query.equal("property", propertyId),
      Query.select(["*", "subject.*", "property.*", "value_relation.*"]),
      Query.limit(100),
    ],
  });

  return result.rows;
}

/**
 * Obtiene un claim específico con sus qualifiers y references
 * Incluye los datos expandidos de las relaciones
 */
export async function getClaim(claimId) {
  const claim = await tablesDB.getRow({
    databaseId: DATABASE_ID,
    tableId: TABLES.CLAIMS,
    rowId: claimId,
    queries: [
      Query.select(["*", "subject.*", "property.*", "value_relation.*"]),
    ],
  });

  // Obtener qualifiers
  const qualifiers = await getQualifiersByClaim(claimId);
  claim.qualifiersList = qualifiers;

  // Obtener references
  const references = await getReferencesByClaim(claimId);
  claim.referencesList = references;

  return claim;
}

/**
 * Crea un nuevo claim
 * @param {Object} data - Datos del claim
 * @param {string} teamId - ID del team que crea el claim (opcional)
 */
export async function createClaim(data, teamId = null) {
  const permissions = generatePermissions(teamId);
  const datatype = data.datatype ?? (data.value_relation ? "relation" : "string");
  const valueRaw =
    data.value_raw === undefined || data.value_raw === null
      ? null
      : typeof data.value_raw === "string"
      ? data.value_raw
      : JSON.stringify(data.value_raw);

  return runWithTransaction("createClaim", async (transactionId) => {
    const result = await tablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.CLAIMS,
      rowId: "unique()",
      data: {
        subject: data.subject || null,
        property: data.property || null,
        datatype: datatype,
        value_raw: valueRaw,
        value_relation: data.value_relation || null,
      },
      permissions,
      transactionId,
    });

    await createAuditEntry({
      action: "create",
      tableId: TABLES.CLAIMS,
      rowId: result?.$id,
      before: null,
      after: stripSystemFields(result),
      transactionId,
    });

    return wrapTransactionResult(result, [
      { action: "create", table: TABLES.CLAIMS, rowId: result?.$id || "" },
    ]);
  });
}

// ============================================
// QUALIFIERS
// ============================================

/**
 * Obtiene los qualifiers de un claim
 * Incluye los datos expandidos de property y value_relation
 */
export async function getQualifiersByClaim(claimId) {
  const result = await tablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: TABLES.QUALIFIERS,
    queries: [
      Query.equal("claim", claimId),
      Query.select(["*", "property.*", "value_relation.*"]),
      Query.limit(50),
    ],
  });

  return result.rows;
}

/**
 * Crea un nuevo qualifier
 * @param {Object} data - Datos del qualifier
 * @param {string} teamId - ID del team que crea el qualifier (opcional)
 */
export async function createQualifier(data, teamId = null) {
  const permissions = generatePermissions(teamId);
  const datatype = data.datatype ?? (data.value_relation ? "relation" : "string");
  const valueRaw =
    data.value_raw === undefined || data.value_raw === null
      ? null
      : typeof data.value_raw === "string"
      ? data.value_raw
      : JSON.stringify(data.value_raw);

  return runWithTransaction("createQualifier", async (transactionId) => {
    const result = await tablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.QUALIFIERS,
      rowId: "unique()",
      data: {
        claim: data.claim || null,
        property: data.property || null,
        datatype: datatype,
        value_raw: valueRaw,
        value_relation: data.value_relation || null,
      },
      permissions,
      transactionId,
    });

    await createAuditEntry({
      action: "create",
      tableId: TABLES.QUALIFIERS,
      rowId: result?.$id,
      before: null,
      after: stripSystemFields(result),
      transactionId,
    });

    return wrapTransactionResult(result, [
      { action: "create", table: TABLES.QUALIFIERS, rowId: result?.$id || "" },
    ]);
  });
}

// ============================================
// REFERENCES
// ============================================

/**
 * Obtiene las referencias de un claim
 * Incluye los datos expandidos de reference (entidad relacionada)
 */
export async function getReferencesByClaim(claimId) {
  const result = await tablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: TABLES.REFERENCES,
    queries: [
      Query.equal("claim", claimId),
      Query.select(["*", "reference.*"]),
      Query.limit(50),
    ],
  });

  return result.rows;
}

/**
 * Crea una nueva referencia
 * @param {Object} data - Datos de la referencia
 * @param {string} teamId - ID del team que crea la referencia (opcional)
 */
export async function createReference(data, teamId = null) {
  const permissions = generatePermissions(teamId);

  return runWithTransaction("createReference", async (transactionId) => {
    const result = await tablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.REFERENCES,
      rowId: "unique()",
      data: {
        claim: data.claim || null,
        details: data.details || null,
        reference: data.reference || null,
      },
      permissions,
      transactionId,
    });

    await createAuditEntry({
      action: "create",
      tableId: TABLES.REFERENCES,
      rowId: result?.$id,
      before: null,
      after: stripSystemFields(result),
      transactionId,
    });

    return wrapTransactionResult(result, [
      { action: "create", table: TABLES.REFERENCES, rowId: result?.$id || "" },
    ]);
  });
}

/**
 * Actualiza una referencia existente
 */
export async function updateReference(referenceId, data) {
  const updateData = {};
  if (data.details !== undefined) updateData.details = data.details;
  if (data.reference !== undefined) updateData.reference = data.reference;

  return runWithTransaction("updateReference", async (transactionId) => {
    const beforeRow = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.REFERENCES,
      rowId: referenceId,
    });

    const result = await tablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.REFERENCES,
      rowId: referenceId,
      data: updateData,
      transactionId,
    });

    await createAuditEntry({
      action: "update",
      tableId: TABLES.REFERENCES,
      rowId: referenceId,
      before: stripSystemFields(beforeRow),
      after: stripSystemFields(result),
      transactionId,
    });

    return wrapTransactionResult(result, [
      { action: "update", table: TABLES.REFERENCES, rowId: referenceId },
    ]);
  });
}

/**
 * Actualiza permisos de una referencia
 */
export async function updateReferencePermissions(referenceId, permissions) {
  return runWithTransaction("updateReferencePermissions", async (transactionId) => {
    const beforeRow = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.REFERENCES,
      rowId: referenceId,
    });

    const result = await updateRowPermissions(TABLES.REFERENCES, referenceId, permissions, transactionId);

    await createAuditEntry({
      action: "updatePermissions",
      tableId: TABLES.REFERENCES,
      rowId: referenceId,
      before: stripSystemFields(beforeRow),
      after: stripSystemFields(result),
      transactionId,
    });

    return wrapTransactionResult(result, [
      { action: "updatePermissions", table: TABLES.REFERENCES, rowId: referenceId },
    ]);
  });
}

/**
 * Elimina una referencia
 */
export async function deleteReference(referenceId) {
  return runWithTransaction("deleteReference", async (transactionId) => {
    const beforeRow = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.REFERENCES,
      rowId: referenceId,
    });

    const result = await tablesDB.deleteRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.REFERENCES,
      rowId: referenceId,
      transactionId,
    });

    await createAuditEntry({
      action: "delete",
      tableId: TABLES.REFERENCES,
      rowId: referenceId,
      before: stripSystemFields(beforeRow),
      after: null,
      transactionId,
    });

    return wrapTransactionResult(result, [
      { action: "delete", table: TABLES.REFERENCES, rowId: referenceId },
    ]);
  });
}

/**
 * Actualiza un qualifier existente
 */
export async function updateQualifier(qualifierId, data) {
  const updateData = {};
  if (data.property !== undefined) updateData.property = data.property;
  if (data.datatype !== undefined) {
    updateData.datatype = data.datatype ?? (data.value_relation ? "relation" : "string");
  } else if (data.value_relation !== undefined) {
    updateData.datatype = "relation";
  }
  if (data.value_raw !== undefined) {
    updateData.value_raw =
      data.value_raw === null || data.value_raw === undefined
        ? null
        : typeof data.value_raw === "string"
        ? data.value_raw
        : JSON.stringify(data.value_raw);
  }
  if (data.value_relation !== undefined) updateData.value_relation = data.value_relation;

  return runWithTransaction("updateQualifier", async (transactionId) => {
    const beforeRow = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.QUALIFIERS,
      rowId: qualifierId,
    });

    const result = await tablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.QUALIFIERS,
      rowId: qualifierId,
      data: updateData,
      transactionId,
    });

    await createAuditEntry({
      action: "update",
      tableId: TABLES.QUALIFIERS,
      rowId: qualifierId,
      before: stripSystemFields(beforeRow),
      after: stripSystemFields(result),
      transactionId,
    });

    return wrapTransactionResult(result, [
      { action: "update", table: TABLES.QUALIFIERS, rowId: qualifierId },
    ]);
  });
}

/**
 * Actualiza permisos de un qualifier
 */
export async function updateQualifierPermissions(qualifierId, permissions) {
  return runWithTransaction("updateQualifierPermissions", async (transactionId) => {
    const beforeRow = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.QUALIFIERS,
      rowId: qualifierId,
    });

    const result = await updateRowPermissions(TABLES.QUALIFIERS, qualifierId, permissions, transactionId);

    await createAuditEntry({
      action: "updatePermissions",
      tableId: TABLES.QUALIFIERS,
      rowId: qualifierId,
      before: stripSystemFields(beforeRow),
      after: stripSystemFields(result),
      transactionId,
    });

    return wrapTransactionResult(result, [
      { action: "updatePermissions", table: TABLES.QUALIFIERS, rowId: qualifierId },
    ]);
  });
}

/**
 * Elimina un qualifier
 */
export async function deleteQualifier(qualifierId) {
  return runWithTransaction("deleteQualifier", async (transactionId) => {
    const beforeRow = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.QUALIFIERS,
      rowId: qualifierId,
    });

    const result = await tablesDB.deleteRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.QUALIFIERS,
      rowId: qualifierId,
      transactionId,
    });

    await createAuditEntry({
      action: "delete",
      tableId: TABLES.QUALIFIERS,
      rowId: qualifierId,
      before: stripSystemFields(beforeRow),
      after: null,
      transactionId,
    });

    return wrapTransactionResult(result, [
      { action: "delete", table: TABLES.QUALIFIERS, rowId: qualifierId },
    ]);
  });
}

/**
 * Actualiza un claim existente
 */
export async function updateClaim(claimId, data) {
  const updateData = {};
  if (data.property !== undefined) updateData.property = data.property;
  if (data.datatype !== undefined) {
    updateData.datatype = data.datatype ?? (data.value_relation ? "relation" : "string");
  } else if (data.value_relation !== undefined) {
    updateData.datatype = "relation";
  }
  if (data.value_raw !== undefined) {
    updateData.value_raw =
      data.value_raw === null || data.value_raw === undefined
        ? null
        : typeof data.value_raw === "string"
        ? data.value_raw
        : JSON.stringify(data.value_raw);
  }
  if (data.value_relation !== undefined) updateData.value_relation = data.value_relation;

  return runWithTransaction("updateClaim", async (transactionId) => {
    const beforeRow = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.CLAIMS,
      rowId: claimId,
    });

    const result = await tablesDB.updateRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.CLAIMS,
      rowId: claimId,
      data: updateData,
      transactionId,
    });

    await createAuditEntry({
      action: "update",
      tableId: TABLES.CLAIMS,
      rowId: claimId,
      before: stripSystemFields(beforeRow),
      after: stripSystemFields(result),
      transactionId,
    });

    return wrapTransactionResult(result, [
      { action: "update", table: TABLES.CLAIMS, rowId: claimId },
    ]);
  });
}

/**
 * Actualiza permisos de un claim
 */
export async function updateClaimPermissions(claimId, permissions) {
  return runWithTransaction("updateClaimPermissions", async (transactionId) => {
    const beforeRow = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.CLAIMS,
      rowId: claimId,
    });

    const result = await updateRowPermissions(TABLES.CLAIMS, claimId, permissions, transactionId);

    await createAuditEntry({
      action: "updatePermissions",
      tableId: TABLES.CLAIMS,
      rowId: claimId,
      before: stripSystemFields(beforeRow),
      after: stripSystemFields(result),
      transactionId,
    });

    return wrapTransactionResult(result, [
      { action: "updatePermissions", table: TABLES.CLAIMS, rowId: claimId },
    ]);
  });
}

/**
 * Elimina un claim y todos sus qualifiers y references asociados
 */
export async function deleteClaim(claimId) {
  return runWithTransaction("deleteClaim", async (transactionId) => {
    const changes = [];
    const beforeClaim = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.CLAIMS,
      rowId: claimId,
    });
    // Primero eliminar qualifiers
    const qualifiers = await getQualifiersByClaim(claimId);
    for (const qualifier of qualifiers) {
      await tablesDB.deleteRow({
        databaseId: DATABASE_ID,
        tableId: TABLES.QUALIFIERS,
        rowId: qualifier.$id,
        transactionId,
      });
      changes.push({ action: "delete", table: TABLES.QUALIFIERS, rowId: qualifier.$id });
    }

    // Eliminar references
    const references = await getReferencesByClaim(claimId);
    for (const reference of references) {
      await tablesDB.deleteRow({
        databaseId: DATABASE_ID,
        tableId: TABLES.REFERENCES,
        rowId: reference.$id,
        transactionId,
      });
      changes.push({ action: "delete", table: TABLES.REFERENCES, rowId: reference.$id });
    }

    // Finalmente eliminar el claim
    const result = await tablesDB.deleteRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.CLAIMS,
      rowId: claimId,
      transactionId,
    });
    changes.push({ action: "delete", table: TABLES.CLAIMS, rowId: claimId });

    await createAuditEntry({
      action: "delete",
      tableId: TABLES.CLAIMS,
      rowId: claimId,
      before: stripSystemFields(beforeClaim),
      after: null,
      transactionId,
      changes,
    });
    return wrapTransactionResult(result, changes);
  });
}

/**
 * Elimina una entidad y todos sus claims asociados
 */
export async function deleteEntity(entityId) {
  return runWithTransaction("deleteEntity", async (transactionId) => {
    const changes = [];
    const beforeEntity = await tablesDB.getRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.ENTITIES,
      rowId: entityId,
    });
    // Obtener todos los claims de esta entidad
    const claims = await getClaimsBySubject(entityId);

    // Eliminar cada claim con sus relaciones dentro de la misma transacción
    for (const claim of claims) {
      const qualifiers = await getQualifiersByClaim(claim.$id);
      for (const qualifier of qualifiers) {
        await tablesDB.deleteRow({
          databaseId: DATABASE_ID,
          tableId: TABLES.QUALIFIERS,
          rowId: qualifier.$id,
          transactionId,
        });
        changes.push({ action: "delete", table: TABLES.QUALIFIERS, rowId: qualifier.$id });
      }

      const references = await getReferencesByClaim(claim.$id);
      for (const reference of references) {
        await tablesDB.deleteRow({
          databaseId: DATABASE_ID,
          tableId: TABLES.REFERENCES,
          rowId: reference.$id,
          transactionId,
        });
        changes.push({ action: "delete", table: TABLES.REFERENCES, rowId: reference.$id });
      }

      await tablesDB.deleteRow({
        databaseId: DATABASE_ID,
        tableId: TABLES.CLAIMS,
        rowId: claim.$id,
        transactionId,
      });
      changes.push({ action: "delete", table: TABLES.CLAIMS, rowId: claim.$id });
    }

    // Finalmente eliminar la entidad
    const result = await tablesDB.deleteRow({
      databaseId: DATABASE_ID,
      tableId: TABLES.ENTITIES,
      rowId: entityId,
      transactionId,
    });
    changes.push({ action: "delete", table: TABLES.ENTITIES, rowId: entityId });

    await createAuditEntry({
      action: "delete",
      tableId: TABLES.ENTITIES,
      rowId: entityId,
      before: stripSystemFields(beforeEntity),
      after: null,
      transactionId,
      changes,
    });
    return wrapTransactionResult(result, changes);
  });
}

// ============================================
// BULK OPERATIONS
// ============================================

/**
 * Crea múltiples rows en una tabla
 * @param {string} tableId - ID de la tabla
 * @param {Array} rows - Array de { data, rowId?, permissions? }
 * @param {string} teamId - ID del team (opcional)
 * @param {Object} options - { continueOnError?: boolean }
 */
export async function createRowsBulk(tableId, rows = [], teamId = null, options = {}) {
  const { continueOnError = true } = options;
  const basePermissions = generatePermissions(teamId);

  return runWithTransaction("createRowsBulk", async (transactionId) => {
    if (typeof tablesDB.createRows === "function") {
      const data = (rows || []).map((row) => ({
        ...(row?.data || {}),
        $id: row?.rowId,
        $permissions: row?.permissions || basePermissions,
      }));
      const result = await tablesDB.createRows({
        databaseId: DATABASE_ID,
        tableId,
        rows: data,
        transactionId,
      });

      await createAuditEntry({
        action: "bulkCreate",
        tableId,
        rowId: null,
        before: null,
        after: null,
        transactionId,
        changes: [{ action: "bulkCreate", table: tableId, count: data.length }],
      });

      return wrapTransactionResult(result, [
        { action: "bulkCreate", table: tableId, count: data.length },
      ]);
    }

    const tasks = (rows || []).map((row) => async () => {
      const rowId = row?.rowId || "unique()";
      const permissions = row?.permissions || basePermissions;
      return tablesDB.createRow({
        databaseId: DATABASE_ID,
        tableId,
        rowId,
        data: row?.data || {},
        permissions,
        transactionId,
      });
    });

    return runBulkTasks(tasks, { continueOnError }).then(async (result) => {
      await createAuditEntry({
        action: "bulkCreate",
        tableId,
        rowId: null,
        before: null,
        after: null,
        transactionId,
        changes: [{ action: "bulkCreate", table: tableId, count: rows.length }],
      });
      return wrapTransactionResult(result, [
        { action: "bulkCreate", table: tableId, count: rows.length },
      ]);
    });
  });
}

/**
 * Actualiza múltiples rows en una tabla
 * @param {string} tableId - ID de la tabla
 * @param {Array} updates - Array de { rowId, data }
 * @param {Object} options - { continueOnError?: boolean }
 */
export async function updateRowsBulk(tableId, updates = [], options = {}) {
  const { continueOnError = true } = options;

  return runWithTransaction("updateRowsBulk", async (transactionId) => {
    if (typeof tablesDB.updateRows === "function") {
      const rows = (updates || []).map((item) => ({
        $id: item?.rowId,
        ...(item?.data || {}),
      }));
      return tablesDB.updateRows({
        databaseId: DATABASE_ID,
        tableId,
        rows,
        transactionId,
      }).then(async (result) => {
        await createAuditEntry({
          action: "bulkUpdate",
          tableId,
          rowId: null,
          before: null,
          after: null,
          transactionId,
          changes: [{ action: "bulkUpdate", table: tableId, count: rows.length }],
        });

        return wrapTransactionResult(result, [
          { action: "bulkUpdate", table: tableId, count: rows.length },
        ]);
      });
    }

    const tasks = (updates || []).map((item) => async () => {
      if (!item?.rowId) throw new Error("rowId es requerido para actualizar");
      return tablesDB.updateRow({
        databaseId: DATABASE_ID,
        tableId,
        rowId: item.rowId,
        data: item.data || {},
        transactionId,
      });
    });

    return runBulkTasks(tasks, { continueOnError }).then(async (result) => {
      await createAuditEntry({
        action: "bulkUpdate",
        tableId,
        rowId: null,
        before: null,
        after: null,
        transactionId,
        changes: [{ action: "bulkUpdate", table: tableId, count: updates.length }],
      });
      return wrapTransactionResult(result, [
        { action: "bulkUpdate", table: tableId, count: updates.length },
      ]);
    });
  });
}

/**
 * Elimina múltiples rows en una tabla
 * @param {string} tableId - ID de la tabla
 * @param {Array} rowIds - Array de rowId
 * @param {Object} options - { continueOnError?: boolean }
 */
export async function deleteRowsBulk(tableId, rowIds = [], options = {}) {
  const { continueOnError = true } = options;

  return runWithTransaction("deleteRowsBulk", async (transactionId) => {
    if (typeof tablesDB.deleteRows === "function") {
      return tablesDB.deleteRows({
        databaseId: DATABASE_ID,
        tableId,
        rowIds: (rowIds || []).filter(Boolean),
        transactionId,
      }).then(async (result) => {
        await createAuditEntry({
          action: "bulkDelete",
          tableId,
          rowId: null,
          before: null,
          after: null,
          transactionId,
          changes: [{ action: "bulkDelete", table: tableId, count: rowIds.length }],
        });

        return wrapTransactionResult(result, [
          { action: "bulkDelete", table: tableId, count: rowIds.length },
        ]);
      });
    }

    const tasks = (rowIds || []).map((rowId) => async () => {
      if (!rowId) throw new Error("rowId es requerido para eliminar");
      return tablesDB.deleteRow({
        databaseId: DATABASE_ID,
        tableId,
        rowId,
        transactionId,
      });
    });

    return runBulkTasks(tasks, { continueOnError }).then(async (result) => {
      await createAuditEntry({
        action: "bulkDelete",
        tableId,
        rowId: null,
        before: null,
        after: null,
        transactionId,
        changes: [{ action: "bulkDelete", table: tableId, count: rowIds.length }],
      });
      return wrapTransactionResult(result, [
        { action: "bulkDelete", table: tableId, count: rowIds.length },
      ]);
    });
  });
}

async function runBulkTasks(tasks, { continueOnError }) {
  const results = [];
  const errors = [];

  if (!continueOnError) {
    for (const task of tasks) {
      const result = await task();
      results.push(result);
    }
    return { results, errors };
  }

  const settled = await Promise.allSettled(tasks.map((task) => task()));
  settled.forEach((item) => {
    if (item.status === "fulfilled") {
      results.push(item.value);
    } else {
      errors.push(item.reason);
    }
  });

  return { results, errors };
}

// ============================================
// UTILITIES
// ============================================

/**
 * Parsea un value_raw desde JSON string
 */
export function parseValueRaw(valueRaw, datatype = "string") {
  if (valueRaw === null || valueRaw === undefined) return null;

  let data = valueRaw;
  if (typeof valueRaw === "string" && ["json", "object", "array"].includes(datatype)) {
    try {
      data = JSON.parse(valueRaw);
    } catch {
      data = valueRaw;
    }
  }

  return { datatype, data };
}

/**
 * Serializa un value para guardarlo como value_raw
 */
export function serializeValue(value) {
  if (!value) return null;
  if (typeof value === "object" && value.datatype !== undefined && value.data !== undefined) {
    return { datatype: value.datatype, value_raw: value.data };
  }
  return { datatype: "string", value_raw: value };
}

// ============================================
// TRANSACTIONS
// ============================================

/**
 * Crea una nueva transacción
 */
export async function createTransaction() {
  const tx = await tablesDB.createTransaction();
  return tx;
}

/**
 * Confirma una transacción
 */
export async function commitTransaction(transactionId) {
  await tablesDB.updateTransaction({
    transactionId,
    commit: true,
  });
}

/**
 * Revierte una transacción
 */
export async function rollbackTransaction(transactionId) {
  await tablesDB.updateTransaction({
    transactionId,
    rollback: true,
  });
}

/**
 * Ejecuta múltiples operaciones en una transacción
 */
export async function executeInTransaction(operations) {
  const tx = await createTransaction();
  
  try {
    await tablesDB.createOperations({
      transactionId: tx.$id,
      operations,
    });
    
    await commitTransaction(tx.$id);
    return { success: true, transactionId: tx.$id };
  } catch (e) {
    await rollbackTransaction(tx.$id);
    throw e;
  }
}

/**
 * Lista transacciones
 */
export async function listTransactions(filters = {}) {
  if (typeof tablesDB.listTransactions !== "function") return [];
  const {
    status,
    from,
    to,
    limit,
    offset,
    queries: extraQueries = [],
  } = filters || {};
  const queries = [...(extraQueries || [])];

  if (status && status !== "all") {
    queries.push(Query.equal("status", status));
  }

  const gt = Query.greaterThanEqual || Query.greaterThan;
  const lt = Query.lessThanEqual || Query.lessThan;

  if (from && gt) {
    queries.push(gt("$createdAt", from));
  }
  if (to && lt) {
    queries.push(lt("$createdAt", to));
  }
  if (limit) queries.push(Query.limit(limit));
  if (offset) queries.push(Query.offset(offset));

  const result = await tablesDB.listTransactions({ queries });
  return result?.transactions || result?.items || [];
}

/**
 * Lista auditoría de cambios
 */
export async function listAuditEntries(filters = {}) {
  if (!isAuditEnabled()) return [];
  const {
    status,
    from,
    to,
    limit,
    offset,
    tableId,
    userId,
    queries: extraQueries = [],
  } = filters || {};
  const queries = [...(extraQueries || [])];

  if (status && status !== "all") {
    queries.push(Query.equal("status", status));
  }
  if (tableId && tableId !== "all") {
    queries.push(Query.equal("tableId", tableId));
  }
  if (userId) {
    queries.push(Query.equal("userId", userId));
  }

  const gt = Query.greaterThanEqual || Query.greaterThan;
  const lt = Query.lessThanEqual || Query.lessThan;

  if (from && gt) queries.push(gt("$createdAt", from));
  if (to && lt) queries.push(lt("$createdAt", to));
  if (limit) queries.push(Query.limit(limit));
  if (offset) queries.push(Query.offset(offset));

  const result = await tablesDB.listRows({
    databaseId: DATABASE_ID,
    tableId: AUDIT_TABLE_ID,
    queries,
  });

  return result?.rows || [];
}

/**
 * Aprueba una auditoría (marca status)
 */
export async function approveAuditEntry(auditId, note) {
  if (!isAuditEnabled()) return null;
  return tablesDB.updateRow({
    databaseId: DATABASE_ID,
    tableId: AUDIT_TABLE_ID,
    rowId: auditId,
    data: {
      status: "approved",
      note: note || null,
      reviewedAt: new Date().toISOString(),
    },
  });
}

/**
 * Rechaza una auditoría (marca status)
 */
export async function rejectAuditEntry(auditId, note) {
  if (!isAuditEnabled()) return null;
  return tablesDB.updateRow({
    databaseId: DATABASE_ID,
    tableId: AUDIT_TABLE_ID,
    rowId: auditId,
    data: {
      status: "rejected",
      note: note || null,
      reviewedAt: new Date().toISOString(),
    },
  });
}

/**
 * Aplica rollback basado en auditoría
 */
export async function rollbackAuditEntry(auditEntry, note) {
  if (!auditEntry) throw new Error("Auditoría inválida");

  const { action, tableId, rowId, before, after } = auditEntry;

  return runWithTransaction("rollbackAuditEntry", async (transactionId) => {
    let result = null;

    if (action === "create") {
      result = await tablesDB.deleteRow({
        databaseId: DATABASE_ID,
        tableId,
        rowId,
        transactionId,
      });
    } else if (action === "update" || action === "updatePermissions") {
      if (!before) throw new Error("No hay estado previo para revertir");
      result = await tablesDB.updateRow({
        databaseId: DATABASE_ID,
        tableId,
        rowId,
        data: before,
        transactionId,
      });
    } else if (action === "delete") {
      if (!before) throw new Error("No hay estado previo para restaurar");
      result = await tablesDB.createRow({
        databaseId: DATABASE_ID,
        tableId,
        rowId: rowId || "unique()",
        data: before,
        transactionId,
      });
    } else {
      throw new Error("Rollback no soportado para esta acción");
    }

    await createAuditEntry({
      action: "rollback",
      tableId,
      rowId,
      before: after || null,
      after: before || null,
      status: "approved",
      transactionId,
      note: note || null,
      relatedAuditId: auditEntry.$id,
    });

    return result;
  });
}

// ============================================
// STORAGE / BUCKETS
// ============================================

/**
 * Sube un archivo a un bucket específico
 * @param {string} bucketId - ID del bucket
 * @param {File|Blob} file - Archivo a subir
 * @param {string} filename - Nombre del archivo (opcional)
 * @param {string} teamId - ID del team para permisos (opcional)
 * @returns {Object} - Resultado con fileId y URL
 */
export async function uploadFile(bucketId, file, filename = null, teamId = null) {
  const permissions = generatePermissions(teamId);
  
  const result = await storage.createFile(
    bucketId,
    ID.unique(),
    file,
    permissions.length > 0 ? permissions : undefined
  );
  
  // Generar URL de visualización
  const fileUrl = storage.getFileView(bucketId, result.$id);
  
  return {
    fileId: result.$id,
    bucketId: bucketId,
    url: fileUrl,
    name: result.name,
    size: result.sizeOriginal,
    mimeType: result.mimeType,
  };
}

/**
 * Sube un string grande (como GeoJSON) como archivo a un bucket
 * @param {string} bucketId - ID del bucket
 * @param {string} content - Contenido a subir
 * @param {string} filename - Nombre del archivo
 * @param {string} mimeType - Tipo MIME del contenido
 * @param {string} teamId - ID del team para permisos (opcional)
 */
export async function uploadStringAsFile(bucketId, content, filename, mimeType = "application/json", teamId = null) {
  const blob = new Blob([content], { type: mimeType });
  const file = new File([blob], filename, { type: mimeType });
  
  return await uploadFile(bucketId, file, filename, teamId);
}

/**
 * Sube un GeoJSON a su bucket correspondiente
 * @param {string|Object} geojson - GeoJSON como string o objeto
 * @param {string} entityLabel - Label de la entidad (para el nombre del archivo)
 * @param {string} teamId - ID del team (opcional)
 */
export async function uploadGeoJSON(geojson, entityLabel = "polygon", teamId = null) {
  const content = typeof geojson === "string" ? geojson : JSON.stringify(geojson);
  const filename = `${entityLabel.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}.geojson`;
  
  return await uploadStringAsFile(BUCKETS.GEOJSON, content, filename, "application/geo+json", teamId);
}

/**
 * Sube un JSON grande a su bucket correspondiente
 * @param {string|Object} json - JSON como string o objeto
 * @param {string} name - Nombre base para el archivo
 * @param {string} teamId - ID del team (opcional)
 */
export async function uploadJSON(json, name = "data", teamId = null) {
  const content = typeof json === "string" ? json : JSON.stringify(json);
  const filename = `${name.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}.json`;
  
  return await uploadStringAsFile(BUCKETS.JSON, content, filename, "application/json", teamId);
}

/**
 * Sube una imagen desde URL (descarga y re-sube)
 * @param {string} imageUrl - URL de la imagen
 * @param {string} teamId - ID del team (opcional)
 */
export async function uploadImageFromUrl(imageUrl, teamId = null) {
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const extension = imageUrl.split(".").pop()?.split("?")[0] || "jpg";
    const filename = `image_${Date.now()}.${extension}`;
    
    const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
    return await uploadFile(BUCKETS.IMAGES, file, filename, teamId);
  } catch (error) {
    console.error("Error uploading image from URL:", error);
    throw error;
  }
}

/**
 * Obtiene la URL de visualización de un archivo
 * @param {string} bucketId - ID del bucket
 * @param {string} fileId - ID del archivo
 */
export function getFileViewUrl(bucketId, fileId) {
  return storage.getFileView(bucketId, fileId);
}

/**
 * Obtiene la URL de descarga de un archivo
 * @param {string} bucketId - ID del bucket
 * @param {string} fileId - ID del archivo
 */
export function getFileDownloadUrl(bucketId, fileId) {
  return storage.getFileDownload(bucketId, fileId);
}

/**
 * Elimina un archivo de un bucket
 * @param {string} bucketId - ID del bucket
 * @param {string} fileId - ID del archivo
 */
export async function deleteFile(bucketId, fileId) {
  await storage.deleteFile(bucketId, fileId);
}

/**
 * Determina si un valor debería subirse a un bucket basándose en su tamaño
 * @param {string} value - Valor a evaluar
 * @param {number} threshold - Umbral en caracteres (default 10000)
 */
export function shouldUploadToBucket(value, threshold = 10000) {
  if (typeof value !== "string") {
    value = JSON.stringify(value);
  }
  return value.length > threshold;
}
