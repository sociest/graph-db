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

module.exports = async ({ req, res, log, error }) => {
  try {
    const body = parseBody(req?.body);
    const eventName = extractEventName(req, body);
    const action = getAction(eventName);

    const payload = body?.payload || body?.data || body?.document || null;
    const collectionId = extractCollectionId(payload, eventName);

    if (!DATABASE_ID || !collectionId || !action) {
      return res.json({
        ok: false,
        skipped: true,
        reason: "missing database, collection or action",
      });
    }

    if (collectionId === AUDIT_LOG_TABLE) {
      return res.json({ ok: true, skipped: true, reason: "audit log" });
    }

    const entityType = toEntityType(collectionId);
    if (!entityType) {
      return res.json({
        ok: true,
        skipped: true,
        reason: "untracked collection",
      });
    }

    const entityId = extractDocumentId(payload, eventName);

    const userId = body?.userId || body?.user?.$id || null;
    const userName = body?.user?.name || body?.user?.email || null;

    const previousData = body?.previousData || null;

    const client = new sdk.Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT)
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setJWT(req.headers['x-appwrite-user-jwt']);
      //.setKey(process.env.APPWRITE_API_KEY);

    const tablesDB = new sdk.TablesDB(client);

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
        previous_data: previousData ? JSON.stringify(previousData) : null,
        new_data: payload ? JSON.stringify(stripSystemFields(payload)) : null,
        metadata: JSON.stringify({
          event: eventName,
          collectionId,
          entityId,
          functionId: process.env.APPWRITE_FUNCTION_ID || null,
        }),
      },
    });

    return res.json({ ok: true });
  } catch (err) {
    error(err);
    return res.json({ ok: false, error: String(err) }, 500);
  }
};
