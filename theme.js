// Apply the saved theme before styles load, including in Manifest V3 extension pages.
(() => {
  const key = 'syncaboutit-theme';
  const names = { slate: 'Slate', ocean: 'Ocean', rose: 'Rose', midnight: 'Midnight', sage: 'Sage' };
  const backgrounds = { slate: '#f5f6f8', ocean: '#f1f6fb', rose: '#faf4f3', midnight: '#171b24', sage: '#f6f5f0' };
  const valid = value => Object.hasOwn(names, value) ? value : 'slate';
  function apply(value) {
    const theme = valid(value);
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', backgrounds[theme]);
    document.querySelectorAll('input[name="theme"]').forEach(input => { input.checked = input.value === theme; });
    return theme;
  }
  try { apply(localStorage.getItem(key)); } catch { apply('slate'); }
  document.addEventListener('DOMContentLoaded', () => {
    apply(document.documentElement.dataset.theme);
    document.querySelector('.theme-picker').addEventListener('change', event => {
      if (!event.target.matches('input[name="theme"]')) return;
      const theme = apply(event.target.value);
      try {
        localStorage.setItem(key, theme);
        document.querySelector('#theme-status').textContent = `${names[theme]} theme saved for this device.`;
      } catch {
        document.querySelector('#theme-status').textContent = `${names[theme]} applied. Browser storage is unavailable, so it may reset when you reopen the app.`;
      }
    });
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      apply(event.newValue);
      const status = document.querySelector('#theme-status');
      if (status) status.textContent = '';
    }
  });
})();
