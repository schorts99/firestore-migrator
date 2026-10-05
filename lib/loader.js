import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadMigrations(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d{14}_.+\.js$/.test(f))
    .sort();
  const migrations = [];

  for (const file of files) {
    const fullPath = path.resolve(migrationsDir, file);
    const fileUrl = pathToFileURL(fullPath).href;
    const mod = await import(`${fileUrl}?t=${Date.now()}`);
    const body = mod.default ?? mod;

    if (!body || typeof body !== "object") {
      throw new Error(`Invalid migration module: ${file}`);
    }

    const id = body.id || path.basename(file, ".js");

    if (!body.collection) {
      throw new Error(`Migration ${id} is missing required "collection" field`);
    }

    if (body.generate) {
      throw new Error(
        `Migration ${id}: "generate" must be declared inside "up" (up.generate)`
      );
    }

    const up = body.up || body.operations || { add: {}, remove: [], update: {} };
    const down = body.down || null;

    if (down && typeof down === "object" && down.generate) {
      throw new Error(
        `Migration ${id}: "down.generate" is not supported — generated documents are only erased via snapshots.`
      );
    }

    const normalizedUp = normalizeOps(up);

    validateGenerate(id, normalizedUp.generate);

    migrations.push({
      id,
      description: body.description || id,
      collection: body.collection,
      up: normalizedUp,
      down: down ? normalizeOps(down) : null,
      filename: file,
      filepath: fullPath,
    });
  }

  return migrations;
}

function validateGenerate(id, spec) {
  if (!spec) return;

  if (typeof spec.from !== "string" || spec.from.trim() === "") {
    throw new Error(
      `Migration ${id}: up.generate.from must be a non-empty collection name`
    );
  }

  if (typeof spec.create !== "function") {
    throw new Error(
      `Migration ${id}: up.generate.create must be a function (doc, ctx) => object | object[] | null`
    );
  }

  if (spec.id !== undefined && typeof spec.id !== "function") {
    throw new Error(
      `Migration ${id}: up.generate.id must be a function (doc, ctx) => string when provided`
    );
  }

  if (spec.where !== undefined) {
    if (!Array.isArray(spec.where)) {
      throw new Error(
        `Migration ${id}: up.generate.where must be an array of [field, operator, value] tuples`
      );
    }

    for (const clause of spec.where) {
      if (
        !Array.isArray(clause) ||
        clause.length !== 3 ||
        typeof clause[0] !== "string" ||
        clause[0] === "" ||
        typeof clause[1] !== "string"
      ) {
        throw new Error(
          `Migration ${id}: up.generate.where entries must be [field, operator, value] tuples`
        );
      }
    }
  }
}

export function normalizeOps(ops = {}) {
  const o = ops && typeof ops === "object" ? ops : {};

  return {
    add: o.add && typeof o.add === "object" ? o.add : {},
    remove: Array.isArray(o.remove) ? o.remove : [],
    update: o.update && typeof o.update === "object" ? o.update : {},
    generate: o.generate && typeof o.generate === "object" ? o.generate : null,
  };
}
