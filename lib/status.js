import { loadMigrations } from "./loader.js";
import { getAppliedMigrations } from "./tracking.js";
import { initFirebase } from "./firebase.js";
import { loadConfig } from "./config.js";

export async function runStatus(cliOptions = {}) {
  const config = loadConfig(cliOptions);
  const migrations = await loadMigrations(config.migrationsDir);

  if (migrations.length === 0) {
    console.log("No migration files found in", config.migrationsDir);

    return;
  }

  let appliedMap = new Map();

  try {
    const db = initFirebase(config);
    appliedMap = await getAppliedMigrations(db, config.trackingCollection);
  } catch (err) {
    console.warn(
      "Warning: could not connect to Firestore to read applied state.\n" +
      `  ${err.message}\n` +
      "  Showing file list only.\n"
    );
  }

  console.log(`Migrations directory: ${config.migrationsDir}`);
  console.log(`Tracking collection:  ${config.trackingCollection}\n`);

  const rows = migrations.map((m) => {
    const applied = appliedMap.get(m.id);

    return {
      id: m.id,
      collection: m.collection,
      status: applied ? "applied" : "pending",
      appliedAt: applied ? applied.appliedAt : "-",
      description: m.description,
    };
  });

  const pending = rows.filter((r) => r.status === "pending").length;
  const appliedCount = rows.filter((r) => r.status === "applied").length;

  for (const row of rows) {
    const mark = row.status === "applied" ? "✓" : "·";

    console.log(`${mark} ${row.id}`);
    console.log(`    ${row.status.padEnd(8)}  ${row.collection}  ${row.description}`);

    if (row.appliedAt !== "-") {
      console.log(`    applied at ${row.appliedAt}`);
    }
  }

  console.log(`\n${appliedCount} applied · ${pending} pending · ${rows.length} total`);
}
