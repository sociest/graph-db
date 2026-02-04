import { tablesDB, Query, Permission, Role, storage, ID } from "./appwrite";

// Configuración de la base de datos
const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID;
const TABLES = {
  ENTITIES: "entities",
  CLAIMS: "claims",
  QUALIFIERS: "qualifiers",
  REFERENCES: "references",
};

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
  });

  return result;
}

/**
 * Actualiza una entidad existente
 */
export async function updateEntity(entityId, data) {
  const result = await tablesDB.updateRow({
    databaseId: DATABASE_ID,
    tableId: TABLES.ENTITIES,
    rowId: entityId,
    data,
  });

  return result;
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
  
  const result = await tablesDB.createRow({
    databaseId: DATABASE_ID,
    tableId: TABLES.CLAIMS,
    rowId: "unique()",
    data: {
      subject: data.subject || null,
      property: data.property || null,
      value_raw: data.value_raw ? JSON.stringify(data.value_raw) : null,
      value_relation: data.value_relation || null,
    },
    permissions,
  });

  return result;
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
  
  const result = await tablesDB.createRow({
    databaseId: DATABASE_ID,
    tableId: TABLES.QUALIFIERS,
    rowId: "unique()",
    data: {
      claim: data.claim || null,
      property: data.property || null,
      value_raw: data.value_raw ? JSON.stringify(data.value_raw) : null,
      value_relation: data.value_relation || null,
    },
    permissions,
  });

  return result;
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
  });

  return result;
}

/**
 * Actualiza una referencia existente
 */
export async function updateReference(referenceId, data) {
  const updateData = {};
  if (data.details !== undefined) updateData.details = data.details;
  if (data.reference !== undefined) updateData.reference = data.reference;

  const result = await tablesDB.updateRow({
    databaseId: DATABASE_ID,
    tableId: TABLES.REFERENCES,
    rowId: referenceId,
    data: updateData,
  });

  return result;
}

/**
 * Elimina una referencia
 */
export async function deleteReference(referenceId) {
  await tablesDB.deleteRow({
    databaseId: DATABASE_ID,
    tableId: TABLES.REFERENCES,
    rowId: referenceId,
  });
}

/**
 * Actualiza un qualifier existente
 */
export async function updateQualifier(qualifierId, data) {
  const updateData = {};
  if (data.property !== undefined) updateData.property = data.property;
  if (data.value_raw !== undefined) {
    updateData.value_raw = data.value_raw ? JSON.stringify(data.value_raw) : null;
  }
  if (data.value_relation !== undefined) updateData.value_relation = data.value_relation;

  const result = await tablesDB.updateRow({
    databaseId: DATABASE_ID,
    tableId: TABLES.QUALIFIERS,
    rowId: qualifierId,
    data: updateData,
  });

  return result;
}

/**
 * Elimina un qualifier
 */
export async function deleteQualifier(qualifierId) {
  await tablesDB.deleteRow({
    databaseId: DATABASE_ID,
    tableId: TABLES.QUALIFIERS,
    rowId: qualifierId,
  });
}

/**
 * Actualiza un claim existente
 */
export async function updateClaim(claimId, data) {
  const updateData = {};
  if (data.property !== undefined) updateData.property = data.property;
  if (data.value_raw !== undefined) {
    updateData.value_raw = data.value_raw ? JSON.stringify(data.value_raw) : null;
  }
  if (data.value_relation !== undefined) updateData.value_relation = data.value_relation;

  const result = await tablesDB.updateRow({
    databaseId: DATABASE_ID,
    tableId: TABLES.CLAIMS,
    rowId: claimId,
    data: updateData,
  });

  return result;
}

/**
 * Elimina un claim y todos sus qualifiers y references asociados
 */
export async function deleteClaim(claimId) {
  // Primero eliminar qualifiers
  const qualifiers = await getQualifiersByClaim(claimId);
  for (const qualifier of qualifiers) {
    await deleteQualifier(qualifier.$id);
  }

  // Eliminar references
  const references = await getReferencesByClaim(claimId);
  for (const reference of references) {
    await deleteReference(reference.$id);
  }

  // Finalmente eliminar el claim
  await tablesDB.deleteRow({
    databaseId: DATABASE_ID,
    tableId: TABLES.CLAIMS,
    rowId: claimId,
  });
}

/**
 * Elimina una entidad y todos sus claims asociados
 */
export async function deleteEntity(entityId) {
  // Obtener todos los claims de esta entidad
  const claims = await getClaimsBySubject(entityId);
  
  // Eliminar cada claim (esto también elimina qualifiers y references)
  for (const claim of claims) {
    await deleteClaim(claim.$id);
  }

  // Finalmente eliminar la entidad
  await tablesDB.deleteRow({
    databaseId: DATABASE_ID,
    tableId: TABLES.ENTITIES,
    rowId: entityId,
  });
}

// ============================================
// UTILITIES
// ============================================

/**
 * Parsea un value_raw desde JSON string
 */
export function parseValueRaw(valueRaw) {
  if (!valueRaw) return null;
  
  try {
    if (typeof valueRaw === "string") {
      return JSON.parse(valueRaw);
    }
    return valueRaw;
  } catch (e) {
    // Si no es JSON válido, retornar como string simple
    return { datatype: "string", data: valueRaw };
  }
}

/**
 * Serializa un value para guardarlo como value_raw
 */
export function serializeValue(value) {
  if (typeof value === "string") {
    return JSON.stringify({ datatype: "string", data: value });
  }
  return JSON.stringify(value);
}

// ============================================
// AUDIT LOG / HISTORY
// ============================================

const TABLES_HISTORY = {
  AUDIT_LOG: "audit_log",
};

/**
 * Registra una acción en el historial de auditoría
 */
export async function logAction(action, {
  entityType,
  entityId,
  userId = null,
  userName = null,
  previousData = null,
  newData = null,
  metadata = null,
}) {
  try {
    await tablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: TABLES_HISTORY.AUDIT_LOG,
      rowId: "unique()",
      data: {
        action, // create, update, delete
        entity_type: entityType, // entity, claim, qualifier, reference
        entity_id: entityId,
        user_id: userId,
        user_name: userName,
        previous_data: previousData ? JSON.stringify(previousData) : null,
        new_data: newData ? JSON.stringify(newData) : null,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
  } catch (e) {
    // Si falla el logging, no interrumpir la operación principal
    console.error("Error logging action:", e);
  }
}

/**
 * Obtiene el historial de cambios con paginación
 */
export async function getAuditLog(limit = 50, offset = 0, filters = {}) {
  const queries = [
    Query.limit(limit),
    Query.offset(offset),
    Query.orderDesc("$createdAt"),
  ];

  // Filtrar por tipo de entidad
  if (filters.entityType) {
    queries.push(Query.equal("entity_type", filters.entityType));
  }

  // Filtrar por ID de entidad
  if (filters.entityId) {
    queries.push(Query.equal("entity_id", filters.entityId));
  }

  // Filtrar por usuario
  if (filters.userId) {
    queries.push(Query.equal("user_id", filters.userId));
  }

  // Filtrar por acción
  if (filters.action) {
    queries.push(Query.equal("action", filters.action));
  }

  try {
    const result = await tablesDB.listRows({
      databaseId: DATABASE_ID,
      tableId: TABLES_HISTORY.AUDIT_LOG,
      queries,
    });

    return {
      logs: result.rows.map((row) => ({
        ...row,
        previous_data: row.previous_data ? JSON.parse(row.previous_data) : null,
        new_data: row.new_data ? JSON.parse(row.new_data) : null,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      })),
      total: result.total,
    };
  } catch (e) {
    console.error("Error fetching audit log:", e);
    return { logs: [], total: 0 };
  }
}

/**
 * Obtiene el historial de una entidad específica
 */
export async function getEntityHistory(entityId, limit = 20) {
  return getAuditLog(limit, 0, { entityId });
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
