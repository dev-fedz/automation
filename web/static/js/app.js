function authToken() { return localStorage.getItem('authToken'); }

async function apiFetch(url, options = {}) {
  const headers = options.headers || {};
  if (authToken()) headers['Authorization'] = 'Token ' + authToken();
  headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  return fetch(url, { ...options, headers });
}

function setupLogin() {
  const form = document.getElementById('login-form');
  if (!form) return;
  let pending2faToken = null;
  let pending2faSetupToken = null;
  const modal = document.querySelector('[data-2fa-modal]');
  const modalTitle = document.querySelector('[data-2fa-modal-title]');
  const modalStatus = document.querySelector('[data-2fa-modal-status]');
  const modalOtp = document.querySelector('[data-2fa-modal-otp]');
  const modalQrWrap = document.querySelector('[data-2fa-modal-qr-wrap]');
  const modalQr = document.querySelector('[data-2fa-modal-qr]');
  const modalCloseButtons = document.querySelectorAll('[data-2fa-modal-close]');
  const modalSubmit = document.querySelector('[data-2fa-modal-submit]');
  const toastContainer = document.querySelector('[data-toast-container]');

  function showToast(message, type = 'success') {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('data-show', 'true');
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.setAttribute('data-show', 'false');
      setTimeout(() => toast.remove(), 250);
    }, 1200);
  }

  function openModal({ title, status, showQr, qrSrc }) {
    if (!modal) return;
    if (modalTitle && title) modalTitle.textContent = title;
    if (modalStatus && status) modalStatus.textContent = status;
    if (modalQrWrap) {
      modalQrWrap.hidden = !showQr;
      modalQrWrap.style.display = showQr ? 'flex' : 'none';
    }
    if (modalQr) modalQr.src = showQr && qrSrc ? qrSrc : '';
    if (modalOtp) modalOtp.value = '';
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('is-open');
    if (modalOtp) modalOtp.focus();
  }

  function closeModal() {
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('is-open');
  }

  if (modalCloseButtons.length) {
    modalCloseButtons.forEach((btn) => btn.addEventListener('click', () => {
      pending2faToken = null;
      pending2faSetupToken = null;
      closeModal();
    }));
  }

  async function submitModalOtp() {
    const otp = modalOtp ? modalOtp.value.trim() : '';
    if (!otp) { alert('Enter the verification code'); return; }
    if (pending2faSetupToken) {
      const resp = await apiFetch('/api/accounts/auth/2fa/setup/verify/', { method: 'POST', body: JSON.stringify({ token: pending2faSetupToken, otp }) });
      if (!resp.ok) { alert('Verification failed'); return; }
      const data = await resp.json();
      localStorage.setItem('authToken', data.token);
      showToast('2FA setup complete. Logged in.');
      setTimeout(() => { window.location = '/dashboard/'; }, 600);
      return;
    }
    if (pending2faToken) {
      const resp = await apiFetch('/api/accounts/auth/2fa/verify/', { method: 'POST', body: JSON.stringify({ token: pending2faToken, otp }) });
      if (!resp.ok) { alert('Verification failed'); return; }
      const data = await resp.json();
      localStorage.setItem('authToken', data.token);
      showToast('Login successful.');
      setTimeout(() => { window.location = '/dashboard/'; }, 600);
    }
  }

  if (modalSubmit) modalSubmit.addEventListener('click', submitModalOtp);
  if (modalOtp) {
    modalOtp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitModalOtp();
      }
    });
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const email = form.querySelector('input[name=email]').value;
      const password = form.querySelector('input[name=password]').value;
      const resp = await apiFetch('/api/accounts/auth/login/', { method: 'POST', body: JSON.stringify({ email, password }) });
      if (!resp.ok) { alert('Login failed'); return; }
      const data = await resp.json();
      if (data && data['2fa_setup_required']) {
        pending2faSetupToken = data['temp_token'];
        openModal({
          title: 'Set up Two-Factor Authentication',
          status: 'Scan the QR in Microsoft Authenticator, then enter the 6-digit code.',
          showQr: true,
          qrSrc: data['qr'],
        });
        return;
      }
      if (data && data['2fa_required']) {
        pending2faToken = data['temp_token'];
        openModal({
          title: 'Two-Factor Authentication',
          status: 'Enter your 6-digit code from Microsoft Authenticator.',
          showQr: false,
        });
        return;
      }
      localStorage.setItem('authToken', data.token);
      window.location = '/dashboard/';
    } catch (_) { alert('Network error'); }
  });
}

// Global modal helpers: use class `is-open` to control visibility across the app.
window.openModalById = function (id) {
  try {
    const el = document.getElementById(id);
    if (!el) return false;
    el.classList.add('is-open');
    el.setAttribute('aria-hidden', 'false');
    return true;
  } catch (e) { return false; }
};

window.closeModalById = function (id) {
  try {
    const el = document.getElementById(id);
    if (!el) return false;
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
    return true;
  } catch (e) { return false; }
};

function setupLogoutLinks() {
  document.querySelectorAll('[data-logout]')?.forEach(el => {
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      const token = authToken();
      // If token auth is active, tell the API to invalidate the token.
      if (token) {
        try { await apiFetch('/api/accounts/auth/logout/', { method: 'POST' }); } catch (_) { }
      }
      localStorage.removeItem('authToken');
      // Always clear the Django session as well.
      // Without this, hitting /login/ may redirect back to / because the user is still authenticated.
      window.location = '/logout/?force=1';
    });
  });
}

function setupUserMenus() {
  function wireMenu(rootSel, buttonSel, dropdownSel) {
    const root = document.querySelector(rootSel);
    if (!root) return;
    const button = root.querySelector(buttonSel);
    const dropdown = root.querySelector(dropdownSel);
    if (!button || !dropdown) return;

    function close() {
      dropdown.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }

    function toggle() {
      const willOpen = dropdown.hidden;
      // close first (ensures consistent state)
      dropdown.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (willOpen) {
        dropdown.hidden = false;
        button.setAttribute('aria-expanded', 'true');
      }
    }

    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });

    document.addEventListener('click', (e) => {
      if (!root.contains(e.target)) close();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  }

  wireMenu('[data-role="user-menu"]', '[data-action="toggle-user-menu"]', '.user-menu__dropdown');
  wireMenu('[data-role="sidebar-user-menu"]', '[data-action="toggle-sidebar-user-menu"]', '.sidebar-user-menu__dropdown');
}

document.addEventListener('DOMContentLoaded', () => {
  setupLogin();
  setupLogoutLinks();
  setupUserMenus();
  // sidebar hamburger toggle
  const menuBtn = document.querySelector('.menu-toggle');
  const overlay = document.querySelector('.sidebar-overlay');
  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
  }
  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      const isMobile = window.matchMedia('(max-width: 980px)').matches;
      if (isMobile) {
        const open = document.body.classList.toggle('sidebar-open');
        document.body.classList.remove('sidebar-hidden');
        menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      } else {
        const hidden = document.body.classList.toggle('sidebar-hidden');
        menuBtn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
      }
    });
  }
  if (overlay) { overlay.addEventListener('click', closeSidebar); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSidebar(); });
  // handle resize: remove mobile open classes if switching to desktop
  let lastIsMobile = window.matchMedia('(max-width: 980px)').matches;
  window.addEventListener('resize', () => {
    const nowMobile = window.matchMedia('(max-width: 980px)').matches;
    if (lastIsMobile !== nowMobile) {
      if (!nowMobile) {
        document.body.classList.remove('sidebar-open');
        menuBtn && menuBtn.setAttribute('aria-expanded', document.body.classList.contains('sidebar-hidden') ? 'false' : 'true');
      } else {
        document.body.classList.remove('sidebar-hidden');
        menuBtn && menuBtn.setAttribute('aria-expanded', 'false');
      }
      lastIsMobile = nowMobile;
    }
  });
  // Automated metrics refresh (idempotent)
  const metricMap = {
    sales: 'metric-sales-value',
    orders: 'metric-orders-value',
    invoices: 'metric-invoices-value',
    alerts: 'metric-alerts-value'
  };
  function refreshMetrics() {
    fetch('/api/metrics/')
      .then(r => r.json())
      .then(data => {
        const root = document.getElementById('dashboard-root');
        if (root) {
          root.setAttribute('data-metrics-version', data.version || '1');
        }
        // Latest Test Run
        assignText('run-started', data.run?.started || '--');
        assignText('run-duration', data.run?.duration || '--');
        assignText('run-total', data.run?.total || '--');
        assignText('run-passed', data.run?.passed || '--');
        assignText('run-failed', data.run?.failed || '--');
        assignText('run-skipped', data.run?.skipped || '--');
        assignText('run-passrate', data.run?.pass_rate ? data.run.pass_rate + '%' : '--');

        // Load snapshot
        assignText('lt-users', data.load?.concurrent_users || '--');
        assignText('lt-rps', data.load?.rps || '--');
        assignText('lt-p95', data.load?.p95 || '--');
        assignText('lt-p99', data.load?.p99 || '--');
        assignText('lt-errorpct', data.load?.error_pct ? data.load.error_pct + '%' : '--');
        assignText('lt-throughput', data.load?.throughput || '--');

        // Failures table
        const failuresTbody = document.querySelector('[data-testid="failures-tbody"]');
        if (failuresTbody) {
          failuresTbody.querySelectorAll('tr:not(.template)').forEach(r => r.remove());
          (data.top_failures || []).forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${row.name}</td><td>${row.fail_count}</td><td>${row.last_error}</td>`;
            failuresTbody.appendChild(tr);
          });
        }

        // Performance table
        const perfTbody = document.querySelector('[data-testid="performance-tbody"]');
        if (perfTbody) {
          perfTbody.querySelectorAll('tr:not(.template)').forEach(r => r.remove());
          (data.performance || []).forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${row.endpoint}</td><td>${row.rps}</td><td>${row.p95}</td><td>${row.p99}</td><td>${row.error_pct}</td>`;
            perfTbody.appendChild(tr);
          });
        }

        // Queue metrics
        assignText('queue-pending', data.queue?.pending || '--');
        assignText('queue-active', data.queue?.active_workers || '--');
        assignText('queue-util', data.queue?.utilization ? data.queue.utilization + '%' : '--');

        // Environment
        assignText('env-commit', data.env?.commit || '--');
        assignText('env-buildtime', data.env?.build_time || '--');
        assignText('env-version', data.env?.service_version || '1.0.0');
      })
      .catch(() => { });
  }
  function assignText(testId, value) {
    const el = document.querySelector(`[data-testid="${testId}"]`);
    if (el) { el.textContent = value; }
  }
  setInterval(refreshMetrics, 15000);
  document.addEventListener('DOMContentLoaded', () => setTimeout(refreshMetrics, 200));
});
