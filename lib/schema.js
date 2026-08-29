import fs from "node:fs";
import path from "node:path";

export function inferType(value) {
  if (value === null || value === undefined) {
    return "null";
  }

  if (
    typeof value === "object" &&
    value !== null &&
    typeof value.toDate === "function" &&
    typeof value.seconds === "number"
  ) {
    return "timestamp";
  }

  if (
    typeof value === "object" &&
    value !== null &&
    typeof value.latitude === "number" &&
    typeof value.longitude === "number" &&
    Object.keys(value).filter((k) => !k.startsWith("_")).length <= 4
  ) {
    if (typeof value.isEqual === "function" || value.constructor?.name === "GeoPoint") {
      return "geopoint";
    }
  }

  if (
    typeof value === "object" &&
    value !== null &&
    typeof value.path === "string" &&
    typeof value.id === "string" &&
    (typeof value.get === "function" || value.constructor?.name === "DocumentReference")
  ) {
    return "reference";
  }

  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return "bytes";
  }

  if (value instanceof Uint8Array) {
    return "bytes";
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { type: "array", items: "unknown" };
    }

    const itemTypes = [];
    const seen = new Set();

    for (const item of value.slice(0, 20)) {
      const t = inferType(item);
      const key = JSON.stringify(t);

      if (!seen.has(key)) {
        seen.add(key);
        itemTypes.push(t);
      }
    }

    return {
      type: "array",
      items: itemTypes.length === 1 ? itemTypes[0] : itemTypes,
    };
  }

  if (typeof value === "object") {
    const fields = {};

    for (const [k, v] of Object.entries(value)) {
      fields[k] = inferType(v);
    }

    return { type: "map", fields };
  }

  const t = typeof value;

  if (t === "string" || t === "number" || t === "boolean") {
    return t;
  }

  return "unknown";
}

export function schemaFromDocument(docSnap) {
  if (!docSnap || !docSnap.exists) {
    return {
      empty: true,
      fields: {},
      sampleId: null,
    };
  }

  const data = docSnap.data();
  const fields = {};

  for (const [k, v] of Object.entries(data || {})) {
    fields[k] = inferType(v);
  }

  return {
    empty: false,
    fields,
    sampleId: docSnap.id,
  };
}

export async function resolveCollectionNames(db, names, trackingCollection) {
  if (names && names.length > 0) {
    return [...new Set(names)];
  }

  const cols = await db.listCollections();

  return cols
    .map((c) => c.id)
    .filter((id) => id !== trackingCollection)
    .sort();
}

export async function sampleCollection(db, collectionName) {
  const snap = await db.collection(collectionName).limit(1).get();

  if (snap.empty) {
    return null;
  }

  return snap.docs[0];
}

export async function generateSchema(db, options = {}) {
  const {
    collections: requested,
    schemaPath,
    trackingCollection = "__migrations",
    merge = true,
  } = options;

  if (!schemaPath) {
    throw new Error("schemaPath is required");
  }

  const names = await resolveCollectionNames(db, requested, trackingCollection);
  let existing = { version: 1, updatedAt: null, collections: {} };

  if (merge && fs.existsSync(schemaPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

      if (!existing.collections || typeof existing.collections !== "object") {
        existing.collections = {};
      }
    } catch {
      existing = { version: 1, updatedAt: null, collections: {} };
    }
  }

  const collections = merge ? { ...existing.collections } : {};

  for (const name of names) {
    const sample = await sampleCollection(db, name);
    const entry = schemaFromDocument(sample);
    collections[name] = {
      ...entry,
      updatedAt: new Date().toISOString(),
    };
  }

  const schema = {
    version: 1,
    updatedAt: new Date().toISOString(),
    collections,
  };
  const dir = path.dirname(schemaPath);

  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2) + "\n", "utf8");

  return schema;
}

export async function refreshSchemaForCollections(db, collectionNames, options = {}) {
  const unique = [...new Set(collectionNames.filter(Boolean))];

  if (unique.length === 0) {
    return null;
  }

  return generateSchema(db, {
    ...options,
    collections: unique,
    merge: true,
  });
}
