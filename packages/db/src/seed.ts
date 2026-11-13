import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogRepo } from "./repos/log";
import { createRulesWriteRepo } from "./repos/rules-write";
import type { ShucamoxaDb } from "./types";

export const DEFAULT_SETUP_OUTPUT_PATH = resolve(
  fileURLToPath(new URL("../../../secrets/setup-output.json", import.meta.url))
);

export const DEFAULT_KAROO_ADDRESS = "r3smzsz3bQWDc729AyEC51EaJjd5PanDM1";
export const DEFAULT_ZAMBEZI_ADDRESS = "r3smzsz3bQWDc7zVez255vjGgBwCEyEyBn";

export interface SeedOptions {
  setupOutputPath?: string;
  perPaymentCapCents?: number;
  totalBudgetCents?: number;
  periodStart?: string;
}

export interface SeedResult {
  perPaymentCapCents: number;
  totalBudgetCents: number;
  periodStart: string;
  suppliers: Array<{
    id: string;
    name: string;
    xrplAddress: string;
    status: "approved";
  }>;
}

function isValidXrplAddress(addr: unknown): addr is string {
  return typeof addr === "string" && addr.startsWith("r") && addr.length >= 25 && addr.length <= 35;
}

/**
 * Loads demo seed into the database:
 * - $50 per-payment cap (5000 cents)
 * - $200 total budget (20000 cents)
 * - Karoo Textiles & Zambezi Spices approved suppliers
 * - Reads addresses from secrets/setup-output.json if present; otherwise uses demo defaults.
 */
export function seed(
  db: ShucamoxaDb,
  options: SeedOptions = {}
): SeedResult {
  const setupOutputPath = options.setupOutputPath ?? DEFAULT_SETUP_OUTPUT_PATH;
  let karooAddress = DEFAULT_KAROO_ADDRESS;
  let zambeziAddress = DEFAULT_ZAMBEZI_ADDRESS;

  if (existsSync(setupOutputPath)) {
    try {
      const raw = JSON.parse(readFileSync(setupOutputPath, "utf8"));
      const candA =
        raw.supplierA?.address ??
        raw.supplierA ??
        raw.supplier_a?.address ??
        raw.supplier_a ??
        raw.sup_karoo?.address ??
        raw.sup_karoo ??
        raw.Karoo?.address ??
        raw.Karoo;

      const candB =
        raw.supplierB?.address ??
        raw.supplierB ??
        raw.supplier_b?.address ??
        raw.supplier_b ??
        raw.sup_zambezi?.address ??
        raw.sup_zambezi ??
        raw.Zambezi?.address ??
        raw.Zambezi;

      if (isValidXrplAddress(candA)) karooAddress = candA;
      if (isValidXrplAddress(candB)) zambeziAddress = candB;
    } catch {
      // Ignore JSON parse errors in optional setup output and fall back to defaults
    }
  }

  const perPaymentCapCents = options.perPaymentCapCents ?? 5000; // $50
  const totalBudgetCents = options.totalBudgetCents ?? 20000; // $200
  const periodStart = options.periodStart ?? "2026-11-01";

  const rulesWrite = createRulesWriteRepo(db);
  const log = createLogRepo(db);

  // Seed rules
  rulesWrite.setRules({
    perPaymentCapCents,
    totalBudgetCents,
    periodStart,
    killSwitch: false,
    updatedBy: "seed",
  });

  // Seed suppliers
  const suppliers: SeedResult["suppliers"] = [
    {
      id: "sup_karoo",
      name: "Karoo Textiles",
      xrplAddress: karooAddress,
      status: "approved",
    },
    {
      id: "sup_zambezi",
      name: "Zambezi Spices",
      xrplAddress: zambeziAddress,
      status: "approved",
    },
  ];

  for (const s of suppliers) {
    rulesWrite.upsertSupplier({
      id: s.id,
      name: s.name,
      xrplAddress: s.xrplAddress,
      status: s.status,
    });
  }

  // Audit log entry for seeding
  log.appendLog({
    actor: "owner",
    event: "rules_changed",
    explanation: "Demo seed loaded: $50 cap, $200 budget, Karoo & Zambezi approved",
  });

  return {
    perPaymentCapCents,
    totalBudgetCents,
    periodStart,
    suppliers,
  };
}
