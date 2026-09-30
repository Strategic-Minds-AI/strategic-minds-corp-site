import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { requireReview } from './review-policy.mjs';
const repository = process.env.GITHUB_REPOSITORY;
if (repository !== 'Strategic-Minds-AI/strategic-minds-corp-site') throw new Error('Repository boundary failed.');
const token = process.env.GH_TOKEN;
async function request(route, method = 'GET', body) {
  const response = await fetch('https://api.github.com/repos/' + repository + route, { method, headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error('GitHub publication failed: ' + response.status + ' ' + (data?.message || ''));
  return data;
}
if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || !/^[0-9]+$/.test(process.env.SOURCE_RUN_ID || '')) throw new Error('Manual security-reviewed publication only.');
const proposal = requireReview(await readFile('candidate/automation-proposal.json', 'utf8'), process.env.APPROVED_PROPOSAL_SHA256, process.env.SECURITY_REVIEWED);
const run = await request('/actions/runs/' + process.env.SOURCE_RUN_ID);
if (run.path !== '.github/workflows/benchmark-coding.yml' || run.head_branch !== 'main' || run.conclusion !== 'success') throw new Error('Untrusted or unsuccessful draft run.');
const checkout = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const main = await request('/git/ref/heads/main');
if (main.object.sha !== proposal.source_sha || checkout !== proposal.source_sha) throw new Error('Main changed since draft generation; fresh review and regeneration required.');
for (let page = 1; page <= 20; page++) { const branches = await request('/branches?per_page=100&page=' + page); if (branches.some(item => item.name.startsWith('benchmark/candidate-'))) throw new Error('Existing candidate requires review first.'); if (branches.length < 100) break; if (page === 20) throw new Error('Branch boundary exceeded.'); }
const branch = 'benchmark/candidate-' + process.env.SOURCE_RUN_ID;
const base = await request('/git/commits/' + proposal.source_sha);
const entries = [];
for (const change of proposal.changes) { const file = 'candidate/' + change.path; if (!(await lstat(file)).isFile()) throw new Error('Non-regular artifact rejected.'); const content = await readFile(file, 'utf8'); if (content.length > 20000 || createHash('sha256').update(content).digest('hex') !== change.sha256) throw new Error('Artifact was changed or exceeded its bound.'); entries.push({ path: change.path, mode: '100644', type: 'blob', content }); }
const tree = await request('/git/trees', 'POST', { base_tree: base.tree.sha, tree: entries });
const commit = await request('/git/commits', 'POST', { message: 'benchmark: bounded candidate for ' + proposal.criterion_id, tree: tree.sha, parents: [proposal.source_sha] });
await request('/git/refs', 'POST', { ref: 'refs/heads/' + branch, sha: commit.sha });
await request('/actions/workflows/benchmark-validator.yml/dispatches', 'POST', { ref: 'main', inputs: { candidate_sha: commit.sha, baseline_sha: proposal.source_sha } });
console.log(JSON.stringify({ candidate_sha: commit.sha, review_url: 'https://github.com/' + repository + '/compare/main...' + branch, criterion_id: proposal.criterion_id, source_sha: proposal.source_sha, parity_awarded: 0 }));
