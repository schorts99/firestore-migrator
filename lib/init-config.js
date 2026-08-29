import { writeConfigTemplate, CONFIG_FILENAME, loadConfig } from "./config.js";

export function runInitConfig(cliOptions = {}) {
  const target = cliOptions.output || CONFIG_FILENAME;
  const dest = writeConfigTemplate(target, { force: Boolean(cliOptions.force) });

  console.log(`✓ Created ${dest}`);
  console.log("\nEdit the file to set paths, project id, and credentials.");
  console.log("Precedence: CLI flags > env vars > this file > defaults");

  try {
    const cfg = loadConfig({ ...cliOptions, config: dest });

    console.log("\nResolved (from this file + env + defaults):");
    console.log(`  migrationsDir:      ${cfg.migrationsDir}`);
    console.log(`  trackingCollection: ${cfg.trackingCollection}`);
    console.log(`  schemaPath:         ${cfg.schemaPath}`);
    console.log(`  batchSize:          ${cfg.batchSize}`);
    console.log(`  projectId:          ${cfg.projectId || "(not set)"}`);
    console.log(`  credentialsPath:    ${cfg.credentialsPath || "(not set)"}`);
    console.log(`  skipSchema:         ${cfg.skipSchema}`);
  } catch {}

  return dest;
}
