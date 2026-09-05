import { loadMigrations } from "./loader.js";
import { getAppliedMigrations, markRolledBack } from "./tracking.js";
import { initFirebase } from "./firebase.js";
import { loadConfig } from "./config.js";
import { refreshSchemaForCollections } from "./schema.js";
import { loadSnapshot, snapshotPath, deleteSnapshot } from "./snapshot.js";

export async function runRollback(cliOptions = {}) {
  const config = loadConfig(cliOptions);
  const migrations = await loadMigrations(config.migrationsDir);

  if (migrations.length === 0) {
    console.log('No migration files found in', config.migrationsDir);

    return { rolledBack: [] };
  }

  const db = initFirebase(config);
  const appliedMap = await getAppliedMigrations(db, config.trackingCollection);
  const applied = migrations.filter((m) => appliedMap.has(m.id)).reverse();

  if (applied.length === 0) {
    console.log('No applied migrations to roll back.');

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
    `Rolling back ${toRollback.length} migration(s)${config.dryRun ? ' [DRY RUN]' : ''}:\n`
  );

  const results = [];
  const touchedCollections = new Set();

  for (const migration of toRollback) {
    console.log(`← ${migration.id}`);
    console.log(`  collection: ${migration.collection}`);
    console.log(`  description: ${migration.description}`);

    const snapFile = snapshotPath(config.snapshotsDir, migration.id);
    const snap = loadSnapshot(snapFile);
    let stats;

    if (snap?.documents && Object.keys(snap.documents).length > 0) {
      console.log(`  restore from snapshot: ${snapFile}`);
      console.log(`  documents in snapshot: ${Object.keys(snap.documents).length}`);

      stats = await restoreFromSnapshot(db, migration.collection, snap.documents, {
        batchSize: config.batchSize,
        dryRun: config.dryRun,
        onProgress: ({ scanned, updated }) => {
          process.stdout.write(`\r  scanned ${scanned} · updated ${updated}`);
        },
      });

      if (stats.scanned > 0) process.stdout.write('\n');

      console.log(
        `  scanned: ${stats.scanned}  restored: ${stats.updated}  batches: ${stats.batches}`
      );

      if (!config.dryRun) {
        deleteSnapshot(snapFile);

        console.log('  ✓ snapshot removed');
      }
    } else {
      if (!hasDownOps(migration.down)) {
        throw new Error(
          `Migration ${migration.id} has no snapshot and no usable "down" block. ` +
            'Cannot roll back.'
        );
      }

      console.log('  no snapshot — using declarative `down`');

      stats = await applyOperations(db, migration.collection, migration.down, {
        batchSize: config.batchSize,
        dryRun: config.dryRun,
        onProgress: ({ scanned, updated }) => {
          process.stdout.write(`\r  scanned ${scanned} · updated ${updated}`);
        },
      });

      if (stats.scanned > 0) process.stdout.write('\n');

      console.log(
        `  scanned: ${stats.scanned}  updated: ${stats.updated}  batches: ${stats.batches}`
      );
    }

    await markRolledBack(db, config.trackingCollection, migration, config.dryRun);

    console.log(
      config.dryRun ? '  (dry-run – not removed from tracking)\n' : '  ✓ tracking removed\n'
    );

    touchedCollections.add(migration.collection);
    results.push({ id: migration.id, ...stats });
  }

  console.log(
    config.dryRun
      ? `Dry run complete. ${results.length} migration(s) would be rolled back.`
      : `Done. Rolled back ${results.length} migration(s).`
  );

  if (!config.dryRun && !config.skipSchema && touchedCollections.size > 0) {
    try {
      console.log(`\nUpdating schema → ${config.schemaPath}`);

      await refreshSchemaForCollections(db, [...touchedCollections], {
        schemaPath: config.schemaPath,
        trackingCollection: config.trackingCollection,
        merge: true,
      });

      console.log(`✓ Schema updated for: ${[...touchedCollections].join(', ')}`);
    } catch (err) {
      console.warn(`Warning: could not update schema: ${err.message}`);
    }
  }

  return { rolledBack: results };
}
