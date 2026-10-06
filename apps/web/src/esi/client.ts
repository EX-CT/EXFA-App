// ESI single-sign-on (EVE SSO v2, OAuth 2.0 + PKCE — a public client, no secret) and the
// read endpoints EXFA uses: character verify, trained skills, plugged implants.
// The OAuth client_id is deploy-configured (VITE_ESI_CLIENT_ID) or user-set below;
// the same module is reused by the desktop app once it exists (same PKCE flow).

const SSO = 'https://login.eveonline.com/v2/oauth';
const ESI = 'https://esi.evetech.net/latest';
const STORE_KEY = 'exfa:esi_characters';
const CFG_KEY = 'exfa:esi_client_id';
export const ESI_SCOPES = 'esi-skills.read_skills.v1 esi-clones.read_implants.v1';

export interface EsiCharacter {
  character_id: number; character_name: string; scopes: string;
  refresh_token: string; access_token: string; access_expires_at: number;
  /** trained skills from the last import: skill_id -> active level */
  skills?: Record<number, number>;
  /** implant type ids from the last import */
  implants?: number[];
  /** pilot security status (public character info — needed by Society ships' traits) */
  security_status?: number | null;
  imported_at?: string;
}

export const esiClientId = () =>
  (import.meta.env?.VITE_ESI_CLIENT_ID as string | undefined) || localStorage.getItem(CFG_KEY) || '';
export const setEsiClientId = (id: string) => { if (id.trim()) localStorage.setItem(CFG_KEY, id.trim()); else localStorage.removeItem(CFG_KEY); };
export const callbackUrl = () => `${location.origin}${import.meta.env?.BASE_URL ?? '/'}esi/callback`;

export const loadEsiCharacters = (): Record<number, EsiCharacter> => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; }
};
const saveEsiCharacters = (m: Record<number, EsiCharacter>) => localStorage.setItem(STORE_KEY, JSON.stringify(m));
export const unlinkEsiCharacter = (id: number) => { const m = loadEsiCharacters(); delete m[id]; saveEsiCharacters(m); };

// ---- PKCE ----
const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!);
const rand = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
async function challenge(v: string) { return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))); }

/** Redirect the whole tab to EVE SSO. `returnTo` is stored in `state` so the callback can restore it. */
export async function login(returnTo = location.pathname + location.search) {
  const cid = esiClientId();
  if (!cid) throw new Error('no ESI client_id configured (VITE_ESI_CLIENT_ID or the field below)');
  const verifier = rand();
  const state = rand();
  sessionStorage.setItem(`esi:pkce:${state}`, JSON.stringify({ verifier, returnTo }));
  const q = new URLSearchParams({
    response_type: 'code', redirect_uri: callbackUrl(), client_id: cid, scope: ESI_SCOPES,
    state, code_challenge: await challenge(verifier), code_challenge_method: 'S256',
  });
  location.href = `${SSO}/authorize/?${q}`;
}

async function tokenRequest(body: URLSearchParams): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const r = await fetch(`${SSO}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error(`ESI token: HTTP ${r.status}`);
  return r.json();
}

/** Handle the /esi/callback hit: exchange the code, verify the character, store the refresh token. */
export async function handleCallback(code: string, state: string): Promise<string> {
  const raw = sessionStorage.getItem(`esi:pkce:${state}`);
  sessionStorage.removeItem(`esi:pkce:${state}`);
  if (!raw) throw new Error('ESI callback: unknown state (session expired?)');
  const { verifier, returnTo } = JSON.parse(raw);
  const tok = await tokenRequest(new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: callbackUrl(), client_id: esiClientId(), code_verifier: verifier,
  }));
  const ch = verify(tok.access_token);
  const all = loadEsiCharacters();
  all[ch.character_id] = {
    character_id: ch.character_id, character_name: ch.character_name, scopes: ESI_SCOPES,
    refresh_token: tok.refresh_token ?? all[ch.character_id]?.refresh_token ?? '',
    access_token: tok.access_token, access_expires_at: Date.now() + tok.expires_in * 1000,
  };
  saveEsiCharacters(all);
  return returnTo;
}

/** SSO v2 access tokens are JWTs: sub = "CHARACTER:EVE:<id>", name = character name.
 * Decoding locally avoids a network call (the legacy esi.evetech.net/verify endpoint is gone). */
function verify(accessToken: string): { character_id: number; character_name: string } {
  const parts = accessToken.split('.');
  if (parts.length !== 3) throw new Error('ESI token: not a JWT');
  const j = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  const id = Number(String(j.sub ?? '').replace('CHARACTER:EVE:', ''));
  if (!id || !j.name) throw new Error('ESI token: missing character claims');
  return { character_id: id, character_name: j.name };
}

async function accessToken(ch: EsiCharacter): Promise<string> {
  if (Date.now() < ch.access_expires_at - 30_000 && ch.access_token) return ch.access_token;
  if (!ch.refresh_token) throw new Error('no refresh token — log in again');
  const tok = await tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: ch.refresh_token, client_id: esiClientId() }));
  const all = loadEsiCharacters();
  const cur = all[ch.character_id] ?? ch;
  all[ch.character_id] = { ...cur, access_token: tok.access_token, refresh_token: tok.refresh_token ?? cur.refresh_token, access_expires_at: Date.now() + tok.expires_in * 1000 };
  saveEsiCharacters(all);
  return tok.access_token;
}

/** Pull trained skills + plugged implants for a linked character and store them on the record. */
export async function importEsiCharacter(ch: EsiCharacter): Promise<EsiCharacter> {
  const tok = await accessToken(ch);
  const get = async (p: string) => {
    const r = await fetch(`${ESI}/characters/${ch.character_id}${p}`, { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) throw new Error(`ESI ${p}: HTTP ${r.status}`);
    return r.json();
  };
  const skills = (await get('/skills/')).skills as { skill_id: number; active_skill_level: number }[];
  const implants = await get('/implants/') as number[];
  // security status is public data: /characters/{id}/ needs no token at all. SoCT ships
  // (Gnosis, Sunesis, Metamorphosis, Apotheosis) scale their traits with it. Best-effort:
  // a failed lookup must not sink the skills import.
  const pub = await fetch(`${ESI}/characters/${ch.character_id}/`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { security_status?: number } | null;
  const all = loadEsiCharacters();
  const out: EsiCharacter = { ...ch, skills: Object.fromEntries(skills.map((s) => [s.skill_id, s.active_skill_level])), implants, security_status: pub?.security_status ?? null, imported_at: new Date().toISOString() };
  all[ch.character_id] = out;
  saveEsiCharacters(all);
  return out;
}
