import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("ESLint security rules", () => {
  it(
    "fails on fixture with dangerouslySetInnerHTML",
    async () => {
      const eslint = new ESLint({
        cwd: resolve(__dirname, ".."),
      });
      const fixturePath = resolve(__dirname, "fixtures/dangerous.tsx");
      const results = await eslint.lintFiles([fixturePath]);
      expect(results.length).toBeGreaterThan(0);
      const messages = results[0]?.messages ?? [];
      const dangerError = messages.find(
        (m) => m.ruleId === "react/no-danger" && m.severity === 2,
      );
      expect(dangerError).toBeDefined();
      expect(dangerError?.message).toContain("dangerouslySetInnerHTML");
    },
    20000,
  );
});
