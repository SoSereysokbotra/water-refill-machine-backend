import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';

describe('Architecture Boundary Rules (dependency-cruiser)', () => {
  it('validates that current src files have zero boundary violations', () => {
    const cwd = path.resolve(__dirname, '..');
    const output = execSync('npx depcruise src --config .dependency-cruiser.cjs', {
      cwd,
      encoding: 'utf-8',
    });
    expect(output).toContain('no dependency violations found');
  });

  it('detects deliberate cross-layer import violation and exits with error', () => {
    const cwd = path.resolve(__dirname, '..');
    let errorOutput = '';
    try {
      execSync(
        'npx depcruise test/fixtures/illegal-boundary --config test/fixtures/illegal-boundary/.dependency-cruiser.cjs',
        { cwd, encoding: 'utf-8', stdio: 'pipe' },
      );
    } catch (err: unknown) {
      const execError = err as { stdout?: string; stderr?: string; status?: number };
      errorOutput = (execError.stdout ?? '') + (execError.stderr ?? '');
      expect(execError.status).toBe(1);
    }

    expect(errorOutput).toContain('domain-cannot-import-infrastructure');
    expect(errorOutput).toContain('dependency violations (1 errors');
  });
});
