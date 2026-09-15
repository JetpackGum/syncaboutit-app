const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

function safeUrl(value) {
  const source = String(value || '').trim();
  if (source.startsWith('#')) return source;
  try {
    const url = new URL(source);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function inlineMarkdown(value) {
  const tokens = [];
  const stash = html => `\u0000${tokens.push(html) - 1}\u0000`;
  let text = String(value ?? '');
  text = text.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${escapeHtml(code)}</code>`));
  text = text.replace(/!\[([^\]\n]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g, (_, alt, target) => {
    const url = safeUrl(target);
    return url ? stash(`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" referrerpolicy="no-referrer">`) : escapeHtml(alt);
  });
  text = text.replace(/\[([^\]\n]+)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g, (_, label, target) => {
    const url = safeUrl(target);
    return url ? stash(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`) : escapeHtml(label);
  });
  text = text.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, (_, target) => {
    const url = safeUrl(target);
    return url ? stash(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(target)}</a>`) : escapeHtml(target);
  });
  text = escapeHtml(text)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\n]+)_/g, '$1<em>$2</em>')
    .replace(/ {2}$/g, '<br>');
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}

const tableCells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
const tableDivider = line => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
const listMatch = line => line.match(/^\s*([-+*]|\d+\.)\s+(.+)$/);
const startsBlock = (lines, index) => {
  const line = lines[index] || '';
  return !line.trim() || /^\s*(```|~~~)/.test(line) || /^\s{0,3}#{1,6}\s+/.test(line) || /^\s*>/.test(line) || /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) || !!listMatch(line) || (line.includes('|') && tableDivider(lines[index + 1] || ''));
};

export function renderMarkdown(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)\s*$/);
    if (fence) {
      const code = []; index++;
      while (index < lines.length && !new RegExp(`^\\s*${fence[1]}`).test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      const language = fence[2] ? ` data-language="${escapeHtml(fence[2])}"` : '';
      html.push(`<pre><code${language}>${escapeHtml(code.join('\n'))}</code></pre>`); continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) { const level = heading[1].length; html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`); index++; continue; }
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) { html.push('<hr>'); index++; continue; }
    if (/^\s*>/.test(line)) {
      const quoted = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quoted.push(lines[index++].replace(/^\s*>\s?/, ''));
      html.push(`<blockquote>${renderMarkdown(quoted.join('\n'))}</blockquote>`); continue;
    }
    if (line.includes('|') && tableDivider(lines[index + 1] || '')) {
      const headers = tableCells(line); index += 2; const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(tableCells(lines[index++]));
      html.push(`<div class="markdown-table-wrap"><table><thead><tr>${headers.map(cell => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map((_, column) => `<td>${inlineMarkdown(row[column] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`); continue;
    }
    const firstItem = listMatch(line);
    if (firstItem) {
      const ordered = /\d+\./.test(firstItem[1]); const items = [];
      while (index < lines.length) {
        const item = listMatch(lines[index]);
        if (!item || /\d+\./.test(item[1]) !== ordered) break;
        const task = item[2].match(/^\[([ xX])\]\s+(.*)$/);
        items.push(task ? `<li class="markdown-task"><input type="checkbox" disabled ${task[1].toLowerCase() === 'x' ? 'checked' : ''}><span>${inlineMarkdown(task[2])}</span></li>` : `<li>${inlineMarkdown(item[2])}</li>`); index++;
      }
      const tag = ordered ? 'ol' : 'ul'; html.push(`<${tag}>${items.join('')}</${tag}>`); continue;
    }
    if (/^ {4}/.test(line)) {
      const code = [];
      while (index < lines.length && (/^ {4}/.test(lines[index]) || !lines[index].trim())) code.push(lines[index++].replace(/^ {4}/, ''));
      html.push(`<pre><code>${escapeHtml(code.join('\n').trimEnd())}</code></pre>`); continue;
    }
    const paragraph = [line.trim()]; index++;
    while (index < lines.length && !startsBlock(lines, index)) paragraph.push(lines[index++].trim());
    html.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
  }
  return html.join('');
}

export function markdownTitle(markdown, filename = 'Markdown document') {
  const heading = String(markdown ?? '').match(/^\s*#\s+(.+?)\s*#*\s*$/m)?.[1];
  return (heading || String(filename).replace(/\.(?:md|markdown)$/i, '') || 'Markdown document').trim().slice(0, 300);
}
