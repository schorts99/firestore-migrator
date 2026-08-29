function stripComment(line) {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) {
      if (i === 0 || line[i - 1] !== "\\") inDouble = !inDouble;
    } else if (c === "#" && !inSingle && !inDouble) {
      return line.slice(0, i).trimEnd();
    }
  }

  return line;
}

function parseValue(raw) {
  const v = raw.trim();

  if (v === "") return "";
  if (v === "true") return true;
  if (v === "false") return false;

  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\'/g, "'");
  }

  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)) {
    return Number(v);
  }

  return v;
}

export function parseToml(text) {
  const root = {};
  let current = root;
  const lines = String(text).split(/\r?\n/);

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    let line = stripComment(lines[lineNum]).trim();

    if (!line) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);

    if (sectionMatch) {
      const name = sectionMatch[1].trim();

      if (!root[name] || typeof root[name] !== "object") {
        root[name] = {};
      }

      current = root[name];

      continue;
    }

    const eq = line.indexOf("=");

    if (eq === -1) {
      throw new Error(`Invalid TOML at line ${lineNum + 1}: ${lines[lineNum]}`);
    }

    const key = line.slice(0, eq).trim();
    const value = parseValue(line.slice(eq + 1));

    if (!key) {
      throw new Error(`Empty key at line ${lineNum + 1}`);
    }

    current[key] = value;
  }

  return root;
}

export function interpolateEnv(value) {
  if (typeof value !== "string") return value;

  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, a, b) => {
    const name = a || b;

    return process.env[name] ?? "";
  });
}

export function interpolateObject(obj) {
  if (!obj || typeof obj !== "object") return obj;

  const out = Array.isArray(obj) ? [] : {};

  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = interpolateObject(v);
    } else {
      out[k] = interpolateEnv(v);
    }
  }

  return out;
}
