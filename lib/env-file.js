import fs from "node:fs";
import path from "node:path";

let loadedFrom = null;

export function parseEnvFile(text) {
  const out = {};
  const lines = String(text).split(/\r?\n/);

  for (const rawLine of lines) {
    let line = rawLine.trim();

    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();

    const eq = line.indexOf("=");

    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(eq + 1).trim();

    if (
      !value.startsWith('"') &&
      !value.startsWith("'") &&
      value.includes(" #")
    ) {
      value = value.replace(/\s+#.*$/, "");
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
      value = value
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }

    out[key] = value;
  }

  return out;
}

export function loadEnvFile(options = {}) {
  const cwd = options.cwd || process.cwd();
  const override = Boolean(options.override);
  const candidates = [];

  if (options.path) {
    candidates.push(path.resolve(cwd, options.path));
  } else {
    candidates.push(path.resolve(cwd, ".env"));
    candidates.push(path.resolve(cwd, ".env.local"));
  }

  let filePath = null;

  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      filePath = p;

      break;
    }
  }

  if (!filePath) {
    return { path: null, keys: [] };
  }

  if (loadedFrom === filePath && !override) {
    return { path: filePath, keys: [] };
  }

  const parsed = parseEnvFile(fs.readFileSync(filePath, "utf8"));
  const keys = [];

  for (const [key, value] of Object.entries(parsed)) {
    if (!override && process.env[key] !== undefined) continue;

    process.env[key] = value;

    keys.push(key);
  }

  loadedFrom = filePath;

  return { path: filePath, keys };
}
