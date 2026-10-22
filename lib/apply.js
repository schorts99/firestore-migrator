import { FieldValue } from "firebase-admin/firestore";

import { captureBeforeImage } from "./snapshot.js";
import { createBulkWriterQueue } from "./bulk-writer.js";

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
  const { dryRun = false, onProgress, snapshotStore = null } = options;
  const colRef = db.collection(collectionName);

  let scanned = 0;
  let updated = 0;
  const bulkWriter = dryRun ? null : createBulkWriterQueue(db);
  const committedIds = [];

  let lastDoc = null;
  const pageSize = 1000;

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

            bulkWriter.add(bulkWriter.writer.update(doc.ref, payload), () => {
              committedIds.push(doc.id);
            });
          }
        }

        if (onProgress && scanned % 500 === 0) {
          onProgress({
            scanned,
            updated,
            writes: bulkWriter?.writes || 0,
            committed: committedIds.length,
          });
        }
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      if (snapshot.size < pageSize) break;
    }

    if (bulkWriter) await bulkWriter.close();
  } catch (err) {
    try {
      if (bulkWriter) await bulkWriter.close();
    } catch (closeErr) {
      if (closeErr !== err) {
        err.message += `; BulkWriter close failed: ${closeErr.message}`;
      }
    }

    err.committedIds = committedIds;
    err.partialStats = {
      scanned,
      updated,
      writes: bulkWriter?.writes || 0,
      committed: committedIds.length,
    };

    throw err;
  }

  return { scanned, updated, writes: bulkWriter?.writes || 0, committedIds };
}

export async function applyOperationsToRefs(db, docRefs, ops, options = {}) {
  const { dryRun = false, onProgress } = options;
  let scanned = 0;
  let updated = 0;
  const bulkWriter = dryRun ? null : createBulkWriterQueue(db);

  try {
    for (const ref of docRefs) {
      scanned += 1;
      const snap = await ref.get();

      if (!snap.exists) continue;

      const payload = buildUpdatePayload(snap.data(), ops);

      if (!payload) continue;

      updated += 1;

      if (!dryRun) {
        bulkWriter.add(bulkWriter.writer.update(ref, payload));
      }

      if (onProgress && scanned % 100 === 0) {
        onProgress({ scanned, updated, writes: bulkWriter?.writes || 0 });
      }
    }

    if (bulkWriter) await bulkWriter.close();
  } catch (err) {
    try {
      if (bulkWriter) await bulkWriter.close();
    } catch (closeErr) {
      if (closeErr !== err) {
        err.message += `; BulkWriter close failed: ${closeErr.message}`;
      }
    }

    throw err;
  }

  return { scanned, updated, writes: bulkWriter?.writes || 0 };
}
