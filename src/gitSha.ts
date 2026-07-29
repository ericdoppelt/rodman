import { execSync } from 'child_process';

/**
 * GitHub Actions sets GITHUB_SHA; falls back to reading the local git HEAD for manual runs.
 */
export function getGitSha(): string | undefined {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync('git rev-parse HEAD').toString().trim();
  } catch {
    return undefined;
  }
}
