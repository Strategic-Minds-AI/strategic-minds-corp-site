import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
let report;
try { report = JSON.parse(await readFile('benchmark-ci-report.json', 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; report = { kind: 'INDEPENDENT_OFFLINE_CI_ONLY', candidate_sha: process.env.CANDIDATE_SHA, baseline_sha: process.env.BASELINE_SHA, catalog_revision: manifest.catalog_revision, observed_at: new Date().toISOString(), run_id: process.env.GITHUB_RUN_ID, checks: [], total_checks: 236, not_tested: 236, results: manifest.criteria.map(item => ({ criterion_id: item.id, tests: item.tests.map(test => ({ ...test, status: 'NOT_TESTED', evidence: 'Independent assertion execution did not produce evidence.' })) })) }; }
const outcomes = { sandbox_isolation: process.env.ISOLATION_RESULT, immutable_revision_identity: process.env.IDENTITY_RESULT, offline_assertions: process.env.ASSERTIONS_RESULT, frozen_dependency_install: process.env.DEPENDENCIES_RESULT, frontend_compile: process.env.COMPILE_RESULT };
report.ci_passed = Object.values(outcomes).every(value => value === 'success');
report.pipeline_outcomes = outcomes;
report.feature_parity = 0; report.check_coverage = 0; report.release_approved = false;
const text = JSON.stringify(report, null, 2);
await writeFile('benchmark-ci-report.json', text);
console.log(JSON.stringify({ ci_passed: report.ci_passed, report_sha256: createHash('sha256').update(text).digest('hex'), pipeline_outcomes: outcomes, runtime_parity_awarded: 0 }));
if (!report.ci_passed) process.exitCode = 1;
