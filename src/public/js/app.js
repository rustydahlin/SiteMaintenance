/* SiteMaintenance — Global JS */
'use strict';

// Auto-dismiss flash alerts after 6 seconds
// Dark mode
(function () {
  const toggle = document.getElementById('darkModeToggle');
  if (!toggle) return;
  const isDark = localStorage.getItem('theme') === 'dark';
  toggle.checked = isDark;
  document.documentElement.setAttribute('data-bs-theme', isDark ? 'dark' : 'light');
  toggle.addEventListener('change', () => {
    const dark = toggle.checked;
    document.documentElement.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  });
})();

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.alert-dismissible').forEach(alert => {
    setTimeout(() => {
      const bsAlert = bootstrap.Alert.getOrCreateInstance(alert);
      bsAlert && bsAlert.close();
    }, 6000);
  });

  // Confirm dialogs on data-confirm elements
  document.querySelectorAll('[data-confirm]').forEach(el => {
    el.addEventListener('click', (e) => {
      const msg = el.getAttribute('data-confirm') || 'Are you sure?';
      if (!confirm(msg)) e.preventDefault();
    });
  });

  // Confirm on delete forms without onsubmit already set
  document.querySelectorAll('form[data-confirm]').forEach(form => {
    form.addEventListener('submit', (e) => {
      const msg = form.getAttribute('data-confirm') || 'Are you sure?';
      if (!confirm(msg)) e.preventDefault();
    });
  });

  // Activate Bootstrap tooltips
  document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
    new bootstrap.Tooltip(el);
  });

  // ── Tab persistence ───────────────────────────────────────────────────────
  // Save active tab to sessionStorage on change, restore on load
  const tabKey = 'activeTab:' + location.pathname;

  // Restore: URL hash takes priority, then sessionStorage
  const savedHash = location.hash || sessionStorage.getItem(tabKey);
  if (savedHash) {
    const tabEl = document.querySelector(`[data-bs-toggle="tab"][href="${savedHash}"]`);
    if (tabEl) bootstrap.Tab.getOrCreateInstance(tabEl).show();
  }

  // Save on change
  document.querySelectorAll('[data-bs-toggle="tab"]').forEach(tabEl => {
    tabEl.addEventListener('shown.bs.tab', () => {
      const hash = tabEl.getAttribute('href');
      if (hash && hash.startsWith('#')) sessionStorage.setItem(tabKey, hash);
    });
  });
});
