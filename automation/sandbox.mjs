import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const image = 'node:22.18.0-bookworm-slim@sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e';
const tools = path.dirname(fileURLToPath(import.meta.url));
export function sandbox(command, extra = []) {
  return execFileSync('docker', ['run', '--rm', '--pull=never', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=65534:65534', '--pids-limit=128', '--memory=3g', '--cpus=2', '--tmpfs=/work:rw,nosuid,nodev,size=1073741824,mode=1777', '--tmpfs=/tmp:rw,nosuid,nodev,size=67108864,mode=1777', '--mount', 'type=bind,src=' + path.resolve(process.env.CANDIDATE_DIRECTORY || 'candidate') + ',dst=/input,readonly', '--mount', 'type=bind,src=' + tools + ',dst=/trusted,readonly', '--mount', 'type=bind,src=' + path.resolve(tools, '../node_modules') + ',dst=/deps,readonly', '--workdir=/work', image, ...extra, ...command], { encoding: 'utf8', timeout: 240000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
export function probe(name) { return JSON.parse(sandbox(['node', '--experimental-strip-types', '--loader', '/trusted/runtime-loader.mjs', '/trusted/probe.mjs', name])); }
if (process.argv.includes('--isolation-check')) {
  const result = probe('isolation');
  if (!result.trusted_read_only || !result.source_read_only || !result.network_blocked || !result.credentials_absent || !result.socket_absent || !result.report_absent) throw new Error('Sandbox isolation checks failed.');
  console.log('Read-only mounts, network denial, absent credentials/socket/report verified.');
}
if (process.argv.includes('--compile')) {
  sandbox(['sh', '-c', 'mkdir -p /work/app && cp -R /input/. /work/app/ && rm -rf /work/app/node_modules && ln -s /deps /work/app/node_modules && cd /work/app && node /deps/vite/bin/vite.js build --outDir /work/dist']);
  console.log('Candidate frontend compiled in a network-disabled container.');
}
