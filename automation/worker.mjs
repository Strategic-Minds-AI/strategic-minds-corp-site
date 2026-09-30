import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const sha = value => createHash('sha256').update(value).digest('hex');
const protectedPath = file => /(^|\/)(automation|\.github|entities|agents|workflows|connectors|api|lib)(\/|$)/.test(file) || /benchmark|vault|Auth|Login|Register|Password|ProtectedRoute|package|lock|\.env/i.test(file);
export function allowed(file) { return typeof file === 'string' && /^(src\/(components|pages)\/|base44\/(shared|functions)\/)[A-Za-z0-9_./-]+\.(jsx?|tsx?)$/.test(file) && !file.split('/').includes('..') && !protectedPath(file); }
async function filesAt(dir) { const result = []; for (const item of await readdir(dir, { withFileTypes: true })) { const file = dir + '/' + item.name; if (item.isDirectory()) result.push(...await filesAt(file)); else if (item.isFile() && allowed(file)) result.push(file); } return result; }
async function generate() {
  const manifest = JSON.parse(await readFile('automation/manifest.json', 'utf8'));
  const criterion = manifest.criteria.find(item => item.id === process.env.CRITERION_ID);
  if (!criterion) throw new Error('Select a real benchmark criterion.');
  const all = (await filesAt('base44')).concat(await filesAt('src/components'), await filesAt('src/pages')).sort();
  const hints = criterion.id === 'agents.context' ? ['adminAssistant','useAdminChatSender','adminChatActions','AdminChatWorkspace'] : criterion.id.split('.').concat([criterion.domain]);
  const relevant = all.filter(file => hints.some(hint => file.toLowerCase().includes(hint.toLowerCase()))).slice(0, 6);
  if (!relevant.length) throw new Error('No scoped source context found; stop rather than guessing.');
  const context = []; let bytes = 0;
  for (const file of relevant) { const content = await readFile(file, 'utf8'); if (bytes + content.length > 24000) break; context.push({ path: file, sha256: sha(content), content }); bytes += content.length; }
  if (!context.length) throw new Error('Source context exceeds the bounded worker window.');
  const tagsResponse = await fetch('http://127.0.0.1:11434/api/tags');
  if (!tagsResponse.ok) throw new Error('Cannot verify local model identity.');
  const tags = await tagsResponse.json(); const localModel = tags.models?.find(item => item.name === 'qwen2.5-coder:1.5b');
  if (localModel?.digest?.replace(/^sha256:/, '') !== 'd7372fd828518a4d38b1eb196c673c31a85f2ed302b3d1e406c4c2d1b64a0668') throw new Error('Model digest changed; no candidate generated.');
  const response = await fetch('http://127.0.0.1:11434/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'qwen2.5-coder:1.5b', stream: false, format: 'json', options: { temperature: 0, seed: 71, num_ctx: 8192, num_predict: 3000, num_thread: 2 }, prompt: 'You are a bounded coding worker. Implement ONE small coherent part of this implementation brief. Never edit protected auth, security, approval, benchmark, test, automation or credential files. Preserve working functionality and imports. Return JSON only: {"summary":"...","changes":[{"path":"exact source path","before_sha256":"provided digest or NEW for new files","content":"complete file text"}],"blockers":[]}. At most 3 files and 20000 output characters. Do not invent tests, results, credentials or connectivity. If blocked return empty changes and explain the blocker. New files need to be imported by an existing changed source.\nBRIEF:\n' + criterion.prompt + '\nSOURCE:\n' + JSON.stringify(context) }), signal: AbortSignal.timeout(480000) });
  if (!response.ok) throw new Error('Local model request failed.');
  const model = await response.json();
  if (model.done !== true || model.done_reason === 'length') throw new Error('Incomplete model output is not a patch.');
  const proposal = JSON.parse(model.response);
  if (!Array.isArray(proposal.changes) || proposal.changes.length > 3 || JSON.stringify(proposal).length > 30000) throw new Error('Patch exceeded its bound.');
  const known = new Map(context.map(item => [item.path, item])); const seen = new Set(); const staged = [];
  for (const change of proposal.changes) {
    if (!allowed(change.path) || seen.has(change.path) || typeof change.content !== 'string' || !change.content.trim() || change.content.length > 20000) throw new Error('Unsafe patch target or invalid content.');
    if (/-----BEGIN .*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20,}|sk_live_[A-Za-z0-9]+/.test(change.content)) throw new Error('Credential-like content rejected.');
    seen.add(change.path);
    const prior = known.get(change.path);
    if (prior) { if (change.before_sha256 !== prior.sha256 || sha(await readFile(change.path, 'utf8')) !== prior.sha256) throw new Error('Source precondition changed.'); }
    else { if (change.before_sha256 !== 'NEW' || all.includes(change.path)) throw new Error('Worker did not inspect this existing source.'); try { await readFile(change.path); throw new Error('New-file target already exists.'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    staged.push(change);
  }
  if (!staged.length) { await writeFile('automation-proposal.json', JSON.stringify({ status: 'BLOCKED', criterion_id: criterion.id, blockers: proposal.blockers || ['No bounded implementation produced.'], parity_awarded: 0 }, null, 2)); throw new Error('No implementation produced; no success awarded.'); }
  for (const change of staged) { await mkdir(path.dirname(change.path), { recursive: true }); await writeFile(change.path, change.content); }
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile('automation-proposal.json', JSON.stringify({ status: 'PROPOSED_NOT_VALIDATED', criterion_id: criterion.id, source_sha: source, model_digest: localModel.digest, summary: String(proposal.summary || 'Bounded candidate change').slice(0, 1000), changes: staged.map(item => ({ path: item.path, sha256: sha(item.content) })), blockers: proposal.blockers || [], parity_awarded: 0 }, null, 2));
}
if (process.argv.includes('--run')) await generate();
