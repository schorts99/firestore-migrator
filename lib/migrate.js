import { loadMigrations } from "./loader.js";
import { getAppliedMigrations, markApplied } from "./tracking.js";
import { initFirebase } from "./firebase.js";
import { loadConfig } from "./config.js";
import { refreshSchemaForCollections } from "./schema.js";
import { applyGenerate, applyOperations, applyOperationsToRefs, hasDownOps } from "./apply.js";
import {
  deleteSnapshot,
  loadSnapshot,
  snapshotPath,
  createSnapshotStore,
  restoreFromSnapshot,
} from "./snapshot.js";

async function compensatePartialUp(db, migration, committedIds, snapshotStore, config) {
  if (!committedIds || committedIds.length === 0) {
    console.log('  No committed documents to compensate.');

    if (snapshotStore) {
      deleteSnapshot(snapshotStore.filePath);
    }

    return null;
  }

  const snapFile = snapshotStore?.filePath || snapshotPath(config.snapshotsDir, migration.id);
  const snap = loadSnapshot(snapFile);
  const snapHasDocuments = snap?.documents && Object.keys(snap.documents).length > 0;
  const snapHasCreated = snap?.created && Object.keys(snap.created).length > 0;

  if (snapHasDocuments || snapHasCreated) {
    console.log(
      `  ↩ Reverting ${committedIds.length} document(s) from snapshot → ${snapFile}`
    );

    const stats = await restoreFromSnapshot(db, migration.collection, snap, {
      batchSize: config.batchSize,
      dryRun: false,
      onlyDocIds: committedIds,
      onProgress: ({ scanned, updated, deleted }) => {
        process.stdout.write(
          `\r  restore scanned ${scanned} · restored ${updated} · erased ${deleted}`
        );
      },
    });

    if (stats.scanned > 0) process.stdout.write('\n');

    console.log(
      `  ✓ Reverted ${stats.updated} restored · ${stats.deleted} erased in ${stats.batches} batch(es)`
    );

    deleteSnapshot(snapFile);

    return stats;
  }

  if (!hasDownOps(migration.down)) {
    console.warn(
      `  ⚠ ${committedIds.length} document(s) changed but no snapshot and no usable "down".\n` +
        (migration.up.generate
          ? '    Generated documents can only be erased via a snapshot.\n'
          : '') +
        '    Collection may be partially migrated.'
    );

    return null;
  }

  console.warn(
    '  ⚠ No snapshot found — falling back to declarative `down` for committed docs.'
  );

  if (migration.up.generate) {
    console.warn('    Note: generated documents cannot be erased without a snapshot.');
  }

  const refs = committedIds.map((id) => db.collection(migration.collection).doc(id));
  const stats = await applyOperationsToRefs(db, refs, migration.down, {
    batchSize: config.batchSize,
  });

  console.log(`  ✓ Compensated ${stats.updated} document(s) via down`);

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

    const snapshotStore = config.dryRun
      ? null
      : createSnapshotStore(migration, config.snapshotsDir);

    if (snapshotStore) {
      console.log(`  snapshot: ${snapshotStore.filePath}`);
    }

    let stats;
    let genStats = null;
    const committedIds = [];
    const generateSpec = migration.up.generate;
    const hasFieldOps =
      Object.keys(migration.up.add).length > 0 ||
      migration.up.remove.length > 0 ||
      Object.keys(migration.up.update).length > 0;

    if (generateSpec) {
      console.log(`  generate from: ${generateSpec.from}`);
    }

    try {
      if (generateSpec) {
        genStats = await applyGenerate(db, migration.collection, generateSpec, {
          batchSize: config.batchSize,
          dryRun: config.dryRun,
          snapshotStore,
          onProgress: ({ scanned, generated }) => {
            process.stdout.write(`\r  scanned ${scanned} · generated ${generated}`);
          },
        });

        committedIds.push(...genStats.committedIds);

        if (genStats.scanned > 0) process.stdout.write('\n');
      }

      if (hasFieldOps) {
        stats = await applyOperations(db, migration.collection, migration.up, {
          batchSize: config.batchSize,
          dryRun: config.dryRun,
          snapshotStore,
          onProgress: ({ scanned, updated }) => {
            process.stdout.write(`\r  scanned ${scanned} · updated ${updated}`);
          },
        });

        committedIds.push(...stats.committedIds);

        if (stats.scanned > 0) process.stdout.write('\n');
      }

      if (snapshotStore) snapshotStore.finalize();
    } catch (err) {
      if ((genStats?.scanned || 0) > 0 || (err.partialStats?.scanned || 0) > 0) {
        process.stdout.write('\n');
      }

      console.error(`  ✗ Migration failed: ${err.message}`);

      if (!config.dryRun) {
        try {
          if (snapshotStore) snapshotStore.flush();

          await compensatePartialUp(
            db,
            migration,
            [...committedIds, ...(err.committedIds || [])],
            snapshotStore,
            config
          );
        } catch (compensateErr) {
          console.error(
            `  ✗ Restore also failed: ${compensateErr.message}\n` +
              '    Collection may be in a partial state.'
          );
        }
      }

      err.message = `Migration ${migration.id} failed: ${err.message}`;

      throw err;
    }

    if (genStats) {
      console.log(
        `  generate: scanned ${genStats.scanned}  generated ${genStats.generated}  ` +
          `skipped ${genStats.skipped}  batches ${genStats.batches}`
      );
    }

    if (stats) {
      console.log(
        `  scanned: ${stats.scanned}  updated: ${stats.updated}  batches: ${stats.batches}` +
          (snapshotStore ? `  snapshotDocs: ${snapshotStore.docCount()}` : '')
      );
    } else if (snapshotStore) {
      console.log(`  snapshotDocs: ${snapshotStore.docCount()}`);
    }

    await markApplied(db, config.trackingCollection, migration, config.dryRun);

    console.log(config.dryRun ? '  (dry-run – not recorded)\n' : '  ✓ recorded\n');

    touchedCollections.add(migration.collection);
    results.push({
      id: migration.id,
      scanned: (genStats?.scanned || 0) + (stats?.scanned || 0),
      updated: stats?.updated || 0,
      generated: genStats?.generated || 0,
      skipped: genStats?.skipped || 0,
      batches: (genStats?.batches || 0) + (stats?.batches || 0),
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