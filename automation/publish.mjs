import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const repository = process.env.GITHUB_REPOSITORY;
if (repository !== 'Strategic-Minds-AI/strategic-minds-corp-site') throw new Error('Repository boundary failed.');
const token = process.env.GH_TOKEN;
async function request(route, method = 'GET', body) {
  const response = await fetch('https://api.github.com/repos/' + repository + route, { method, headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error('GitHub publication failed: ' + response.status + ' ' + (data?.message || ''));
  return data;
}
const proposal = JSON.parse(await readFile('candidate/automation-proposal.json', 'utf8'));
if (!/^[a-f0-9]{40}$/.test(proposal.source_sha) || proposal.status !== 'PROPOSED_NOT_VALIDATED' || proposal.parity_awarded !== 0 || !Array.isArray(proposal.changes) || !proposal.changes.length || proposal.changes.length > 3) throw new Error('Invalid proposal.');
const allowed = file => /^(src\/(components|pages)\/|base44\/(shared|functions)\/)[A-Za-z0-9_./-]+\.(jsx?|tsx?)$/.test(file) && !file.split('/').includes('..') && !/(^|\/)(automation|\.github|entities|agents|workflows|connectors|api|lib)(\/|$)|benchmark|vault|Auth|Login|Register|Password|ProtectedRoute|package|lock|\.env/i.test(file);
const branch = 'benchmark/candidate-' + process.env.GITHUB_RUN_ID;
const base = await request('/git/commits/' + proposal.source_sha);
const entries = [];
for (const change of proposal.changes) { if (!allowed(change.path)) throw new Error('Protected source mutation rejected.'); const content = await readFile('candidate/' + change.path, 'utf8'); if (createHash('sha256').update(content).digest('hex') !== change.sha256) throw new Error('Artifact was changed.'); entries.push({ path: change.path, mode: '100644', type: 'blob', content }); }
const tree = await request('/git/trees', 'POST', { base_tree: base.tree.sha, tree: entries });
const commit = await request('/git/commits', 'POST', { message: 'benchmark: bounded candidate for ' + proposal.criterion_id, tree: tree.sha, parents: [proposal.source_sha] });
await request('/git/refs', 'POST', { ref: 'refs/heads/' + branch, sha: commit.sha });
const pull = await request('/pulls', 'POST', { title: 'Benchmark candidate: ' + proposal.criterion_id, head: branch, base: 'main', draft: true, body: 'Untrusted local-model proposal. No merge, deployment, outbound action or benchmark pass is approved.\n\n' + proposal.summary + '\n\nSource revision: ' + proposal.source_sha + '\nRollback: close this draft and delete its branch; production is unchanged.\nIndependent CI must evaluate this exact candidate. Full runtime evidence remains pending.' });
await request('/actions/workflows/benchmark-validator.yml/dispatches', 'POST', { ref: 'main', inputs: { candidate_sha: commit.sha, baseline_sha: proposal.source_sha } });
console.log(JSON.stringify({ candidate_sha: commit.sha, pull_request: pull.html_url, parity_awarded: 0 }));
