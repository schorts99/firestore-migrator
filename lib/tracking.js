export async function getAppliedMigrations(db, trackingCollection) {
  const snap = await db.collection(trackingCollection).get();
  const map = new Map();
  snap.forEach((doc) => {
    map.set(doc.id, doc.data());
  });

  return map;
}

export async function markApplied(db, trackingCollection, migration, dryRun = false) {
  if (dryRun) return;

  await db.collection(trackingCollection).doc(migration.id).set({
    id: migration.id,
    description: migration.description,
    collection: migration.collection,
    appliedAt: new Date().toISOString(),
    direction: "up",
  });
}

export async function markRolledBack(db, trackingCollection, migration, dryRun = false) {
  if (dryRun) return;

  await db.collection(trackingCollection).doc(migration.id).delete();
}
