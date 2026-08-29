import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensureMigrationsDir } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function pad(n) {
  return String(n).padStart(2, "0");
}

export function generateTimestamp() {
  const now = new Date();

  return (
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

export function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function generateMigration(name, options = {}) {
  if (!name || !String(name).trim()) {
    throw new Error("Migration name is required");
  }

  const slug = slugify(name);

  if (!slug) {
    throw new Error("Migration name produced an empty slug. Provide a valid name.");
  }

  const migrationsDir = ensureMigrationsDir(
    options.migrationsDir || path.join(process.cwd(), "migrations")
  );
  const timestamp = generateTimestamp();
  const id = `${timestamp}_${slug}`;
  const filename = `${id}.js`;
  const filepath = path.join(migrationsDir, filename);

  if (fs.existsSync(filepath)) {
    throw new Error(`Migration file already exists: ${filename}`);
  }

  const templatePath = path.join(__dirname, "..", "templates", "migration.template.js");

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found at ${templatePath}`);
  }

  const collection = options.collection || "your_collection";
  const description = String(name).replace(/[-_]/g, " ").trim();
  const template = fs.readFileSync(templatePath, "utf8");
  const content = template
    .replace(/\{\{ID\}\}/g, id)
    .replace(/\{\{NAME\}\}/g, slug)
    .replace(/\{\{DESCRIPTION\}\}/g, description)
    .replace(/\{\{COLLECTION\}\}/g, collection)
    .replace(/\{\{TIMESTAMP_ISO\}\}/g, new Date().toISOString());

  fs.writeFileSync(filepath, content, "utf8");

  return {
    id,
    filename,
    filepath,
    collection,
    description,
  };
}
