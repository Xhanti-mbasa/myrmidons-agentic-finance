import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

/** A throwaway git repo in the OS temp dir, so tests never touch the real index. */
export function gitSandbox() {
  const dir = mkdtempSync(join(tmpdir(), "payguard-t02-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");

  return {
    dir,
    /** Writes the files and stages them with -f, the way a careless tool would. */
    track(...paths: string[]) {
      for (const p of paths) {
        mkdirSync(dirname(join(dir, p)), { recursive: true });
        writeFileSync(join(dir, p), "x\n");
      }
      git("add", "-f", "--", ...paths);
    },
    run(script: string, env: NodeJS.ProcessEnv = process.env) {
      const r = spawnSync("sh", [script], { cwd: dir, env, encoding: "utf8" });
      return { code: r.status, stdout: r.stdout, stderr: r.stderr };
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
