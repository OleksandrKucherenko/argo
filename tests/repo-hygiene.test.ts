import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function trackedVideos(): string {
  return execSync('git ls-files -- videos/', { cwd: repoRoot, encoding: 'utf8' }).trim();
}

describe('repository hygiene', () => {
  // New demo features must not force-add recordings: `.gitignore` covers
  // videos/*.mp4, and a tracked video rides in every clone forever. Main
  // still carries a few legacy showcase videos, so the guard is scoped to
  // this feature; link a GitHub attachment from the docs instead.
  it('keeps the pseudo-cursor demo recording out of git', () => {
    expect(trackedVideos()).not.toContain('pseudo-cursor');
  });

  it('links the demo recording externally instead of from inside the repo', () => {
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
    expect(readme).not.toMatch(/\]\((?:\.{0,2}\/)?videos\//);
  });
});
