import { createDatabase, DEFAULT_DB_PATH } from "../src/connection";
import { migrate } from "../src/migrate";

const dbPath = process.env.SHUCAMOXA_DB_PATH ?? DEFAULT_DB_PATH;
const db = createDatabase(dbPath);

try {
  const applied = migrate(db);
  if (applied.length === 0) {
    console.log(`Database at ${dbPath} is already up to date.`);
  } else {
    console.log(`Applied ${applied.length} migration(s) to ${dbPath}:`);
    for (const m of applied) {
      console.log(`  - ${String(m.version).padStart(3, "0")}_${m.name}`);
    }
  }
} finally {
  db.close();
}
