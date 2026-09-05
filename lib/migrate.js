import { loadMigrations } from "./loader.js";
import { getAppliedMigrations, markApplied } from "./tracking.js";
import { initFirebase } from "./firebase.js";
import { loadConfig } from "./config.js";
import { refreshSchemaForCollections } from "./schema.js";
import { applyOperations, hasDownOps } from "./apply.js";

async function compensatePartialUp(db, migration, committedRefs, config) {
  if (!committedRefs || committedRefs.length === 0) {
    console.log('  No committed documents to compensate.');

    return null;
  }

  if (!hasDownOps(migration.down)) {
    console.warn(
      `  ⚠ ${committedRefs.length} document(s) were updated but migration has no usable "down" block.\n` +
        '    Automatic compensate skipped — collection may be partially migrated.\n' +
        '    Define a non-empty `down` to enable auto-rollback on failure.'
    );

    return null;
  }

  console.log(
    `  ↩ Compensating: applying down to ${committedRefs.length} already-updated document(s)…`
  );

  const stats = await applyOperationsToRefs(db, committedRefs, migration.down, {
    batchSize: config.batchSize,
    dryRun: false,
    onProgress: ({ scanned, updated }) => {
      process.stdout.write(`\r  compensate scanned ${scanned} · updated ${updated}`);
    },
  });

  if (stats.scanned > 0) process.stdout.write('\n');

  console.log(
    `  ✓ Compensated ${stats.updated} document(s) in ${stats.batches} batch(es)`
  );

  return stats;
}

export async function runMigrate(cliOptions = {}) {
  const config = loadConfig(cliOptions);
  const migrations = await loadMigrations(config.migrationsDir);

  if (migrations.length === 0) {
    console.log('No migration files found in', config.migrationsDir);

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
    console.log('✓ All migrations are already applied.');

    return { applied: [] };
  }

  console.log(
    `Found ${pending.length} pending migration(s)${config.dryRun ? ' [DRY RUN]' : ''}:\n`
  );

  const results = [];
  const touchedCollections = new Set();

  for (const migration of pending) {
    console.log(`→ ${migration.id}`);
    console.log(`  collection: ${migration.collection}`);
    console.log(`  description: ${migration.description}`);

    let stats;

    try {
      stats = await applyOperations(db, migration.collection, migration.up, {
        batchSize: config.batchSize,
        dryRun: config.dryRun,
        onProgress: ({ scanned, updated }) => {
          process.stdout.write(`\r  scanned ${scanned} · updated ${updated}`);
        },
      });
    } catch (err) {
      if (stats?.scanned > 0 || err.partialStats?.scanned > 0) {
        process.stdout.write('\n');
      }

      console.error(`  ✗ Migration failed: ${err.message}`);

      if (!config.dryRun) {
        const committedRefs = err.committedRefs || [];

        try {
          await compensatePartialUp(db, migration, committedRefs, config);
        } catch (compensateErr) {
          console.error(
            `  ✗ Compensate also failed: ${compensateErr.message}\n` +
              '    Collection may be in a partial state. Fix data manually or retry after repair.'
          );
        }
      }

      err.message = `Migration ${migration.id} failed: ${err.message}`;

      throw err;
    }

    if (stats.scanned > 0) {
      process.stdout.write('\n');
    }

    console.log(
      `  scanned: ${stats.scanned}  updated: ${stats.updated}  batches: ${stats.batches}`
    );

    await markApplied(db, config.trackingCollection, migration, config.dryRun);

    console.log(config.dryRun ? '  (dry-run – not recorded)\n' : '  ✓ recorded\n');

    touchedCollections.add(migration.collection);
    results.push({
      id: migration.id,
      scanned: stats.scanned,
      updated: stats.updated,
      batches: stats.batches,
    });
  }

  console.log(
    config.dryRun
      ? `Dry run complete. ${results.length} migration(s) would be applied.`
      : `Done. Applied ${results.length} migration(s).`
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

  return { applied: results };
}
