// Halo MCC stats client: Microsoft sign-in -> Xbox Live -> Halo Waypoint "Spartan" token -> MCC stats.
// No dependencies; needs Node 18+ (built-in fetch).
//
// The MCC stats endpoints are the unofficial ones the Halo Waypoint website uses
// (mccapi.svc.halowaypoint.com). They are not a documented public API and may change.

const MS_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const MS_DEVICE_CODE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode';
const XBL_USER_AUTH_URL = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const SPARTAN_TOKEN_URL = 'https://settings.svc.halowaypoint.com/spartan-token';
const HALO_WAYPOINT_RELYING_PARTY = 'https://prod.xsts.halowaypoint.com/';
export const SCOPE = 'XboxLive.signin offline_access';

export const MCC_API_BASE = process.env.MCC_API_BASE || 'https://mccapi.svc.halowaypoint.com/hmcc';

const XSTS_ERRORS = {
  2148916233: 'This Microsoft account has no Xbox profile. Sign in once at xbox.com to create one.',
  2148916235: 'Xbox Live is not available in this account\'s country/region.',
  2148916236: 'This account needs adult verification (South Korea).',
  2148916237: 'This account needs adult verification (South Korea).',
  2148916238: 'This is a child account. An adult must add it to a Microsoft family group first.',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { res, data, text };
}

async function postForm(url, fields) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(fields),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

// ---------- Microsoft account ----------

export async function startDeviceCode(clientId) {
  const { res, data } = await postForm(MS_DEVICE_CODE_URL, { client_id: clientId, scope: SCOPE });
  if (!res.ok) throw new Error(`Device code request failed: ${data.error_description || data.error || res.status}`);
  return data; // { device_code, user_code, verification_uri, interval, expires_in, message }
}

export async function pollDeviceCode(clientId, { device_code, interval = 5, expires_in = 900 }) {
  const deadline = Date.now() + expires_in * 1000;
  let wait = interval * 1000;
  while (Date.now() < deadline) {
    await sleep(wait);
    const { data } = await postForm(MS_TOKEN_URL, {
      client_id: clientId,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code,
    });
    if (data.access_token) return data;
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') { wait += 5000; continue; }
    throw new Error(`Sign-in failed: ${data.error_description || data.error}`);
  }
  throw new Error('Sign-in timed out. Run the login script again.');
}

export async function refreshMicrosoftToken(clientId, refreshToken) {
  const { res, data } = await postForm(MS_TOKEN_URL, {
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: SCOPE,
  });
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Microsoft token refresh failed (${data.error || res.status}): ${data.error_description || ''}\n` +
      'The saved refresh token has probably expired. Run `node scripts/login.mjs` again and update the XBOX_REFRESH_TOKEN secret.'
    );
  }
  return data; // { access_token, refresh_token, expires_in }
}

// ---------- Xbox Live + Halo Waypoint ----------

export async function getSpartanToken(msAccessToken) {
  // 1. Xbox Live user token
  const user = await postJson(
    XBL_USER_AUTH_URL,
    {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    },
    { 'x-xbl-contract-version': '1' }
  );
  if (!user.res.ok || !user.data?.Token) {
    throw new Error(`Xbox Live sign-in failed (HTTP ${user.res.status}). ${user.text?.slice(0, 200) || ''}`);
  }

  // 2. XSTS token for Halo Waypoint
  const xsts = await postJson(
    XSTS_URL,
    {
      Properties: { SandboxId: 'RETAIL', UserTokens: [user.data.Token] },
      RelyingParty: HALO_WAYPOINT_RELYING_PARTY,
      TokenType: 'JWT',
    },
    { 'x-xbl-contract-version': '1' }
  );
  if (!xsts.res.ok || !xsts.data?.Token) {
    const hint = XSTS_ERRORS[xsts.data?.XErr] || '';
    throw new Error(`Xbox XSTS authorization failed (HTTP ${xsts.res.status}${xsts.data?.XErr ? `, XErr ${xsts.data.XErr}` : ''}). ${hint}`);
  }
  const signedInAs = xsts.data.DisplayClaims?.xui?.[0]?.gtg || null;

  // 3. Halo Waypoint Spartan token
  const spartan = await postJson(SPARTAN_TOKEN_URL, {
    Audience: 'urn:343:s3:services',
    MinVersion: '4',
    Proof: [{ Token: xsts.data.Token, TokenType: 'Xbox_XSTSv3' }],
  });
  if (!spartan.res.ok || !spartan.data?.SpartanToken) {
    throw new Error(`Halo Waypoint token request failed (HTTP ${spartan.res.status}). ${spartan.text?.slice(0, 200) || ''}`);
  }
  return { spartanToken: spartan.data.SpartanToken, signedInAs };
}

// ---------- MCC stats ----------

export class MccClient {
  constructor(spartanToken, { delayMs = 400 } = {}) {
    this.token = spartanToken;
    this.delayMs = delayMs;
  }

  async get(path, attempt = 0) {
    await sleep(this.delayMs);
    const res = await fetch(`${MCC_API_BASE}${path}`, {
      headers: {
        'x-343-authorization-spartan': this.token,
        Accept: 'application/json',
        'User-Agent': 'halo-mcc-dashboard (personal stats tracker)',
      },
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const retryAfter = Number(res.headers.get('retry-after')) || 2 ** attempt * 3;
      await sleep(retryAfter * 1000);
      return this.get(path, attempt + 1);
    }
    if (res.status === 404) {
      const err = new Error('Player not found (check the gamertag spelling, or they may have no MCC history).');
      err.status = 404;
      throw err;
    }
    if (res.status === 401 || res.status === 403) {
      const err = new Error(`Not authorized (HTTP ${res.status}). The player's privacy settings may hide their game history.`);
      err.status = res.status;
      throw err;
    }
    if (!res.ok) throw new Error(`MCC API HTTP ${res.status} for ${path}`);
    return res.json();
  }

  serviceRecord(gamertag) {
    return this.get(`/users/gt(${encodeURIComponent(gamertag)})/service-record`);
  }

  matchesPage(gamertag, page, pageSize = 20) {
    return this.get(`/users/gt(${encodeURIComponent(gamertag)})/matches?page=${page}&pageSize=${pageSize}`);
  }
}

// A stable key for de-duplicating matches across runs.
export function matchKey(m) {
  const id = m.matchId ?? m.MatchId ?? m.id ?? m.gameId ?? m.GameId;
  if (id) return String(id);
  return [m.datePlayed, m.haloTitleId, m.durationSeconds, m.kills, m.deaths].join('|');
}
