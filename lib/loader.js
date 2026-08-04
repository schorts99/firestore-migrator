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

    const up = body.up || body.operations || { add: {}, remove: [], update: {} };
    const down = body.down || null;

    migrations.push({
      id,
      description: body.description || id,
      collection: body.collection,
      up: normalizeOps(up),
      down: down ? normalizeOps(down) : null,
      filename: file,
      filepath: fullPath,
    });
  }

  return migrations;
}

export function normalizeOps(ops = {}) {
  return {
    add: ops.add && typeof ops.add === "object" ? ops.add : {},
    remove: Array.isArray(ops.remove) ? ops.remove : [],
    update: ops.update && typeof ops.update === "object" ? ops.update : {},
  };
}
