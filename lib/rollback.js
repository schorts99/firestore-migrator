import { loadMigrations } from "./loader";
import { getAppliedMigrations, markRolledBack } from "./tracking";
import { initFirebase } from "./firebase";
import { loadConfig } from "./config";

export async function runRollback(cliOptions = {}) {
  const config = loadConfig(cliOptions);
  const migrations = await loadMigrations(config.migrationsDir);

  if (migrations.length === 0) {
    console.log("No migration files found in", config.migrationsDir);

    return { rolledBack: [] };
  }

  const db = initFirebase(config);
  const appliedMap = await getAppliedMigrations(db, config.trackingCollection);

  const applied = migrations.filter((m) => appliedMap.has(m.id)).reverse();

  if (applied.length === 0) {
    console.log("No applied migrations to roll back.");

    return { rolledBack: [] };
  }

  let toRollback = [];

  if (cliOptions.only) {
    const onlyId = cliOptions.only;
    const match = applied.find(
      (m) =>
        m.id === onlyId ||
        m.id.endsWith(`_${onlyId}`) ||
        m.filename.startsWith(onlyId)
    );

    if (!match) {
      throw new Error(`No applied migration matching "${onlyId}"`);
    }

    toRollback = [match];
  } else {
    const steps = Math.max(1, Number(cliOptions.steps) || 1);
    toRollback = applied.slice(0, steps);
  }

  console.log(
    `Rolling back ${toRollback.length} migration(s)${config.dryRun ? " [DRY RUN]" : ""}:\n`
  );

  const results = [];

  for (const migration of toRollback) {
    if (!migration.down) {
      throw new Error(
        `Migration ${migration.id} has no "down" operations defined. ` +
        "Add a down block to the migration file before rolling back."
      );
    }

    const hasOps =
      Object.keys(migration.down.add || {}).length > 0 ||
      (migration.down.remove || []).length > 0 ||
      Object.keys(migration.down.update || {}).length > 0;

    if (!hasOps) {
      throw new Error(
        `Migration ${migration.id} has an empty "down" block. ` +
        "Define reverse operations before rolling back."
      );
    }

    console.log(`← ${migration.id}`);
    console.log(`  collection: ${migration.collection}`);
    console.log(`  description: ${migration.description}`);

    const stats = await applyOperations(db, migration.collection, migration.down, {
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

    await markRolledBack(db, config.trackingCollection, migration, config.dryRun);
    console.log(
      config.dryRun ? "  (dry-run – not removed from tracking)\n" : "  ✓ tracking removed\n"
    );

    results.push({ id: migration.id, ...stats });
  }

  console.log(
    config.dryRun
      ? `Dry run complete. ${results.length} migration(s) would be rolled back.`
      : `Done. Rolled back ${results.length} migration(s).`
  );

  return { rolledBack: results };
}
