import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { probe } from './sandbox.mjs';
import { allowed, requireReview, sha256 } from './review-policy.mjs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(process.env.CANDIDATE_DIRECTORY || '.');
const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
const checks = [];
async function check(name, operation) { try { const actual = await operation(); checks.push({ name, passed: true, expected: 'Assertion completes without error', actual: actual ?? 'Assertions passed' }); } catch (error) { checks.push({ name, passed: false, expected: 'Assertion completes without error', actual: String(error.message).slice(0, 1500) }); } }
const load = file => {
  if (!['base44/shared/benchmarkCriteria.ts', 'base44/shared/benchmarkSelfChecks.ts'].includes(file)) throw new Error('Candidate code may only run in the isolated container.');
  return import(new URL('../' + file, import.meta.url).href);
};
await check('Exact-content approval rejects missing, forged and changed grants', async () => {
  const raw = JSON.stringify({ source_sha: 'a'.repeat(40), status: 'PROPOSED_NOT_VALIDATED', parity_awarded: 0, changes: [{ path: 'base44/shared/example.ts', sha256: 'b'.repeat(64) }] });
  assert.throws(() => requireReview(raw, sha256(raw), 'false')); assert.throws(() => requireReview(raw, 'c'.repeat(64), 'true')); assert.throws(() => requireReview(raw + ' ', sha256(raw), 'true'));
  assert.equal(requireReview(raw, sha256(raw), 'true').changes.length, 1);
  for (const file of ['base44/shared/benchmarkProof.ts', 'src/pages/Login.jsx', 'src/components/../api/client.js', '.github/workflows/evil.yml']) assert.equal(allowed(file), false);
  const sensitive = raw.replace('base44/shared/example.ts', 'base44/shared/benchmarkProof.ts'); assert.throws(() => requireReview(sensitive, sha256(sensitive), 'true'));
});
await check('Backend modules parse and relative imports resolve', async () => {
  const ts = createRequire(new URL('../package.json', import.meta.url))('typescript');
  async function walk(directory) { const files = []; for (const entry of await readdir(directory, { withFileTypes: true })) { const file = path.join(directory, entry.name); if (entry.isDirectory()) files.push(...await walk(file)); else if (entry.isFile() && file.endsWith('.ts')) files.push(file); } return files; }
  const files = await walk(path.join(root, 'base44')); const failures = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const result = ts.transpileModule(text, { fileName: file, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
    for (const diagnostic of result.diagnostics || []) if (diagnostic.category === ts.DiagnosticCategory.Error) failures.push(path.relative(root, file) + ': ' + ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text.startsWith('.')) {
      const target = path.resolve(path.dirname(file), statement.moduleSpecifier.text); assert.ok(target.startsWith(root + path.sep), 'Import escapes repository');
      try { await readFile(target); } catch { failures.push(path.relative(root, file) + ': unresolved relative import ' + statement.moduleSpecifier.text); }
    }
  }
  assert.deepEqual(failures, []); return { modules_parsed: files.length, runtime_execution_certified: false };
});
await check('Complete catalog and denominator retained', async () => { const { criteria } = await load('base44/shared/benchmarkCriteria.ts'); assert.deepEqual(criteria.map(item => ({ id: item.id, tests: item.tests })), manifest.criteria.map(item => ({ id: item.id, tests: item.tests }))); assert.equal(criteria.length, 59); assert.equal(criteria.flatMap(item => item.tests).length, 236); });
await check('Isolated message validation and canonical normalization', async () => {
  const result = probe('messages');
  for (const key of ['unknown', 'oversized', 'traversal', 'negative', 'fraction', 'unsafe_url']) assert.equal(result[key], true);
  assert.equal(result.zero, 0); assert.deepEqual(result.normalized, result.canonical); assert.equal(result.canonical.content, 'hello');
});
await check('Existing scoring and signing controls reject forgery', async () => { const { validatorSelfChecks } = await load('base44/shared/benchmarkSelfChecks.ts'); const result = await validatorSelfChecks('offline-validator-fixture'); assert.equal(result.passed, true); assert.equal(result.feature_parity_awarded, 0); return result.tests.map(test => ({ name: test.name, passed: test.passed })); });
await check('Isolated chat retries, conflicts, completion, deletion and tombstones', async () => {
  assert.deepEqual(probe('chat'), { same_id: true, conflict: 409, saved: 'https://drive.google.com/fixture', overwrite: 409, status: 'complete', other: 409, remaining: 0, tombstone: 409, skipped: true });
});
const passed = checks.every(item => item.passed);
const report = { kind: 'INDEPENDENT_OFFLINE_CI_ONLY', candidate_sha: process.env.CANDIDATE_SHA, baseline_sha: process.env.BASELINE_SHA, catalog_revision: manifest.catalog_revision, observed_at: new Date().toISOString(), run_id: process.env.GITHUB_RUN_ID, ci_passed: passed, checks, feature_parity: 0, check_coverage: 0, release_approved: false, total_checks: 236, not_tested: 236, results: manifest.criteria.map(item => ({ criterion_id: item.id, tests: item.tests.map(test => ({ ...test, status: 'NOT_TESTED', evidence: 'No independently trusted deployed-runtime, authorization, resilience or rollback receipt for this acceptance check.' })) })) };
const output = JSON.stringify(report, null, 2); await writeFile('benchmark-ci-report.json', output);
console.log(JSON.stringify({ ci_passed: passed, offline_checks: checks.length, report_sha256: createHash('sha256').update(output).digest('hex'), feature_parity_awarded: 0, release_approved: false }));
if (!passed) process.exitCode = 1;
