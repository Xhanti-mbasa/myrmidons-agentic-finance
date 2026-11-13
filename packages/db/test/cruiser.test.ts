import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const req = createRequire(import.meta.url);
const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));

describe("T28 - Dependency-cruiser architectural boundary", () => {
  it("6. Dependency-cruiser rule catches services/agent -> packages/db", () => {
    const configPath = join(repoRoot, ".dependency-cruiser.cjs");
    expect(existsSync(configPath)).toBe(true);

    const config = req(configPath);
    expect(config).toBeDefined();
    expect(config.forbidden).toBeInstanceOf(Array);

    const agentToDbRule = config.forbidden.find(
      (r: any) => r.name === "no-agent-to-db"
    );
    expect(agentToDbRule).toBeDefined();
    expect(agentToDbRule.severity).toBe("error");

    const fromPattern = new RegExp(agentToDbRule.from.path);
    const toPattern = new RegExp(agentToDbRule.to.path);

    // Helper that evaluates whether a from->to dependency triggers the rule
    function isForbidden(fromPath: string, toPath: string): boolean {
      return fromPattern.test(fromPath) && toPattern.test(toPath);
    }

    // A. Positive cases: any import from services/agent to packages/db is caught!
    expect(
      isForbidden(
        "services/agent/src/agent.ts",
        "packages/db/src/index.ts"
      )
    ).toBe(true);

    expect(
      isForbidden(
        "services/agent/src/tools.ts",
        "packages/db/src/repos/rules-read.ts"
      )
    ).toBe(true);

    // B. Negative cases: other services importing packages/db are allowed
    expect(
      isForbidden(
        "services/backend/src/server.ts",
        "packages/db/src/index.ts"
      )
    ).toBe(false);

    expect(
      isForbidden(
        "services/payments/src/payment.ts",
        "packages/db/src/index.ts"
      )
    ).toBe(false);

    // C. Negative cases: services/agent importing other packages (like packages/shared) is allowed
    expect(
      isForbidden(
        "services/agent/src/agent.ts",
        "packages/shared/src/index.ts"
      )
    ).toBe(false);

    // D. Verify actual codebase compliance: services/agent currently contains ZERO references to packages/db
    const agentSrcDir = join(repoRoot, "services/agent/src");
    if (existsSync(agentSrcDir)) {
      const files: string[] = [];
      function walk(dir: string) {
        for (const item of readdirSync(dir)) {
          const full = join(dir, item);
          if (statSync(full).isDirectory()) walk(full);
          else if (full.endsWith(".ts")) files.push(full);
        }
      }
      walk(agentSrcDir);

      for (const file of files) {
        const content = readFileSync(file, "utf8");
        expect(content).not.toMatch(/from\s+["']@shucamoxa\/db["']/);
        expect(content).not.toMatch(/from\s+["'].*packages\/db.*["']/);
      }
    }
  });
});
