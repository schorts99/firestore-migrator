import { initFirebase } from "./firebase.js";
import { loadConfig } from "./config.js";
import { generateSchema } from "./schema.js";

export async function runSchema(cliOptions = {}, collectionNames = []) {
  const config = loadConfig(cliOptions);
  const db = initFirebase(config);
  const names =
    collectionNames && collectionNames.length > 0
      ? collectionNames
      : undefined;

  console.log(
    names
      ? `Generating schema for: ${names.join(", ")}`
      : "Generating schema for all root collections…"
  );
  console.log(`Output: ${config.schemaPath}\n`);

  const schema = await generateSchema(db, {
    collections: names,
    schemaPath: config.schemaPath,
    trackingCollection: config.trackingCollection,
    merge: !cliOptions.noMerge,
  });
  const colNames = Object.keys(schema.collections || {});

  for (const name of colNames) {
    const entry = schema.collections[name];

    if (entry.empty) {
      console.log(`· ${name}  (empty)`);
    } else {
      const fieldCount = Object.keys(entry.fields || {}).length;

      console.log(`✓ ${name}  ${fieldCount} field(s)  sample=${entry.sampleId}`);
    }
  }

  console.log(`\n✓ Schema written to ${config.schemaPath}`);
  console.log(`  ${colNames.length} collection(s)`);

  return schema;
}
