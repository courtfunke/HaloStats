/* Fireteam Stats dashboard — reads data/summary.json + data/matches/*.json (written by the GitHub Action). */
(() => {
  'use strict';

  const DEMO = new URLSearchParams(location.search).has('demo');
  const DATA = DEMO ? 'demo' : 'data';

  // Fixed per-player colors (validated categorical palette, dark mode). Color follows the
  // player by their position in config.json, never their rank.
  const COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];

  const TITLES = {
    HaloCEA: 'Halo: CE', HaloCE: 'Halo: CE', Halo1: 'Halo: CE',
    Halo2: 'Halo 2', Halo2Anniversary: 'Halo 2: Anniv.', Halo2A: 'Halo 2: Anniv.',
    Halo3: 'Halo 3', Halo3ODST: 'ODST', HaloODST: 'ODST',
    HaloReach: 'Reach', Halo4: 'Halo 4', Halo5Forge: 'Halo 5 Forge',
  };
  const TITLE_ORDER = ['Halo: CE', 'Halo 2', 'Halo 2: Anniv.', 'Halo 3', 'ODST', 'Reach', 'Halo 4'];
  const titleName = (id) => TITLES[id] || id || 'Unknown';

  const RANGES = [
    { id: '7', label: '7 days', days: 7 },
    { id: '30', label: '30 days', days: 30 },
    { id: '90', label: '90 days', days: 90 },
    { id: 'all', label: 'All tracked', days: null },
  ];

  const state = { title: 'all', range: 'all', sort: { key: 'kd', dir: -1 }, feedLimit: 15 };
  let players = [];   // [{gamertag, color, serviceRecord, error, ...}]
  let matches = [];   // flattened
  let charts = {};

  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => (Number.isFinite(+v) ? +v : 0);
  const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
  const ratio = (a, b) => (b > 0 ? a / b : a > 0 ? a : NaN);
  const pct = (a, b) => (b > 0 ? (100 * a) / b : NaN);

  function readPref() {
    try { Object.assign(state, JSON.parse(localStorage.getItem('fireteam-filters') || '{}')); } catch { /* ignore */ }
  }
  function savePref() {
    try { localStorage.setItem('fireteam-filters', JSON.stringify({ title: state.title, range: state.range })); } catch { /* ignore */ }
  }

  async function getJson(path) {
    const res = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }

  async function load() {
    let summary;
    try { summary = await getJson(`${DATA}/summary.json`); } catch { summary = null; }
    if (!summary || !summary.players?.length) return renderEmpty();

    if (summary.title) { $('#title').textContent = summary.title; document.title = summary.title; }
    $('#updated').innerHTML = `${summary.updatedAt ? `Updated ${timeAgo(Date.parse(summary.updatedAt))}` : ''}${DEMO ? '<span class="demo-pill">Demo data</span>' : ''}`;

    players = summary.players.map((p, i) => ({ ...p, color: COLORS[i % COLORS.length], index: i }));
    const files = await Promise.all(players.map((p) => getJson(`${DATA}/matches/${p.slug}.json`).catch(() => ({ matches: [] }))));
    matches = [];
    files.forEach((f, i) => {
      for (const m of f.matches || []) {
        const t = Date.parse(m.datePlayed);
        if (!Number.isFinite(t)) continue;
        matches.push({
          player: players[i].gamertag, p: players[i], t,
          title: titleName(m.haloTitleId), won: !!m.won,
          kills: num(m.kills), deaths: num(m.deaths), assists: num(m.assists),
          headshots: num(m.headshots), medals: num(m.medals), score: num(m.score),
          dur: num(m.durationSeconds),
          map: m.mapName || m.map || m.MapName || null,
          mode: m.gameVariantName || m.gameVariant || m.gameType || m.playlistName || null,
        });
      }
    });
    matches.sort((a, b) => a.t - b.t);
    if (!matches.length && players.every((p) => !p.serviceRecord)) return renderEmpty(players.find((p) => p.error)?.error);
    render();
  }

  // ---------- derived data ----------

  function nowRef() {
    return DEMO && matches.length ? matches[matches.length - 1].t : Date.now();
  }

  function filtered() {
    const r = RANGES.find((x) => x.id === state.range);
    const since = r?.days ? nowRef() - r.days * 86400000 : -Infinity;
    return matches.filter((m) => m.t >= since && (state.title === 'all' || m.title === state.title));
  }

  function aggregate(list) {
    const by = new Map(players.map((p) => [p.gamertag, []]));
    list.forEach((m) => by.get(m.player)?.push(m));
    return players.map((p) => {
      const ms = by.get(p.gamertag);
      const s = (f) => ms.reduce((a, m) => a + m[f], 0);
      const games = ms.length, wins = ms.filter((m) => m.won).length;
      const kills = s('kills'), deaths = s('deaths'), assists = s('assists');
      // current streak = most recent run of identical results
      let streak = 0, streakWin = null;
      for (let i = ms.length - 1; i >= 0; i--) {
        if (streakWin === null) streakWin = ms[i].won;
        if (ms[i].won !== streakWin) break;
        streak++;
      }
      return {
        p, games, wins,
        winPct: pct(wins, games),
        kd: ratio(kills, deaths),
        kda: ratio(kills + assists, deaths),
        kpg: games ? kills / games : NaN,
        dpg: games ? deaths / games : NaN,
        hspg: games ? s('headshots') / games : NaN,
        best: games ? Math.max(...ms.map((m) => m.kills)) : NaN,
        streak, streakWin,
      };
    });
  }

  // Matches where several of us were in the same game: same title + same length, start within 2 minutes.
  function groupMatches(list) {
    const groups = [];
    for (const m of list) {
      let g = null;
      for (let i = groups.length - 1; i >= 0 && m.t - groups[i].t <= 120000; i--) {
        const c = groups[i];
        if (c.title === m.title && c.dur === m.dur && !c.members.some((x) => x.player === m.player)) { g = c; break; }
      }
      if (g) g.members.push(m);
      else groups.push({ t: m.t, title: m.title, dur: m.dur, members: [m] });
    }
    return groups;
  }

  // ---------- rendering ----------

  function render() {
    const list = filtered();
    const titlesPresent = TITLE_ORDER.filter((t) => matches.some((m) => m.title === t))
      .concat([...new Set(matches.map((m) => m.title))].filter((t) => !TITLE_ORDER.includes(t)));
    if (state.title !== 'all' && !titlesPresent.includes(state.title)) state.title = 'all';

    $('#app').innerHTML = `
      <div class="filters" role="toolbar" aria-label="Filters">
        <div class="filter-group"><span class="filter-label">Game</span>
          <div class="chips" id="f-title">
            ${['all', ...titlesPresent].map((t) => `<button class="chip" data-v="${esc(t)}" aria-pressed="${state.title === t}">${t === 'all' ? 'All' : esc(t)}</button>`).join('')}
          </div>
        </div>
        <div class="filter-group"><span class="filter-label">Range</span>
          <div class="chips" id="f-range">
            ${RANGES.map((r) => `<button class="chip" data-v="${r.id}" aria-pressed="${state.range === r.id}">${r.label}</button>`).join('')}
          </div>
        </div>
      </div>

      <section>
        <h2>Service records</h2>
        <p class="sub">Lifetime MCC multiplayer totals from Halo Waypoint, plus how many matches this site has saved.</p>
        <div class="players">${players.map(playerCard).join('')}</div>
      </section>

      <section>
        <h2>Leaderboard</h2>
        <p class="sub">${list.length ? `From ${fmt(list.length)} saved player-games${state.title !== 'all' ? ` in ${esc(state.title)}` : ''}${state.range !== 'all' ? `, last ${RANGES.find((r) => r.id === state.range).label}` : ''}. Click a column to sort.` : 'No matches for these filters yet.'}</p>
        <div class="card table-wrap">${leaderboard(list)}</div>
      </section>

      <section class="grid-2">
        <div>
          <h2>K/D trend</h2>
          <p class="sub">Rolling K/D over each player's last 10 games.</p>
          <div class="card chart-card">
            <ul class="chart-legend">${players.map((p) => `<li><span class="dot" style="--c:${p.color}"></span>${esc(p.gamertag)}</li>`).join('')}</ul>
            <div class="chart-box"><canvas id="kd-chart" aria-label="Rolling K/D over time per player" role="img"></canvas></div>
          </div>
        </div>
        <div>
          <h2>Best Halo</h2>
          <p class="sub">K/D in each game. Darker = higher K/D; small number = games played.</p>
          <div class="card table-wrap">${heatGrid(state.title === 'all' ? list : filteredNoTitle(), titlesPresent)}</div>
        </div>
      </section>

      <section>
        <h2>Squad</h2>
        <p class="sub">Matches two of you played together and the win rate when you did. Matched up by start time and game length, so it's an estimate.</p>
        <div class="card table-wrap">${squadMatrix(list)}</div>
      </section>

      <section>
        <h2>Recent matches</h2>
        <p class="sub">Friends who were in the same game are shown together.</p>
        <div class="card">${feed(list)}</div>
      </section>
    `;

    $('#f-title').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; state.title = b.dataset.v; savePref(); render(); });
    $('#f-range').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; state.range = b.dataset.v; savePref(); render(); });
    $('#app').querySelectorAll('th.sortable').forEach((th) => th.addEventListener('click', () => {
      const k = th.dataset.k;
      state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: k === 'name' ? 1 : -1 };
      render();
    }));
    const more = $('#more');
    if (more) more.addEventListener('click', () => { state.feedLimit += 20; render(); });
    drawKdChart(list);
  }

  function filteredNoTitle() {
    const saved = state.title; state.title = 'all';
    const l = filtered(); state.title = saved; return l;
  }

  function playerCard(p) {
    const mp = p.serviceRecord?.multiplayer || p.serviceRecord?.Multiplayer || null;
    const g = mp ? num(mp.gamesPlayed ?? mp.GamesPlayed) : NaN;
    const k = mp ? num(mp.kills ?? mp.Kills) : NaN;
    const d = mp ? num(mp.deaths ?? mp.Deaths) : NaN;
    const w = mp && (mp.wins ?? mp.Wins) != null ? num(mp.wins ?? mp.Wins) : null;
    const saved = matches.filter((m) => m.player === p.gamertag).length;
    return `
      <article class="card pcard" style="--c:${p.color}">
        <h3 class="pname"><span class="dot" style="--c:${p.color}"></span>${esc(p.gamertag)}</h3>
        <dl class="pstats">
          <div><dt>Games</dt><dd>${mp ? fmt(g) : '–'}</dd></div>
          <div><dt>K/D</dt><dd>${mp ? fmt(ratio(k, d), 2) : '–'}</dd></div>
          <div><dt>Kills</dt><dd>${mp ? fmt(k) : '–'}</dd></div>
          <div><dt>${w != null ? 'Win %' : 'Deaths'}</dt><dd>${mp ? (w != null ? fmt(pct(w, g), 0) + '%' : fmt(d)) : '–'}</dd></div>
        </dl>
        <p class="pnote">${fmt(saved)} matches saved</p>
        ${p.error ? `<p class="perr">Last update failed: ${esc(p.error)}</p>` : ''}
      </article>`;
  }

  function leaderboard(list) {
    const rows = aggregate(list).filter((r) => r.games > 0);
    if (!rows.length) return '<p class="sub" style="padding:16px;margin:0">Nothing to show for these filters.</p>';
    const cols = [
      { k: 'name', label: 'Player' }, { k: 'games', label: 'Games' }, { k: 'winPct', label: 'Win %', d: 0, suf: '%' },
      { k: 'kd', label: 'K/D', d: 2 }, { k: 'kda', label: 'KDA', d: 2 }, { k: 'kpg', label: 'Kills/G', d: 1 },
      { k: 'dpg', label: 'Deaths/G', d: 1, low: true }, { k: 'hspg', label: 'HS/G', d: 1 }, { k: 'best', label: 'Best' },
      { k: 'streak', label: 'Streak' },
    ];
    const { key, dir } = state.sort;
    const val = (r, k) => (k === 'name' ? r.p.gamertag.toLowerCase() : k === 'streak' ? (r.streakWin ? r.streak : -r.streak) : r[k]);
    rows.sort((a, b) => {
      const x = val(a, key), y = val(b, key);
      if (typeof x === 'string') return dir * x.localeCompare(y);
      return dir * ((Number.isFinite(x) ? x : -Infinity) - (Number.isFinite(y) ? y : -Infinity));
    });
    const leaders = {};
    for (const c of cols.slice(1, -1)) {
      const vs = rows.map((r) => r[c.k]).filter(Number.isFinite);
      if (vs.length > 1) leaders[c.k] = c.low ? Math.min(...vs) : Math.max(...vs);
    }
    return `<table>
      <thead><tr>${cols.map((c) => `<th class="sortable" data-k="${c.k}" ${key === c.k ? `aria-sort="${dir > 0 ? 'ascending' : 'descending'}"` : ''} scope="col">${c.label}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td class="lead"><span class="rank">${i + 1}</span><span class="dot" style="--c:${r.p.color}"></span>${esc(r.p.gamertag)}</td>
        ${cols.slice(1, -1).map((c) => {
          const v = r[c.k];
          const top = leaders[c.k] !== undefined && v === leaders[c.k];
          return `<td class="${top ? 'top-val' : ''}">${Number.isFinite(v) ? fmt(v, c.d || 0) + (c.suf || '') : '–'}</td>`;
        }).join('')}
        <td class="${r.streakWin ? 'streak-w' : 'streak-l'}">${r.streak ? `${r.streakWin ? 'W' : 'L'}${r.streak}` : '–'}</td>
      </tr>`).join('')}</tbody></table>`;
  }

  function heatGrid(list, titles) {
    if (!titles.length) return '<p class="sub" style="padding:16px;margin:0">No matches yet.</p>';
    const cells = players.map((p) => titles.map((t) => {
      const ms = list.filter((m) => m.player === p.gamertag && m.title === t);
      const k = ms.reduce((a, m) => a + m.kills, 0), d = ms.reduce((a, m) => a + m.deaths, 0);
      return { n: ms.length, kd: ms.length ? ratio(k, d) : NaN };
    }));
    const vals = cells.flat().filter((c) => c.n && Number.isFinite(c.kd)).map((c) => c.kd);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const shade = (kd) => {
      const f = hi > lo ? (kd - lo) / (hi - lo) : 0.5;
      return `rgba(55,197,224,${(0.08 + f * 0.52).toFixed(2)})`;
    };
    return `<table class="heat">
      <thead><tr><th scope="col">Player</th>${titles.map((t) => `<th scope="col">${esc(t)}</th>`).join('')}</tr></thead>
      <tbody>${players.map((p, i) => `<tr><td class="lead"><span class="dot" style="--c:${p.color}"></span>${esc(p.gamertag)}</td>
        ${cells[i].map((c, j) => c.n
          ? `<td><span class="cell" style="background:${shade(c.kd)}" title="${esc(p.gamertag)} · ${esc(titles[j])}: ${fmt(c.kd, 2)} K/D over ${c.n} games"><span class="kd">${fmt(c.kd, 2)}</span><span class="n">${c.n} games</span></span></td>`
          : '<td><span class="cell empty">–</span></td>').join('')}
      </tr>`).join('')}</tbody></table>`;
  }

  function squadMatrix(list) {
    const groups = groupMatches(list).filter((g) => g.members.length > 1);
    const pair = new Map();
    for (const g of groups) {
      for (let a = 0; a < g.members.length; a++) for (let b = a + 1; b < g.members.length; b++) {
        const A = g.members[a], B = g.members[b];
        const key = [A.p.index, B.p.index].sort((x, y) => x - y).join('-');
        const cur = pair.get(key) || { n: 0, w: 0 };
        cur.n++; if (A.won && B.won) cur.w++;
        pair.set(key, cur);
      }
    }
    if (!pair.size) return '<p class="sub" style="padding:16px;margin:0">No shared matches found for these filters.</p>';
    return `<table class="squad">
      <thead><tr><th scope="col"></th>${players.map((p) => `<th scope="col"><span class="dot" style="--c:${p.color}"></span>${esc(p.gamertag)}</th>`).join('')}</tr></thead>
      <tbody>${players.map((p) => `<tr><td class="lead"><span class="dot" style="--c:${p.color}"></span>${esc(p.gamertag)}</td>
        ${players.map((q) => {
          if (p === q) return '<td class="self">—</td>';
          const c = pair.get([p.index, q.index].sort((x, y) => x - y).join('-'));
          return c ? `<td><span class="wr">${fmt(pct(c.w, c.n), 0)}%</span><span class="n">${c.n} together</span></td>` : '<td class="self">·</td>';
        }).join('')}
      </tr>`).join('')}</tbody></table>`;
  }

  function feed(list) {
    const groups = groupMatches(list).reverse();
    if (!groups.length) return '<p class="sub" style="padding:16px;margin:0">No matches yet.</p>';
    const shown = groups.slice(0, state.feedLimit);
    return `<ul class="feed">${shown.map((g) => {
      const won = g.members.some((m) => m.won);
      const extras = [g.members[0].mode, g.members[0].map].filter(Boolean).map(esc).join(' · ');
      return `<li>
        <div class="result ${won ? 'win' : 'loss'}">${won ? 'WIN' : 'LOSS'}<small>${g.dur ? `${Math.round(g.dur / 60)} min` : ''}</small></div>
        <div>
          <div class="mhead"><strong>${esc(g.title)}</strong>${extras ? `${extras} · ` : ''}${new Date(g.t).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
          <div class="mplayers">${g.members.map((m) => `<span class="mp"><span class="dot" style="--c:${m.p.color}"></span><b>${esc(m.player)}</b>${m.kills} / ${m.deaths} / ${m.assists}${m.won !== won ? ` (${m.won ? 'W' : 'L'})` : ''}</span>`).join('')}</div>
        </div>
      </li>`;
    }).join('')}</ul>
    ${groups.length > shown.length ? `<p style="padding:0 16px 16px;margin:0"><button class="chip more" id="more">Show more</button></p>` : ''}`;
  }

  function drawKdChart(list) {
    if (charts.kd) charts.kd.destroy();
    const canvas = $('#kd-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const WINDOW = 10;
    const datasets = players.map((p) => {
      const ms = list.filter((m) => m.player === p.gamertag);
      const pts = [];
      for (let i = 0; i < ms.length; i++) {
        const w = ms.slice(Math.max(0, i - WINDOW + 1), i + 1);
        if (w.length < Math.min(5, ms.length)) continue;
        const k = w.reduce((a, m) => a + m.kills, 0), d = w.reduce((a, m) => a + m.deaths, 0);
        pts.push({ x: ms[i].t, y: +ratio(k, d).toFixed(2) });
      }
      return {
        label: p.gamertag, data: pts, borderColor: p.color, backgroundColor: p.color,
        borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2,
        pointHoverBorderColor: '#121821', tension: 0.25,
      };
    });
    const day = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    charts.kd = new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'nearest', intersect: false, axis: 'x' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#19212d', borderColor: '#26303e', borderWidth: 1,
            titleColor: '#eef2f6', bodyColor: '#a9b4c2', padding: 10, boxPadding: 4, usePointStyle: true,
            callbacks: {
              title: (items) => new Date(items[0].parsed.x).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
              label: (c) => ` ${c.dataset.label}: ${c.parsed.y.toFixed(2)} K/D`,
            },
          },
        },
        scales: {
          x: { type: 'linear', grid: { display: false }, border: { color: '#26303e' }, ticks: { color: '#7a8696', maxTicksLimit: 6, callback: (v) => day(v) } },
          y: { beginAtZero: true, grid: { color: '#1f2834' }, border: { display: false }, ticks: { color: '#7a8696', maxTicksLimit: 6 } },
        },
      },
    });
  }

  function renderEmpty(error) {
    $('#updated').textContent = '';
    $('#app').innerHTML = `
      <div class="empty-state">
        <h2>No stats yet</h2>
        <p>The dashboard is live, but the stats job hasn't saved any data yet. Once the <b>Update Halo stats</b> workflow runs (every 2 hours, or from the Actions tab), stats show up here.</p>
        ${error ? `<p class="perr">Last error: ${esc(error)}</p>` : ''}
        <p>Want a preview first? <a href="?demo">Open the dashboard with demo data</a>.</p>
      </div>`;
  }

  function timeAgo(t) {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 90) return 'just now';
    if (s < 5400) return `${Math.round(s / 60)} min ago`;
    if (s < 129600) return `${Math.round(s / 3600)} hours ago`;
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  readPref();
  load().catch((err) => {
    $('#app').innerHTML = `<div class="empty-state"><h2>Couldn't load stats</h2><p class="perr">${esc(err.message)}</p></div>`;
  });
})();
