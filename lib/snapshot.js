
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { FieldValue } from "firebase-admin/firestore";

const require = createRequire(import.meta.url);

function loadAdminTypes() {
  try {
    const { Timestamp, GeoPoint } = require("firebase-admin/firestore");

    return { Timestamp, GeoPoint };
  } catch {
    return {
      Timestamp: class Timestamp {
        constructor(seconds, nanoseconds) {
          this.seconds = seconds;
          this.nanoseconds = nanoseconds;
        }
      },
      GeoPoint: class GeoPoint {
        constructor(latitude, longitude) {
          this.latitude = latitude;
          this.longitude = longitude;
        }
      },
    };
  }
}

const { Timestamp, GeoPoint } = loadAdminTypes();

export const ABSENT = { __absent: true };

export function isAbsent(value) {
  return (
    value &&
    typeof value === "object" &&
    value.__absent === true &&
    Object.keys(value).length === 1
  );
}

export function serializeValue(value) {
  if (value === null || value === undefined) return null;

  if (
    typeof value === "object" &&
    typeof value.toDate === "function" &&
    typeof value.seconds === "number"
  ) {
    return {
      __type: "timestamp",
      seconds: value.seconds,
      nanoseconds: value.nanoseconds ?? 0,
    };
  }

  if (
    typeof value === "object" &&
    typeof value.latitude === "number" &&
    typeof value.longitude === "number" &&
    (typeof value.isEqual === "function" || value.constructor?.name === "GeoPoint")
  ) {
    return {
      __type: "geopoint",
      latitude: value.latitude,
      longitude: value.longitude,
    };
  }

  if (
    typeof value === "object" &&
    typeof value.path === "string" &&
    typeof value.id === "string" &&
    (typeof value.get === "function" || value.constructor?.name === "DocumentReference")
  ) {
    return { __type: "reference", path: value.path };
  }

  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return { __type: "bytes", base64: value.toString("base64") };
  }
  if (value instanceof Uint8Array) {
    return { __type: "bytes", base64: Buffer.from(value).toString("base64") };
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }

  if (typeof value === "object") {
    if (value.__absent) return ABSENT;

    const out = {};

    for (const [k, v] of Object.entries(value)) {
      out[k] = serializeValue(v);
    }

    return out;
  }

  return value;
}

export function deserializeValue(value, db) {
  if (value === null || value === undefined) return null;
  if (isAbsent(value)) return getFieldValue().delete();

  if (Array.isArray(value)) {
    return value.map((v) => deserializeValue(v, db));
  }

  if (typeof value === "object" && value.__type) {
    switch (value.__type) {
      case "timestamp":
        return new Timestamp(value.seconds, value.nanoseconds || 0);
      case "geopoint":
        return new GeoPoint(value.latitude, value.longitude);
      case "reference":
        return db.doc(value.path);
      case "bytes":
        return Buffer.from(value.base64, "base64");
      default:
        return value;
    }
  }

  if (typeof value === "object") {
    const out = {};

    for (const [k, v] of Object.entries(value)) {
      out[k] = deserializeValue(v, db);
    }

    return out;
  }

  return value;
}

export function captureBeforeImage(docData, ops) {
  const before = {};
  let changed = false;

  for (const field of Object.keys(ops.add || {})) {
    if (docData[field] !== undefined) continue;

    before[field] = ABSENT;
    changed = true;
  }

  for (const field of ops.remove || []) {
    if (docData[field] === undefined) continue;

    before[field] = serializeValue(docData[field]);
    changed = true;
  }

  for (const field of Object.keys(ops.update || {})) {
    if (docData[field] === undefined) {
      before[field] = ABSENT;
    } else {
      before[field] = serializeValue(docData[field]);
    }

    changed = true;
  }

  return changed ? before : null;
}

export function buildRestorePayload(beforeImage, db) {
  const payload = {};

  for (const [field, value] of Object.entries(beforeImage || {})) {
    payload[field] = deserializeValue(value, db);
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

export function snapshotPath(snapshotsDir, migrationId) {
  return path.join(snapshotsDir, `${migrationId}.json`);
}

export function ensureSnapshotsDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return dir;
}

export function createSnapshotStore(migration, snapshotsDir) {
  ensureSnapshotsDir(snapshotsDir);

  const filePath = snapshotPath(snapshotsDir, migration.id);
  const state = {
    migrationId: migration.id,
    collection: migration.collection,
    description: migration.description || migration.id,
    createdAt: new Date().toISOString(),
    documents: {},
  };

  if (fs.existsSync(filePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, "utf8"));

      if (existing?.documents) state.documents = existing.documents;
    } catch {}
  }

  let dirty = 0;
  const FLUSH_EVERY = 50;

  function record(docId, beforeImage) {
    if (!beforeImage) return;
    if (state.documents[docId]) return;

    state.documents[docId] = beforeImage;
    dirty += 1;

    if (dirty >= FLUSH_EVERY) flush();
  }

  function flush() {
    state.updatedAt = new Date().toISOString();

    fs.writeFileSync(filePath, JSON.stringify(state), "utf8");

    dirty = 0;
  }

  function finalize() {
    flush();

    return filePath;
  }

  function allDocuments() {
    return state.documents;
  }

  function docCount() {
    return Object.keys(state.documents).length;
  }

  return {
    record,
    flush,
    finalize,
    allDocuments,
    docCount,
    filePath,
  };
}

export function loadSnapshot(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function deleteSnapshot(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export async function restoreFromSnapshot(db, collectionName, documents, options = {}) {
  const { batchSize = 400, dryRun = false, onlyDocIds = null, onProgress } = options;
  const colRef = db.collection(collectionName);
  let entries = Object.entries(documents || {});

  if (onlyDocIds) {
    const allow = new Set(onlyDocIds);
    entries = entries.filter(([id]) => allow.has(id));
  }

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

  for (const [docId, beforeImage] of entries) {
    scanned += 1;
    const payload = buildRestorePayload(beforeImage, db);

    if (!payload) continue;

    updated += 1;

    if (!dryRun) {
      batch.update(colRef.doc(docId), payload);

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
