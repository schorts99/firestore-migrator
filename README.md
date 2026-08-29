# @schortsfirestore-migrator

Declarative migration tool for Cloud Firestore. Define field additions, removals, and transforms in simple migration files, then apply or roll them back with a single CLI command. Optionally keep a live `firestore.schema.json` in sync after every migrate or rollback.

Requires **Node.js ≥ 18** and a Firebase service account (or Application Default Credentials).

## Install

```bash
npm install @schorts/firestore-migrator
```

## Quick start

```bash
# 0. Optional: project config file
firestore-migrator init

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

# 6. Inspect / refresh schema
firestore-migrator schema
# or only some collections
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
| `schema` | Sample one document per collection and write `firestore.schema.json` |
| `status` | List migrations and whether each is applied or pending |

### Global options

| Option | Description |
|--------|-------------|
| `--config <path>` | Path to TOML config (default: `./firestore-migrator.toml` if present) |
| `-d, --migrations-dir <path>` | Directory with migration files (default: `./migrations`) |
| `-t, --tracking-collection <name>` | Collection that records applied migrations (default: `__migrations`) |
| `--schema-path <path>` | Schema output path (default: `./firestore.schema.json`) |
| `--project-id <id>` | GCP / Firebase project id |
| `-c, --credentials <path>` | Path to service account JSON |
| `--batch-size <n>` | Max writes per Firestore batch (default: `400`) |
| `--dry-run` | Simulate without writing |
| `--skip-schema` | Do not refresh schema after migrate/rollback |
| `--no-merge` | `schema` only: replace the schema file instead of merging collections |
| `--force` | `init` only: overwrite an existing config file |
| `-o, --output <path>` | `init` only: custom path for the config file |

## Configuration

### Precedence (highest → lowest)

1. CLI flags
2. Environment variables
3. `firestore-migrator.toml`
4. Built-in defaults

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

  // Required for rollback — reverse of `up`
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
| `add` | Add fields. Use `{ default: value }` for a static value or `{ from: (doc) => value }` to compute from the current document. Existing fields are left untouched (idempotent). |
| `remove` | Array of field names to delete (`FieldValue.delete()`). |
| `update` | Map of field → `(doc) => newValue` transforms. |

`down` must be present and non-empty to roll a migration back.

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

1. Migration files live in `./migrations` (or `migrations_dir`) and are named `YYYYMMDDHHmmss_<slug>.js`.
2. Applied migrations are recorded in a tracking collection (`__migrations` by default).
3. `migrate` runs pending files in timestamp order, applying `up` with batched writes.
4. `rollback` applies `down` and removes the tracking record.
5. Schema is optionally refreshed for touched collections after migrate/rollback.

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
} from "firestore-migrator";

runInitConfig();

await runMigrate({ dryRun: true });
await runSchema({}, ["users", "orders"]);
```

Pass the same option names as the CLI flags (camelCase), e.g. `migrationsDir`, `schemaPath`, `projectId`, `credentials`, `skipSchema`, `config`.

## License

See `package.json` for the package license.
