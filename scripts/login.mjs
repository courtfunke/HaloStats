#!/usr/bin/env node
// One-time sign-in. Run on your own computer:
//
//   node scripts/login.mjs <AZURE_CLIENT_ID>
//
// It shows a code to enter at microsoft.com/link, checks that Halo Waypoint
// accepts the sign-in, then saves a refresh token to .refresh-token.txt
// (git-ignored). Paste that into the XBOX_REFRESH_TOKEN repository secret,
// or add --set-secrets to have the GitHub CLI (gh) set both secrets for you.

import { writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDeviceCode, pollDeviceCode, getSpartanToken, MccClient } from './lib/halo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const setSecrets = args.includes('--set-secrets');
const clientId = args.find((a) => !a.startsWith('--')) || process.env.AZURE_CLIENT_ID;

if (!clientId) {
  console.error('Usage: node scripts/login.mjs <AZURE_CLIENT_ID> [--set-secrets]');
  process.exit(1);
}

function setSecret(name, value) {
  const r = spawnSync('gh', ['secret', 'set', name], { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`gh secret set ${name} failed. Is the GitHub CLI installed and logged in (gh auth login)?`);
}

try {
  const code = await startDeviceCode(clientId);
  console.log(`\n  1. Open ${code.verification_uri}`);
  console.log(`  2. Enter the code: ${code.user_code}`);
  console.log('  3. Sign in with the Microsoft account you use on Xbox.\n');
  console.log('Waiting for you to finish signing in...');

  const tokens = await pollDeviceCode(clientId, code);
  console.log('✓ Microsoft sign-in complete');

  const { spartanToken, signedInAs } = await getSpartanToken(tokens.access_token);
  console.log(`✓ Halo Waypoint accepted the sign-in${signedInAs ? ` (${signedInAs})` : ''}`);

  // Quick end-to-end check against the first player in config.json.
  const config = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'));
  const first = config.players[0];
  try {
    const sr = await new MccClient(spartanToken, { delayMs: 0 }).serviceRecord(first);
    const mp = sr?.multiplayer || {};
    console.log(`✓ Pulled MCC stats for ${first}${mp.gamesPlayed != null ? `: ${mp.gamesPlayed} games, ${mp.kills ?? '?'} kills` : ''}`);
  } catch (e) {
    console.warn(`! Signed in fine, but couldn't read ${first}'s stats: ${e.message}`);
  }

  if (setSecrets) {
    setSecret('AZURE_CLIENT_ID', clientId);
    setSecret('XBOX_REFRESH_TOKEN', tokens.refresh_token);
    console.log('✓ Saved AZURE_CLIENT_ID and XBOX_REFRESH_TOKEN as GitHub repository secrets');
  } else {
    const file = join(ROOT, '.refresh-token.txt');
    await writeFile(file, tokens.refresh_token, { mode: 0o600 });
    console.log(`\nSaved your refresh token to ${file}`);
    console.log('Copy its contents into a repository secret named XBOX_REFRESH_TOKEN, then delete the file.');
  }
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
}
