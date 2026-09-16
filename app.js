import { COLORS, materialize, materializeFolders, materializeAgentPermissions, AGENT_PERMISSIONS_ID, validateOperation, conflicts, folderTree } from './core.js';
import { settings, allNotes, allOperations, change, changeNotes, ingest } from './store.js';
import { Drive } from './drive.js';
import { connect, disconnect, getToken, isConnected, finishSignIn, redirectUri } from './auth.js';
import { renderMarkdown, markdownTitle } from './markdown.js';
import { selectNotes, groupNotes, opportunityStatus, labelSuggestions } from './library.js';

const $ = selector => document.querySelector(selector);
const paths = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  rows: '<path d="M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1"/>',
  import: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  notes: '<path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  pin: '<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  tack: '<path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4-1-6ZM12 15v6"/>',
  spark: '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3ZM20 2v4M18 4h4"/>',
  archive: '<path d="M4 8v12h16V8M3 3h18v5H3zM9 12h6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  settings: '<path d="m9 3-1 3-3 1v4l-2 1 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-1V7l-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  sync: '<path d="M20 7a9 9 0 0 0-15-2L2 8m0-5v5h5M4 17a9 9 0 0 0 15 2l3-3m0 5v-5h-5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  checklist: '<path d="m3 6 2 2 4-4m-6 9 2 2 4-4m-6 9 2 2 4-4M13 6h8M13 13h8M13 20h8"/>',
  edit: '<path d="m15 4 5 5M3 21l5-1L21 7l-5-5L3 15v6Z"/>',
  restore: '<path d="M3 10a9 9 0 1 1 0 6M3 3v7h7"/>',
  folder: '<path d="M3 7V4h6l3 3h9v13H3V7Z"/>',
  link: '<path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(2 -1) scale(.9)"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.notes}</svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
let view = 'notes', query = '', notes = [], current = null, draftItems = [], kind = 'note', color = 'paper';
let syncPromise, syncTimer, toastTimer, renderVersion = 0;
let folders = [], editingFolder = null, folderReturnTo = null, pendingClip = null, pendingConflicts = [], ownDeviceId = null;
let aiPermissions = { readAll: false, createNotes: false };
let searchScope = 'view', sortOrder = 'updated', listLayout = false, selectionMode = false, visibleNotes = [];
let selectedIds = new Set(), collapsedFolders = new Set(), bulkAction = 'move', bulkIds = [];
let markdownMode = 'write', editorBaseline = '', editorSaving = false;
const mobileQuery = matchMedia('(max-width: 760px)');
const views = {
  notes: ['All notes', 'All notes', 'Your notes, lists, and documents.'],
  unfiled: ['Unfiled', 'Unfiled', 'Notes that haven’t been added to a folder.'],
  reminders: ['Reminders', 'Reminders', 'What needs your attention, in time order.'],
  opportunities: ['Opportunities', 'Opportunities', 'Things to find when you’re nearby.'],
  agents: ['Shared with AI', 'A little help, on your terms.', 'The notes and lists you’ve invited your agents to work with.'],
  conflicts: ['Needs review', 'Two devices, one field.', 'Changes made at the same time on different devices. Pick the version to keep.'],
  archive: ['Archive', 'Off your mind. Still here.', 'Finished projects and thoughts you might come back to.'],
  trash: ['Trash', 'A place for second thoughts.', 'Restore a note any time. Nothing is automatically deleted.'],
};
const folderById = id => folders.find(f => f.id === id);
const descendants = id => { const set = new Set(); const walk = parent => folders.filter(f => f.parentId === parent).forEach(f => { set.add(f.id); walk(f.id); }); walk(id); return set; };
function folderOptions(selected = '', exclude = null, top = 'No folder') {
  const skip = exclude ? new Set([exclude, ...descendants(exclude)]) : new Set();
  return `<option value="">${top}</option>` + folderTree(folders).filter(f => !skip.has(f.id)).map(f => `<option value="${f.id}" ${f.id === selected ? 'selected' : ''}>${'   '.repeat(f.depth)}${escape(f.name)}</option>`).join('');
}
const fieldLabels = { title: 'Title', body: 'Text', kind: 'Note type', color: 'Color', labels: 'Labels', folderId: 'Folder', pinned: 'Pinned', archived: 'Archived', trashed: 'In trash', agentShared: 'Shared with AI', reminder: 'Reminder', text: 'Checklist item text', checked: 'Checklist item checked', order: 'Checklist item position' };
function describeValue(field, value) {
  if (value === null || value === undefined) return 'None';
  if (field === 'folderId') return folderById(value)?.name || 'No folder';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ') || 'None';
  if (typeof value === 'object') return value.type === 'time' ? `Remind at ${new Date(value.at).toLocaleString()}` : value.type === 'opportunity' ? `Find ${value.query || '…'}${value.place ? ` near ${value.place}` : ''}` : JSON.stringify(value);
  return String(value).trim() ? String(value).slice(0, 600) : 'Empty';
}
function conflictCard(conflict, index) {
  const note = notes.find(n => n.id === conflict.noteId);
  const item = conflict.itemId ? note.items.find(i => i.id === conflict.itemId) : null;
  const option = (write, choice, heading) => `<div class="conflict-option"><div class="conflict-meta"><strong>${heading}</strong><small>${write.deviceId === ownDeviceId ? 'This browser' : 'Another device'} · ${escape(new Date(write.at).toLocaleString())}</small></div><div class="conflict-value">${escape(describeValue(conflict.field, write.value))}</div><button type="button" class="secondary" data-conflict="${index}" data-choice="${choice}">${choice === 'current' ? 'Keep this' : 'Use this instead'}</button></div>`;
  return `<article class="note-card conflict-card" data-color="${note.color}"><button class="note-open" data-action="edit" data-id="${note.id}"><h2 class="note-title">${escape(note.title || 'Untitled')}</h2></button><p class="conflict-field">${escape(fieldLabels[conflict.field] || conflict.field)}${item ? ` · “${escape(item.text.slice(0, 60))}”` : ''}</p>${option(conflict.current, 'current', 'Showing now')}${conflict.overridden.map((write, i) => option(write, String(i), 'Hidden change')).join('')}</article>`;
}
function proposalsHtml(note) {
  if (note.trashed || !note.proposals.length) return '';
  const pending = note.proposals.filter(p => p.status === 'pending' && (!p.expiresAt || Date.parse(p.expiresAt) > Date.now()));
  const accepted = note.proposals.filter(p => p.status === 'accepted');
  return accepted.map(p => `<span class="tag reminder">${icon('pin')}${escape(p.label)} · accepted</span>`).join('') + pending.map(p => `<div class="proposal"><div><strong>${escape(p.label)}</strong>${p.address ? `<small>${escape(p.address)}</small>` : ''}<small>${escape(p.reason)}${p.confidence !== undefined ? ` · ${Math.round(p.confidence * 100)}% confident` : ''} · ${p.radius} m</small>${p.evidenceUrl ? `<a href="${escape(p.evidenceUrl)}" target="_blank" rel="noopener noreferrer">Evidence ↗</a>` : ''}</div><div class="proposal-actions"><button type="button" class="secondary" data-action="accept-place" data-id="${note.id}" data-proposal="${p.id}">Accept</button><button type="button" class="text-button" data-action="dismiss-place" data-id="${note.id}" data-proposal="${p.id}">Dismiss</button></div></div>`).join('');
}
function toast(message) { const notification = $('#toast'); ([...document.querySelectorAll('dialog[open]')].at(-1) || document.body).append(notification); notification.textContent = message; notification.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { notification.hidden = true; }, 5500); }
const attempt = fn => async event => { try { await fn(event); } catch (error) { console.error(error.message); toast(error.message); } };
function humanDate(at) { return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function button(action, title, glyph, id, extra = '') { return `<button class="icon-button ${extra}" data-action="${action}" data-id="${id}" title="${escape(title)}" aria-label="${escape(title)}">${icon(glyph)}</button>`; }
function card(note) {
  const folder = folders.find(f => f.id === note.folderId);
  const folderLabel = folder ? `<button class="note-folder" data-action="folder" data-id="${note.id}">${icon('folder')}${escape(folder.name)}</button>` : '<span class="note-folder">Unfiled</span>';
  const labels = note.labels.slice(0, 2).map(label => `<button class="tag" data-action="label" data-label="${escape(label)}" data-id="${note.id}">${escape(label)}</button>`).join('') + (note.labels.length > 2 ? `<span class="tag" title="${escape(note.labels.slice(2).join(', '))}">+${note.labels.length - 2} labels</span>` : '') + (note.sources.length ? `<span class="tag">${icon('link')}${note.sources.length} source${note.sources.length > 1 ? 's' : ''}</span>` : '');
  let reminder = '';
  if (note.reminder?.type === 'time') reminder = `<span class="tag reminder">${icon('bell')}${escape(new Date(note.reminder.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</span>`;
  if (note.reminder?.type === 'opportunity') reminder = `<span class="tag reminder">${icon('pin')}${escape(opportunityStatus(note))}</span>`;
  const body = note.kind === 'list' ? `<ul class="check-items">${note.items.slice(0, 7).map(item => `<li><label class="check-item ${item.checked ? 'completed' : ''}"><input type="checkbox" data-note="${note.id}" data-item="${item.id}" ${item.checked ? 'checked' : ''} ${note.trashed ? 'disabled' : ''}><span>${escape(item.text)}</span></label></li>`).join('')}</ul>${note.items.length > 7 ? `<div class="more-items">+ ${note.items.length - 7} more items</div>` : ''}` : note.kind === 'markdown' ? `<div class="note-body markdown-body markdown-card">${renderMarkdown(note.body)}</div>` : `<button class="note-open" data-action="edit" data-id="${note.id}" aria-label="Edit ${escape(note.title || 'untitled note')}"><div class="note-body">${escape(note.body)}</div></button>`;
  const selection = selectionMode ? `<label class="note-selection"><input type="checkbox" data-select-note="${note.id}" aria-label="Select ${escape(note.title || 'Untitled')}" ${selectedIds.has(note.id) ? 'checked' : ''}></label>` : '';
  const actions = note.trashed ? button('restore', 'Restore note', 'restore', note.id) : `<button class="icon-button" popovertarget="actions-${note.id}" aria-label="Actions for ${escape(note.title || 'Untitled')}">···</button><div id="actions-${note.id}" class="action-popover" popover>${[['edit', 'Edit', 'edit'], ['archive', note.archived ? 'Unarchive' : 'Archive', 'archive'], ['trash', 'Move to trash', 'trash']].map(([action, label, glyph]) => `<button data-action="${action}" data-id="${note.id}">${icon(glyph)}${label}</button>`).join('')}</div>`;
  const preview = note.kind === 'list' ? note.items.filter(i => !i.checked).map(i => i.text).join(' · ') || 'All items complete' : note.body.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ');
  return `<article class="note-card ${selectionMode ? 'selectable' : ''}" data-color="${note.color}">${selection}<button class="note-open card-title" data-action="edit" data-id="${note.id}"><h2 class="note-title">${escape(note.title || 'Untitled')}</h2></button>${!note.trashed ? button('pin', note.pinned ? 'Unpin note' : 'Pin note', 'tack', note.id, `note-pin ${note.pinned ? 'is-pinned' : ''}`) : ''}<div class="card-content">${body}</div><button class="list-preview note-open" data-action="edit" data-id="${note.id}">${escape(preview.slice(0, 240) || 'Empty note')}</button><div class="note-location">${folderLabel}</div><div class="note-tags">${labels}${reminder}${note.agentShared ? `<span class="tag ai-mark">${icon('spark')}Shared with AI</span>` : ''}</div><div class="card-proposals">${proposalsHtml(note)}</div><div class="note-bottom"><time class="note-date" datetime="${escape(note.updatedAt)}" title="Edited ${escape(new Date(note.updatedAt).toLocaleString())}">${humanDate(note.updatedAt)}</time><div class="note-actions">${actions}</div></div></article>`;
}
async function render() {
  const version = ++renderVersion;
  const ops = await allOperations();
  const fetched = materialize(ops);
  if (version !== renderVersion) return;
  notes = fetched;
  aiPermissions = materializeAgentPermissions(ops);
  renderAiPermissions();
  folders = materializeFolders(ops);
  ownDeviceId ??= await settings.get('deviceId');
  renderFolderNavigation();
  pendingConflicts = conflicts(ops).filter(c => { const note = notes.find(n => n.id === c.noteId); return note && !note.trashed && (!c.itemId || note.items.some(i => i.id === c.itemId)); });
  $('#conflicts-nav').hidden = !pendingConflicts.length && view !== 'conflicts';
  $('#conflict-count').textContent = pendingConflicts.length;
  const active = notes.filter(n => !n.trashed && !n.archived);
  $('#note-count').textContent = active.length;
  const labels = [...new Set(notes.filter(n => !n.trashed).flatMap(n => n.labels))].sort();
  $('#labels-nav').innerHTML = labels.map(label => `<button class="nav-button ${view === `label:${label}` ? 'active' : ''}" data-label="${escape(label)}"><span class="label-dot"></span>${escape(label)}</button>`).join('');
  updateLabelSuggestions();
  const currentFolder = view.startsWith('folder:') ? folderById(view.slice(7)) : null;
  const folderName = view.startsWith('folder:') ? currentFolder?.name || 'Folder' : null;
  const metadata = views[view] || [folderName || view.slice(6), folderName || view.slice(6), 'A little collection of related thoughts.'];
  $('#view-title').textContent = metadata[0]; $('#view-description').textContent = metadata[2];
  document.title = `${metadata[0]} — SyncAboutIt`;
  const ancestors = []; let ancestor = currentFolder;
  while (ancestor) { ancestors.unshift(ancestor); ancestor = folderById(ancestor.parentId); }
  $('#breadcrumbs').innerHTML = `<button data-folder="">All notes</button>${ancestors.length ? ancestors.map((f, i) => `<span>/</span>${i === ancestors.length - 1 ? `<strong aria-current="page">${escape(f.name)}</strong>` : `<button data-folder="${f.id}">${escape(f.name)}</button>`}`).join('') : view !== 'notes' ? `<span>/</span><strong aria-current="page">${escape(metadata[0])}</strong>` : ''}`;
  $('#search').placeholder = searchScope === 'all' ? 'Search all active notes' : `Search ${metadata[0].toLowerCase()}`;
  $('#search-scope option[value="view"]').textContent = currentFolder ? 'This folder' : 'This view';
  $('#search-summary').hidden = !query || view === 'conflicts';
  $('.toolbar').hidden = view === 'conflicts';
  $('.quick-capture').hidden = ['archive', 'trash', 'conflicts'].includes(view) || selectionMode || !!query;
  $('#select-notes').hidden = ['trash', 'conflicts'].includes(view);
  $('#bulk-toolbar').hidden = !selectionMode;
  $('#sort-notes').disabled = view === 'reminders' && !(query && searchScope === 'all');
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  document.querySelectorAll('.sidebar .nav-button').forEach(el => { if (el.classList.contains('active')) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  const folderBar = $('#folder-bar');
  folderBar.hidden = !currentFolder;
  if (currentFolder) {
    const parent = currentFolder.parentId ? folderById(currentFolder.parentId) : null;
    const children = folders.filter(f => f.parentId === currentFolder.id);
    folderBar.innerHTML = `<div class="folder-chips">${parent ? `<button type="button" class="tag" data-folder="${parent.id}">↑ ${escape(parent.name)}</button>` : '<button type="button" class="tag" data-folder="">↑ All notes</button>'}${children.map(f => `<button type="button" class="tag" data-folder="${f.id}">${icon('folder')}${escape(f.name)}</button>`).join('')}</div><div class="folder-tools"><button type="button" class="text-button" data-rename-folder="${currentFolder.id}">Rename</button><button type="button" class="text-button" data-delete-folder="${currentFolder.id}">Delete folder</button></div>`;
  }
  if (view === 'conflicts') {
    $('#view-notice').hidden = true;
    $('#notes-container').innerHTML = pendingConflicts.length ? `<div class="notes-grid">${pendingConflicts.map(conflictCard).join('')}</div>` : '';
    $('#empty-state').hidden = pendingConflicts.length > 0;
    $('#empty-state h2').textContent = 'Nothing to review.'; $('#empty-state p').textContent = 'Simultaneous edits to the same field will appear here.';
    $('#load-examples').hidden = true;
    $('#empty-create').hidden = true;
    return;
  }
  const selected = selectNotes(notes, { view, query, scope: searchScope, sort: sortOrder, readAll: aiPermissions.readAll });
  visibleNotes = selected;
  selectedIds = new Set([...selectedIds].filter(id => selected.some(note => note.id === id)));
  updateSelection();
  $('#search-results').textContent = `${selected.length} result${selected.length === 1 ? '' : 's'} in ${searchScope === 'all' ? 'all active notes' : metadata[0]}`;
  const notice = $('#view-notice');
  notice.hidden = !['opportunities', 'agents', 'reminders'].includes(view);
  notice.textContent = view === 'opportunities' ? 'Share a note with AI to receive place suggestions. Accept a place here, then confirm it in the Android app to monitor on that phone.' : view === 'agents' ? `${aiPermissions.readAll ? 'AI can view all active notes.' : 'Only individually shared notes are visible to AI.'} Automatic creation is ${aiPermissions.createNotes ? 'on' : 'off'}. Checklist additions require individual sharing. Manage access in Settings.` : 'Browser reminders need this app open. The Android app can notify you in the background. Enable notifications in Settings.';
  const groups = groupNotes(selected, { view: query && searchScope === 'all' ? 'notes' : view, title: query ? 'Search results' : metadata[0] });
  $('#notes-container').innerHTML = groups.filter(([, list]) => list.length).map(([title, list, glyph]) => `<div class="section-heading">${icon(glyph)}${escape(title.toUpperCase())}<span class="section-count">${list.length}</span></div><div class="notes-grid">${list.map(card).join('')}</div>`).join('');
  $('#empty-state').hidden = selected.length > 0;
  $('#empty-state h2').textContent = query ? 'No matching notes.' : view === 'notes' ? 'A little space to think.' : view === 'unfiled' ? 'Everything has a home.' : `No ${metadata[0].toLowerCase()} yet.`;
  $('#empty-state p').textContent = query ? 'Try another word or change the search scope to all active notes.' : view === 'trash' ? 'Notes you move to Trash can be restored here.' : view === 'archive' ? 'Archived notes stay here until you need them again.' : view === 'unfiled' ? 'New notes without a folder will appear here.' : view === 'reminders' ? 'Add a date and time to a note to see it here.' : view === 'opportunities' ? 'Save something you’d like to find and choose a place reminder.' : 'Add a note, start a checklist, or save an idea for another day.';
  $('#empty-create').hidden = !!query || ['trash', 'archive'].includes(view);
  $('#load-examples').hidden = notes.length > 0 || !!query || view !== 'notes';
}
async function status() {
  const connected = await isConnected(), last = await settings.get('lastSync');
  $('#drive-status').textContent = connected ? 'Google Drive connected' : 'Saved on this device';
  $('#drive-detail').textContent = connected ? (last ? `Last synced ${new Date(last).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}. Changes sync while this app is open.` : 'Ready to sync your notes to your private app folder.') : 'Connect Drive to take your notes with you.';
  $('#connect-drive').innerHTML = connected ? 'Sync now <span>↻</span>' : 'Connect Google Drive <span>↗</span>';
}
async function sync(manual = false) {
  if (syncPromise) return syncPromise;
  if (!await isConnected()) { if (manual) toast('Connect Google Drive in Settings to sync.'); return; }
  syncPromise = (async () => {
    $('#save-status').textContent = 'Syncing…'; $('#sync-button').disabled = true;
    try {
      const result = await new Drive(getToken).sync(await allOperations());
      await navigator.locks.request('syncaboutit-write', () => ingest(result));
      await settings.set('lastSync', new Date().toISOString());
      if ($('#ai-permissions-status').textContent) $('#ai-permissions-status').textContent = 'AI permissions synced with Drive.';
      $('#save-status').innerHTML = '<span class="status-dot"></span> Synced with Drive';
      await render(); await status();
      if (manual) toast('Your notes are synced.');
    } catch (error) {
      $('#save-status').textContent = 'Saved locally · sync paused';
      if (manual) toast(error.message);
    } finally { $('#sync-button').disabled = false; syncPromise = null; }
  })();
  return syncPromise;
}
function scheduleSync() { clearTimeout(syncTimer); $('#save-status').innerHTML = '<span class="status-dot"></span> Saved locally'; syncTimer = setTimeout(() => sync(), 2000); }
function renderItems() {
  $('#edit-items').innerHTML = draftItems.map((item, index) => `<div class="edit-item"><input type="checkbox" data-index="${index}" data-field="checked" aria-label="Item ${index + 1} completed" ${item.checked ? 'checked' : ''}><input type="text" data-index="${index}" data-field="text" aria-label="Item ${index + 1}" value="${escape(item.text)}" placeholder="List item" maxlength="10000"><button type="button" class="icon-button" data-remove-item="${index}" aria-label="Remove item ${index + 1}">×</button></div>`).join('');
}
function renderMarkdownPreview() { $('#edit-markdown-preview').innerHTML = kind === 'markdown' ? renderMarkdown($('#edit-body').value) : ''; }
function renderKind() {
  $('#edit-body').hidden = kind === 'list' || (kind === 'markdown' && markdownMode === 'preview');
  $('#edit-markdown-preview').hidden = kind !== 'markdown' || markdownMode !== 'preview';
  $('#markdown-modes').hidden = kind !== 'markdown';
  $('#edit-body').placeholder = kind === 'markdown' ? 'Write Markdown…' : 'Start anywhere…';
  $('#edit-items').hidden = $('#add-item').hidden = kind !== 'list';
  document.querySelectorAll('[data-kind]').forEach(el => { el.classList.toggle('selected', el.dataset.kind === kind); el.setAttribute('aria-pressed', String(el.dataset.kind === kind)); });
  document.querySelectorAll('[data-markdown-mode]').forEach(el => { el.classList.toggle('selected', el.dataset.markdownMode === markdownMode); el.setAttribute('aria-pressed', String(el.dataset.markdownMode === markdownMode)); });
  renderMarkdownPreview();
}
function renderColors() { $('#color-options').innerHTML = COLORS.map(c => `<button type="button" class="color-swatch ${color === c ? 'selected' : ''}" style="--swatch:var(--${c})" data-color="${c}" aria-label="${c} color" aria-pressed="${color === c}"></button>`).join(''); }
function reminderFields() { const type = $('#reminder-type').value; $('#time-fields').hidden = type !== 'time'; $('#opportunity-fields').hidden = type !== 'opportunity'; $('#reminder-summary').textContent = type === 'time' ? 'Date & time' : type === 'opportunity' ? 'Nearby place' : 'None'; }
function openEditor(note = null, mode = 'note', title = '') {
  closeNavigation(false);
  markdownMode = 'write';
  current = note ? structuredClone(note) : null;
  kind = note?.kind || mode; color = note?.color || 'paper';
  $('#edit-title').value = note?.title || title; $('#edit-body').value = note?.body || '';
  $('#edit-labels').value = note ? note.labels.join(', ') : (view.startsWith('label:') ? view.slice(6) : '');
  $('#edit-folder').innerHTML = folderOptions(note ? note.folderId || '' : (view.startsWith('folder:') ? view.slice(7) : ''));
  $('#edit-sources').innerHTML = note?.sources.length ? `<details class="sources"><summary>${icon('link')} ${note.sources.length} saved source${note.sources.length > 1 ? 's' : ''}</summary>${note.sources.map(sourceHtml).join('')}</details>` : '';
  $('#edit-pinned').checked = note?.pinned || false; $('#edit-shared').checked = note?.agentShared || false;
  draftItems = structuredClone(note?.items || []);
  if (kind === 'list' && !draftItems.length) draftItems.push({ id: crypto.randomUUID(), text: '', checked: false, order: 0 });
  const reminder = note?.reminder;
  $('#reminder-type').value = note ? reminder?.type || 'none' : (view === 'opportunities' ? 'opportunity' : view === 'reminders' ? 'time' : 'none');
  $('#reminder-at').value = reminder?.type === 'time' ? new Date(new Date(reminder.at).getTime() - new Date(reminder.at).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  $('#reminder-query').value = reminder?.query || ''; $('#reminder-place').value = reminder?.place || '';
  $('.reminder-details').open = $('#reminder-type').value !== 'none';
  $('#editor-heading').textContent = note ? 'Edit note' : 'New note';
  $('#organize-note').open = false; $('#sharing-options').open = false;
  $('#editor').classList.toggle('expanded', kind === 'markdown'); updateExpandButton();
  editorBaseline = editorState(); updateEditorStatus(); updateLabelSuggestions();
  renderItems(); renderKind(); renderColors(); reminderFields(); $('#editor').showModal(); $('#edit-title').focus();
}
$('#editor-form').addEventListener('submit', attempt(async event => {
  event.preventDefault();
  const submit = event.submitter; submit.disabled = true;
  editorSaving = true;
  $('#editor-form').inert = true;
  try {
    const id = current?.id || crypto.randomUUID();
    let reminder = null;
    if ($('#reminder-type').value === 'time') {
      if (!$('#reminder-at').value) throw new Error('Choose a date and time for your reminder.');
      reminder = { type: 'time', at: new Date($('#reminder-at').value).toISOString() };
    }
    if ($('#reminder-type').value === 'opportunity') {
      if (!$('#reminder-query').value.trim()) throw new Error('Add what you’d like to find.');
      reminder = { type: 'opportunity', query: $('#reminder-query').value.trim(), place: $('#reminder-place').value.trim() };
    }
    const values = { title: $('#edit-title').value.trim(), body: $('#edit-body').value, kind, color, labels: [...new Set($('#edit-labels').value.split(',').map(x => x.trim()).filter(Boolean))], folderId: $('#edit-folder').value || null, pinned: $('#edit-pinned').checked, agentShared: $('#edit-shared').checked, reminder };
    // Write only edited fields, preserving unrelated changes that arrived while editing.
    const patch = Object.fromEntries(Object.entries(values).filter(([key, value]) => !current || JSON.stringify(current[key]) !== JSON.stringify(value)));
    if (Object.keys(patch).length) await change(id, 'note.patch', patch);
    for (const [index, item] of draftItems.filter(i => i.text.trim()).entries()) {
      const before = current?.items.find(i => i.id === item.id);
      const after = { text: item.text.trim(), checked: item.checked, order: index };
      const changed = Object.fromEntries(Object.entries(after).filter(([key, value]) => !before || before[key] !== value));
      if (Object.keys(changed).length) await change(id, 'item.put', { id: item.id, ...changed });
    }
    for (const item of current?.items || []) if (!draftItems.some(i => i.id === item.id && i.text.trim())) await change(id, 'item.remove', { id: item.id });
    $('#editor').close(); $('#quick-title').value = ''; await render(); scheduleSync(); toast('Note saved.');
  } finally { submit.disabled = false; editorSaving = false; $('#editor-form').inert = false; }
}));
$('#edit-items').addEventListener('input', event => { const el = event.target; if (el.dataset.field) draftItems[Number(el.dataset.index)][el.dataset.field] = el.type === 'checkbox' ? el.checked : el.value; });
$('#edit-items').addEventListener('click', event => { const el = event.target.closest('[data-remove-item]'); if (el) { draftItems.splice(Number(el.dataset.removeItem), 1); renderItems(); updateEditorStatus(); } });
$('#add-item').onclick = () => { draftItems.push({ id: crypto.randomUUID(), text: '', checked: false, order: draftItems.length }); renderItems(); updateEditorStatus(); $('#edit-items .edit-item:last-child input[type=text]').focus(); };
document.querySelectorAll('[data-kind]').forEach(el => { el.onclick = () => { kind = el.dataset.kind; renderKind(); updateEditorStatus(); }; });
$('#edit-body').addEventListener('input', renderMarkdownPreview);
$('#color-options').onclick = event => { const el = event.target.closest('[data-color]'); if (el) { color = el.dataset.color; renderColors(); updateEditorStatus(); } };
$('#reminder-type').onchange = reminderFields;
document.querySelectorAll('[data-close]').forEach(el => { el.onclick = () => el.dataset.close === 'editor' ? closeEditor() : $(`#${el.dataset.close}`).close(); });
document.querySelectorAll('[data-view]').forEach(el => { el.onclick = attempt(async () => navigate(el.dataset.view)); });
$('#labels-nav').onclick = attempt(async event => { const el = event.target.closest('[data-label]'); if (el) await navigate(`label:${el.dataset.label}`); });
$('#search').oninput = attempt(async event => { query = event.target.value.toLowerCase().trim(); await render(); });
$('#empty-create').onclick = () => openEditor();
document.querySelectorAll('[data-create]').forEach(el => { el.onclick = () => { $('#create-menu').hidePopover(); openEditor(null, el.dataset.create); }; });
$('#quick-list').onclick = () => openEditor(null, 'list', $('#quick-title').value);
$('#quick-add').onclick = () => openEditor(null, 'note', $('#quick-title').value);
$('#quick-title').onkeydown = event => { if (event.key === 'Enter') openEditor(null, 'note', event.target.value); };
$('#add-label').onclick = () => { openEditor(); $('#organize-note').open = true; $('#edit-labels').focus(); };
$('#import-markdown').onclick = () => { $('#create-menu').hidePopover(); $('#markdown-file').click(); };
$('#markdown-file').onchange = attempt(async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const body = await file.text();
    if (body.length > 100000) throw new Error('Markdown documents must be 100,000 characters or less.');
    openEditor(null, 'markdown', markdownTitle(body, file.name));
    $('#edit-body').value = body; renderMarkdownPreview(); updateEditorStatus();
  } finally { event.target.value = ''; }
});
$('#layout-button').onclick = attempt(async () => { listLayout = !listLayout; updateLayout(); await settings.set('listLayout', listLayout); });
$('#notes-container').onclick = attempt(async event => {
  const resolve = event.target.closest('[data-conflict]');
  if (resolve) {
    const conflict = pendingConflicts[Number(resolve.dataset.conflict)]; if (!conflict) return;
    const value = resolve.dataset.choice === 'current' ? conflict.current.value : conflict.overridden[Number(resolve.dataset.choice)].value;
    // A fresh write sorts after both versions, so every device converges on the chosen value.
    await change(conflict.noteId, conflict.itemId ? 'item.put' : 'note.patch', conflict.itemId ? { id: conflict.itemId, [conflict.field]: value } : { [conflict.field]: value });
    await render(); scheduleSync(); toast('Kept the version you chose.');
    return;
  }
  const el = event.target.closest('[data-action]'); if (!el) return;
  const note = notes.find(n => n.id === el.dataset.id); if (!note) return;
  el.closest('[popover]')?.hidePopover();
  if (el.dataset.action === 'folder') { await navigate(`folder:${note.folderId}`); return; }
  if (el.dataset.action === 'label') { await navigate(`label:${el.dataset.label}`); return; }
  if (el.dataset.action === 'edit') { if (note.trashed) { toast('Restore this note before editing.'); return; } openEditor(note); return; }
  if (['accept-place', 'dismiss-place'].includes(el.dataset.action)) {
    const accepted = el.dataset.action === 'accept-place';
    await change(note.id, 'place.review', { id: el.dataset.proposal, status: accepted ? 'accepted' : 'dismissed' }); await render(); scheduleSync();
    toast(accepted ? 'Place accepted. Confirm it on your phone to start monitoring.' : 'Suggestion dismissed.');
    return;
  }
  const patches = { pin: { pinned: !note.pinned }, archive: { archived: !note.archived }, trash: { trashed: true }, restore: { trashed: false } };
  await change(note.id, 'note.patch', patches[el.dataset.action]); await render(); scheduleSync();
  if (el.dataset.action === 'trash') toast('Moved to Trash. You can restore it any time.');
});
$('#notes-container').onchange = attempt(async event => {
  if (event.target.dataset.selectNote) { const id = event.target.dataset.selectNote; event.target.checked ? selectedIds.add(id) : selectedIds.delete(id); updateSelection(); return; }
  const el = event.target; if (!el.dataset.item) return;
  try { await change(el.dataset.note, 'item.put', { id: el.dataset.item, checked: el.checked }); await render(); scheduleSync(); }
  catch (error) { el.checked = !el.checked; throw error; }
});
function renderAiPermissions() {
  $('#ai-auto-view').checked = aiPermissions.readAll;
  $('#ai-auto-create').checked = aiPermissions.createNotes;
  $('#edit-ai-help').textContent = aiPermissions.readAll ? 'AI can already view active notes. Sharing also allows checklist additions.' : 'Connected agents can read this note and add checklist items.';
}
async function openSettings(section = 'appearance') { closeNavigation(false); $('#client-id').value = await settings.get('googleClientId') || ''; $('#redirect-uri').textContent = redirectUri(); aiPermissions = materializeAgentPermissions(await allOperations()); renderAiPermissions(); renderFolderManager(); showSettings(section); await updateConnectionSettings(); if (!$('#settings-dialog').open) $('#settings-dialog').showModal(); }
document.querySelectorAll('[data-permission]').forEach(input => {
  input.onchange = attempt(async () => {
    const enabled = input.checked;
    input.disabled = true;
    try {
      await change(AGENT_PERMISSIONS_ID, 'permissions.patch', { [input.dataset.permission]: enabled });
      await render(); scheduleSync();
      $('#ai-permissions-status').textContent = 'Permissions saved. Sync with Drive to apply them to connected agents.';
    } catch (error) { input.checked = !enabled; throw error; }
    finally { input.disabled = false; }
  });
});
$('#settings-button').onclick = $('#mobile-settings').onclick = attempt(() => openSettings());
$('#settings-form').onsubmit = attempt(async event => { event.preventDefault(); const id = $('#client-id').value.trim(); if (id && !id.endsWith('.apps.googleusercontent.com')) throw new Error('Enter a valid Google OAuth client ID.'); await settings.set('googleClientId', id); toast('Connection settings saved.'); });
const connectDrive = attempt(async () => { if (await isConnected()) { await sync(true); await updateConnectionSettings(); return; } await connect(); await status(); await sync(true); await updateConnectionSettings(); });
$('#settings-connect').onclick = connectDrive;
$('#connect-drive').onclick = connectDrive;
$('#sync-button').onclick = connectDrive;
$('#disconnect').onclick = attempt(async () => { await disconnect(); await status(); await updateConnectionSettings(); $('#save-status').textContent = 'Saved locally'; toast('Disconnected on this device. Your notes are still here.'); });
$('#export').onclick = attempt(async () => { const blob = new Blob([JSON.stringify({ app: 'syncaboutit', schema: 1, operations: await allOperations() }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `syncaboutit-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
$('#import').onclick = () => $('#import-file').click();
$('#import-file').onchange = attempt(async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('Choose a backup smaller than 20 MB.');
    const backup = JSON.parse(await file.text());
    if (backup.app !== 'syncaboutit' || backup.schema !== 1 || !Array.isArray(backup.operations)) throw new Error('This is not a supported SyncAboutIt backup.');
    materialize(backup.operations);
    await navigator.locks.request('syncaboutit-write', () => ingest(backup.operations)); await render(); scheduleSync(); toast('Backup merged with your notes.');
  } finally { event.target.value = ''; }
});
$('#enable-notifications').onclick = attempt(async () => { if (!('Notification' in window)) throw new Error('This browser doesn’t support notifications.'); const result = await Notification.requestPermission(); toast(result === 'granted' ? 'Notifications enabled while the app is open.' : 'Notifications are disabled in your browser settings.'); });
async function reminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  await navigator.locks.request('syncaboutit-reminders', async () => {
    const fired = await settings.get('firedReminders') || {};
    for (const note of await allNotes()) {
      if (note.trashed || note.archived || note.reminder?.type !== 'time') continue;
      const key = `${note.id}:${note.reminder.at}`;
      if (Date.parse(note.reminder.at) <= Date.now() && !fired[key]) {
        const content = { body: note.kind === 'list' ? note.items.filter(i => !i.checked).map(i => i.text).slice(0, 5).join(', ') : note.body.slice(0, 180), icon: './icons/icon-128.png', tag: key };
        const registration = await navigator.serviceWorker?.getRegistration();
        if (registration) await registration.showNotification(note.title || 'A little reminder', content);
        else new Notification(note.title || 'A little reminder', content);
        fired[key] = true;
      }
    }
    await settings.set('firedReminders', fired);
  });
}
$('#load-examples').onclick = attempt(async () => {
  const examples = [
    { title: 'A few things for the week', kind: 'list', color: 'sage', pinned: true, labels: ['Shopping'], items: ['Oat milk', 'Fresh sourdough', 'Avocados', 'Something for Sunday dinner'] },
    { title: 'The little home office project', body: 'A corner that feels like mine.\n\nA bigger desk, a warmer light, and a place for all the ideas that tend to land on loose paper.\n\nStart with the light. The rest can follow.', color: 'peach', pinned: true, labels: ['Projects'] },
    { title: 'Good things take their time', body: 'An idea doesn’t have to be ready to be worth writing down.\n\nLeave a little room for the things you haven’t figured out yet.', color: 'paper', labels: ['Personal'] },
    { title: 'For the next hardware store trip', kind: 'list', color: 'sand', labels: ['Shopping', 'Projects'], items: ['Warm white desk bulb', 'Picture hanging strips', 'A small terracotta pot'], reminder: { type: 'opportunity', query: 'Warm white desk bulb', place: 'Hardware store' } },
    { title: 'A weekend, somewhere green', body: 'A trail without a schedule. Coffee in a flask. No particular destination.\n\nLook for a spot with a lake, and leave early enough to watch the morning happen.', color: 'sky', labels: ['Personal'] },
    { title: 'Things to explore', kind: 'list', color: 'lavender', labels: ['Ideas'], items: ['A better way to save recipes', 'Learn a little pottery', 'Make something just for fun'] },
  ];
  for (const example of examples) {
    const { items, ...data } = example, id = crypto.randomUUID();
    await change(id, 'note.patch', { kind: 'note', ...data });
    for (const [order, text] of (items || []).entries()) await change(id, 'item.put', { id: crypto.randomUUID(), text, checked: order === 0, order });
  }
  await render(); scheduleSync(); toast('Example notes added. Make them your own.');
});
document.addEventListener('keydown', event => { if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); $('#search').focus(); } });
window.addEventListener('notes-changed', () => { render().catch(error => toast(error.message)); scheduleSync(); });
window.addEventListener('online', () => sync());
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render().catch(error => toast(error.message)); sync(); } });
async function start() {
  await finishSignIn();
  listLayout = !!await settings.get('listLayout'); updateLayout();
  sortOrder = await settings.get('sortOrder') || 'updated'; $('#sort-notes').value = sortOrder;
  collapsedFolders = new Set(await settings.get('collapsedFolders') || []);
  updateNavigationMode();
  if (!globalThis.chrome?.runtime?.id && 'serviceWorker' in navigator) await navigator.serviceWorker.register('./sw.js');
  await render(); await status(); await loadClip(); await sync();
  setInterval(() => sync(), 60000);
  setInterval(() => { reminders().catch(error => console.warn(error.message)); if (view === 'reminders' && !document.querySelector('dialog[open]')) render().catch(error => toast(error.message)); }, 30000);
}
function sourceHtml(source) {
  return `<div class="source-block"><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.title || new URL(source.url).hostname)} ↗</a><small>${escape(source.url)}</small><small>Captured ${escape(new Date(source.capturedAt).toLocaleString())}</small>${source.selection ? `<blockquote>${escape(source.selection)}</blockquote>` : ''}</div>`;
}
function openFolder(folder = null, returnTo = null) {
  closeNavigation(false);
  editingFolder = folder; folderReturnTo = returnTo; $('#folder-name').value = folder?.name || '';
  // A new folder starts inside the folder being viewed; an existing one cannot move under itself.
  $('#folder-parent').innerHTML = folderOptions(folder ? folder.parentId || '' : view.startsWith('folder:') ? view.slice(7) : '', folder?.id, 'Top level');
  $('#folder-heading').textContent = folder ? 'Rename or move this folder.' : 'A home for related thoughts.';
  $('#folder-dialog').showModal(); $('#folder-name').focus();
}
function renderFolderManager() { $('#manage-folders').innerHTML = folderTree(folders).map(folder => `<div class="folder-row" style="--depth:${folder.depth}"><button data-open-folder="${folder.id}">${icon('folder')}${escape(folder.name)}</button><span><button class="text-button" data-rename-folder="${folder.id}">Rename</button><button class="text-button" data-delete-folder="${folder.id}">Delete</button></span></div>`).join(''); }
$('#add-folder').onclick = $('#settings-add-folder').onclick = () => openFolder();
$('#edit-create-folder').onclick = () => openFolder(null, 'editor');
$('#folder-dialog').addEventListener('close', () => { folderReturnTo = null; });
$('#folder-form').onsubmit = attempt(async event => {
  event.preventDefault(); const name = $('#folder-name').value.trim(); if (!name) throw new Error('Give this folder a name.');
  const parentId = $('#folder-parent').value || null;
  if (parentId && (parentId === editingFolder?.id || descendants(editingFolder?.id).has(parentId))) throw new Error('A folder cannot sit inside itself.');
  if (folders.some(f => f.name.toLowerCase() === name.toLowerCase() && f.parentId === parentId && f.id !== editingFolder?.id)) throw new Error('That folder already exists here.');
  const id = editingFolder?.id || crypto.randomUUID(), returnTo = folderReturnTo;
  await change(id, 'folder.put', { name, parentId }); $('#folder-dialog').close();
  if (returnTo !== 'editor') view = `folder:${id}`;
  await render(); renderFolderManager();
  if (returnTo === 'editor') { $('#edit-folder').innerHTML = folderOptions(id); updateEditorStatus(); }
  scheduleSync(); toast(returnTo === 'editor' ? 'Folder created and selected for this note.' : 'Folder saved. Choose it when editing a note.');
});
async function deleteFolder(id) {
  const folder = folderById(id); if (!folder) return;
  const inside = notes.filter(n => n.folderId === id), children = folders.filter(f => f.parentId === id);
  const destination = folder.parentId ? folderById(folder.parentId)?.name : null;
  if (!confirm(`Delete “${folder.name}”? ${inside.length} note${inside.length === 1 ? '' : 's'} and ${children.length} subfolder${children.length === 1 ? '' : 's'} will move to ${destination ? `“${destination}”` : 'the top level'}. Notes are never deleted with a folder.`)) return;
  // Explicit moves keep memberships readable on every device, even ones that never see the removal.
  for (const note of inside) await change(note.id, 'note.patch', { folderId: folder.parentId });
  for (const child of children) await change(child.id, 'folder.put', { name: child.name, parentId: folder.parentId });
  await change(id, 'folder.remove', {});
  if (view === `folder:${id}`) view = folder.parentId ? `folder:${folder.parentId}` : 'notes';
  await render(); renderFolderManager(); scheduleSync(); toast('Folder deleted. Its notes are still here.');
}
$('#folders-nav').onclick = attempt(async event => {
  const toggle = event.target.closest('[data-collapse-folder]');
  if (toggle) { const id = toggle.dataset.collapseFolder; collapsedFolders.has(id) ? collapsedFolders.delete(id) : collapsedFolders.add(id); renderFolderNavigation(); $(`[data-collapse-folder="${id}"]`)?.focus(); await settings.set('collapsedFolders', [...collapsedFolders]); return; }
  const el = event.target.closest('[data-folder]'); if (el) await navigate(`folder:${el.dataset.folder}`);
});
$('#folder-bar').onclick = attempt(async event => {
  const open = event.target.closest('[data-folder]'), rename = event.target.closest('[data-rename-folder]'), remove = event.target.closest('[data-delete-folder]');
  if (open) await navigate(open.dataset.folder ? `folder:${open.dataset.folder}` : 'notes');
  if (rename) openFolder(folderById(rename.dataset.renameFolder));
  if (remove) await deleteFolder(remove.dataset.deleteFolder);
});
$('#manage-folders').onclick = attempt(async event => {
  const rename = event.target.closest('[data-rename-folder]'), open = event.target.closest('[data-open-folder]'), remove = event.target.closest('[data-delete-folder]');
  if (rename) openFolder(folderById(rename.dataset.renameFolder));
  if (remove) await deleteFolder(remove.dataset.deleteFolder);
  if (open) { view = `folder:${open.dataset.openFolder}`; $('#settings-dialog').close(); await render(); }
});
async function loadClip() {
  const id = new URLSearchParams(location.search).get('capture');
  if (!id || !globalThis.chrome?.storage?.session) return;
  pendingClip = (await chrome.storage.session.get(`clip:${id}`))[`clip:${id}`];
  if (!pendingClip) return;
  validateOperation({ schema: 1, id: crypto.randomUUID(), deviceId: 'clip', noteId: 'clip', clock: 1, at: new Date().toISOString(), type: 'source.add', data: pendingClip });
  $('#clip-preview').textContent = pendingClip.selection || 'Save a link to this page.';
  $('#clip-source').innerHTML = sourceHtml({ ...pendingClip, selection: '' });
  const active = notes.filter(n => !n.trashed && !n.archived);
  const destinationGroup = (label, list) => list.length ? `<optgroup label="${label}">${list.map(note => { const folder = folders.find(candidate => candidate.id === note.folderId); return `<option value="existing:${note.id}">${escape(note.title || 'Untitled')}${folder ? ` — ${escape(folder.name)}` : ''}</option>`; }).join('')}</optgroup>` : '';
  $('#clip-destination').innerHTML = '<optgroup label="Create new"><option value="new:note">New note</option><option value="new:list">New checklist</option><option value="new:markdown">New Markdown document</option></optgroup>' + destinationGroup('Existing checklists', active.filter(note => note.kind === 'list')) + destinationGroup('Existing Markdown documents', active.filter(note => note.kind === 'markdown')) + destinationGroup('Existing notes', active.filter(note => note.kind === 'note'));
  $('#clip-title').value = pendingClip.title.slice(0, 300);
  $('#clip-folder').innerHTML = folderOptions();
  renderClipDestinationFields();
  $('#clip-dialog').showModal();
}
function renderClipDestinationFields() { $('#clip-new-fields').hidden = $('#clip-destination').value.startsWith('existing:'); }
$('#clip-destination').onchange = renderClipDestinationFields;
$('#clip-form').onsubmit = attempt(async event => {
  event.preventDefault(); if (!pendingClip) return;
  const submit = event.submitter; submit.disabled = true;
  try {
    const destination = $('#clip-destination').value;
    const creating = destination.startsWith('new:');
    const id = creating ? crypto.randomUUID() : destination.slice('existing:'.length);
    const note = (await allNotes()).find(n => n.id === id);
    if (!creating && !note) throw new Error('This note is no longer available. Choose another destination.');
    if (note?.trashed) throw new Error('This note was moved to Trash. Choose another note.');
    // A source is append-only: its original text survives later edits to the note body.
    await change(id, 'source.add', pendingClip);
    if (creating) {
      const kind = destination === 'new:list' ? 'list' : destination === 'new:markdown' ? 'markdown' : 'note';
      const title = $('#clip-title').value.trim() || pendingClip.title.slice(0, 300) || (kind === 'list' ? 'New checklist' : 'New note');
      await change(id, 'note.patch', { title, body: kind === 'list' ? '' : pendingClip.selection || pendingClip.url, kind, folderId: $('#clip-folder').value || null, labels: ['Web clips'] });
      if (kind === 'list') await change(id, 'item.put', { id: crypto.randomUUID(), text: (pendingClip.selection || pendingClip.url).slice(0, 10000), checked: false, order: 0 });
    }
    else if (note.kind === 'list') await change(id, 'item.put', { id: crypto.randomUUID(), text: (pendingClip.selection || pendingClip.url).slice(0, 10000), checked: false, order: Math.max(-1, ...note.items.map(i => i.order)) + 1 });
    else await change(id, 'note.patch', { body: [note.body, pendingClip.selection || pendingClip.url].filter(Boolean).join('\n\n').slice(0, 100000) });
    await chrome.storage.session.remove(`clip:${pendingClip.id}`); pendingClip = null; history.replaceState(null, '', location.pathname); $('#clip-dialog').close(); view = 'notes'; await render(); scheduleSync(); toast('Web clip saved, with its source and capture date.');
  } finally { submit.disabled = false; }
});
function renderFolderNavigation() {
  const tree = folderTree(folders);
  const hidden = new Set();
  $('#folders-nav').innerHTML = tree.map(folder => {
    if (hidden.has(folder.parentId) || collapsedFolders.has(folder.parentId)) { hidden.add(folder.id); return ''; }
    const children = folders.some(f => f.parentId === folder.id);
    return `<div class="folder-nav-row" style="--depth:${folder.depth}">${children ? `<button class="folder-disclosure icon-button" data-collapse-folder="${folder.id}" aria-label="${collapsedFolders.has(folder.id) ? 'Expand' : 'Collapse'} ${escape(folder.name)}" aria-expanded="${!collapsedFolders.has(folder.id)}">${collapsedFolders.has(folder.id) ? '›' : '⌄'}</button>` : '<span class="folder-disclosure"></span>'}<button class="nav-button ${view === `folder:${folder.id}` ? 'active' : ''}" data-folder="${folder.id}">${icon('folder')}<span>${escape(folder.name)}</span></button></div>`;
  }).join('') || '<p class="nav-hint">Give related notes a home.</p>';
}

async function navigate(next) {
  view = next; selectionMode = false; selectedIds.clear();
  $('#select-notes').setAttribute('aria-pressed', 'false');
  closeNavigation(false);
  await render();
  $('#view-title').tabIndex = -1; $('#view-title').focus({ preventScroll: true });
}
$('#breadcrumbs').onclick = attempt(async event => { const el = event.target.closest('[data-folder]'); if (el) await navigate(el.dataset.folder ? `folder:${el.dataset.folder}` : 'notes'); });

function closeNavigation(restoreFocus = true) {
  const wasOpen = document.body.classList.contains('navigation-open');
  document.body.classList.remove('navigation-open');
  $('#navigation-backdrop').hidden = true; $('.main-shell').inert = false;
  $('#open-navigation').setAttribute('aria-expanded', 'false');
  $('#navigation').inert = mobileQuery.matches;
  if (wasOpen && restoreFocus) $('#open-navigation').focus();
}
function updateNavigationMode() {
  closeNavigation(false);
  if (mobileQuery.matches) { $('#navigation').setAttribute('role', 'dialog'); $('#navigation').setAttribute('aria-modal', 'true'); }
  else { $('#navigation').removeAttribute('role'); $('#navigation').removeAttribute('aria-modal'); }
}
$('#open-navigation').onclick = () => {
  $('#navigation').inert = false; document.body.classList.add('navigation-open');
  $('#navigation-backdrop').hidden = false; $('.main-shell').inert = true;
  $('#open-navigation').setAttribute('aria-expanded', 'true'); $('#close-navigation').focus();
};
$('#close-navigation').onclick = () => closeNavigation();
$('#navigation-backdrop').onclick = () => closeNavigation();
mobileQuery.addEventListener('change', updateNavigationMode);
document.addEventListener('keydown', event => {
  if (!document.body.classList.contains('navigation-open')) return;
  if (event.key === 'Escape') { event.preventDefault(); closeNavigation(); }
  if (event.key === 'Tab') {
    const items = [...$('#navigation').querySelectorAll('button, a[href]')].filter(el => !el.disabled && el.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

function updateLayout() {
  $('#notes-container').classList.toggle('list-layout', listLayout);
  const label = listLayout ? 'Switch to grid layout' : 'Switch to list layout';
  $('#layout-button').setAttribute('aria-label', label); $('#layout-button').title = label;
  $('#layout-button').innerHTML = icon(listLayout ? 'grid' : 'rows');
}
$('#search-scope').onchange = attempt(async event => { searchScope = event.target.value; await render(); });
$('#sort-notes').onchange = attempt(async event => { sortOrder = event.target.value; await settings.set('sortOrder', sortOrder); await render(); });
$('#clear-search').onclick = attempt(async () => { query = ''; $('#search').value = ''; await render(); $('#search').focus(); });

function updateSelection() {
  $('#selection-count').textContent = `${selectedIds.size} selected`;
  $('#select-all').checked = !!visibleNotes.length && selectedIds.size === visibleNotes.length;
  $('#select-all').indeterminate = selectedIds.size > 0 && selectedIds.size < visibleNotes.length;
  $('#bulk-move').disabled = $('#bulk-label').disabled = !selectedIds.size;
}
$('#select-notes').onclick = attempt(async () => { selectionMode = !selectionMode; selectedIds.clear(); $('#select-notes').setAttribute('aria-pressed', String(selectionMode)); await render(); });
$('#cancel-selection').onclick = attempt(async () => { selectionMode = false; selectedIds.clear(); $('#select-notes').setAttribute('aria-pressed', 'false'); await render(); $('#select-notes').focus(); });
$('#select-all').onchange = event => { selectedIds = new Set(event.target.checked ? visibleNotes.map(n => n.id) : []); document.querySelectorAll('[data-select-note]').forEach(el => { el.checked = selectedIds.has(el.dataset.selectNote); }); updateSelection(); };
function openBulk(action) {
  bulkAction = action; bulkIds = [...selectedIds];
  $('#bulk-heading').textContent = action === 'move' ? 'Move notes' : 'Add labels';
  $('#bulk-description').textContent = `${bulkIds.length} selected note${bulkIds.length === 1 ? '' : 's'}. ${action === 'label' ? 'Existing labels will be kept.' : 'Choose a new folder, or Unfiled.'}`;
  $('#bulk-folder-field').hidden = action !== 'move'; $('#bulk-label-field').hidden = action !== 'label';
  $('#bulk-folder').innerHTML = folderOptions('', null, 'Unfiled'); $('#bulk-labels').value = '';
  $('#bulk-dialog').showModal();
}
$('#bulk-move').onclick = () => openBulk('move'); $('#bulk-label').onclick = () => openBulk('label');
$('#bulk-form').onsubmit = attempt(async event => {
  event.preventDefault();
  const labels = [...new Set($('#bulk-labels').value.split(',').map(label => label.trim()).filter(Boolean))];
  if (bulkAction === 'label' && !labels.length) throw new Error('Enter at least one label.');
  const folderId = $('#bulk-folder').value || null;
  const submit = event.submitter; submit.disabled = true;
  let changed = 0;
  $('#bulk-form').inert = true;
  try {
    changed = await changeNotes(bulkIds, (note, operations) => {
      if (bulkAction === 'move' && folderId && !materializeFolders(operations).some(f => f.id === folderId)) throw new Error('That folder is no longer available. Reopen Move and choose another folder.');
      const merged = [...new Set([...note.labels, ...labels])];
      if (bulkAction === 'label' && (merged.length > 30 || merged.some(label => label.length > 80))) throw new Error('Each note can have up to 30 labels, with 80 characters per label. No notes were changed.');
      return bulkAction === 'move' ? { folderId } : { labels: merged };
    });
    $('#bulk-dialog').close(); selectionMode = false; selectedIds.clear(); $('#select-notes').setAttribute('aria-pressed', 'false');
    await render(); toast(`${changed} note${changed === 1 ? '' : 's'} updated.`);
  } finally { submit.disabled = false; $('#bulk-form').inert = false; scheduleSync(); }
});

function editorState() {
  return JSON.stringify({ title: $('#edit-title').value, body: $('#edit-body').value, labels: $('#edit-labels').value,
    folder: $('#edit-folder').value, pinned: $('#edit-pinned').checked, shared: $('#edit-shared').checked,
    reminder: $('#reminder-type').value, at: $('#reminder-at').value, query: $('#reminder-query').value, place: $('#reminder-place').value,
    kind, color, items: draftItems });
}
function editorDirty() { return editorState() !== editorBaseline; }
function updateEditorStatus() {
  $('#edit-meta').textContent = editorDirty() ? 'Unsaved changes' : current ? 'No unsaved changes' : 'New note · not saved';
  $('#organization-summary').textContent = folderById($('#edit-folder').value)?.name || 'Unfiled';
  $('#sharing-summary').textContent = $('#edit-shared').checked ? 'Shared' : aiPermissions.readAll ? 'Automatic viewing on' : 'Private';
}
function updateLabelSuggestions() {
  const labels = [...new Set(notes.filter(n => !n.trashed).flatMap(n => n.labels))].sort();
  $('#label-suggestions').innerHTML = labelSuggestions(labels, $('#edit-labels').value).map(value => `<option value="${escape(value)}"></option>`).join('');
}
function closeEditor() {
  if (editorSaving) return;
  if (editorDirty()) $('#discard-dialog').showModal(); else $('#editor').close();
}
$('#editor').addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
$('#keep-editing').onclick = () => $('#discard-dialog').close();
$('#discard-changes').onclick = () => { $('#discard-dialog').close(); $('#editor').close(); };
$('#editor-form').addEventListener('input', updateEditorStatus);
$('#editor-form').addEventListener('change', updateEditorStatus);
$('#edit-labels').addEventListener('input', updateLabelSuggestions);
window.addEventListener('beforeunload', event => { if ($('#editor').open && editorDirty()) { event.preventDefault(); event.returnValue = ''; } });
function updateExpandButton() { const expanded = $('#editor').classList.contains('expanded'); $('#expand-editor').textContent = expanded ? 'Compact' : 'Expand'; $('#expand-editor').setAttribute('aria-pressed', String(expanded)); }
$('#expand-editor').onclick = () => { $('#editor').classList.toggle('expanded'); updateExpandButton(); };
document.querySelectorAll('[data-markdown-mode]').forEach(button => { button.onclick = () => { markdownMode = button.dataset.markdownMode; renderKind(); }; });

function showSettings(section) {
  document.querySelectorAll('[data-settings-panel]').forEach(panel => { panel.hidden = panel.dataset.settingsPanel !== section; });
  document.querySelectorAll('[data-settings]').forEach(button => { if (button.dataset.settings === section) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  $('#settings-dialog').scrollTop = 0;
}
document.querySelectorAll('[data-settings]').forEach(button => { button.onclick = () => showSettings(button.dataset.settings); });
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', () => { if (dialog.contains($('#toast'))) { $('#toast').hidden = true; document.body.append($('#toast')); } }));
async function updateConnectionSettings() {
  const connected = await isConnected();
  const last = await settings.get('lastSync');
  $('#connection-summary').textContent = connected ? `Google Drive connected.${last ? ` Last synced ${new Date(last).toLocaleString()}.` : ''}` : 'Notes are saved on this device. Connect Google Drive to sync across devices.';
  $('#settings-connect').textContent = connected ? 'Sync now' : 'Connect Google Drive';
  $('#disconnect').hidden = !connected;
}

// Native popovers keep actions above cards without clipping or an extra modal.
document.addEventListener('toggle', event => {
  const popover = event.target;
  if (!popover.matches?.('.action-popover') || event.newState !== 'open') return;
  const trigger = document.querySelector(`[popovertarget="${CSS.escape(popover.id)}"]`);
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  popover.style.left = `${Math.max(8, Math.min(rect.right - popover.offsetWidth, innerWidth - popover.offsetWidth - 8))}px`;
  const top = rect.bottom + 6 + popover.offsetHeight <= innerHeight - 8 ? rect.bottom + 6 : rect.top - popover.offsetHeight - 6;
  popover.style.top = `${Math.max(8, top)}px`;
}, true);
start().catch(error => { toast(error.message); render().catch(() => {}); });
