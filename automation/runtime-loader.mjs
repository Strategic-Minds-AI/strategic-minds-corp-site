export async function resolve(specifier, context, next) {
  if (specifier === 'base44:runtime') return { url: 'data:text/javascript,' + encodeURIComponent("export const secrets = { get(name) { if (name === 'VAULT_BACKUP_ENCRYPTION_KEY') return 'a'.repeat(64); if (name === 'BASE44_APP_ID') return 'offline-ci-fixture-only'; throw new Error('Offline validator has no real secrets.'); } };"), shortCircuit: true };
  return next(specifier, context);
}
