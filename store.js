import { mergeOperations, materialize, operation } from './core.js';
const DB = 'syncaboutit-v1';
let opened;
function db() {
  return opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('ops', { keyPath: 'id' });
      request.result.createObjectStore('settings');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transact(name, mode, fn) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(name, mode);
    const result = fn(tx.objectStore(name));
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Could not save changes.'));
  });
}
export const settings = {
  get: key => transact('settings', 'readonly', s => s.get(key)),
  set: (key, value) => transact('settings', 'readwrite', s => s.put(value, key)),
};
export const allOperations = () => transact('ops', 'readonly', s => s.getAll());
export const allNotes = async () => materialize(await allOperations());
export async function ingest(ops) {
  const existing = await allOperations();
  mergeOperations(existing, ops);
  const ids = new Set(existing.map(op => op.id));
  const added = ops.filter(op => !ids.has(op.id));
  if (!added.length) return;
  await transact('ops', 'readwrite', s => { for (const op of added) s.put(op); });
  channel?.postMessage('changed');
}
export async function change(noteId, type, data) {
  return navigator.locks.request('syncaboutit-write', async () => {
    let deviceId = await settings.get('deviceId');
    if (!deviceId) { deviceId = crypto.randomUUID(); await settings.set('deviceId', deviceId); }
    const op = operation(await allOperations(), deviceId, noteId, type, data);
    await ingest([op]);
    globalThis.dispatchEvent(new Event('notes-changed'));
    return op;
  });
}
// Bulk organization validates every patch before committing one IndexedDB transaction.
// The write lock keeps a concurrent tab or Drive refresh from racing label additions.
export async function changeNotes(noteIds, patchForNote) {
  return navigator.locks.request('syncaboutit-write', async () => {
    let deviceId = await settings.get('deviceId');
    if (!deviceId) { deviceId = crypto.randomUUID(); await settings.set('deviceId', deviceId); }
    const existing = await allOperations(), ids = new Set(noteIds), pending = [];
    for (const note of materialize(existing).filter(note => ids.has(note.id) && !note.trashed)) {
      const patch = patchForNote(note, existing);
      if (Object.entries(patch).every(([key, value]) => JSON.stringify(note[key]) === JSON.stringify(value))) continue;
      pending.push(operation([...existing, ...pending], deviceId, note.id, 'note.patch', patch));
    }
    if (pending.length) { await ingest(pending); globalThis.dispatchEvent(new Event('notes-changed')); }
    return pending.length;
  });
}
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(DB) : null;
channel?.addEventListener('message', () => globalThis.dispatchEvent(new Event('notes-changed')));
