import { mergeOperations } from './core.js';
const ROOT = 'https://www.googleapis.com/drive/v3/files';
const PREFIX = 'syncaboutit-v1-';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export class Drive {
  constructor(getToken, fetcher = fetch) { this.getToken = getToken; this.fetcher = fetcher; }
  async request(url, options = {}) {
    const token = await this.getToken();
    const response = await Reflect.apply(this.fetcher, globalThis, [url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) }]);
    if (!response.ok) {
      if (response.status === 401) throw new Error('Google sign-in expired. Connect Drive again.');
      if (response.status === 403) throw new Error('Google denied Drive access. Check the Drive API and app permission.');
      throw new Error(`Drive sync failed (${response.status}). Your local notes are safe; retry shortly.`);
    }
    return response.json();
  }
  async read() {
    const files = [];
    let pageToken;
    do {
      const query = new URLSearchParams({ spaces: 'appDataFolder', q: `trashed = false and name contains '${PREFIX}'`, fields: 'nextPageToken,files(id,name)', pageSize: '1000' });
      if (pageToken) query.set('pageToken', pageToken);
      const page = await this.request(`${ROOT}?${query}`);
      files.push(...(page.files || []).filter(f => f.name.startsWith(PREFIX)));
      pageToken = page.nextPageToken;
    } while (pageToken);
    const batches = [];
    // Bounded concurrency keeps large note libraries from exhausting connections.
    for (let i = 0; i < files.length; i += 5) {
      const group = await Promise.all(files.slice(i, i + 5).map(file => this.request(`${ROOT}/${encodeURIComponent(file.id)}?alt=media`)));
      for (const batch of group) {
        if (batch.schema !== 1 || !Array.isArray(batch.operations)) throw new Error('Unsupported Drive data. Sync stopped; local notes are unchanged.');
        batches.push(batch.operations);
      }
    }
    return mergeOperations(...batches);
  }
  async upload(operations) {
    if (!operations.length) return;
    const boundary = `syncaboutit_${crypto.randomUUID()}`;
    const metadata = { name: `${PREFIX}${crypto.randomUUID()}.json`, parents: ['appDataFolder'], mimeType: 'application/json' };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ schema: 1, operations })}\r\n--${boundary}--`;
    await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  }
  async sync(local) {
    const remote = await this.read();
    const merged = mergeOperations(local, remote);
    const ids = new Set(remote.map(op => op.id));
    const pending = local.filter(op => !ids.has(op.id));
    for (let i = 0; i < pending.length; i += 250) await this.upload(pending.slice(i, i + 250));
    return merged;
  }
}
