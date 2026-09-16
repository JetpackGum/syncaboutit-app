import { settings } from './store.js';
import { DRIVE_SCOPE } from './drive.js';
// SyncAboutIt's own Web application OAuth client (public by design, not a secret -- see docs/google-connection.md).
// Used unless the user sets their own in Settings, so Connect Google Drive works with no setup for everyone
// installing the extension or hosted app; a self-hosted deployment can still override it.
export const DEFAULT_GOOGLE_CLIENT_ID = '489250154174-a4ak4smjdf05ih9kuivkpenov4a701h4.apps.googleusercontent.com';
const extension = !!globalThis.chrome?.identity;
export const redirectUri = () => extension ? chrome.identity.getRedirectURL() : `${location.origin}${location.pathname}`;
const tokenStore = {
  async get() { return extension ? (await chrome.storage.session.get('googleToken')).googleToken : JSON.parse(sessionStorage.getItem('googleToken') || 'null'); },
  async set(value) { if (extension) await chrome.storage.session.set({ googleToken: value }); else sessionStorage.setItem('googleToken', JSON.stringify(value)); },
};
export async function getToken() {
  const saved = await tokenStore.get();
  if (!saved || saved.expiresAt < Date.now() + 60000) throw new Error('Connect Google Drive to sync your notes.');
  return saved.token;
}
export async function isConnected() { try { await getToken(); return true; } catch { return false; } }
async function receive(url, state) {
  const result = validateOAuthRedirect(url, redirectUri(), state);
  await tokenStore.set(result);
}
export function validateOAuthRedirect(url, expectedUrl, state, now = Date.now()) {
  const target = new URL(url);
  const expected = new URL(expectedUrl);
  if (target.origin !== expected.origin || target.pathname !== expected.pathname) throw new Error('Unexpected Google sign-in redirect.');
  const result = new URLSearchParams(target.hash.slice(1));
  if (!state || result.get('state') !== state) throw new Error('Google sign-in could not be verified. Please try again.');
  if (result.has('error')) throw new Error(`Google sign-in: ${result.get('error')}`);
  if (!result.get('access_token') || !result.get('scope')?.split(' ').includes(DRIVE_SCOPE)) throw new Error('Drive permission was not granted.');
  const expiresIn = Number(result.get('expires_in'));
  if (!Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > 86400) throw new Error('Google returned an invalid token lifetime. Please try again.');
  return { token: result.get('access_token'), expiresAt: now + expiresIn * 1000 };
}
export async function finishSignIn() {
  if (!extension && /access_token=|error=/.test(location.hash)) {
    const url = location.href;
    const state = sessionStorage.getItem('oauthState');
    history.replaceState(null, '', location.pathname);
    sessionStorage.removeItem('oauthState');
    await receive(url, state);
    return true;
  }
  return false;
}
export async function connect() {
  const clientId = (await settings.get('googleClientId')) || DEFAULT_GOOGLE_CLIENT_ID;
  const state = crypto.randomUUID();
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri(), response_type: 'token', scope: DRIVE_SCOPE, state, prompt: 'select_account consent' });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  if (extension) {
    const response = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
    await receive(response, state);
  } else {
    sessionStorage.setItem('oauthState', state);
    location.assign(url);
  }
}
export async function disconnect() { await tokenStore.set(null); }
