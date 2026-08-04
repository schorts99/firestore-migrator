import path from "node:path";
import fs from "node:fs";

const DEFAULTS = {
  migrationsDir: "migrations",
  trackingCollection: "__migrations",
  batchSize: 400,
};

export function loadConfig(cliOptions = {}) {
  const migrationsDir = path.resolve(
    process.cwd(),
    cliOptions.migrationsDir ||
    process.env.FIRESTORE_MIGRATIONS_DIR ||
    DEFAULTS.migrationsDir
  );
  const trackingCollection =
    cliOptions.trackingCollection ||
    process.env.FIRESTORE_MIGRATIONS_TRACKING ||
    DEFAULTS.trackingCollection;
  const batchSize = Number(
    cliOptions.batchSize ||
    process.env.FIRESTORE_MIGRATIONS_BATCH_SIZE ||
    DEFAULTS.batchSize
  );
  const projectId =
    cliOptions.projectId ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    undefined;
  const credentialsPath =
    cliOptions.credentials ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    undefined;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : undefined;
  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL_ADDRESS;

  return {
    migrationsDir,
    trackingCollection,
    batchSize,
    projectId,
    credentialsPath,
    privateKey,
    clientEmail,
    dryRun: Boolean(cliOptions.dryRun),
  };
}

export function ensureMigrationsDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return dir;
}

export { DEFAULTS };
