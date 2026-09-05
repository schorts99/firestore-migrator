import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { parseToml, interpolateObject } from "./toml.js";
import { loadEnvFile } from "./env-file.js";

const DEFAULTS = {
  migrationsDir: "migrations",
  trackingCollection: "__migrations",
  batchSize: 400,
  schemaPath: "firestore.schema.json",
  skipSchema: false,
  snapshotsDir: null,
};

export const CONFIG_FILENAME = "firestore-migrator.toml";

function normalizeFileConfig(raw = {}) {
  const flat = { ...raw };
  const map = {
    migrations_dir: "migrationsDir",
    migrationsDir: "migrationsDir",
    tracking_collection: "trackingCollection",
    trackingCollection: "trackingCollection",
    batch_size: "batchSize",
    batchSize: "batchSize",
    schema_path: "schemaPath",
    schemaPath: "schemaPath",
    project_id: "projectId",
    projectId: "projectId",
    credentials: "credentialsPath",
    credentials_path: "credentialsPath",
    credentialsPath: "credentialsPath",
    private_key: "privateKey",
    privateKey: "privateKey",
    client_email: "clientEmail",
    clientEmail: "clientEmail",
    skip_schema: "skipSchema",
    skipSchema: "skipSchema",
    snapshots_dir: "snapshotsDir",
    snapshotsDir: "snapshotsDir",
  };
  const out = {};

  for (const [k, v] of Object.entries(flat)) {
    if (k === "env" || typeof v === "object") continue;

    const canon = map[k];

    if (canon) out[canon] = v;
  }

  if (raw.env && typeof raw.env === "object") {
    out._envMap = {};

    for (const [k, envName] of Object.entries(raw.env)) {
      const canon = map[k] || map[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] || k;

      if (typeof envName === "string" && envName) {
        out._envMap[canon] = envName;
      }
    }
  }

  return out;
}

export function resolveConfigPath(cliOptions = {}) {
  if (cliOptions.config) {
    return path.resolve(process.cwd(), cliOptions.config);
  }

  const candidate = path.resolve(process.cwd(), CONFIG_FILENAME);

  if (fs.existsSync(candidate)) return candidate;

  return null;
}

export function loadConfigFile(configPath) {
  if (!configPath || !fs.existsSync(configPath)) {
    return {};
  }

  const text = fs.readFileSync(configPath, "utf8");
  const raw = parseToml(text);
  const interpolated = interpolateObject(raw);

  return normalizeFileConfig(interpolated);
}

function firstDefined(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== "") return v;
  }

  return undefined;
}

function resolveFromEnvMap(envMap, key, fallbackEnvNames = []) {
  if (envMap && envMap[key] && process.env[envMap[key]] !== undefined) {
    return process.env[envMap[key]];
  }

  for (const name of fallbackEnvNames) {
    if (process.env[name] !== undefined && process.env[name] !== "") {
      return process.env[name];
    }
  }

  return undefined;
}

export function loadConfig(cliOptions = {}) {
  if (!cliOptions.skipEnvFile) {
    loadEnvFile({
      path: cliOptions.envFile,
      override: Boolean(cliOptions.envOverride),
    });
  }

  const configPath = resolveConfigPath(cliOptions);
  const file = loadConfigFile(configPath);
  const envMap = file._envMap || {};

  const migrationsDir = path.resolve(
    process.cwd(),
    firstDefined(
      cliOptions.migrationsDir,
      process.env.FIRESTORE_MIGRATIONS_DIR,
      resolveFromEnvMap(envMap, "migrationsDir"),
      file.migrationsDir,
      DEFAULTS.migrationsDir
    )
  );

  const trackingCollection = firstDefined(
    cliOptions.trackingCollection,
    process.env.FIRESTORE_MIGRATIONS_TRACKING,
    resolveFromEnvMap(envMap, "trackingCollection"),
    file.trackingCollection,
    DEFAULTS.trackingCollection
  );

  const batchSize = Number(
    firstDefined(
      cliOptions.batchSize,
      process.env.FIRESTORE_MIGRATIONS_BATCH_SIZE,
      resolveFromEnvMap(envMap, "batchSize"),
      file.batchSize,
      DEFAULTS.batchSize
    )
  );

  const schemaPath = path.resolve(
    process.cwd(),
    firstDefined(
      cliOptions.schemaPath,
      process.env.FIRESTORE_SCHEMA_PATH,
      resolveFromEnvMap(envMap, "schemaPath"),
      file.schemaPath,
      DEFAULTS.schemaPath
    )
  );

  const projectId = firstDefined(
    cliOptions.projectId,
    process.env.GCLOUD_PROJECT,
    process.env.GOOGLE_CLOUD_PROJECT,
    process.env.FIREBASE_PROJECT_ID,
    resolveFromEnvMap(envMap, "projectId", [
      "FIREBASE_PROJECT_ID",
      "GCLOUD_PROJECT",
      "GOOGLE_CLOUD_PROJECT",
    ]),
    file.projectId
  );

  let credentialsPath = firstDefined(
    cliOptions.credentials,
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    resolveFromEnvMap(envMap, "credentialsPath", ["GOOGLE_APPLICATION_CREDENTIALS"]),
    file.credentialsPath
  );

  if (credentialsPath && !path.isAbsolute(credentialsPath)) {
    credentialsPath = path.resolve(process.cwd(), credentialsPath);
  }

  let privateKey = firstDefined(
    resolveFromEnvMap(envMap, "privateKey", ["FIREBASE_PRIVATE_KEY"]),
    process.env.FIREBASE_PRIVATE_KEY,
    file.privateKey
  );

  if (typeof privateKey === "string") {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  const clientEmail = firstDefined(
    resolveFromEnvMap(envMap, "clientEmail", [
      "FIREBASE_CLIENT_EMAIL",
      "FIREBASE_CLIENT_EMAIL_ADDRESS",
    ]),
    process.env.FIREBASE_CLIENT_EMAIL,
    process.env.FIREBASE_CLIENT_EMAIL_ADDRESS,
    file.clientEmail
  );

  const skipSchema = Boolean(
    firstDefined(
      cliOptions.skipSchema === true ? true : cliOptions.skipSchema === false ? false : undefined,
      process.env.FIRESTORE_SKIP_SCHEMA === "1" ? true : process.env.FIRESTORE_SKIP_SCHEMA === "0" ? false : undefined,
      resolveFromEnvMap(envMap, "skipSchema"),
      file.skipSchema,
      DEFAULTS.skipSchema
    )
  );

  const snapshotsDir = path.resolve(
    process.cwd(),
    firstDefined(
      cliOptions.snapshotsDir,
      process.env.FIRESTORE_SNAPSHOTS_DIR,
      file.snapshotsDir,
      path.join(migrationsDir, ".snapshots")
    )
  );

  return {
    migrationsDir,
    trackingCollection,
    batchSize,
    schemaPath,
    snapshotsDir,
    projectId,
    credentialsPath,
    privateKey,
    clientEmail,
    dryRun: Boolean(cliOptions.dryRun),
    skipSchema,
    configPath: configPath || undefined,
  };
}

export function ensureMigrationsDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return dir;
}

export function writeConfigTemplate(targetPath, { force = false } = {}) {
  const dest = path.resolve(process.cwd(), targetPath || CONFIG_FILENAME);

  if (fs.existsSync(dest) && !force) {
    throw new Error(
      `Config already exists: ${dest}\nUse --force to overwrite.`
    );
  }

  const templateCandidates = [
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "templates", "firestore-migrator.toml"),
  ];

  let content;

  for (const p of templateCandidates) {
    if (fs.existsSync(p)) {
      content = fs.readFileSync(p, "utf8");
      break;
    }
  }

  if (!content) {
    content = `# firestore-migrator.toml
migrations_dir = "migrations"
tracking_collection = "__migrations"
schema_path = "firestore.schema.json"
snapshots_dir = "migrations/.snapshots"
batch_size = 400
skip_schema = false
`;
  }

  fs.writeFileSync(dest, content, "utf8");

  return dest;
}

export { DEFAULTS };
