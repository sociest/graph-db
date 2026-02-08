const sdk = require("node-appwrite");

const DATABASE_ID =
  process.env.APPWRITE_DATABASE_ID ||
  process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID;

const TABLES = {
  ENTITIES: process.env.APPWRITE_ENTITIES_TABLE_ID || "entities",
  CLAIMS: process.env.APPWRITE_CLAIMS_TABLE_ID || "claims",
  QUALIFIERS: process.env.APPWRITE_QUALIFIERS_TABLE_ID || "qualifiers",
  REFERENCES: process.env.APPWRITE_REFERENCES_TABLE_ID || "references",
};

const AUDIT_LOG_TABLE =
  process.env.APPWRITE_AUDIT_LOG_TABLE_ID || "audit_log";

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "object") return body;
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function extractEventName(req, body) {
  return (
    req?.headers?.["x-appwrite-event"] ||
    req?.headers?.["X-Appwrite-Event"] ||
    body?.event ||
    body?.events?.[0] ||
    null
  );
}

function extractCollectionId(payload, eventName) {
  if (payload?.$collectionId) return payload.$collectionId;
  if (payload?.$tableId) return payload.$tableId;
  if (!eventName) return null;

  const collectionMatch = eventName.match(/collections\.([^\.]+)\./);
  if (collectionMatch) return collectionMatch[1];

  const tableMatch = eventName.match(/tables\.([^\.]+)\./);
  if (tableMatch) return tableMatch[1];

  return null;
}

function extractDocumentId(payload, eventName) {
  if (payload?.$id) return payload.$id;
  if (!eventName) return null;

  const documentMatch = eventName.match(/documents\.([^\.]+)\./);
  if (documentMatch) return documentMatch[1];

  const rowMatch = eventName.match(/rows\.([^\.]+)\./);
  if (rowMatch) return rowMatch[1];

  return null;
}

function getAction(eventName) {
  if (!eventName) return null;
  if (eventName.includes(".create")) return "create";
  if (eventName.includes(".update")) return "update";
  if (eventName.includes(".delete")) return "delete";
  return null;
}

function toEntityType(collectionId) {
  switch (collectionId) {
    case TABLES.ENTITIES:
      return "entity";
    case TABLES.CLAIMS:
      return "claim";
    case TABLES.QUALIFIERS:
      return "qualifier";
    case TABLES.REFERENCES:
      return "reference";
    default:
      return null;
  }
}

function stripSystemFields(data) {
  if (!data || typeof data !== "object") return data;
  const output = { ...data };
  const systemFields = [
    "$id",
    "$createdAt",
    "$updatedAt",
    "$permissions",
    "$databaseId",
    "$tableId",
    "$collectionId",
  ];

  for (const key of systemFields) {
    if (key in output) delete output[key];
  }

  return output;
}

function getEntityLabel(data) {
  if (!data || typeof data !== "object") return null;
  return (
    data.label ||
    data.name ||
    data.title ||
    data.displayName ||
    data.value ||
    null
  );
}

function isEntityRef(data) {
  if (!data || typeof data !== "object") return false;
  if (!data.$id) return false;
  return Boolean(getEntityLabel(data));
}

function reduceRelatedEntities(data, depth = 0) {
  if (data == null) return data;
  if (Array.isArray(data)) {
    return data.map((item) => reduceRelatedEntities(item, depth + 1));
  }
  if (typeof data !== "object") return data;

  if (depth > 0 && isEntityRef(data)) {
    const label = getEntityLabel(data);
    return {
      $id: data.$id,
      label: label,
    };
  }

  const output = {};
  for (const [key, value] of Object.entries(data)) {
    output[key] = reduceRelatedEntities(value, depth + 1);
  }
  return output;
}

function getApiKey(headers) {
  return (
    process.env.APPWRITE_API_KEY ||
    process.env.NEXT_PUBLIC_APPWRITE_API_KEY ||
    process.env.APPWRITE_FUNCTION_API_KEY ||
    headers["x-appwrite-key"]
  );
}

module.exports = async ({ req, res, log, error }) => {
  try {
    log("audit-log: start");
    log(`audit-log: headers=${JSON.stringify(req?.headers || {})}`);
    log(`audit-log: rawBodyType=${typeof req?.body}`);
    log(`audit-log: rawBody=${typeof req?.body === "string" ? req.body : JSON.stringify(req?.body || {})}`);

    const body = parseBody(req?.body);
    log(`audit-log: parsedBody=${JSON.stringify(body)}`);
    const eventName = extractEventName(req, body);
    const action = getAction(eventName);
    log(`audit-log: eventName=${eventName} action=${action}`);

    const payload = body?.payload || body?.data || body?.document || null;
    const collectionId = extractCollectionId(payload, eventName);
    log(`audit-log: collectionId=${collectionId}`);

    if (!DATABASE_ID || !collectionId || !action) {
      log("audit-log: skipped missing database, collection or action");
      return res.json({
        ok: false,
        skipped: true,
        reason: "missing database, collection or action",
      });
    }

    if (collectionId === AUDIT_LOG_TABLE) {
      log("audit-log: skipped audit log collection");
      return res.json({ ok: true, skipped: true, reason: "audit log" });
    }

    const entityType = toEntityType(collectionId);
    if (!entityType) {
      log("audit-log: skipped untracked collection");
      return res.json({
        ok: true,
        skipped: true,
        reason: "untracked collection",
      });
    }

    const entityId = extractDocumentId(payload, eventName);
    log(`audit-log: entityType=${entityType} entityId=${entityId}`);

    const userId = body?.userId || body?.user?.$id || null;
    const userName = body?.user?.name || body?.user?.email || null;
    log(`audit-log: userId=${userId} userName=${userName}`);
    
    
    const previousData = body?.previousData || null;
    log(`audit-log: previousData=${previousData ? "present" : "null"}`);

    const endpoint =
      process.env.APPWRITE_ENDPOINT ||
      process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
    const projectId =
      process.env.APPWRITE_PROJECT_ID ||
      process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
    const apiKey = getApiKey(req?.headers || {});

    if (!endpoint || !projectId || !apiKey) {
      log("audit-log: missing endpoint/project/apiKey");
      return res.json({
        ok: false,
        skipped: true,
        reason: "missing Appwrite endpoint, project, or api key",
      });
    }

    const client = new sdk.Client()
      .setEndpoint(endpoint)
      .setProject(projectId)
      .setKey(apiKey);

    //const userJwt = req?.headers?.["x-appwrite-user-jwt"];
    //if (userJwt) {
    //  client.setJWT(userJwt);
    //} else if (process.env.APPWRITE_API_KEY) {
    //  client.setKey(process.env.APPWRITE_API_KEY);
    //}

    const tablesDB = new sdk.TablesDB(client);

    log("audit-log: writing audit row");
    await tablesDB.createRow({
      databaseId: DATABASE_ID,
      tableId: AUDIT_LOG_TABLE,
      rowId: "unique()",
      data: {
        action,
        entity_type: entityType,
        entity_id: entityId,
        user_id: userId,
        user_name: userName,
        previous_data: previousData
          ? JSON.stringify(reduceRelatedEntities(previousData))
          : null,
        new_data: payload
          ? JSON.stringify(reduceRelatedEntities(stripSystemFields(payload)))
          : null,
        metadata: JSON.stringify({
          event: eventName,
          collectionId,
          entityId,
          functionId: process.env.APPWRITE_FUNCTION_ID || null,
        }),
      },
    });
    log("audit-log: write successful");

    return res.json({ ok: true });
  } catch (err) {
    error(`audit-log: error=${String(err)}`);
    return res.json({ ok: false, error: String(err) }, 500);
  }
};
