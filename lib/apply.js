import { FieldValue } from "firebase-admin/firestore";

export function buildUpdatePayload(docData, ops) {
  const FieldValue = getFieldValue();
  const payload = {};
  let hasChanges = false;

  for (const [field, spec] of Object.entries(ops.add || {})) {
    if (docData[field] !== undefined) continue;

    let value;

    if (spec && typeof spec.from === 'function') {
      value = spec.from(docData);
    } else if (spec && Object.prototype.hasOwnProperty.call(spec, 'default')) {
      value = spec.default;
    } else if (spec !== undefined && typeof spec !== 'object') {
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
    if (typeof fn !== 'function') {
      throw new Error(`update.${field} must be a function (doc) => newValue`);
    }

    payload[field] = fn(docData);
    hasChanges = true;
  }

  return hasChanges ? payload : null;
}

function hasDownOps(ops) {
  if (!ops) return false;

  return (
    Object.keys(ops.add || {}).length > 0 ||
    (ops.remove || []).length > 0 ||
    Object.keys(ops.update || {}).length > 0
  );
}

export async function applyOperationsToRefs(db, docRefs, ops, options = {}) {
  const { batchSize = 400, dryRun = false, onProgress } = options;
  let scanned = 0;
  let updated = 0;
  let batches = 0;
  let batch = dryRun ? null : db.batch();
  let batchCount = 0;
  const committedRefs = [];
  let pendingRefs = [];

  const commitBatch = async () => {
    if (dryRun || batchCount === 0) return;

    await batch.commit();

    batches += 1;

    committedRefs.push(...pendingRefs);

    pendingRefs = [];
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
      pendingRefs.push(ref);
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

  return { scanned, updated, batches, committedRefs };
}

export async function applyOperations(db, collectionName, ops, options = {}) {
  const { batchSize = 400, dryRun = false, onProgress, onBatchCommitted } = options;
  const colRef = db.collection(collectionName);
  let scanned = 0;
  let updated = 0;
  let batches = 0;
  let batch = dryRun ? null : db.batch();
  let batchCount = 0;
  const committedRefs = [];
  let pendingRefs = [];

  const commitBatch = async () => {
    if (dryRun || batchCount === 0) return;

    await batch.commit();

    batches += 1;

    committedRefs.push(...pendingRefs);

    if (typeof onBatchCommitted === 'function') {
      onBatchCommitted([...pendingRefs], committedRefs.length);
    }

    pendingRefs = [];
    batch = db.batch();
    batchCount = 0;
  };

  let lastDoc = null;
  const pageSize = Math.min(batchSize * 2, 1000);

  try {
    while (true) {
      let query = colRef.orderBy('__name__').limit(pageSize);

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
            batch.update(doc.ref, payload);
            pendingRefs.push(doc.ref);

            batchCount += 1;

            if (batchCount >= batchSize) {
              await commitBatch();
            }
          }
        }

        if (onProgress && scanned % 500 === 0) {
          onProgress({ scanned, updated, batches, committed: committedRefs.length });
        }
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      if (snapshot.size < pageSize) break;
    }

    await commitBatch();
  } catch (err) {
    err.committedRefs = committedRefs;
    err.partialStats = { scanned, updated, batches, committed: committedRefs.length };

    throw err;
  }

  return {
    scanned,
    updated,
    batches,
    committedRefs,
  };
}

export { hasDownOps };
