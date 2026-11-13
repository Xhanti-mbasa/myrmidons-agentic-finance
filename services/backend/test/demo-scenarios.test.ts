import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
it('runs the public scenario command against isolated HTTP services without a model or ledger', () => {
  const output = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/demo-scenarios.ts'], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)), timeout: 30000, encoding: 'utf8',
  });
  expect(output).toContain('12 scenarios passed. SIMULATION only; zero blockchain funds moved.');
  expect(output.match(/^PASS /gm)).toHaveLength(12);
}, 35000);
