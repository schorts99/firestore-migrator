# @schorts/firestore-migrator

Declarative migration tool for Cloud Firestore. Define field additions, removals, and transforms in simple migration files, then apply or roll them back with a single CLI command.

Features:

- Declarative `up` / `down` operations (`add`, `remove`, `update`)
- Before-image **snapshots** for exact restore on failure and rollback
- Optional live **schema** file refreshed after migrate/rollback
- Project config via `firestore-migrator.toml`, `.env`, and CLI flags

Requires **Node.js ≥ 18** and a Firebase service account (or Application Default Credentials).

## Install

```bash
npm install -D @schorts/firestore-migrator
```

The CLI binary is always `firestore-migrator`.

## Quick start

```bash
# 0. Config + credentials
firestore-migrator init
# put secrets in .env (auto-loaded) or set GOOGLE_APPLICATION_CREDENTIALS

# 1. Create a migration
firestore-migrator generate add-user-status users

# 2. Edit migrations/<timestamp>_add-user-status.js
#    Fill in up / down operations

# 3. Preview
firestore-migrator migrate --dry-run

# 4. Apply
firestore-migrator migrate

# 5. Status
firestore-migrator status

# 6. Schema (optional)
firestore-migrator schema
firestore-migrator schema users orders

# 7. Roll back last migration
firestore-migrator rollback
```

## CLI

```
firestore-migrator init
firestore-migrator generate <name> [collection]
firestore-migrator migrate   [--dry-run] [--only <id>] [--skip-schema]
firestore-migrator rollback  [--steps <n>] [--only <id>] [--dry-run] [--skip-schema]
firestore-migrator schema    [collections...] [--no-merge]
firestore-migrator status
```

### Commands

| Command | Description |
|---------|-------------|
| `init` | Create `firestore-migrator.toml` in the current directory |
| `generate` | Create a new timestamped migration file |
| `migrate` | Apply all pending migrations (or one with `--only`) |
| `rollback` | Roll back the latest applied migration(s) |
| `schema` | Sample collections and write `firestore.schema.json` |
| `status` | List migrations and applied / pending state |

### Global options

| Option | Description |
|--------|-------------|
| `--config <path>` | Path to TOML config (default: `./firestore-migrator.toml` if present) |
| `--env-file <path>` | Path to `.env` file (default: `./.env`, then `./.env.local`) |
| `--env-override` | Let `.env` values override existing environment variables |
| `-d, --migrations-dir <path>` | Directory with migration files (default: `./migrations`) |
| `-t, --tracking-collection <name>` | Collection that records applied migrations (default: `__migrations`) |
| `--schema-path <path>` | Schema output path (default: `./firestore.schema.json`) |
| `--snapshots-dir <path>` | Before-image snapshots directory (default: `<migrationsDir>/.snapshots`) |
| `--project-id <id>` | GCP / Firebase project id |
| `-c, --credentials <path>` | Path to service account JSON |
| `--batch-size <n>` | Max writes per Firestore batch (default: `400`) |
| `--dry-run` | Simulate without writing |
| `--skip-schema` | Do not refresh schema after migrate/rollback |
| `--no-merge` | `schema` only: replace the schema file instead of merging |
| `--force` | `init` only: overwrite an existing config file |
| `-o, --output <path>` | `init` only: custom path for the config file |

## Configuration

### Precedence (highest → lowest)

1. CLI flags  
2. Environment variables (including values loaded from `.env`)  
3. `firestore-migrator.toml`  
4. Built-in defaults  

### `.env` files

`loadConfig()` loads **`./.env`**, then **`./.env.local`** if `.env` is missing. Existing shell/CI variables are **not** overwritten unless you pass `--env-override`.

```bash
# .env
FIREBASE_PROJECT_ID=my-project
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json
FIREBASE_CLIENT_EMAIL=sa@my-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

```bash
firestore-migrator migrate
firestore-migrator migrate --env-file ./config/.env.staging
firestore-migrator migrate --env-override
```

`.env` is listed in `.gitignore` by default.

### `firestore-migrator init`

```bash
firestore-migrator init
firestore-migrator init --force
firestore-migrator init -o ./config/prod.toml
```

Example `firestore-migrator.toml`:

```toml
# paths & behaviour
migrations_dir       = "migrations"
tracking_collection  = "__migrations"
schema_path          = "firestore.schema.json"
snapshots_dir        = "migrations/.snapshots"
batch_size           = 400
skip_schema          = false

# firebase
project_id  = "my-firebase-project"
credentials = "./serviceAccount.json"
# or interpolate from the environment:
# credentials = "${GOOGLE_APPLICATION_CREDENTIALS}"
# project_id  = "$FIREBASE_PROJECT_ID"

# map config keys → env var *names* (values stay in the environment)
[env]
project_id   = "FIREBASE_PROJECT_ID"
credentials  = "GOOGLE_APPLICATION_CREDENTIALS"
private_key  = "FIREBASE_PRIVATE_KEY"
client_email = "FIREBASE_CLIENT_EMAIL"
```

String values support `${VAR}` and `$VAR` expansion. The optional `[env]` section points keys at env var **names** so secrets never need to live in the file.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account JSON |
| `FIREBASE_PROJECT_ID` / `GCLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT` | Project id |
| `FIREBASE_PRIVATE_KEY` | Inline private key (use with client email) |
| `FIREBASE_CLIENT_EMAIL` | Service account email |
| `FIRESTORE_MIGRATIONS_DIR` | Migrations directory |
| `FIRESTORE_MIGRATIONS_TRACKING` | Tracking collection name |
| `FIRESTORE_SCHEMA_PATH` | Schema file path |
| `FIRESTORE_SNAPSHOTS_DIR` | Snapshots directory |
| `FIRESTORE_MIGRATIONS_BATCH_SIZE` | Batch size |
| `FIRESTORE_SKIP_SCHEMA` | `1` to skip schema refresh |

## Migration file format

Files are ESM modules named `YYYYMMDDHHmmss_<slug>.js` under the migrations directory.

```js
export default {
  id: "20260804052509_add-user-status",
  description: "add user status",
  collection: "users",

  up: {
    add: {
      status: { default: "active" },
      fullName: {
        from: (doc) => `${doc.firstName || ""} ${doc.lastName || ""}`.trim(),
      },
    },
    remove: ["legacyFlag"],
    update: {
      email: (doc) => (doc.email || "").toLowerCase(),
    },
  },

  // Used when no snapshot is available (fallback)
  down: {
    add: {},
    remove: ["status", "fullName"],
    update: {},
  },
};
```

### Operations

| Key | Purpose |
|-----|---------|
| `add` | Add fields. Use `{ default: value }` or `{ from: (doc) => value }`. Existing fields are left untouched (idempotent). |
| `remove` | Array of field names to delete (`FieldValue.delete()`). |
| `update` | Map of field → `(doc) => newValue` transforms. |

Prefer keeping a useful `down` block even when snapshots exist — it is the fallback if the snapshot file is missing.

## Snapshots, failure & rollback

During `migrate`, before each document is updated a **before-image** is written to:

```text
<migrationsDir>/.snapshots/<migrationId>.json
```

Example:

```json
{
  "migrationId": "20260905120000_add-status",
  "collection": "users",
  "documents": {
    "user_1": {
      "status": { "__absent": true },
      "email": "Old@Email.com",
      "legacyFlag": true
    }
  }
}
```

| Situation | Behavior |
|-----------|----------|
| **Migrate fails** mid-way | Restores **only committed docs** from the snapshot (exact previous values), then deletes the snapshot. Migration is **not** marked applied. |
| **Manual `rollback`** | Prefers snapshot restore for the whole migration; deletes snapshot when done |
| **No snapshot** | Falls back to declarative `down` |
| **No snapshot and no `down`** | Cannot compensate / roll back — warning or error |

- `__absent` means the field was added by `up` and should be deleted on restore.
- Timestamps, GeoPoints, references, and bytes are serialized so they can be written back.
- Keep `migrations/.snapshots/` out of git if snapshots may contain sensitive data (listed in `.gitignore`).

Configure the directory via:

```toml
snapshots_dir = "migrations/.snapshots"
```

or `FIRESTORE_SNAPSHOTS_DIR` / `--snapshots-dir`.

## Schema

```bash
# All root collections (skips tracking collection)
firestore-migrator schema

# Specific collections
firestore-migrator schema users orders

# Custom path / replace instead of merge
firestore-migrator schema --schema-path ./schemas/app.json --no-merge
```

After a successful **migrate** or **rollback** (not dry-run), the schema is refreshed for every collection those migrations touched and merged into the schema file. Disable with `--skip-schema` or `skip_schema = true` in the TOML config.

Example `firestore.schema.json`:

```json
{
  "version": 1,
  "updatedAt": "2026-08-04T21:00:00.000Z",
  "collections": {
    "users": {
      "empty": false,
      "sampleId": "abc123",
      "updatedAt": "2026-08-04T21:00:00.000Z",
      "fields": {
        "email": "string",
        "age": "number",
        "active": "boolean",
        "tags": { "type": "array", "items": "string" },
        "profile": {
          "type": "map",
          "fields": {
            "displayName": "string",
            "score": "number"
          }
        },
        "createdAt": "timestamp"
      }
    }
  }
}
```

Inferred types: `string`, `number`, `boolean`, `null`, `timestamp`, `geopoint`, `reference`, `bytes`, `array`, `map`.

One document is sampled per collection (`limit(1)`). Empty collections are recorded as `"empty": true`.

## How it works

1. `.env` / `.env.local` is loaded into `process.env` (if present).
2. Migration files live in `./migrations` (or `migrations_dir`) and are named `YYYYMMDDHHmmss_<slug>.js`.
3. Applied migrations are recorded in a tracking collection (`__migrations` by default).
4. `migrate` runs pending files in timestamp order, applying `up` with batched writes and writing before-image snapshots.
5. **On failure mid-migration**, committed docs are restored from the **snapshot**. The migration is **not** marked applied.
6. **`rollback`** restores from the snapshot when present; otherwise uses declarative `down`. Tracking record is removed.
7. Schema is optionally refreshed for touched collections after migrate/rollback.

Collections are paginated so large datasets stay memory-safe. `add` skips fields that already exist.

## Programmatic usage

```js
import {
  generateMigration,
  runMigrate,
  runRollback,
  runStatus,
  runSchema,
  runInitConfig,
  loadConfig,
  loadEnvFile,
} from "firestore-migrator";

loadEnvFile(); // optional; also runs inside loadConfig()
runInitConfig();

await runMigrate({ dryRun: true });
await runSchema({}, ["users", "orders"]);
await runRollback({ steps: 1 });
```

Pass the same option names as the CLI flags (camelCase), e.g. `migrationsDir`, `schemaPath`, `snapshotsDir`, `projectId`, `credentials`, `skipSchema`, `config`, `envFile`, `envOverride`.

## License

LGPL-3.0-or-later
