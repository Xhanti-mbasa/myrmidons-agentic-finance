import { createDatabase } from "../src/connection";
import { appendLog } from "../src/repos/log";

async function main() {
  const [dbPath, countStr, workerId] = process.argv.slice(2);
  if (!dbPath) {
    throw new Error("Missing dbPath argument");
  }
  const count = parseInt(countStr ?? "50", 10);
  const db = createDatabase(dbPath, { busyTimeout: 30000 });

  for (let i = 0; i < count; i++) {
    await appendLog(db, {
      actor: "agent",
      event: "invoice_received",
      invoiceNumber: `INV-${workerId}-${i + 1}`,
      amount: "10.00",
      explanation: `Worker ${workerId} append ${i + 1}`,
    });
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(`Worker error:`, err);
    process.exit(1);
  });
