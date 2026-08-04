import { loadMigrations } from "./loader";
import { getAppliedMigrations, markApplied } from "./tracking";
import { initFirebase } from "./firebase";
import { loadConfig } from "./config";

export async function runMigrate(cliOptions = {}) {
  const config = loadConfig(cliOptions);
  const migrations = await loadMigrations(config.migrationsDir);

  if (migrations.length === 0) {
    console.log("No migration files found in", config.migrationsDir);

    return { applied: [] };
  }

  const db = initFirebase(config);
  const appliedMap = await getAppliedMigrations(db, config.trackingCollection);

  let pending = migrations.filter((m) => !appliedMap.has(m.id));

  if (cliOptions.only) {
    const onlyId = cliOptions.only;
    pending = pending.filter(
      (m) => m.id === onlyId || m.id.endsWith(`_${onlyId}`) || m.filename.startsWith(onlyId)
    );

    if (pending.length === 0) {
      throw new Error(`No pending migration matching "${onlyId}"`);
    }
  }

  if (pending.length === 0) {
    console.log("✓ All migrations are already applied.");

    return { applied: [] };
  }

  console.log(
    `Found ${pending.length} pending migration(s)${config.dryRun ? " [DRY RUN]" : ""}:\n`
  );

  const results = [];

  for (const migration of pending) {
    console.log(`→ ${migration.id}`);
    console.log(`  collection: ${migration.collection}`);
    console.log(`  description: ${migration.description}`);

    const stats = await applyOperations(db, migration.collection, migration.up, {
      batchSize: config.batchSize,
      dryRun: config.dryRun,
      onProgress: ({ scanned, updated }) => {
        process.stdout.write(`\r  scanned ${scanned} · updated ${updated}`);
      },
    });

    if (stats.scanned > 0) {
      process.stdout.write("\n");
    }

    console.log(
      `  scanned: ${stats.scanned}  updated: ${stats.updated}  batches: ${stats.batches}`
    );

    await markApplied(db, config.trackingCollection, migration, config.dryRun);
    console.log(config.dryRun ? "  (dry-run – not recorded)\n" : "  ✓ recorded\n");

    results.push({ id: migration.id, ...stats });
  }

  console.log(
    config.dryRun
      ? `Dry run complete. ${results.length} migration(s) would be applied.`
      : `Done. Applied ${results.length} migration(s).`
  );

  return { applied: results };
}
