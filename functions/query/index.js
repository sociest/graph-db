const fs = require('fs');
const path = require('path');
const sdk = require('node-appwrite');
const { SparqlParser } = require('./parser');

// Defaults or environment variables
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID || process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || "master";
const TABLES = {
    ENTITIES: process.env.APPWRITE_ENTITIES_TABLE_ID || "entities",
    CLAIMS: process.env.APPWRITE_CLAIMS_TABLE_ID || "claims",
    QUALIFIERS: process.env.APPWRITE_QUALIFIERS_TABLE_ID || "qualifiers",
    REFERENCES: process.env.APPWRITE_REFERENCES_TABLE_ID || "references",
};

/**
 * Normalizes a text string for case-insensitive and whitespace-agnostic comparison.
 */
const normalizeText = (value) =>
    String(value ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ");

/**
 * Stringifies a claim's raw value for comparison.
 */
const stringifyClaimValue = (rawValue) => {
    if (rawValue === null || rawValue === undefined) return "";
    if (typeof rawValue === "string") {
        try {
            const parsed = JSON.parse(rawValue);
            if (typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean") {
                return String(parsed);
            }
            if (parsed && typeof parsed === "object" && parsed.url) {
                return String(parsed.url);
            }
        } catch {
            return rawValue;
        }
        return rawValue;
    }
    if (typeof rawValue === "object" && rawValue.url) return String(rawValue.url);
    try {
        return JSON.stringify(rawValue);
    } catch {
        return String(rawValue);
    }
};

/**
 * Parsed search query for text searching
 */
function parseSearchQuery(query) {
    const result = { exactPhrases: [], excludedTerms: [], optionalTerms: [], rawText: query || "" };
    if (!query) return result;

    const exactRegex = /"([^"]+)"/g;
    let match;
    let remainingQuery = query;

    while ((match = exactRegex.exec(query)) !== null) {
        if (match[1].trim()) result.exactPhrases.push(normalizeText(match[1]));
        remainingQuery = remainingQuery.replace(match[0], ' ');
    }

    const tokens = remainingQuery.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
        if (token.startsWith('-') && token.length > 1) {
            result.excludedTerms.push(normalizeText(token.substring(1)));
        } else {
            const norm = normalizeText(token);
            if (norm) result.optionalTerms.push(norm);
        }
    }
    return result;
}

/**
 * Searches for entities based on a structured schema.
 * @param {sdk.Databases} databases Appwrite Databases service instance.
 * @param {object} schema The search schema.
 * @param {number} limit Maximum number of entities to return.
 * @param {number} offset Offset for pagination.
 * @param {function} log Optional logging function.
 * @returns {Promise<Array<object>>} List of matching entities.
 */
async function searchEntitiesBySchema(databases, schema, limit = 20, offset = 0, log, checkTimeout) {
    const mainStart = Date.now();
    if (log) log(`[SchemaSearch] Starting search with schema: ${JSON.stringify(schema)}`);

    const entityIds = await _findEntityIds(databases, schema, limit + offset, log, checkTimeout);

    if (entityIds.length === 0) {
        if (log) log(`[SchemaSearch] No entity IDs found. Search completed in ${Date.now() - mainStart}ms.`);
        return [];
    }

    // Fetch full entity data for the found IDs
    const queries = [
        sdk.Query.limit(limit),
        sdk.Query.offset(offset),
        sdk.Query.orderDesc("$createdAt"), // Default ordering
        sdk.Query.equal("$id", entityIds)
    ];

    if (log) log(`[SchemaSearch] Fetching full entity data for ${entityIds.length} IDs. Time elapsed: ${Date.now() - mainStart}ms.`);
    const result = await databases.listDocuments(DATABASE_ID, TABLES.ENTITIES, queries);
    const finalEntities = result.documents.map(doc => typeof doc.data === 'string' ? JSON.parse(doc.data) : (doc.data || doc));

    if (log) log(`[SchemaSearch] Search completed successfully in ${Date.now() - mainStart}ms!`);
    return finalEntities;
}

function calculateRelevance(entity, parsedQuery) {
    const normLabel = normalizeText(entity.label);
    const normDesc = normalizeText(entity.description);
    const normAliases = (entity.aliases || []).map(a => normalizeText(a));
    const normId = normalizeText(entity.$id);

    let score = 0;
    const allTerms = [...parsedQuery.exactPhrases, ...parsedQuery.optionalTerms];
    const fullOriginalText = normalizeText(parsedQuery.rawText);

    if (normLabel === fullOriginalText) score += 1000;
    if (normAliases.includes(fullOriginalText)) score += 900;
    if (normId === fullOriginalText) score += 800;

    if (normLabel.startsWith(fullOriginalText)) score += 600;
    if (normAliases.some(a => a.startsWith(fullOriginalText))) score += 500;

    for (const term of allTerms) {
        if (normLabel === term) score += 100;
        else if (normLabel.startsWith(term)) score += 80;
        else if (normLabel.includes(term)) score += 50;

        if (normAliases.includes(term)) score += 90;
        else if (normAliases.some(a => a.startsWith(term))) score += 70;
        else if (normAliases.some(a => a.includes(term))) score += 40;

        if (normDesc.includes(term)) score += 20;

        if (normId === term) score += 100;
        else if (normId.includes(term)) score += 10;
    }

    for (const term of parsedQuery.excludedTerms) {
        if (normLabel.includes(term) || normDesc.includes(term) || normAliases.some(a => a.includes(term))) {
            score -= 5000;
        }
    }

    return score;
}

async function searchEntitiesText(databases, searchTerm, limit = 20, offset = 0) {
    const parsedQuery = parseSearchQuery(searchTerm);
    const allRequiredTerms = [...parsedQuery.exactPhrases, ...parsedQuery.optionalTerms];

    const queries = [
        sdk.Query.limit(limit * 3),
        sdk.Query.offset(offset),
        sdk.Query.select(["$id", "label", "description", "aliases"])
    ];

    if (searchTerm && searchTerm.trim()) {
        if (allRequiredTerms.length > 0) {
            for (const term of allRequiredTerms) {
                queries.push(sdk.Query.or([
                    sdk.Query.search("label", term),
                    sdk.Query.search("description", term),
                    sdk.Query.contains("aliases", term),
                    sdk.Query.contains("label", term),
                    sdk.Query.equal("$id", term)
                ]));
            }
        } else {
            queries.push(sdk.Query.orderDesc("$createdAt"));
        }
    } else {
        queries.push(sdk.Query.orderDesc("$createdAt"));
    }

    const result = await databases.listDocuments(DATABASE_ID, TABLES.ENTITIES, queries);
    let rows = result.documents;

    if (searchTerm && rows.length > 0) {
        let filteredRows = rows.map(row => {
            const data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || row);
            return {
                ...row,
                ...data,
                _score: calculateRelevance(data, parsedQuery)
            };
        }).filter(row => row._score >= 0);

        filteredRows.sort((a, b) => b._score - a._score);
        rows = filteredRows.slice(0, limit);
    }

    return rows;
}

async function searchEntitiesByPropertyValue(databases, propertyId, value, limit = 10, matchMode = "contains") {
    if (!propertyId || !value) return [];

    const searchValue = normalizeText(value);
    const entityIds = new Set();
    const pageSize = 100;
    let offset = 0;

    while (entityIds.size < limit) {
        const claimsResult = await databases.listDocuments(DATABASE_ID, TABLES.CLAIMS, [
            sdk.Query.equal("property", propertyId),
            sdk.Query.limit(pageSize),
            sdk.Query.offset(offset),
        ]);

        const rows = claimsResult.documents || [];
        if (rows.length === 0) break;

        for (const claimDoc of rows) {
            const claim = typeof claimDoc.data === 'string' ? JSON.parse(claimDoc.data) : (claimDoc.data || claimDoc);
            const claimValue = normalizeText(stringifyClaimValue(claim.value_raw));

            if (!claimValue || !searchValue) continue;

            const claimNum = parseFloat(claimValue);
            const condNum = parseFloat(searchValue);
            const isNumeric = !isNaN(claimNum) && !isNaN(condNum);

            let matches = false;
            switch (matchMode) {
                case "equal": matches = claimValue === searchValue; break;
                case "notEqual": matches = claimValue !== searchValue; break;
                case "startsWith": matches = claimValue.startsWith(searchValue); break;
                case "endsWith": matches = claimValue.endsWith(searchValue); break;
                case "greaterThan": matches = isNumeric && claimNum > condNum; break;
                case "greaterThanEqual": matches = isNumeric && claimNum >= condNum; break;
                case "lessThan": matches = isNumeric && claimNum < condNum; break;
                case "lessThanEqual": matches = isNumeric && claimNum <= condNum; break;
                case "contains":
                default: matches = claimValue.includes(searchValue);
            }

            if (matches) {
                const id = claim.subject?.$id || claim.subject;
                if (id) entityIds.add(typeof id === 'string' ? id : id.$id);
            }
            if (entityIds.size >= limit) break;
        }

        if (rows.length < pageSize) break;
        offset += pageSize;
    }

    if (entityIds.size === 0) return [];

    // We only need IDs for intermediate steps, we don't fetch full entities yet
    return Array.from(entityIds).slice(0, limit).map(id => ({ $id: id }));
}

async function getFullClaim(databases, claimId, log, checkTimeout) {
    const t0 = Date.now();
    try {
        if (checkTimeout) checkTimeout();
        const claimDoc = await databases.getDocument(DATABASE_ID, TABLES.CLAIMS, claimId);
        const claim = typeof claimDoc.data === 'string' ? JSON.parse(claimDoc.data) : (claimDoc.data || claimDoc);

        if (log) log(`[getFullClaim] Requesting qualifiers/references for claim: ${JSON.stringify(claimId)}`);
        const [qualifiersResult, referencesResult] = await Promise.all([
            databases.listDocuments(DATABASE_ID, TABLES.QUALIFIERS, [sdk.Query.equal("claim", claimId), sdk.Query.limit(100)]).catch(e => {
                if (log) log(`QUALIFIER ERROR for claimId ${claimId}: ${e.message}`);
                throw e;
            }),
            databases.listDocuments(DATABASE_ID, TABLES.REFERENCES, [sdk.Query.equal("claim", claimId), sdk.Query.limit(100)]).catch(e => {
                if (log) log(`REFERENCE ERROR for claimId ${claimId}: ${e.message}`);
                throw e;
            })
        ]);

        claim.qualifiersList = qualifiersResult.documents.map(d => typeof d.data === 'string' ? JSON.parse(d.data) : (d.data || d));
        claim.referencesList = referencesResult.documents.map(d => typeof d.data === 'string' ? JSON.parse(d.data) : (d.data || d));

        if (log) log(`[getFullClaim] Finished in ${Date.now() - t0}ms for claimId ${claimId}`);
        return claim;
    } catch (err) {
        if (log) log(`[getFullClaim] Error: ${err.message}`);
        return null;
    }
}

function _claimMatchesSchemaCondition(claim, claimSchema) {
    if ((claim.property?.$id || claim.property) !== claimSchema.propertyId) return false;

    if (claimSchema.value !== undefined) {
        const normalizedClaimValue = normalizeText(stringifyClaimValue(claim.value_raw));
        const normalizedSchemaValue = normalizeText(claimSchema.value);
        const matchMode = claimSchema.valueMatchMode || "contains";

        if (matchMode === "equal" && normalizedClaimValue !== normalizedSchemaValue) return false;
        if (matchMode === "contains" && !normalizedClaimValue.includes(normalizedSchemaValue)) return false;
    }

    if (Array.isArray(claimSchema.qualifiers) && claimSchema.qualifiers.length > 0) {
        const claimQualifiers = claim.qualifiersList || [];
        for (const qCondition of claimSchema.qualifiers) {
            const matchingQualifier = claimQualifiers.find(qualifier => {
                if ((qualifier.property?.$id || qualifier.property) !== qCondition.propertyId) return false;
                const normalizedQualifierValue = normalizeText(stringifyClaimValue(qualifier.value_raw));
                const normalizedConditionValue = normalizeText(qCondition.value);
                const matchMode = qCondition.matchMode || "contains";
                return matchMode === "equal"
                    ? normalizedQualifierValue === normalizedConditionValue
                    : normalizedQualifierValue.includes(normalizedConditionValue);
            });
            if (!matchingQualifier) return false;
        }
    }

    if (Array.isArray(claimSchema.references) && claimSchema.references.length > 0) {
        const claimReferences = claim.referencesList || [];
        for (const rCondition of claimSchema.references) {
            const matchingReference = claimReferences.find(reference => {
                return (reference.reference?.$id || reference.reference) === rCondition.referenceId;
            });
            if (!matchingReference) return false;
        }
    }

    return true;
}

async function _searchClaimsBySchemaCondition(databases, claimSchema, limit = 50, offset = 0, log, checkTimeout) {
    if (log) log(`[_searchClaimsBySchemaCondition] Started for property: ${claimSchema.propertyId}`);
    const matchingSubjectIds = new Set();
    const pageSize = 100;
    let currentOffset = 0;
    let hasMoreClaims = true;

    // OPTIMIZATION: Push exact matches down to the DB if possible
    const dbQueries = [
        sdk.Query.equal("property", claimSchema.propertyId)
    ];

    if (claimSchema.value !== undefined && (!claimSchema.valueMatchMode || claimSchema.valueMatchMode === "equal")) {
        const strVal = String(claimSchema.value);
        if (strVal.length === 20 && /^[a-zA-Z0-9]+$/.test(strVal)) {
            dbQueries.push(sdk.Query.equal("value_relation", strVal));
            if (log) log(`[_searchClaimsBySchemaCondition] Pushed exact value_relation query for ${strVal} to DB`);
        }
    }

    while (hasMoreClaims && matchingSubjectIds.size < limit) {
        if (checkTimeout) checkTimeout();
        const loopT0 = Date.now();
        const claimsResult = await databases.listDocuments(DATABASE_ID, TABLES.CLAIMS, [
            ...dbQueries,
            sdk.Query.limit(pageSize),
            sdk.Query.offset(currentOffset),
        ]);

        const claims = claimsResult.documents || [];
        if (log) log(`[_searchClaimsBySchemaCondition] Fetched ${claims.length} claims inside loop at offset ${currentOffset} in ${Date.now() - loopT0}ms`);
        if (claims.length === 0) break;

        for (const claimDoc of claims) {
            const claim = typeof claimDoc.data === 'string' ? JSON.parse(claimDoc.data) : (claimDoc.data || claimDoc);
            claim.$id = claimDoc.$id;

            if ((Array.isArray(claimSchema.qualifiers) && claimSchema.qualifiers.length > 0) ||
                (Array.isArray(claimSchema.references) && claimSchema.references.length > 0)) {

                const fullClaim = await getFullClaim(databases, claimDoc.$id, log, checkTimeout);
                if (fullClaim && _claimMatchesSchemaCondition(fullClaim, claimSchema)) {
                    const subjectId = fullClaim.subject?.$id || fullClaim.subject;
                    if (subjectId) {
                        matchingSubjectIds.add(typeof subjectId === 'string' ? subjectId : subjectId.$id);
                        if (matchingSubjectIds.size >= limit) break;
                    }
                }
            } else {
                if (_claimMatchesSchemaCondition(claim, claimSchema)) {
                    const subjectId = claim.subject?.$id || claim.subject;
                    if (subjectId) {
                        matchingSubjectIds.add(typeof subjectId === 'string' ? subjectId : subjectId.$id);
                        if (matchingSubjectIds.size >= limit) break;
                    }
                }
            }
        }

        currentOffset += pageSize;
        if (claims.length < pageSize) hasMoreClaims = false;
    }

    return matchingSubjectIds;
}

// Helper to recursively find entities matching the schema condition
async function _findEntityIds(databases, schema, limit, log, checkTimeout) {
    const t0 = Date.now();
    if (log) log(`[_findEntityIds] Started lookup with schema logic ${schema.logic}`);
    const { text, properties = [], claims = [], groups = [], logic = "AND" } = schema;
    let candidateEntityIds = new Set();
    let firstConditionProcessed = false;

    if (text) {
        if (checkTimeout) checkTimeout();
        const textMatches = await searchEntitiesText(databases, text, limit * 5, 0);
        const ids = textMatches.map(entity => entity.$id);
        candidateEntityIds = new Set(ids);
        firstConditionProcessed = true;
    }

    const mergeIds = (currentSet, newSet, isFirstInLoop) => {
        if (logic === "AND") {
            if (firstConditionProcessed || !isFirstInLoop) {
                return new Set([...currentSet].filter(id => newSet.has(id)));
            } else {
                return newSet;
            }
        } else {
            return new Set([...currentSet, ...newSet]);
        }
    };

    if (properties.length > 0) {
        let propertyMatchedIds = new Set(firstConditionProcessed ? candidateEntityIds : []);
        let firstProp = true;

        for (const propCondition of properties) {
            if (!propCondition.propertyId || !propCondition.value) continue;
            const propMatches = await searchEntitiesByPropertyValue(
                databases,
                propCondition.propertyId,
                propCondition.value,
                limit * 5,
                propCondition.matchMode
            );
            const currentPropIds = new Set(propMatches.map(entity => entity.$id));
            propertyMatchedIds = mergeIds(propertyMatchedIds, currentPropIds, firstProp);
            firstProp = false;
        }

        if (!firstProp) {
            candidateEntityIds = propertyMatchedIds;
            firstConditionProcessed = true;
        }
    }

    if (claims.length > 0) {
        let claimMatchedIds = new Set(firstConditionProcessed ? candidateEntityIds : []);
        let firstClaim = true;

        for (const claimCondition of claims) {
            if (checkTimeout) checkTimeout();
            const currentClaimSubjectIds = await _searchClaimsBySchemaCondition(databases, claimCondition, limit * 5, 0, log, checkTimeout);
            claimMatchedIds = mergeIds(claimMatchedIds, currentClaimSubjectIds, firstClaim);
            firstClaim = false;
        }

        if (!firstClaim) {
            candidateEntityIds = claimMatchedIds;
            firstConditionProcessed = true;
        }
    }

    if (groups.length > 0) {
        let groupMatchedIds = new Set(firstConditionProcessed ? candidateEntityIds : []);
        let firstGroup = true;

        for (const groupSchema of groups) {
            if (checkTimeout) checkTimeout();
            const matchedIds = await _findEntityIds(databases, groupSchema, limit, log, checkTimeout);
            const currentGroupIds = new Set(matchedIds);
            groupMatchedIds = mergeIds(groupMatchedIds, currentGroupIds, firstGroup);
            firstGroup = false;
        }

        if (!firstGroup) {
            candidateEntityIds = groupMatchedIds;
            firstConditionProcessed = true;
        }
    }

    if (!firstConditionProcessed) {
        if (log) log(`[_findEntityIds] Finished in ${Date.now() - t0}ms, no conditions processed.`);
        return [];
    }

    if (log) log(`[_findEntityIds] Finished in ${Date.now() - t0}ms, found ${candidateEntityIds.size} candidates.`);
    return Array.from(candidateEntityIds);
}

// ----------------------------------------------------- //
// Legacy SPARQL Execution Logic
// ----------------------------------------------------- //
async function executeSparql(parsed, databases, log, checkTimeout) {
    const startTime = Date.now();
    if (log) log(`[SPARQL] Starting execution. Parsed patterns: ${parsed.wherePattern.length}`);

    if (parsed.type !== 'SELECT') throw new Error('Only SELECT queries are supported in this engine version.');
    if (parsed.wherePattern.length === 0) throw new Error('WHERE clause cannot be empty.');

    // 0. Pre-process concise syntax (e.g. `?item prop:Pxx item:Qyy .` -> full graph equivalents)
    let autoVarCount = 0;
    const normalizedPatterns = [];
    for (const p of parsed.wherePattern) {
        if (p.predicate.startsWith('prop:')) {
            const propId = p.predicate.replace('prop:', '');
            const autoVar = `?_auto_stmt${autoVarCount++}`;
            normalizedPatterns.push({ subject: p.subject, predicate: `claim:${propId}`, object: autoVar });
            normalizedPatterns.push({ subject: autoVar, predicate: 'value:', object: p.object });
        } else if (p.predicate.startsWith('claim:') && !p.object.startsWith('?')) {
            const autoVar = `?_auto_stmt${autoVarCount++}`;
            normalizedPatterns.push({ subject: p.subject, predicate: p.predicate, object: autoVar });
            normalizedPatterns.push({ subject: autoVar, predicate: 'value:', object: p.object });
        } else {
            normalizedPatterns.push(p);
        }
    }
    parsed.wherePattern = normalizedPatterns;

    // 1. Group patterns by type
    const claimPatterns = parsed.wherePattern.filter(p => p.predicate.startsWith('claim:') && p.object.startsWith('?'));
    const valuePatterns = parsed.wherePattern.filter(p => p.predicate === 'value:');
    const qualPatterns = parsed.wherePattern.filter(p => p.predicate.startsWith('qual:'));
    const refPatterns = parsed.wherePattern.filter(p => p.predicate.startsWith('ref:'));

    if (claimPatterns.length === 0) throw new Error('At least one claim predicate is required to anchor the search.');

    // Find the best anchor claim (one that has an exact value match)
    let anchorClaimPattern = claimPatterns[0];
    let anchorValuePattern = null;
    let anchorTargetValue = null;

    for (const cp of claimPatterns) {
        const vp = valuePatterns.find(v => v.subject === cp.object);
        if (vp && !vp.object.startsWith('?')) {
            anchorClaimPattern = cp;
            anchorValuePattern = vp;
            anchorTargetValue = vp.object.replace('item:', '').replace(/['"]/g, '');
            break;
        }
    }

    const itemVar = anchorClaimPattern.subject;
    const anchorPropId = anchorClaimPattern.predicate.replace('claim:', '');

    let queryLimit = parsed.limit || 100;
    let queryOffset = parsed.offset || 0;

    // Fetch limits
    const fetchLimit = Math.min(Math.max((queryLimit + queryOffset) * 2, 100), 5000);
    const queries = [sdk.Query.equal('property', anchorPropId), sdk.Query.limit(fetchLimit)];

    if (anchorTargetValue && (queryOffset + queryLimit) <= 5000) {
        // If we are looking for an exact target value on the anchor, we can pass offset directly to DB
        // But since Appwrite search on `value_raw` isn't direct in our current index setup without warning,
        // we let the manual filter catch it unless we are sure it's an indexed field.
    }

    if (log) log(`[SPARQL] Fetching anchor claims for property ${anchorPropId}. Limit: ${fetchLimit}. Time elapsed: ${Date.now() - startTime}ms`);

    let claimsResponse;
    try {
        claimsResponse = await databases.listDocuments(DATABASE_ID, TABLES.CLAIMS, queries);
    } catch (e) {
        throw new Error(`Failed to fetch anchor claims: ${e.message}`);
    }

    if (log) log(`[SPARQL] Anchor claims returned ${claimsResponse.documents.length} documents. Time elapsed: ${Date.now() - startTime}ms`);

    let results = [];
    let yieldedCount = 0;

    if (log) log(`[SPARQL] Starting loop over ${claimsResponse.documents.length} anchor documents...`);
    let loopStartTime = Date.now();

    for (const anchorDoc of claimsResponse.documents) {
        if (checkTimeout) checkTimeout();

        if (results.length >= queryLimit) {
            if (log) log(`[SPARQL] Reached requested limit of ${queryLimit}. Breaking loop.`);
            break;
        }

        const data = typeof anchorDoc.data === 'string' ? JSON.parse(anchorDoc.data) : (anchorDoc.data || anchorDoc);
        const subjectId = data.subject || data.$id;
        const claimValueRaw = data.value_raw || data.value;
        const claimValueRelation = data.value_relation?.$id || data.value_relation;

        if (anchorTargetValue) {
            if (claimValueRaw !== anchorTargetValue && claimValueRelation !== anchorTargetValue) {
                continue;
            }
        }

        const env = {
            [itemVar]: subjectId,
            [anchorClaimPattern.object]: {
                id: anchorDoc.$id,
                value: claimValueRaw,
                relation: claimValueRelation
            }
        };

        let isValid = true;

        // Satisfy other claims
        for (const cp of claimPatterns) {
            if (cp === anchorClaimPattern) continue;
            if (cp.subject !== itemVar) continue; // Only joining on the main subject for now

            const propId = cp.predicate.replace('claim:', '');

            try {
                const claimT1 = Date.now();
                const otherClaims = await databases.listDocuments(DATABASE_ID, TABLES.CLAIMS, [
                    sdk.Query.equal('subject', typeof subjectId === 'string' ? subjectId : subjectId.$id),
                    sdk.Query.equal('property', propId),
                    sdk.Query.limit(1)
                ]);
                // if (log) log(`[SPARQL] Fetched additional claim ${propId} in ${Date.now() - claimT1}ms`);

                if (otherClaims.documents.length === 0) {
                    isValid = false; break;
                }

                const odata = typeof otherClaims.documents[0].data === 'string' ? JSON.parse(otherClaims.documents[0].data) : (otherClaims.documents[0].data || otherClaims.documents[0]);
                env[cp.object] = {
                    id: otherClaims.documents[0].$id,
                    value: odata.value_raw || odata.value,
                    relation: odata.value_relation?.$id || odata.value_relation
                };
            } catch (e) {
                if (log) log(`Error fetching claim ${propId}: ${e.message}`);
                isValid = false; break;
            }
        }
        if (!isValid) continue;

        let resultRow = {};

        // Satisfy values
        for (const vp of valuePatterns) {
            if (vp === anchorValuePattern) continue;
            const claimCtx = env[vp.subject];
            if (!claimCtx) { isValid = false; break; }

            if (vp.object.startsWith('?')) {
                resultRow[vp.object] = claimCtx.value;
            } else {
                const reqVal = vp.object.replace('item:', '').replace(/['"]/g, '');
                if (claimCtx.value !== reqVal && claimCtx.relation !== reqVal) {
                    isValid = false; break;
                }
            }
        }
        if (!isValid) continue;

        // Satisfy qualifiers
        for (const qp of qualPatterns) {
            const claimCtx = env[qp.subject];
            if (!claimCtx) { isValid = false; break; }

            const qualPropId = qp.predicate.replace('qual:', '');
            try {
                const qualResponse = await databases.listDocuments(DATABASE_ID, TABLES.QUALIFIERS, [
                    sdk.Query.equal('claim', claimCtx.id), sdk.Query.equal('property', qualPropId), sdk.Query.limit(1)
                ]);
                if (qualResponse.documents.length === 0) { isValid = false; break; }
                const qdata = typeof qualResponse.documents[0].data === 'string' ? JSON.parse(qualResponse.documents[0].data) : (qualResponse.documents[0].data || qualResponse.documents[0]);

                if (qp.object.startsWith('?')) {
                    resultRow[qp.object] = qdata.value;
                } else {
                    const reqVal = qp.object.replace('item:', '').replace(/['"]/g, '');
                    if (qdata.value !== reqVal) { isValid = false; break; }
                }
            } catch (err) {
                isValid = false; break;
            }
        }
        if (!isValid) continue;

        // Satisfy references
        for (const rp of refPatterns) {
            const claimCtx = env[rp.subject];
            if (!claimCtx) { isValid = false; break; }

            const refPropId = rp.predicate.replace('ref:', '');
            try {
                const refResponse = await databases.listDocuments(DATABASE_ID, TABLES.REFERENCES, [
                    sdk.Query.equal('claim', claimCtx.id), sdk.Query.equal('property', refPropId), sdk.Query.limit(1)
                ]);
                if (refResponse.documents.length === 0) { isValid = false; break; }
                const rdata = typeof refResponse.documents[0].data === 'string' ? JSON.parse(refResponse.documents[0].data) : (refResponse.documents[0].data || refResponse.documents[0]);

                if (rp.object.startsWith('?')) {
                    resultRow[rp.object] = rdata.value;
                } else {
                    const reqVal = rp.object.replace('item:', '').replace(/['"]/g, '');
                    if (rdata.value !== reqVal) { isValid = false; break; }
                }
            } catch (err) {
                isValid = false; break;
            }
        }
        if (!isValid) continue;

        // Apply Offset early to avoid expensive Entity queries
        yieldedCount++;
        if (yieldedCount <= queryOffset) {
            continue; // Skip this row as it falls before the requested offset
        }

        // Finalize row variables
        if (parsed.variables.includes('?label') || parsed.variables.includes('*')) {
            try {
                const entityRow = await databases.getDocument(DATABASE_ID, TABLES.ENTITIES, typeof subjectId === 'string' ? subjectId : subjectId.$id, [
                    sdk.Query.select(["$id", "label", "name"])
                ]);
                const entityData = typeof entityRow.data === 'string' ? JSON.parse(entityRow.data) : (entityRow.data || entityRow);
                resultRow['?label'] = entityData.label || entityData.name || null;
            } catch {
                resultRow['?label'] = null;
            }
        }

        for (const v of parsed.variables) {
            if (v === itemVar) resultRow[v] = typeof subjectId === 'string' ? subjectId : subjectId.$id;
            else if (env[v] && typeof env[v] === 'object') resultRow[v] = env[v].id;
            else if (resultRow[v] === undefined && v !== '*') resultRow[v] = null;
        }

        results.push(resultRow);
    }

    if (log) log(`[SPARQL] Loop finished in ${Date.now() - loopStartTime}ms. Total execution time: ${Date.now() - startTime}ms. Yielded items: ${results.length}. Skipped on offset: ${yieldedCount - results.length}`);
    return results;
}

// ----------------------------------------------------- //
// Main Endpoint Export
// ----------------------------------------------------- //
module.exports = async ({ req, res, log, error }) => {
    try {
        if (req.method === 'GET') {
            log("GET Request received. Redirecting to Next.js Query page.");

            const isProd = !req.headers.host?.includes('localhost');
            // Provide a graceful fallback to frontend URL dynamically if NEXT_PUBLIC_BASE_URL is set
            const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (isProd ? 'https://tu-dominio.com' : 'http://localhost:3000');

            return res.send('', 302, {
                'Location': `${baseUrl}/query`
            });
        }

        if (req.method === 'POST') {
            const reqStart = Date.now();
            const checkTimeout = () => {
                if (Date.now() - reqStart > 13500) {
                    const err = new Error("INTERNAL_TIMEOUT: Function approached 14s limit. Bailing out gracefully to flush logs.");
                    err.isTimeout = true;
                    throw err;
                }
            };

            let body = req.body;
            if (typeof body === 'string') {
                body = JSON.parse(body);
            }

            const endpoint = process.env.APPWRITE_ENDPOINT || process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
            const projectId = process.env.APPWRITE_PROJECT_ID || process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
            const apiKey = req.headers['x-appwrite-key'] || process.env.APPWRITE_API_KEY;

            const client = new sdk.Client().setEndpoint(endpoint).setProject(projectId);
            if (apiKey) {
                client.setKey(apiKey);
            } else {
                log("Warning: No API Key provided. Queries might fail due to permissions.");
            }
            const databases = new sdk.Databases(client);

            // Path 1: Schema Search
            if (body.schema) {
                log("Executing Schema Search: " + JSON.stringify(body.schema));
                const limit = body.limit || 50;
                const offset = body.offset || 0;

                const returnsList = body.returns || body.schema.returns || null;

                try {
                    const allIds = await _findEntityIds(databases, body.schema, limit + offset + 50, log, checkTimeout);
                    const pagedIds = allIds.slice(offset, offset + limit);

                    const entities = [];

                    let dbSelects = null;
                    let propSelects = [];
                    if (returnsList && Array.isArray(returnsList)) {
                        dbSelects = returnsList.filter(r => !r.startsWith("prop:")).map(r => r === "id" ? "$id" : r);
                        if (dbSelects.length === 0) dbSelects = ["$id"];
                        propSelects = returnsList.filter(r => r.startsWith("prop:")).map(r => r.replace("prop:", ""));
                    }

                    for (const id of pagedIds) {
                        if (checkTimeout) checkTimeout();
                        try {
                            const selectQuery = dbSelects ? [sdk.Query.select(dbSelects)] : [sdk.Query.select(["$id", "label", "description", "aliases", "$createdAt", "$updatedAt"])];
                            const entity = await databases.getDocument(DATABASE_ID, TABLES.ENTITIES, id, selectQuery);
                            const data = typeof entity.data === 'string' ? JSON.parse(entity.data) : (entity.data || entity);

                            let resultObj = { ...entity, ...data };

                            // Map specific claims if requested via returns logic
                            if (propSelects.length > 0) {
                                for (const propId of propSelects) {
                                    resultObj[`prop:${propId}`] = null;
                                    try {
                                        const claimsList = await databases.listDocuments(DATABASE_ID, TABLES.CLAIMS, [
                                            sdk.Query.equal("subject", id),
                                            sdk.Query.equal("property", propId)
                                        ]);
                                        if (claimsList.documents.length > 0) {
                                            const mappedClaims = claimsList.documents.map(d => {
                                                const cdata = typeof d.data === 'string' ? JSON.parse(d.data) : (d.data || d);
                                                return cdata.value_raw || cdata.value_relation?.$id || cdata.value_relation || null;
                                            }).filter(Boolean);

                                            if (mappedClaims.length === 1) resultObj[`prop:${propId}`] = mappedClaims[0];
                                            else if (mappedClaims.length > 1) resultObj[`prop:${propId}`] = mappedClaims;
                                        }
                                    } catch (e) { }
                                }
                            } else if (returnsList) {
                                // Clean up unrequested stuff if using explicit returns without props
                                Object.keys(resultObj).forEach(k => {
                                    if (!k.startsWith('$') && !dbSelects.includes(k) && k !== 'id') delete resultObj[k];
                                });
                            }

                            entities.push(resultObj);
                        } catch (e) {
                            log(`Entidad ${id} no encontrada`);
                        }
                    }

                    return res.json({ results: entities }, 200);
                } catch (e) {
                    error(`Error in Schema Search: ${e.message}`);
                    if (e.isTimeout) return res.json({ error: e.message, timeout: true }, 504);
                    return res.json({ error: e.message }, 500);
                }
            }

            // Path 2: SPARQL Query
            if (body.query) {
                log("Executing SPARQL Query");
                const parser = new SparqlParser(body.query);
                const parsed = parser.parse();
                log("Parsed Query: " + JSON.stringify(parsed));

                try {
                    const results = await executeSparql(parsed, databases, log, checkTimeout);
                    return res.json({ results: { bindings: results } }, 200);
                } catch (e) {
                    error(`Error in SPARQL Execution: ${e.message}`);
                    if (e.isTimeout) return res.json({ error: e.message, timeout: true }, 504);
                    return res.json({ error: e.message }, 500);
                }
            }

            return res.json({ error: 'Missing `schema` or `query` parameter in request body' }, 400);
        }

        return res.json({ error: 'Method not allowed' }, 405);
    } catch (err) {
        error(err.message);
        return res.json({ error: err.message || 'Server Error' }, 500);
    }
};
