
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { FieldValue } from "firebase-admin/firestore";
import { createBulkWriterQueue } from "./bulk-writer.js";

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
  if (isAbsent(value)) return FieldValue.delete();

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

function snapshotJournalPath(filePath) {
  if (!filePath) return null;

  return `${filePath}.journal`;
}

function readSnapshot(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function applySnapshotJournal(filePath, documents) {
  const journalPath = snapshotJournalPath(filePath);

  if (!fs.existsSync(journalPath)) return;

  const journal = fs.readFileSync(journalPath, "utf8");

  const lines = journal.split("\n");

  for (const [index, line] of lines.entries()) {
    if (!line) continue;

    let entry;

    try {
      entry = JSON.parse(line);
    } catch (err) {
      if (index === lines.length - 1 && !journal.endsWith("\n")) break;

      throw new Error(
        `Invalid snapshot journal entry ${index + 1} in ${journalPath}: ${err.message}`
      );
    }

    if (typeof entry?.docId !== "string" || !entry.beforeImage) {
      throw new Error(`Invalid snapshot journal entry ${index + 1} in ${journalPath}`);
    }

    if (!Object.prototype.hasOwnProperty.call(documents, entry.docId)) {
      documents[entry.docId] = entry.beforeImage;
    }
  }
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

  const existing = readSnapshot(filePath);

  if (existing?.documents) state.documents = existing.documents;
  applySnapshotJournal(filePath, state.documents);

  const journalPath = snapshotJournalPath(filePath);

  function record(docId, beforeImage) {
    if (!beforeImage) return;
    if (state.documents[docId]) return;

    fs.appendFileSync(
      journalPath,
      `${JSON.stringify({ docId, beforeImage })}\n`,
      "utf8"
    );
    state.documents[docId] = beforeImage;
  }

  function flush() {
    state.updatedAt = new Date().toISOString();

    const temporaryPath = `${filePath}.tmp-${process.pid}`;

    fs.writeFileSync(temporaryPath, JSON.stringify(state), "utf8");
    fs.renameSync(temporaryPath, filePath);

    if (fs.existsSync(journalPath)) fs.unlinkSync(journalPath);
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
  if (!filePath) return null;

  const snapshot = readSnapshot(filePath);
  const journalPath = snapshotJournalPath(filePath);

  if (!snapshot && !fs.existsSync(journalPath)) return null;

  const result = snapshot || { documents: {} };
  result.documents ||= {};
  applySnapshotJournal(filePath, result.documents);

  return result;
}

export function deleteSnapshot(filePath) {
  if (!filePath) return;

  for (const target of [filePath, snapshotJournalPath(filePath)]) {
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
}

export async function restoreFromSnapshot(db, collectionName, documents, options = {}) {
  const { dryRun = false, onlyDocIds = null, onProgress } = options;
  const colRef = db.collection(collectionName);
  let entries = Object.entries(documents || {});

  if (onlyDocIds) {
    const allow = new Set(onlyDocIds);
    entries = entries.filter(([id]) => allow.has(id));
  }

  let scanned = 0;
  let updated = 0;
  const bulkWriter = dryRun ? null : createBulkWriterQueue(db);

  try {
    for (const [docId, beforeImage] of entries) {
      scanned += 1;
      const payload = buildRestorePayload(beforeImage, db);

      if (!payload) continue;

      updated += 1;

      if (!dryRun) {
        bulkWriter.add(bulkWriter.writer.update(colRef.doc(docId), payload));
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
