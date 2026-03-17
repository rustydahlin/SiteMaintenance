/* SiteMaintenance — Global JS */
'use strict';

// Apply theme + sidebar collapse state before first paint to avoid flash
(function () {
  if (localStorage.getItem('theme') === 'dark') {
    document.documentElement.setAttribute('data-bs-theme', 'dark');
  }
  if (localStorage.getItem('sidebarCollapsed') === '1') {
    document.getElementById('sidebar')?.classList.add('sidebar-collapsed');
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  // Dark mode toggle
  const darkToggle = document.getElementById('darkModeToggle');
  if (darkToggle) {
    darkToggle.checked = localStorage.getItem('theme') === 'dark';
    darkToggle.addEventListener('change', () => {
      const dark = darkToggle.checked;
      document.documentElement.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    });
  }

  // Sidebar toggle
  const sidebar     = document.getElementById('sidebar');
  const toggleBtn   = document.getElementById('sidebarToggle');
  const toggleIcon  = document.getElementById('sidebarToggleIcon');

  function updateToggleIcon(collapsed) {
    if (!toggleIcon) return;
    toggleIcon.className = collapsed ? 'bi bi-chevron-double-right' : 'bi bi-chevron-double-left';
  }

  if (sidebar && toggleBtn) {
    // Sync icon with current state (state already applied by IIFE above)
    updateToggleIcon(sidebar.classList.contains('sidebar-collapsed'));

    toggleBtn.addEventListener('click', () => {
      const collapsed = sidebar.classList.toggle('sidebar-collapsed');
      localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
      updateToggleIcon(collapsed);
    });
  }

  document.querySelectorAll('.alert-dismissible').forEach(alert => {
    setTimeout(() => {
      const bsAlert = bootstrap.Alert.getOrCreateInstance(alert);
      bsAlert && bsAlert.close();
    }, 6000);
  });

  // Bootstrap confirmation modal for data-confirm elements
  const confirmModal    = document.getElementById('confirmModal');
  const confirmMessage  = document.getElementById('confirmModalMessage');
  const confirmOkBtn    = document.getElementById('confirmModalOk');

  if (confirmModal && confirmOkBtn) {
    const bsConfirmModal = bootstrap.Modal.getOrCreateInstance(confirmModal);
    let pendingAction = null;

    confirmOkBtn.addEventListener('click', () => {
      bsConfirmModal.hide();
      if (pendingAction) { pendingAction(); pendingAction = null; }
    });

    confirmModal.addEventListener('hidden.bs.modal', () => { pendingAction = null; });

    function showConfirm(message, onConfirm) {
      confirmMessage.textContent = message || 'Are you sure?';
      pendingAction = onConfirm;
      bsConfirmModal.show();
    }

    // Forms with data-confirm: intercept submit
    document.querySelectorAll('form[data-confirm]').forEach(form => {
      form.addEventListener('submit', e => {
        e.preventDefault();
        showConfirm(form.dataset.confirm, () => form.submit());
      });
    });

    // Non-form elements with data-confirm: intercept click
    document.querySelectorAll('[data-confirm]:not(form)').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        showConfirm(el.dataset.confirm, () => {
          el.removeAttribute('data-confirm');
          el.click();
        });
      });
    });
  }

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
