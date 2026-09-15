export const SCHEMA = 1;
export const AGENT_PERMISSIONS_ID = 'workspace-agent-permissions';
export const COLORS = ['paper', 'sage', 'peach', 'lavender', 'sky', 'sand'];
export const TYPES = ['note.patch', 'item.put', 'item.remove', 'source.add', 'folder.put', 'folder.remove', 'permissions.patch', 'place.propose', 'place.review'];
export const PROPOSAL_STATUSES = ['pending', 'accepted', 'dismissed'];
const FIELDS = ['title', 'body', 'kind', 'color', 'labels', 'folderId', 'pinned', 'archived', 'trashed', 'agentShared', 'reminder'];
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const validId = value => typeof value === 'string' && ID.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const isText = (value, limit) => typeof value === 'string' && value.length <= limit;
const isWebUrl = value => { try { return typeof value === 'string' && value.length <= 10000 && ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; } };
export function validateOperation(op) {
  if (!op || op.schema !== SCHEMA || !validId(op.id) || !validId(op.noteId) || !validId(op.deviceId) ||
      !Number.isSafeInteger(op.clock) || op.clock < 0 || typeof op.at !== 'string' || !Number.isFinite(Date.parse(op.at)) ||
      !TYPES.includes(op.type)) throw new Error('Invalid note change.');
  if (!op.data || typeof op.data !== 'object' || Array.isArray(op.data)) throw new Error('Invalid change data.');
  if (op.type === 'note.patch') {
    for (const [key, value] of Object.entries(op.data)) {
      if (!FIELDS.includes(key)) throw new Error(`Unknown note field: ${key}`);
      if (['title', 'body'].includes(key) && !isText(value, 100000)) throw new Error('Note text is too long.');
      if (['pinned', 'archived', 'trashed', 'agentShared'].includes(key) && typeof value !== 'boolean') throw new Error('Invalid flag.');
      if (key === 'kind' && !['note', 'list', 'markdown'].includes(value)) throw new Error('Invalid note type.');
      if (key === 'color' && !COLORS.includes(value)) throw new Error('Invalid color.');
      if (key === 'labels' && (!Array.isArray(value) || value.length > 30 || value.some(x => !isText(x, 80)))) throw new Error('Invalid labels.');
      if (key === 'folderId' && value !== null && !validId(value)) throw new Error('Invalid folder.');
      if (key === 'reminder' && value !== null) {
        if (!value || typeof value !== 'object' || !['time', 'opportunity'].includes(value.type)) throw new Error('Invalid reminder.');
        if (value.type === 'time' && !Number.isFinite(Date.parse(value.at))) throw new Error('Choose a valid reminder date.');
        if (value.type === 'opportunity' && (!isText(value.query, 300) || !isText(value.place, 300))) throw new Error('Invalid opportunity.');
      }
    }
  } else if (op.type === 'permissions.patch') {
    if (op.noteId !== AGENT_PERMISSIONS_ID || !Object.keys(op.data).length || Object.entries(op.data).some(([key, value]) => !['readAll', 'createNotes'].includes(key) || typeof value !== 'boolean')) throw new Error('Invalid AI permissions.');
  } else if (op.type === 'folder.put') {
    if (typeof op.data.name !== 'string' || !op.data.name.trim() || op.data.name.length > 100 || Object.keys(op.data).some(k => !['name', 'parentId'].includes(k))) throw new Error('Choose a folder name up to 100 characters.');
    if ('parentId' in op.data && op.data.parentId !== null && (!validId(op.data.parentId) || op.data.parentId === op.noteId)) throw new Error('Invalid parent folder.');
  } else if (op.type === 'folder.remove') {
    if (Object.keys(op.data).length) throw new Error('Invalid folder removal.');
  } else if (op.type === 'source.add') {
    if (!validId(op.data.id) || !isText(op.data.title, 1000) || !isText(op.data.selection, 100000) || !Number.isFinite(Date.parse(op.data.capturedAt))) throw new Error('Invalid web clip metadata.');
    if (!isWebUrl(op.data.url)) throw new Error('Web clips need an HTTP or HTTPS source URL.');
  } else if (op.type === 'place.propose') {
    const d = op.data;
    if (Object.keys(d).some(k => !['id', 'label', 'address', 'latitude', 'longitude', 'radius', 'reason', 'evidenceUrl', 'confidence', 'expiresAt'].includes(k))) throw new Error('Invalid place suggestion field.');
    if (!validId(d.id) || !isText(d.label, 300) || !d.label.trim() || !isText(d.reason, 1000)) throw new Error('A place suggestion needs an id, a name, and a reason.');
    if (!Number.isFinite(d.latitude) || Math.abs(d.latitude) > 90 || !Number.isFinite(d.longitude) || Math.abs(d.longitude) > 180) throw new Error('Invalid place coordinates.');
    if (!Number.isFinite(d.radius) || d.radius < 100 || d.radius > 5000) throw new Error('Choose a radius between 100 and 5,000 meters.');
    if ('address' in d && !isText(d.address, 300)) throw new Error('Invalid place address.');
    if ('evidenceUrl' in d && !isWebUrl(d.evidenceUrl)) throw new Error('Evidence needs an HTTP or HTTPS URL.');
    if ('confidence' in d && (!Number.isFinite(d.confidence) || d.confidence < 0 || d.confidence > 1)) throw new Error('Confidence must be between 0 and 1.');
    if ('expiresAt' in d && (!isText(d.expiresAt, 100) || !Number.isFinite(Date.parse(d.expiresAt)))) throw new Error('Invalid suggestion expiry.');
  } else if (op.type === 'place.review') {
    if (!validId(op.data.id) || !PROPOSAL_STATUSES.includes(op.data.status) || Object.keys(op.data).length !== 2) throw new Error('Invalid place review.');
  } else {
    if (!validId(op.data.id)) throw new Error('Invalid checklist item.');
    if (op.type === 'item.put') {
      if (Object.keys(op.data).some(k => !['id', 'text', 'checked', 'order'].includes(k))) throw new Error('Invalid item field.');
      if ('text' in op.data && !isText(op.data.text, 10000)) throw new Error('Invalid item text.');
      if ('checked' in op.data && typeof op.data.checked !== 'boolean') throw new Error('Invalid checklist state.');
      if ('order' in op.data && !Number.isFinite(op.data.order)) throw new Error('Invalid item order.');
    }
  }
  return op;
}
export function mergeOperations(...groups) {
  const byId = new Map();
  for (const op of groups.flat()) {
    validateOperation(op);
    const previous = byId.get(op.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(op)) throw new Error('Conflicting change identifiers. Sync stopped to protect your notes.');
    byId.set(op.id, op);
  }
  return [...byId.values()].sort((a, b) => a.clock - b.clock || compareId(a.deviceId, b.deviceId) || compareId(a.id, b.id));
}
// Folders are patched per field, so a rename from an older client does not reset a parent.
// A removed folder disappears until a later folder.put; its notes and children fall back to
// the nearest live ancestor. Parent cycles caused by concurrent moves resolve to the root.
function folderState(sorted) {
  const folders = new Map();
  for (const op of sorted) {
    if (op.type === 'folder.put') folders.set(op.noteId, { id: op.noteId, name: '', parentId: null, ...folders.get(op.noteId), ...op.data, removed: false });
    if (op.type === 'folder.remove') folders.set(op.noteId, { id: op.noteId, name: '', parentId: null, ...folders.get(op.noteId), removed: true });
  }
  const live = new Map([...folders].filter(([, f]) => !f.removed && f.name));
  const resolve = folder => {
    const seen = new Set();
    let parent = folder.parentId;
    while (parent !== null) {
      if (parent === folder.id) return null;
      if (!live.has(parent) || seen.has(parent)) return folder.parentId;
      seen.add(parent); parent = live.get(parent).parentId;
    }
    return folder.parentId;
  };
  const result = new Map();
  for (const folder of live.values()) result.set(folder.id, { id: folder.id, name: folder.name, parentId: live.has(folder.parentId) ? resolve(folder) : null });
  return result;
}
export function materialize(operations) {
  const sorted = mergeOperations(operations);
  const notes = new Map();
  for (const op of sorted) {
    if (['folder.put', 'folder.remove', 'permissions.patch'].includes(op.type)) continue;
    if (!notes.has(op.noteId)) notes.set(op.noteId, {
      id: op.noteId, title: '', body: '', kind: 'note', color: 'paper', labels: [], pinned: false,
      archived: false, trashed: false, agentShared: false, reminder: null, folderId: null, sources: {}, items: {}, proposals: {}, createdAt: op.at, updatedAt: op.at,
    });
    const note = notes.get(op.noteId);
    note.updatedAt = op.at;
    if (op.type === 'note.patch') Object.assign(note, op.data);
    if (op.type === 'item.put') note.items[op.data.id] = { text: '', checked: false, order: 0, ...note.items[op.data.id], ...op.data, removed: false };
    if (op.type === 'item.remove') note.items[op.data.id] = { ...note.items[op.data.id], removed: true };
    if (op.type === 'source.add') note.sources[op.data.id] = op.data;
    // A suggestion keeps the user's decision if it is re-proposed; a review of an unknown suggestion stays invisible.
    if (op.type === 'place.propose') note.proposals[op.data.id] = { ...op.data, status: note.proposals[op.data.id]?.status || 'pending', proposedAt: op.at };
    if (op.type === 'place.review') note.proposals[op.data.id] = { ...note.proposals[op.data.id], status: op.data.status };
  }
  const folders = folderState(sorted);
  return [...notes.values()].map(n => ({ ...n, folderId: folders.has(n.folderId) ? n.folderId : null, sources: Object.values(n.sources),
    items: Object.values(n.items).filter(i => !i.removed).sort((a, b) => a.order - b.order || compareId(a.id, b.id)),
    proposals: Object.values(n.proposals).filter(p => p.proposedAt).sort((a, b) => a.proposedAt.localeCompare(b.proposedAt) || compareId(a.id, b.id)) }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}
export function materializeFolders(operations) {
  return [...folderState(mergeOperations(operations)).values()].sort((a, b) => a.name.localeCompare(b.name) || compareId(a.id, b.id));
}
/** Depth-first folder tree order with a display depth, for navigation lists and pickers. */
export function folderTree(folders) {
  const result = [];
  const walk = (parentId, depth) => { for (const folder of folders.filter(f => f.parentId === parentId)) { result.push({ ...folder, depth }); walk(folder.id, depth + 1); } };
  walk(null, 0);
  return result;
}
export function materializeAgentPermissions(operations) {
  const permissions = { readAll: false, createNotes: false };
  for (const op of mergeOperations(operations)) if (op.type === 'permissions.patch') Object.assign(permissions, op.data);
  return permissions;
}
// Two writes to the same field are reported when the losing write could not have seen the
// winner: equal logical clocks on different devices, or a later wall-clock time on the loser.
// Any later write that sorts after both resolves the report, so a review writes the chosen value.
export function conflicts(operations) {
  const state = new Map();
  for (const op of mergeOperations(operations)) {
    const entries = op.type === 'note.patch' ? Object.entries(op.data).map(([field, value]) => [field, null, value])
      : op.type === 'item.put' ? Object.entries(op.data).filter(([field]) => field !== 'id').map(([field, value]) => [field, op.data.id, value]) : [];
    for (const [field, itemId, value] of entries) {
      const key = `${op.noteId} ${itemId ?? ''} ${field}`;
      const previous = state.get(key);
      const current = { value, deviceId: op.deviceId, at: op.at, id: op.id, clock: op.clock };
      let overridden = [];
      if (previous) {
        const concurrent = previous.current.deviceId !== op.deviceId && (previous.current.clock === op.clock || Date.parse(previous.current.at) > Date.parse(op.at));
        if (concurrent) overridden = JSON.stringify(previous.current.value) === JSON.stringify(value) ? previous.overridden : [...previous.overridden, previous.current];
      }
      state.set(key, { noteId: op.noteId, field, itemId, current, overridden });
    }
  }
  const strip = ({ clock, ...rest }) => rest;
  return [...state.values()].filter(entry => entry.overridden.length).map(entry => ({ ...entry, current: strip(entry.current), overridden: entry.overridden.map(strip) }));
}
export function operation(operations, deviceId, noteId, type, data) {
  return validateOperation({ schema: SCHEMA, id: crypto.randomUUID(), deviceId, noteId, type, data,
    clock: operations.reduce((max, op) => Math.max(max, op.clock), 0) + 1, at: new Date().toISOString() });
}
