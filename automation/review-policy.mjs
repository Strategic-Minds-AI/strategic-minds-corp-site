import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function allowed(file) { return typeof file === 'string' && /^(src\/(components|pages)\/|base44\/(shared|functions)\/)[A-Za-z0-9_./-]+\.(jsx?|tsx?)$/.test(file) && !file.split('/').some(part => part === '..' || part === '.' || part === '') && !/(^|\/)(automation|\.github|entities|agents|workflows|connectors|api|lib)(\/|$)|benchmark|vault|Auth|Login|Register|Password|ProtectedRoute|package|lock|\.env/i.test(file); }
export function requireReview(raw, expected, acknowledged) {
  if (acknowledged !== 'true' || !/^[a-f0-9]{64}$/.test(expected || '') || sha256(raw) !== expected) throw new Error('Exact-content security review approval required; no publication permitted.');
  const proposal = JSON.parse(raw);
  if (!/^[a-f0-9]{40}$/.test(proposal.source_sha) || proposal.status !== 'PROPOSED_NOT_VALIDATED' || proposal.parity_awarded !== 0 || !Array.isArray(proposal.changes) || !proposal.changes.length || proposal.changes.length > 3) throw new Error('Invalid reviewed proposal.');
  const paths = new Set();
  for (const change of proposal.changes) { if (!allowed(change.path) || paths.has(change.path) || !/^[a-f0-9]{64}$/.test(change.sha256 || '')) throw new Error('Protected, duplicate or invalid change.'); paths.add(change.path); }
  return proposal;
}
if (process.argv.includes('--verify-diff')) {
  const { BASELINE_SHA: baseline, CANDIDATE_SHA: candidate } = process.env;
  if (![baseline, candidate].every(value => /^[a-f0-9]{40}$/.test(value || ''))) throw new Error('Full immutable revisions required.');
  const git = (directory, ...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim();
  if (git('trusted', 'rev-parse', 'HEAD') !== baseline || git('candidate', 'rev-parse', 'HEAD') !== candidate) throw new Error('Revision identity mismatch.');
  git('candidate', 'merge-base', '--is-ancestor', baseline, candidate);
  if (baseline !== candidate) {
    const names = git('candidate', 'diff', '--name-only', '-z', baseline, candidate).split('\0').filter(Boolean);
    if (!names.length || names.length > 3 || names.some(file => !allowed(file))) throw new Error('Change exceeds reviewed source scope.');
    for (const file of names) if (!git('candidate', 'ls-tree', candidate, '--', file).startsWith('100644 blob ')) throw new Error('Deletion or non-regular source rejected.');
  }
}
