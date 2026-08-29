#!/usr/bin/env node

const HELP = `
firestore-migrator – declarative migrations for Cloud Firestore

Usage:
  firestore-migrator <command> [options]

Commands:
  init                           Create firestore-migrator.toml in the current directory
  generate <name> [collection]   Create a new migration file
  migrate                        Apply all pending migrations
  rollback                       Roll back the latest applied migration(s)
  schema [collections...]        Sample collections and write firestore.schema.json
  status                         List migrations and their state

Global options:
  --config <path>                Path to TOML config (default: ./firestore-migrator.toml)
  --env-file <path>              Path to .env file (default: ./.env then ./.env.local)
  --env-override                 Let .env values override existing environment variables
  -d, --migrations-dir <path>    Migrations directory (default: ./migrations)
  -t, --tracking-collection <n>  Tracking collection (default: __migrations)
  --schema-path <path>           Schema output path (default: ./firestore.schema.json)
  --project-id <id>              Firebase / GCP project id
  -c, --credentials <path>       Path to service account JSON
  --batch-size <n>               Max ops per batch (default: 400)
  --dry-run                      Simulate without writing
  --skip-schema                  Do not refresh schema after migrate/rollback
  --no-merge                     schema: replace file instead of merging collections
  --force                        init: overwrite existing config
  -o, --output <path>            init: output path for config file
  -h, --help                     Show help
  -v, --version                  Show version

Config precedence (highest → lowest):
  CLI flags  >  environment variables  >  firestore-migrator.toml  >  defaults

Examples:
  firestore-migrator init
  firestore-migrator generate add-user-status users
  firestore-migrator migrate --dry-run
  firestore-migrator migrate --config ./config/prod.toml
  firestore-migrator schema users orders
  firestore-migrator status
`.trim();

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];

    if (a === "-h" || a === "--help") {
      flags.help = true;
    } else if (a === "-v" || a === "--version") {
      flags.version = true;
    } else if (a === "--dry-run") {
      flags.dryRun = true;
    } else if (a === "--skip-schema") {
      flags.skipSchema = true;
    } else if (a === "--no-merge") {
      flags.noMerge = true;
    } else if (a === "--force") {
      flags.force = true;
    } else if (a === "--config") {
      flags.config = args[++i];
    } else if (a === "--env-file") {
      flags.envFile = args[++i];
    } else if (a === "--env-override") {
      flags.envOverride = true;
    } else if (a === "-o" || a === "--output") {
      flags.output = args[++i];
    } else if (a === "-d" || a === "--migrations-dir") {
      flags.migrationsDir = args[++i];
    } else if (a === "-t" || a === "--tracking-collection") {
      flags.trackingCollection = args[++i];
    } else if (a === "--schema-path") {
      flags.schemaPath = args[++i];
    } else if (a === "--project-id") {
      flags.projectId = args[++i];
    } else if (a === "-c" || a === "--credentials") {
      flags.credentials = args[++i];
    } else if (a === "--batch-size") {
      flags.batchSize = args[++i];
    } else if (a === "--only") {
      flags.only = args[++i];
    } else if (a === "--steps") {
      flags.steps = args[++i];
    } else if (a.startsWith("-")) {
      console.error(`Unknown option: ${a}`);

      process.exit(1);
    } else {
      positional.push(a);
    }
  }

  return { flags, positional };
}

async function main() {
  const { flags, positional } = parseArgs(process.argv);
  const command = positional[0];

  if (flags.version) {
    console.log("0.3.0");

    return;
  }

  if (!command || flags.help) {
    console.log(HELP);

    process.exit(flags.help ? 0 : 1);
  }

  try {
    if (command === "init") {
      const { runInitConfig } = await import("../lib/init-config.js");

      runInitConfig(flags);

      return;
    }

    if (command === "generate" || command === "g") {
      const name = positional[1];
      const collection = positional[2] || "your_collection";

      if (!name) {
        console.error("Error: migration name is required\n");
        console.log("Usage: firestore-migrator generate <name> [collection]");

        process.exit(1);
      }

      const { generateMigration } = await import("../lib/generate.js");
      const { loadConfig } = await import("../lib/config.js");
      const config = loadConfig(flags);
      const result = generateMigration(name, {
        collection,
        migrationsDir: config.migrationsDir,
      });

      console.log(`✓ Created migration: ${result.filename}`);
      console.log(`  id:         ${result.id}`);
      console.log(`  collection: ${result.collection}`);
      console.log(`  path:       ${result.filepath}`);
      console.log("\nEdit the file to define up / down operations.");

      return;
    }

    if (command === "migrate" || command === "up") {
      const { runMigrate } = await import("../lib/migrate.js");

      await runMigrate(flags);

      return;
    }

    if (command === "rollback" || command === "down") {
      const { runRollback } = await import("../lib/rollback.js");

      await runRollback(flags);

      return;
    }

    if (command === "schema") {
      const { runSchema } = await import("../lib/run-schema.js");
      const collectionNames = positional.slice(1);

      await runSchema(flags, collectionNames);

      return;
    }

    if (command === "status" || command === "s") {
      const { runStatus } = await import("../lib/status.js");

      await runStatus(flags);

      return;
    }

    console.error(`Unknown command: ${command}\n`);
    console.log(HELP);

    process.exit(1);
  } catch (err) {
    console.error("Error:", err.message);

    if (process.env.DEBUG) console.error(err);

    process.exit(1);
  }
}

main();
