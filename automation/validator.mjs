import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(process.env.CANDIDATE_DIRECTORY || '.');
const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
const checks = [];
async function check(name, operation) { try { const actual = await operation(); checks.push({ name, passed: true, expected: 'Assertion completes without error', actual: actual ?? 'Assertions passed' }); } catch (error) { checks.push({ name, passed: false, expected: 'Assertion completes without error', actual: String(error.message).slice(0, 1500) }); } }
const load = file => import(pathToFileURL(path.join(root, file)).href);
await check('Complete catalog and denominator retained', async () => { const { criteria } = await load('base44/shared/benchmarkCriteria.ts'); assert.deepEqual(criteria.map(item => ({ id: item.id, tests: item.tests })), manifest.criteria.map(item => ({ id: item.id, tests: item.tests }))); assert.equal(criteria.length, 59); assert.equal(criteria.flatMap(item => item.tests).length, 236); });
await check('Message validation rejects unknown properties and oversized content', async () => { const { chatMessage, chatKey, pageOffset } = await load('base44/shared/adminChatValidation.ts'); assert.throws(() => chatMessage({ role: 'user', content: 'hello', owner_id: 'other' }, 'user')); assert.throws(() => chatMessage({ role: 'user', content: 'x'.repeat(60001) }, 'user')); assert.throws(() => chatKey('../other')); assert.throws(() => pageOffset(-1)); assert.throws(() => pageOffset(1.5)); assert.equal(pageOffset(0), 0); });
await check('Schema normalization preserves canonical message identity', async () => { const { chatMessage } = await load('base44/shared/adminChatValidation.ts'); assert.deepEqual(chatMessage({ role: 'user', content: 'hello', attachments: null }, 'user'), chatMessage({ role: 'user', content: 'hello' }, 'user')); assert.throws(() => chatMessage({ role: 'assistant', content: 'hello', savedUrl: 'http://unsafe.test' }, 'assistant')); });
await check('Existing scoring and signing controls reject forgery', async () => { const { validatorSelfChecks } = await load('base44/shared/benchmarkSelfChecks.ts'); const result = await validatorSelfChecks('offline-validator-fixture'); assert.equal(result.passed, true); assert.equal(result.feature_parity_awarded, 0); return result.tests.map(test => ({ name: test.name, passed: test.passed })); });
await check('Chat retries, conflicts, completion, deletion and tombstones', async () => {
  const { beginTurn, finishTurn } = await load('base44/shared/adminChatTurns.ts'); const { deleteConversations } = await load('base44/shared/adminChatConversations.ts');
  let sequence = 0; const records = { AdminConversation: [], AdminChatTurn: [] };
  const matches = (row, query) => Object.entries(query).every(([key, value]) => value && typeof value === 'object' ? ('$in' in value ? value.$in.includes(row[key]) : '$lte' in value ? row[key] <= value.$lte : false) : row[key] === value);
  const api = { entities: Object.fromEntries(Object.keys(records).map(name => [name, {
    async filter(query, sort, limit, skip = 0) { return structuredClone(records[name].filter(row => matches(row, query)).slice(skip, skip + limit)); },
    async create(data) { const row = { ...structuredClone(data), id: String(++sequence), created_date: new Date().toISOString() }; records[name].push(row); return structuredClone(row); },
    async update(id, data) { const row = records[name].find(row => row.id === id); Object.assign(row, structuredClone(data)); return structuredClone(row); },
    async updateMany(query, changes) { const rows = records[name].filter(row => matches(row, query)); for (const row of rows) { Object.assign(row, structuredClone(changes.$set || {})); for (const [key, value] of Object.entries(changes.$max || {})) if (!row[key] || row[key] < value) row[key] = value; } return { updated: rows.length, has_more: false }; },
    async deleteMany(query) { records[name] = records[name].filter(row => !matches(row, query)); return { deleted: true }; }
  }])) };
  const input = { chatKey: 'fixture_chat_one', turnKey: 'fixture_turn_one', title: 'Fixture', userMessage: { role: 'user', content: 'hello' } };
  const first = await beginTurn(api, 'owner-one', input); const retry = await beginTurn(api, 'owner-one', input); assert.equal(first.turn.id, retry.turn.id);
  assert.equal((await beginTurn(api, 'owner-one', { ...input, userMessage: { role: 'user', content: 'different' } })).status, 409);
  await finishTurn(api, 'owner-one', { ...input, assistantMessage: { role: 'assistant', content: 'result', savedUrl: 'https://drive.google.com/fixture' } });
  await finishTurn(api, 'owner-one', { ...input, assistantMessage: { role: 'assistant', content: 'result' } });
  assert.equal(records.AdminChatTurn[0].assistant_message.savedUrl, 'https://drive.google.com/fixture');
  assert.equal((await finishTurn(api, 'owner-one', { ...input, assistantMessage: { role: 'assistant', content: 'overwrite' } })).status, 409);
  await finishTurn(api, 'owner-one', input, true); assert.equal(records.AdminChatTurn[0].status, 'complete');
  assert.equal((await finishTurn(api, 'other-owner', input)).status, 409);
  await deleteConversations(api, 'owner-one', input.chatKey); assert.equal(records.AdminChatTurn.length, 0);
  assert.equal((await beginTurn(api, 'owner-one', input)).status, 409); assert.equal((await beginTurn(api, 'owner-one', input, true)).skipped, true);
});
const passed = checks.every(item => item.passed);
const report = { kind: 'INDEPENDENT_OFFLINE_CI_ONLY', candidate_sha: process.env.CANDIDATE_SHA, baseline_sha: process.env.BASELINE_SHA, catalog_revision: manifest.catalog_revision, observed_at: new Date().toISOString(), run_id: process.env.GITHUB_RUN_ID, ci_passed: passed, checks, feature_parity: 0, check_coverage: 0, release_approved: false, total_checks: 236, not_tested: 236, results: manifest.criteria.map(item => ({ criterion_id: item.id, tests: item.tests.map(test => ({ ...test, status: 'NOT_TESTED', evidence: 'No independently trusted deployed-runtime, authorization, resilience or rollback receipt for this acceptance check.' })) })) };
const output = JSON.stringify(report, null, 2); await writeFile('benchmark-ci-report.json', output);
console.log(JSON.stringify({ ci_passed: passed, offline_checks: checks.length, report_sha256: createHash('sha256').update(output).digest('hex'), feature_parity_awarded: 0, release_approved: false }));
if (!passed) process.exitCode = 1;
