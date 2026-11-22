#!/usr/bin/env node
// Pulls Halo MCC service records + recent matches for every gamertag in config.json
// and merges new matches into data/matches/<player>.json so history keeps growing
// past the ~100 matches the Halo API remembers.
//
// Env:
//   AZURE_CLIENT_ID       your Azure app's Application (client) ID
//   XBOX_REFRESH_TOKEN    refresh token from `node scripts/login.mjs`
//   NEW_REFRESH_TOKEN_FILE  (optional) where to write the rotated refresh token
//   SPARTAN_TOKEN         (optional, testing) skip sign-in and use this token directly

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refreshMicrosoftToken, getSpartanToken, MccClient, matchKey } from './lib/halo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'data');
const MAX_PAGES = 10; // safety cap per player per run

export const slugify = (gt) => gt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function getToken() {
  if (process.env.SPARTAN_TOKEN) return { spartanToken: process.env.SPARTAN_TOKEN, signedInAs: null };
  const clientId = process.env.AZURE_CLIENT_ID;
  const refreshToken = process.env.XBOX_REFRESH_TOKEN;
  if (!clientId || !refreshToken) {
    throw new Error('Missing AZURE_CLIENT_ID or XBOX_REFRESH_TOKEN. See README.md, step 3.');
  }
  const ms = await refreshMicrosoftToken(clientId, refreshToken);
  if (ms.refresh_token && process.env.NEW_REFRESH_TOKEN_FILE) {
    await writeFile(process.env.NEW_REFRESH_TOKEN_FILE, ms.refresh_token, { mode: 0o600 });
  }
  return getSpartanToken(ms.access_token);
}

async function updatePlayer(client, gamertag, pageSize) {
  const slug = slugify(gamertag);
  const file = join(DATA_DIR, 'matches', `${slug}.json`);
  const store = await readJson(file, { gamertag, matches: [] });
  const known = new Set(store.matches.map(matchKey));
  const hadHistory = known.size > 0;

  const serviceRecord = await client.serviceRecord(gamertag);

  let added = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await client.matchesPage(gamertag, page, pageSize);
    const matches = Array.isArray(body?.matches) ? body.matches : [];
    let newOnPage = 0;
    for (const m of matches) {
      const key = matchKey(m);
      if (known.has(key)) continue;
      known.add(key);
      store.matches.push(m);
      newOnPage++;
    }
    added += newOnPage;
    const maxPage = Number(body?.maxPage) || 1;
    // Once we hit a page with nothing new, everything older is already saved.
    if (page >= maxPage || matches.length === 0 || (hadHistory && newOnPage === 0)) break;
  }

  store.gamertag = gamertag;
  store.matches.sort((a, b) => String(b.datePlayed).localeCompare(String(a.datePlayed)));
  await writeFile(file, JSON.stringify(store, null, 1));
  return { slug, serviceRecord, added, total: store.matches.length };
}

async function main() {
  const config = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'));
  await mkdir(join(DATA_DIR, 'matches'), { recursive: true });

  const { spartanToken, signedInAs } = await getToken();
  if (signedInAs) console.log(`Signed in to Halo Waypoint as ${signedInAs}`);
  const client = new MccClient(spartanToken);

  const summaryPath = join(DATA_DIR, 'summary.json');
  const previous = await readJson(summaryPath, { players: [] });
  const players = [];
  let failures = 0;

  for (const gamertag of config.players) {
    const prev = previous.players.find((p) => p.gamertag === gamertag) || {};
    try {
      const r = await updatePlayer(client, gamertag, config.pageSize || 20);
      console.log(`✓ ${gamertag}: +${r.added} new matches (${r.total} saved)`);
      players.push({ gamertag, slug: r.slug, serviceRecord: r.serviceRecord, matchCount: r.total, lastUpdated: new Date().toISOString(), error: null });
    } catch (err) {
      failures++;
      console.error(`✗ ${gamertag}: ${err.message}`);
      // Keep the last good service record so the dashboard doesn't go blank.
      players.push({ ...prev, gamertag, slug: slugify(gamertag), error: err.message });
    }
  }

  await writeFile(summaryPath, JSON.stringify({ title: config.title, updatedAt: new Date().toISOString(), players }, null, 1));
  if (failures === config.players.length) {
    console.error('Every player failed. If they all say "Not authorized", the sign-in token was rejected: run `node scripts/login.mjs` again and update the XBOX_REFRESH_TOKEN secret.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
