import { FieldValue } from "firebase-admin/firestore";

import { captureBeforeImage } from "./snapshot.js";

export function buildUpdatePayload(docData, ops) {
  const payload = {};
  let hasChanges = false;

  for (const [field, spec] of Object.entries(ops.add || {})) {
    if (docData[field] !== undefined) continue;

    let value;

    if (spec && typeof spec.from === "function") {
      value = spec.from(docData);
    } else if (spec && Object.prototype.hasOwnProperty.call(spec, "default")) {
      value = spec.default;
    } else if (spec !== undefined && typeof spec !== "object") {
      value = spec;
    } else {
      value = null;
    }

    payload[field] = value;
    hasChanges = true;
  }

  for (const field of ops.remove || []) {
    if (docData[field] !== undefined) {
      payload[field] = FieldValue.delete();
      hasChanges = true;
    }
  }

  for (const [field, fn] of Object.entries(ops.update || {})) {
    if (typeof fn !== "function") {
      throw new Error(`update.${field} must be a function (doc) => newValue`);
    }

    const newVal = fn(docData);

    if (newVal !== undefined) {
      payload[field] = newVal;
      hasChanges = true;
    }
  }

  return hasChanges ? payload : null;
}

export function hasDownOps(ops) {
  if (!ops) return false;

  return (
    Object.keys(ops.add || {}).length > 0 ||
    (ops.remove || []).length > 0 ||
    Object.keys(ops.update || {}).length > 0
  );
}

export async function applyOperations(db, collectionName, ops, options = {}) {
  const {
    batchSize = 400,
    dryRun = false,
    onProgress,
    snapshotStore = null,
  } = options;
  const colRef = db.collection(collectionName);

  let scanned = 0;
  let updated = 0;
  let batches = 0;
  let batch = dryRun ? null : db.batch();
  let batchCount = 0;
  const committedIds = [];
  let pendingIds = [];

  const commitBatch = async () => {
    if (dryRun || batchCount === 0) return;

    await batch.commit();

    batches += 1;

    committedIds.push(...pendingIds);

    pendingIds = [];
    batch = db.batch();
    batchCount = 0;

    if (snapshotStore) snapshotStore.flush();
  };

  let lastDoc = null;
  const pageSize = Math.min(batchSize * 2, 1000);

  try {
    while (true) {
      let query = colRef.orderBy("__name__").limit(pageSize);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();

      if (snapshot.empty) break;

      for (const doc of snapshot.docs) {
        scanned += 1;
        const data = doc.data();
        const payload = buildUpdatePayload(data, ops);

        if (payload) {
          updated += 1;

          if (!dryRun) {
            if (snapshotStore) {
              const before = captureBeforeImage(data, ops);

              snapshotStore.record(doc.id, before);
            }

            batch.update(doc.ref, payload);
            pendingIds.push(doc.id);

            batchCount += 1;

            if (batchCount >= batchSize) {
              await commitBatch();
            }
          }
        }

        if (onProgress && scanned % 500 === 0) {
          onProgress({
            scanned,
            updated,
            batches,
            committed: committedIds.length,
          });
        }
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      if (snapshot.size < pageSize) break;
    }

    await commitBatch();
  } catch (err) {
    err.committedIds = committedIds;
    err.partialStats = {
      scanned,
      updated,
      batches,
      committed: committedIds.length,
    };

    throw err;
  }

  return { scanned, updated, batches, committedIds };
}

export async function applyOperationsToRefs(db, docRefs, ops, options = {}) {
  const { batchSize = 400, dryRun = false, onProgress } = options;
  let scanned = 0;
  let updated = 0;
  let batches = 0;
  let batch = dryRun ? null : db.batch();
  let batchCount = 0;

  const commitBatch = async () => {
    if (dryRun || batchCount === 0) return;

    await batch.commit();

    batches += 1;
    batch = db.batch();
    batchCount = 0;
  };

  for (const ref of docRefs) {
    scanned += 1;
    const snap = await ref.get();

    if (!snap.exists) continue;

    const payload = buildUpdatePayload(snap.data(), ops);

    if (!payload) continue;

    updated += 1;

    if (!dryRun) {
      batch.update(ref, payload);

      batchCount += 1;

      if (batchCount >= batchSize) {
        await commitBatch();
      }
    }

    if (onProgress && scanned % 100 === 0) {
      onProgress({ scanned, updated, batches });
    }
  }

  await commitBatch();

  return { scanned, updated, batches };
}

const RANGE_OPERATORS = new Set(["<", "<=", ">", ">=", "!="]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;

  const proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
}

export function sanitizeForWrite(value) {
  if (Array.isArray(value)) {
    return value.map((item) =>
      item === undefined ? null : sanitizeForWrite(item)
    );
  }

  if (isPlainObject(value)) {
    const out = {};

    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;

      out[key] = sanitizeForWrite(item);
    }

    return out;
  }

  return value;
}

function buildSourceQuery(sourceCol, spec, pageSize) {
  const clauses = Array.isArray(spec.where) ? spec.where : [];
  const rangeClause = clauses.find(([, op]) => RANGE_OPERATORS.has(op));

  let query = sourceCol;

  if (rangeClause) {
    query = query.orderBy(rangeClause[0], "asc");
  }

  query = query.orderBy("__name__");

  for (const [field, op, value] of clauses) {
    query = query.where(field, op, value);
  }

  return query.limit(pageSize);
}

export async function applyGenerate(db, destinationCollection, spec, options = {}) {
  const {
    batchSize = 400,
    dryRun = false,
    onProgress,
    snapshotStore = null,
  } = options;
  const sourceCol = db.collection(spec.from);
  const destCol = db.collection(destinationCollection);

  let scanned = 0;
  let generated = 0;
  let skipped = 0;
  let batches = 0;
  let batch = dryRun ? null : db.batch();
  let batchCount = 0;
  const committedIds = [];
  let pendingIds = [];
  const resolvedIds = new Set();

  const commitBatch = async () => {
    if (dryRun || batchCount === 0) return;

    await batch.commit();

    batches += 1;

    committedIds.push(...pendingIds);

    pendingIds = [];
    batch = db.batch();
    batchCount = 0;

    if (snapshotStore) snapshotStore.flush();
  };

  let lastDoc = null;
  const pageSize = Math.min(batchSize * 2, 1000);

  try {
    while (true) {
      let query = buildSourceQuery(sourceCol, spec, pageSize);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();

      if (snapshot.empty) break;

      for (const doc of snapshot.docs) {
        scanned += 1;

        const data = doc.data();
        const result = spec.create(data, { id: doc.id });

        if (result === null || result === undefined) {
          skipped += 1;
          continue;
        }

        const items = Array.isArray(result) ? result : [result];

        if (items.length === 0) {
          skipped += 1;
          continue;
        }

        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];

          if (item === null || typeof item !== "object" || Array.isArray(item)) {
            throw new Error(
              `generate.create must return a document object, an array of document objects, ` +
                `or null (source ${spec.from}/${doc.id}, index ${index})`
            );
          }

          let destRef;

          if (typeof spec.id === "function") {
            const destId = spec.id(data, { id: doc.id, index });

            if (
              typeof destId !== "string" ||
              destId.trim() === "" ||
              destId.includes("/")
            ) {
              throw new Error(
                `generate.id must return a non-empty string without "/" ` +
                  `(source ${spec.from}/${doc.id}, index ${index})`
              );
            }

            if (resolvedIds.has(destId)) {
              throw new Error(
                `generate produced duplicate destination id "${destId}" ` +
                  `(source ${spec.from}/${doc.id}, index ${index})`
              );
            }

            resolvedIds.add(destId);
            destRef = destCol.doc(destId);

            const existing = await destRef.get();

            if (existing.exists) {
              throw new Error(
                `Destination document ${destinationCollection}/${destId} already exists ` +
                  `(source ${spec.from}/${doc.id}). ` +
                  `Generated documents are only created, never overwritten.`
              );
            }
          } else {
            destRef = destCol.doc();
          }

          generated += 1;

          if (!dryRun) {
            if (snapshotStore) snapshotStore.recordCreated(destRef.id);

            batch.set(destRef, sanitizeForWrite(item));
            pendingIds.push(destRef.id);

            batchCount += 1;

            if (batchCount >= batchSize) {
              await commitBatch();
            }
          }
        }

        if (onProgress && scanned % 500 === 0) {
          onProgress({
            scanned,
            generated,
            skipped,
            batches,
            committed: committedIds.length,
          });
        }
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      if (snapshot.size < pageSize) break;
    }

    await commitBatch();
  } catch (err) {
    err.committedIds = committedIds;
    err.partialStats = {
      scanned,
      generated,
      skipped,
      batches,
      committed: committedIds.length,
    };

    throw err;
  }

  return { scanned, generated, skipped, batches, committedIds };
}
