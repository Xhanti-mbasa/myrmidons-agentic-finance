import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitSandbox, REPO_ROOT } from "./support/git-sandbox";

const HOOK = join(REPO_ROOT, ".githooks", "pre-commit");

// The hook may only rely on these tools. Each test gets a PATH holding just them,
// so a real gitleaks on the developer's machine can't change the result.
const TOOLS = ["sh", "git", "grep", "tr", "sort", "dirname"];

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function pathWith(stubGitleaks?: { exitCode: number }) {
  const bin = mkdtempSync(join(tmpdir(), "payguard-t02-bin-"));
  cleanups.push(() => rmSync(bin, { recursive: true, force: true }));
  for (const tool of TOOLS) {
    const real = execFileSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).trim();
    symlinkSync(real, join(bin, tool));
  }
  const argsFile = join(bin, "gitleaks-args.txt");
  if (stubGitleaks) {
    writeFileSync(
      join(bin, "gitleaks"),
      `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\nexit ${stubGitleaks.exitCode}\n`,
    );
    chmodSync(join(bin, "gitleaks"), 0o755);
  }
  return { env: { PATH: bin, HOME: process.env.HOME ?? tmpdir() }, argsFile };
}

function stagedRepo(...paths: string[]) {
  const repo = gitSandbox();
  cleanups.push(() => repo.cleanup());
  repo.track("README.md", ...paths);
  return repo;
}

describe("pre-commit hook with gitleaks installed", () => {
  it("blocks the commit when gitleaks reports a finding", () => {
    const { env } = pathWith({ exitCode: 1 });
    const r = stagedRepo().run(HOOK, env);
    expect(r.code).not.toBe(0);
  });

  it("lets the commit through when gitleaks finds nothing", () => {
    const { env } = pathWith({ exitCode: 0 });
    const r = stagedRepo().run(HOOK, env);
    expect(r.code).toBe(0);
  });

  it("scans only the staged changes, with secrets redacted from the output", () => {
    const { env, argsFile } = pathWith({ exitCode: 0 });
    stagedRepo().run(HOOK, env);
    const args = readFileSync(argsFile, "utf8").trim().split("\n");
    expect(args[0]).toBe("git");
    expect(args).toContain("--staged");
    expect(args).toContain("--redact");
    expect(args).toContain("--no-banner");
  });

  it("uses the repo's .gitleaks.toml, not whatever config the working directory offers", () => {
    const { env, argsFile } = pathWith({ exitCode: 0 });
    const repo = stagedRepo();
    repo.run(HOOK, env);
    const args = readFileSync(argsFile, "utf8").trim().split("\n");
    const config = args[args.indexOf("--config") + 1];
    expect(args).toContain("--config");
    // Resolve as gitleaks would: relative to the hook's working directory, the repo being committed to.
    const resolved = config && resolve(repo.dir, config);
    expect(resolved && existsSync(resolved) && realpathSync(resolved)).toBe(realpathSync(join(REPO_ROOT, ".gitleaks.toml")));
  });
});

describe("pre-commit hook without gitleaks", () => {
  it("warns on one line and lets the commit through", () => {
    const { env } = pathWith();
    const r = stagedRepo().run(HOOK, env);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/gitleaks/);
    expect(r.stderr).toMatch(/not (installed|found)/);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
  });
});

describe("pre-commit hook blocks local-only and env files even without gitleaks", () => {
  it.each([".env", "services/agent/.env", "CLAUDE.md", ".scratch/payguard/spec.md", "docs/agents/x.md"])(
    "refuses a staged %s",
    (path) => {
      const { env } = pathWith();
      const r = stagedRepo(path).run(HOOK, env);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain(path);
    },
  );

  it("refuses them before spending time on a gitleaks scan", () => {
    const { env, argsFile } = pathWith({ exitCode: 0 });
    const r = stagedRepo(".env").run(HOOK, env);
    expect(r.code).not.toBe(0);
    expect(existsSync(argsFile)).toBe(false);
  });
});

describe("hook wiring", () => {
  it("ships the hook and the path check as executable files", () => {
    for (const f of [HOOK, join(REPO_ROOT, "scripts", "check-tracked-paths.sh")]) {
      expect(statSync(f).mode & 0o111).not.toBe(0);
    }
  });

  it("points git at .githooks from the root prepare script, without failing outside a git checkout", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    expect(pkg.scripts.prepare).toBe("git config core.hooksPath .githooks || true");
  });
});
