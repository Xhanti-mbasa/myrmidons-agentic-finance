import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Result = "BLOCKED" | "VULNERABLE" | "NOT_IMPLEMENTED";
export type Probe = { safe: boolean; observation: string };
/** Setup/transport errors fail beforeAll. Only the final safety assertion may fail as expected. */
export function attack(id: string, attack: string, target: string, standard: string,
  result: Result, evidence: string, probe: () => Promise<Probe> | Probe) {
  describe(`${id}: ${attack}`, () => {
    let observed: Probe;
    beforeAll(async () => {
      observed = await probe();
      if (typeof observed.safe !== "boolean") throw new Error("Probe did not return a safety verdict");
      const dir = process.env.SECURITY_RESULTS_DIR;
      if (!dir) throw new Error("Run with python3 security/run.py");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id, attack, target, standard,
        result, evidence, ...observed }, null, 2));
    });
    const check = result === "BLOCKED" ? it : it.fails;
    check(`[${result}] expected safe outcome`, () => expect(observed.safe, observed.observation).toBe(true));
  });
}
