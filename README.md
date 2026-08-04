# @schorts/firestore-migrator

Declarative migration tool for Cloud Firestore. Define field additions, removals, and transforms in simple migration files, then apply or roll them back with a single CLI command.

## Install

```
npm install --dev @schorts/firestore-migrator
```

Requires Node.js ≥ 18 and a Firebase service account (or Application Default Credentials).

## Quick start

```bash
# 1. Create a migration
firestore-migrator generate add-user-status users

# 2. Edit migrations/<timestamp>_add-user-status.js
#    Fill in up / down operations

# 3. Preview
firestore-migrator migrate --dry-run

# 4. Apply
firestore-migrator migrate

# 5. Check state
firestore-migrator status

# 6. Roll back last migration
firestore-migrator rollback
```

## CLI

```
firestore-migrator generate <name> [collection]
firestore-migrator migrate   [--dry-run] [--only <id>]
firestore-migrator rollback  [--steps <n>] [--only <id>] [--dry-run]
firestore-migrator status
```

### Global options

### Global options

| Option | Description |
|--------|-------------|
| `-d, --migrations-dir <path>` | Directory with migration files (default: `./migrations`) |
| `-t, --tracking-collection <name>` | Collection that records applied migrations (default: `__migrations`) |
| `--project-id <id>` | GCP / Firebase project id |
| `-c, --credentials <path>` | Path to service account JSON |
| `--batch-size <n>` | Max writes per Firestore batch (default: 400) |
| `--dry-run` | Simulate without writing |

Credentials can also be provided via `GOOGLE_APPLICATION_CREDENTIALS`.

## Migration file format

```js
export default {
  id: '20260804052509_add-user-status',
  description: 'add user status',
  collection: 'users',

  up: {
    add: {
      status: { default: 'active' },
      fullName: {
        from: (doc) => `${doc.firstName || ''} ${doc.lastName || ''}`.trim(),
      },
    },
    remove: ['legacyFlag'],
    update: {
      email: (doc) => (doc.email || '').toLowerCase(),
    },
  },

  // Required for rollback
  down: {
    add: {},
    remove: ['status', 'fullName'],
    update: {},
  },
};
```

### Operations

| Key | Purpose |
|-----|---------|
| `add` | Add fields. Use `{ default: value }` for a static value or `{ from: (doc) => value }` to compute from the current document. Existing fields are left untouched (idempotent). |
| `remove` | Array of field names to delete (`FieldValue.delete()`). |
| `update` | Map of field → `(doc) => newValue` transforms. |

## How it works

1. Migration files live in `./migrations` and are named `YYYYMMDDHHmmss_<slug>.js`.
2. Applied migrations are recorded in a tracking collection (`__migrations` by default).
3. `migrate` runs pending files in timestamp order, applying `up` operations to every document in the target collection using batched writes.
4. `rollback` applies the corresponding `down` operations and removes the tracking record. A migration without a non-empty `down` block cannot be rolled back.

## Programmatic usage

```js
import { generateMigration, runMigrate, runRollback, runStatus } from '@schorts/firestore-migrator';

await runMigrate({ dryRun: true, migrationsDir: './migrations' });
```

## License

LGPL-3.0-or-later
