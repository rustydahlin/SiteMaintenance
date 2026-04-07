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

  // ── Sidebar (desktop expand/collapse) ──────────────────────────────────────
  const sidebar    = document.getElementById('sidebar');
  const toggleBtn  = document.getElementById('sidebarToggle');
  const toggleIcon = document.getElementById('sidebarToggleIcon');
  const backdrop   = document.getElementById('sidebarBackdrop');

  function updateToggleIcon(collapsed) {
    if (!toggleIcon) return;
    toggleIcon.className = collapsed ? 'bi bi-chevron-double-right' : 'bi bi-chevron-double-left';
  }

  if (sidebar && toggleBtn) {
    updateToggleIcon(sidebar.classList.contains('sidebar-collapsed'));
    toggleBtn.addEventListener('click', () => {
      const collapsed = sidebar.classList.toggle('sidebar-collapsed');
      localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
      updateToggleIcon(collapsed);
    });
  }

  // ── Sidebar (mobile overlay) ────────────────────────────────────────────────
  const mobileSidebarToggle = document.getElementById('mobileSidebarToggle');

  function openMobileSidebar() {
    sidebar && sidebar.classList.add('sidebar-mobile-open');
    backdrop && backdrop.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  function closeMobileSidebar() {
    sidebar && sidebar.classList.remove('sidebar-mobile-open');
    backdrop && backdrop.classList.remove('show');
    document.body.style.overflow = '';
  }

  if (mobileSidebarToggle) {
    mobileSidebarToggle.addEventListener('click', () => {
      sidebar && sidebar.classList.contains('sidebar-mobile-open')
        ? closeMobileSidebar()
        : openMobileSidebar();
    });
  }

  backdrop && backdrop.addEventListener('click', closeMobileSidebar);

  // Close mobile sidebar when a nav link is tapped
  sidebar && sidebar.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      if (window.innerWidth < 768) closeMobileSidebar();
    });
  });

  // Clean up mobile state when resizing to desktop
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 768) closeMobileSidebar();
  });

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

  // ── Filter card active indicator ─────────────────────────────────────────
  // Adds an orange border to the filter card when any filter has a value set.
  // Works on page load and updates in real-time as the user changes inputs.
  function isFilterActive(form) {
    for (const el of form.elements) {
      if (el.type === 'hidden') continue;
      if (el.type === 'checkbox' && el.checked) return true;
      if (el.type !== 'checkbox' && el.value.trim() !== '') return true;
    }
    return false;
  }

  document.querySelectorAll('form[method="GET"][action]').forEach(form => {
    const card = form.closest('.card');
    if (!card) return;
    const update = () => card.classList.toggle('filter-card-active', isFilterActive(form));
    update();
    form.addEventListener('input', update);
    form.addEventListener('change', update);
  });

  // ── List filter persistence ───────────────────────────────────────────────
  // On list pages: save current search params so detail pages can restore them
  document.querySelectorAll('form[method="GET"][action]').forEach(form => {
    const action = form.getAttribute('action');
    if (action && location.pathname === action) {
      sessionStorage.setItem('listFilters:' + action, location.search);
    }
  });

  // On detail pages: update [data-back-list] links to restore saved filters
  document.querySelectorAll('a[data-back-list]').forEach(link => {
    const basePath = link.getAttribute('data-back-list');
    const saved = sessionStorage.getItem('listFilters:' + basePath);
    if (saved) link.href = basePath + saved;
  });

  // Sidebar nav links: restore saved filters when navigating to a list page
  document.querySelectorAll('#sidebar a.nav-link[href]').forEach(link => {
    const href = link.getAttribute('href');
    const saved = sessionStorage.getItem('listFilters:' + href);
    if (saved) link.href = href + saved;
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
