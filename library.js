// Library presentation rules shared by the browser UI and its regression tests.
export function selectNotes(notes, { view = 'notes', query = '', scope = 'view', sort = 'updated', readAll = false } = {}) {
  const search = query.trim().toLowerCase();
  return notes.filter(note => {
    if (search && scope === 'all') return !note.trashed && !note.archived;
    if (view === 'trash') return note.trashed;
    if (note.trashed) return false;
    if (view === 'archive') return note.archived;
    if (note.archived) return false;
    if (view === 'unfiled') return !note.folderId;
    if (view === 'reminders') return note.reminder?.type === 'time';
    if (view === 'opportunities') return note.reminder?.type === 'opportunity';
    if (view === 'agents') return readAll || note.agentShared;
    if (view.startsWith('folder:')) return note.folderId === view.slice(7);
    if (view.startsWith('label:')) return note.labels.includes(view.slice(6));
    return true;
  }).filter(note => !search || [note.title, note.body, ...note.labels, ...note.items.map(item => item.text),
    ...note.sources.flatMap(source => [source.title, source.url, source.selection]), note.reminder?.query || '', note.reminder?.place || '']
    .join(' ').toLowerCase().includes(search))
    .sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title) :
      Date.parse(sort === 'created' ? b.createdAt : b.updatedAt) - Date.parse(sort === 'created' ? a.createdAt : a.updatedAt)) || a.id.localeCompare(b.id));
}

export function groupNotes(notes, { view = 'notes', title = 'Notes', now = new Date() } = {}) {
  if (view === 'reminders') {
    const tomorrow = new Date(now); tomorrow.setHours(24, 0, 0, 0);
    const sorted = [...notes].sort((a, b) => Date.parse(a.reminder.at) - Date.parse(b.reminder.at));
    return [
      ['Overdue', sorted.filter(n => Date.parse(n.reminder.at) < now.getTime()), 'bell'],
      ['Today', sorted.filter(n => Date.parse(n.reminder.at) >= now.getTime() && Date.parse(n.reminder.at) < tomorrow.getTime()), 'bell'],
      ['Upcoming', sorted.filter(n => Date.parse(n.reminder.at) >= tomorrow.getTime()), 'bell'],
    ];
  }
  return [['Pinned', notes.filter(n => n.pinned), 'tack'], [notes.some(n => n.pinned) ? 'Other notes' : title, notes.filter(n => !n.pinned), 'notes']];
}

export function opportunityStatus(note, now = Date.now()) {
  const accepted = note.proposals.some(p => p.status === 'accepted');
  const pending = note.proposals.filter(p => p.status === 'pending' && (!p.expiresAt || Date.parse(p.expiresAt) > now)).length;
  if (pending) return `${pending} suggestion${pending === 1 ? '' : 's'} to review`;
  // Monitoring is local to Android; the browser must never infer it from acceptance.
  return accepted ? 'Place accepted · check monitoring on phone' : 'Awaiting place suggestions';
}

export function labelSuggestions(labels, input) {
  const parts = input.split(',');
  const fragment = parts.pop().trim().toLowerCase();
  const selected = parts.map(part => part.trim()).filter(Boolean);
  return labels.filter(label => !selected.includes(label) && label.toLowerCase().startsWith(fragment))
    .map(label => [...selected, label].join(', '));
}
