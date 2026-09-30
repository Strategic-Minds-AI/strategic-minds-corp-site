import { writeFile, access } from 'node:fs/promises';
const load = file => import('file:///input/base44/shared/' + file + '.ts');
const rejected = async operation => { try { await operation(); return false; } catch { return true; } };
const name = process.argv[2]; let result;
if (name === 'isolation') {
  result = { trusted_read_only: await rejected(() => writeFile('/trusted/.write-probe', 'denied')), source_read_only: await rejected(() => writeFile('/input/.write-probe', 'denied')), network_blocked: await rejected(() => fetch('https://example.com', { signal: AbortSignal.timeout(2000) })), credentials_absent: !Object.keys(process.env).some(key => /TOKEN|SECRET|GITHUB|ACTIONS_|BASE44|AI_GATEWAY/.test(key)), socket_absent: await rejected(() => access('/var/run/docker.sock')), report_absent: await rejected(() => access('/benchmark-ci-report.json')) };
} else if (name === 'messages') {
  const { chatMessage, chatKey, pageOffset } = await load('adminChatValidation');
  result = { unknown: await rejected(() => chatMessage({ role: 'user', content: 'hello', owner_id: 'other' }, 'user')), oversized: await rejected(() => chatMessage({ role: 'user', content: 'x'.repeat(60001) }, 'user')), traversal: await rejected(() => chatKey('../other')), negative: await rejected(() => pageOffset(-1)), fraction: await rejected(() => pageOffset(1.5)), zero: pageOffset(0), normalized: chatMessage({ role: 'user', content: 'hello', attachments: null }, 'user'), canonical: chatMessage({ role: 'user', content: 'hello' }, 'user'), unsafe_url: await rejected(() => chatMessage({ role: 'assistant', content: 'hello', savedUrl: 'http://unsafe.test' }, 'assistant')) };
} else if (name === 'chat') {
  const { beginTurn, finishTurn } = await load('adminChatTurns'); const { deleteConversations } = await load('adminChatConversations');
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
  const first = await beginTurn(api, 'owner-one', input); const retry = await beginTurn(api, 'owner-one', input);
  const conflict = await beginTurn(api, 'owner-one', { ...input, userMessage: { role: 'user', content: 'different' } });
  await finishTurn(api, 'owner-one', { ...input, assistantMessage: { role: 'assistant', content: 'result', savedUrl: 'https://drive.google.com/fixture' } });
  await finishTurn(api, 'owner-one', { ...input, assistantMessage: { role: 'assistant', content: 'result' } });
  const saved = records.AdminChatTurn[0].assistant_message.savedUrl;
  const overwrite = await finishTurn(api, 'owner-one', { ...input, assistantMessage: { role: 'assistant', content: 'overwrite' } });
  await finishTurn(api, 'owner-one', input, true); const status = records.AdminChatTurn[0].status;
  const other = await finishTurn(api, 'other-owner', input);
  await deleteConversations(api, 'owner-one', input.chatKey);
  result = { same_id: first.turn.id === retry.turn.id, conflict: conflict.status, saved, overwrite: overwrite.status, status, other: other.status, remaining: records.AdminChatTurn.length, tombstone: (await beginTurn(api, 'owner-one', input)).status, skipped: (await beginTurn(api, 'owner-one', input, true)).skipped };
} else { throw new Error('Unknown trusted probe.'); }
process.stdout.write(JSON.stringify(result));
