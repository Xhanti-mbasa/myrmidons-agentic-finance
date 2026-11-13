import { createDatabase, DEFAULT_DB_PATH } from "../src/connection";
import { migrate } from "../src/migrate";
import { seed } from "../src/seed";

const dbPath = process.env.SHUCAMOXA_DB_PATH ?? DEFAULT_DB_PATH;
const db = createDatabase(dbPath);

try {
  // Ensure schema is present before seeding
  migrate(db);
  const result = seed(db);
  console.log(`Successfully seeded database at ${dbPath}:`);
  console.log(`  - Per-payment cap: $${(result.perPaymentCapCents / 100).toFixed(2)} (${result.perPaymentCapCents} cents)`);
  console.log(`  - Total budget: $${(result.totalBudgetCents / 100).toFixed(2)} (${result.totalBudgetCents} cents)`);
  console.log(`  - Period start: ${result.periodStart}`);
  console.log(`  - Suppliers:`);
  for (const s of result.suppliers) {
    console.log(`      * [${s.status}] ${s.name} (${s.id}) -> ${s.xrplAddress}`);
  }
} finally {
  db.close();
}
