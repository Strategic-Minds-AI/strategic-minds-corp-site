import { readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { allowed } from './review-policy.mjs';
const sha = text => createHash('sha256').update(text).digest('hex');
export function validateProposal(raw, baseline, criteria) {
  if (Buffer.byteLength(raw) > 30000) throw new Error('Oversized proposal.');
  const proposal = JSON.parse(raw);
  if (!/^[a-f0-9]{40}$/.test(baseline || '') || proposal.source_sha !== baseline || proposal.status !== 'PROPOSED_NOT_VALIDATED' || proposal.parity_awarded !== 0 || !criteria.some(item => item.id === proposal.criterion_id) || !Array.isArray(proposal.changes) || !proposal.changes.length || proposal.changes.length > 3) throw new Error('Untrusted proposal identity or scope.');
  const paths = new Set();
  for (const change of proposal.changes) {
    if (!allowed(change.path) || paths.has(change.path) || !/^[a-f0-9]{64}$/.test(change.sha256 || '')) throw new Error('Protected, duplicate or invalid patch.');
    paths.add(change.path);
  }
  return proposal;
}
async function materialize() {
  const baseline = process.env.BASELINE_SHA;
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
  if (git('-C', 'trusted', 'rev-parse', 'HEAD') !== baseline) throw new Error('Trusted checkout identity mismatch.');
  const manifest = JSON.parse(await readFile('trusted/automation/manifest.json', 'utf8'));
  const raw = await readFile('draft/automation-proposal.json', 'utf8');
  const proposal = validateProposal(raw, baseline, manifest.criteria);
  const artifactRoot = await realpath('draft');
  const entries = [];
  for (const change of proposal.changes) {
    const file = path.resolve('draft', change.path);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 80000 || !(await realpath(file)).startsWith(artifactRoot + path.sep)) throw new Error('Unsafe artifact file.');
    const content = await readFile(file, 'utf8');
    if (!content.trim() || content.length > 20000 || sha(content) !== change.sha256 || /-----BEGIN .*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20,}|sk_live_[A-Za-z0-9]+/.test(content)) throw new Error('Invalid content or digest.');
    entries.push({ ...change, content });
  }
  git('clone', '--no-hardlinks', '--no-checkout', 'trusted', 'candidate');
  git('-C', 'candidate', '-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', baseline);
  const candidateRoot = await realpath('candidate');
  for (const change of entries) {
    const target = path.resolve('candidate', change.path);
    // Missing parent directories are intentionally rejected: no artifact-controlled symlink traversal.
    if (!(await realpath(path.dirname(target))).startsWith(candidateRoot + path.sep)) throw new Error('Candidate parent escapes checkout.');
    try { if ((await lstat(target)).isSymbolicLink()) throw new Error('Candidate symlink rejected.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeFile(target, change.content);
  }
  git('-C', 'candidate', 'add', '--', ...entries.map(item => item.path));
  git('-C', 'candidate', '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Independent Draft Validator', '-c', 'user.email=validator@localhost', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Local isolated draft qualification; not published');
  const candidate = git('-C', 'candidate', 'rev-parse', 'HEAD');
  if (!/^[a-f0-9]{40}$/.test(candidate)) throw new Error('Invalid local candidate revision.');
  await writeFile(process.env.GITHUB_ENV, 'CANDIDATE_SHA=' + candidate + '\nPROPOSAL_SHA256=' + sha(raw) + '\n', { flag: 'a' });
  console.log(JSON.stringify({ baseline_sha: baseline, candidate_sha: candidate, proposal_sha256: sha(raw), changed_files: entries.map(item => item.path), source_published: false, release_approved: false }));
}
if (process.argv.includes('--self-check')) {
  const baseline = 'a'.repeat(40); const criteria = [{ id: 'agents.context' }];
  const proposal = { source_sha: baseline, status: 'PROPOSED_NOT_VALIDATED', criterion_id: 'agents.context', parity_awarded: 0, changes: [{ path: 'src/components/example.jsx', sha256: 'b'.repeat(64) }] };
  const validate = value => validateProposal(JSON.stringify(value), baseline, criteria);
  assert.equal(validate(proposal).changes.length, 1);
  for (const change of [{ source_sha: 'c'.repeat(40) }, { status: 'PASSED' }, { parity_awarded: 100 }, { criterion_id: 'invented' }, { changes: [] }, { changes: [...proposal.changes, ...proposal.changes] }, { changes: [{ path: 'src/components/../api/client.js', sha256: 'b'.repeat(64) }] }, { changes: [{ path: 'base44/shared/benchmarkProof.ts', sha256: 'b'.repeat(64) }] }, { changes: [{ path: 'src/components/example.jsx', sha256: 'invalid' }] }]) assert.throws(() => validate({ ...proposal, ...change }));
  assert.throws(() => validateProposal(' '.repeat(30001), baseline, criteria));
  console.log('Automatic draft identity, scope, digest and negative controls passed; no release approval.');
}
if (process.argv.includes('--materialize')) await materialize();
