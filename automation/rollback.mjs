import { execFileSync } from 'node:child_process';
import { mkdtemp, chmod, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { sandbox } from './sandbox.mjs';
const baseline = process.env.BASELINE_SHA;
const candidate = process.env.CANDIDATE_SHA;
assert.ok([baseline, candidate].every(value => /^[a-f0-9]{40}$/.test(value || '')), 'Exact revisions required.');
const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
assert.equal(git('-C', 'trusted', 'rev-parse', 'HEAD'), baseline);
assert.equal(git('-C', 'candidate', 'rev-parse', 'HEAD'), candidate);
git('-C', 'candidate', 'merge-base', '--is-ancestor', baseline, candidate);
const directory = await mkdtemp(path.join(tmpdir(), 'benchmark-rollback-'));
const previous = process.env.CANDIDATE_DIRECTORY;
try {
  git('clone', '--no-hardlinks', '--no-checkout', path.resolve('candidate'), directory);
  git('-C', directory, 'checkout', '--detach', candidate);
  assert.equal(git('-C', directory, 'rev-parse', 'HEAD'), candidate);
  git('-C', directory, 'reset', '--hard', baseline);
  assert.equal(git('-C', directory, 'rev-parse', 'HEAD'), baseline);
  assert.equal(git('-C', directory, 'write-tree'), git('-C', 'trusted', 'rev-parse', 'HEAD^{tree}'));
  assert.equal(git('-C', directory, 'status', '--porcelain', '--untracked-files=all'), '');
  await chmod(directory, 0o755);
  process.env.CANDIDATE_DIRECTORY = directory;
  sandbox(['sh', '-c', 'mkdir -p /work/app && cp -R /input/. /work/app/ && rm -rf /work/app/node_modules && mkdir /work/app/node_modules && for package in /opt/node_modules/* /opt/node_modules/.[!.]*; do if [ -e "$package" ]; then ln -s "$package" /work/app/node_modules/; fi; done && cd /work/app && node /opt/node_modules/vite/bin/vite.js build --outDir /work/dist']);
  const receipt = { kind: 'OFFLINE_SOURCE_ROLLBACK_REHEARSAL_ONLY', baseline_sha: baseline, candidate_sha: candidate, restored_tree: git('-C', directory, 'write-tree'), candidate_had_changes: baseline !== candidate, source_restored: true, restored_frontend_compiled: true, observed_at: new Date().toISOString(), provider_rollback_verified: false, deployed_staging_verified: false, release_approved: false };
  await writeFile('benchmark-rollback-report.json', JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally {
  if (previous === undefined) delete process.env.CANDIDATE_DIRECTORY; else process.env.CANDIDATE_DIRECTORY = previous;
  await rm(directory, { recursive: true, force: true });
}
