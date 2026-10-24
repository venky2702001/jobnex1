/* ==========================================================================
   JOBNEX — Unified Application Controller & UI Logic
   Production-quality SaaS frontend controller with clean component rendering,
   rich report visualization, session management, and robust backend hooks.
   ========================================================================== */

(function () {
  'use strict';

  /* ---------- DOM & Element Helpers ---------- */
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const API = () => window.JOBNEX_API || {};

  // Safe element builder (uses textContent, prevents HTML injection)
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const key in attrs || {}) {
      const val = attrs[key];
      if (val === false || val == null) continue;
      if (key === 'class' || key === 'className') {
        el.className = val;
      } else if (key.startsWith('on') && typeof val === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), val);
      } else if (key === 'html') {
        el.innerHTML = val;
      } else {
        el.setAttribute(key, val === true ? '' : val);
      }
    }
    children.flat().forEach(child => {
      if (child == null) return;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return el;
  }

  // Escape text before it is placed inside an innerHTML template (jobs/applications come from the server).
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));

  // Local Storage Wrapper
  const store = {
    get(key, defaultValue) {
      try {
        const item = localStorage.getItem('jobnex.' + key);
        return item == null ? defaultValue : JSON.parse(item);
      } catch (e) {
        return defaultValue;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('jobnex.' + key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem('jobnex.' + key);
      } catch (e) {}
    }
  };

  /* ---------- Toast Notification System ---------- */
  function showToast(message, type = 'info', duration = 3500) {
    let container = $('#toast-container');
    if (!container) {
      container = h('div', { id: 'toast-container', 'aria-live': 'polite' });
      document.body.appendChild(container);
    }
    const iconSvg = type === 'success'
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
      : type === 'error'
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';

    const toast = h('div', { class: `toast ${type}`, role: 'status' });
    toast.innerHTML = `${iconSvg}<span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'all 0.2s ease';
      setTimeout(() => toast.remove(), 200);
    }, duration);
  }

  /* ---------- Modal Dialog System ---------- */
  function showModal({ title, content, confirmText = 'Confirm', cancelText = 'Cancel', onConfirm, isDanger = false }) {
    const close = () => backdrop.remove();

    const backdrop = h('div', { class: 'modal-backdrop', onclick(e) { if (e.target === backdrop) close(); } },
      h('div', { class: 'modal-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title' },
        h('div', { class: 'modal-header' },
          h('h3', { id: 'modal-title' }, title),
          h('button', { type: 'button', class: 'modal-close-btn', 'aria-label': 'Close dialog', onclick: close },
            h('span', { html: '&times;' })
          )
        ),
        h('div', { class: 'modal-body' }, content),
        h('div', { class: 'modal-footer' },
          h('button', { type: 'button', class: 'btn btn-secondary', onclick: close }, cancelText),
          h('button', {
            type: 'button',
            class: isDanger ? 'btn btn-danger-solid' : 'btn',
            async onclick() {
              if (onConfirm) await onConfirm();
              close();
            }
          }, confirmText)
        )
      )
    );
    document.body.appendChild(backdrop);
    const firstBtn = backdrop.querySelector('.modal-footer button:last-child');
    if (firstBtn) firstBtn.focus();
  }

  /* ---------- Session & Auth Handling ---------- */
  const SKEY = 'jobnex.session';
  const getSession = () => {
    try {
      return JSON.parse(sessionStorage.getItem(SKEY) || localStorage.getItem(SKEY) || 'null');
    } catch (e) {
      return null;
    }
  };

  const setSession = (data, remember) => {
    try {
      (remember ? localStorage : sessionStorage).setItem(SKEY, JSON.stringify(data));
    } catch (e) {}
  };

  const logout = () => {
    showModal({
      title: 'Sign out of JOBNEX',
      content: h('p', {}, 'Are you sure you want to log out of your current session?'),
      confirmText: 'Sign out',
      isDanger: false,
      async onConfirm() {
        try { if (API().logout) await API().logout(); } catch (e) { /* already signed out */ }
        try {
          sessionStorage.removeItem(SKEY);
          localStorage.removeItem(SKEY);
        } catch (e) {}
        location.href = 'login.html';
      }
    });
  };

  const page = document.body.dataset.page || '';
  const session = getSession();

  // Route protection
  if (page === 'login') {
    if (session && location.search.includes('redirect=true')) {
      location.replace('dashboard.html');
      return;
    }
  } else if (!session && page !== 'login') {
    location.replace('login.html');
    return;
  }

  // The stored session only makes the redirect instant. The REAL session is the signed cookie
  // on the server, so confirm it in the background and bounce to login if it has expired.
  if (page !== 'login' && API().me) {
    API().me().then(res => {
      if (res && res.user) {
        const remembered = !!localStorage.getItem(SKEY);
        setSession({ email: res.user.email, name: res.user.name || null }, remembered);
      }
    }).catch(err => {
      if (err && err.status === 401) {
        try { sessionStorage.removeItem(SKEY); localStorage.removeItem(SKEY); } catch (e) {}
        location.replace('login.html');
      } // network errors: keep the page usable
    });
  }

  // Gracefully redirect any direct access to removed AI Assistant / chatbot route
  if (page === 'chatbot' || location.pathname.endsWith('chatbot.html') || location.pathname.includes('/chatbot')) {
    location.replace('dashboard.html');
    return;
  }

  /* ---------- Shared Navigation & Chrome ---------- */
  const NAV_ITEMS = [
    { href: 'dashboard.html', label: 'Dashboard', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>' },
    { href: 'analyzer.html', label: 'Resume Analyzer', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' },
    { href: 'jobs.html', label: 'Find Jobs', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' },
    { href: 'interveiw.html', label: 'Interview Prep', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>' },
    { href: 'courses.html', label: 'Courses', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>' },
    { href: 'applications.html', label: 'Applications', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>' },
    { href: 'privacy.html', label: 'Privacy', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' }
  ];

  function renderChrome() {
    const header = $('#site-header');
    const footer = $('#site-footer');
    if (!header) return;

    const currentPath = location.pathname.split('/').pop() || 'dashboard.html';
    const userEmail = (session && session.email) || 'guest';
    const userInitials = (((session && session.name) || userEmail.split('@')[0]).slice(0, 2).toUpperCase()) || 'JN';

    // Desktop Nav Items
    const navLinks = h('ul', { class: 'nav-menu', role: 'menubar' },
      NAV_ITEMS.map(item => {
        // Handle interveiw.html vs interview.html matching
        const isCurrent = item.href === currentPath || (item.href === 'interveiw.html' && currentPath === 'interview.html');
        const link = h('a', {
          href: item.href,
          role: 'menuitem',
          'aria-current': isCurrent ? 'page' : false
        });
        link.innerHTML = `${item.icon}<span>${item.label}</span>`;
        return h('li', { role: 'none' }, link);
      })
    );

    // Mobile Hamburger Button
    const mobileToggle = h('button', {
      type: 'button',
      class: 'mobile-menu-toggle',
      'aria-label': 'Toggle navigation menu',
      'aria-expanded': 'false',
      onclick() {
        const isOpen = mobileDrawer.classList.toggle('open');
        mobileToggle.setAttribute('aria-expanded', String(isOpen));
      }
    }, h('span', { html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>' }));

    // User Profile Strip
    const userStrip = h('div', { class: 'nav-user' },
      h('div', { class: 'user-avatar', title: userEmail }, userInitials),
      h('div', { class: 'user-info' },
        h('span', { class: 'user-email' }, userEmail),
        h('span', { class: 'user-role' }, 'Candidate Account')
      ),
      h('button', {
        type: 'button',
        class: 'btn btn-ghost btn-sm',
        title: 'Sign out',
        onclick: logout
      }, h('span', { html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' }))
    );

    // Assemble Header
    header.innerHTML = '';
    header.appendChild(
      h('div', { class: 'nav-container' },
        h('div', { class: 'nav-left' },
          h('a', { class: 'brand-logo', href: 'dashboard.html' },
            h('span', { class: 'brand-mark' }, 'J'),
            h('span', {}, 'JOB', h('span', { class: 'brand-text-green' }, 'NEX'))
          ),
          navLinks
        ),
        h('div', { class: 'nav-right' },
          userStrip,
          mobileToggle
        )
      )
    );

    // Mobile Drawer
    const mobileDrawer = h('div', { class: 'mobile-nav-drawer', id: 'mobile-nav-drawer' },
      NAV_ITEMS.map(item => {
        const isCurrent = item.href === currentPath || (item.href === 'interveiw.html' && currentPath === 'interview.html');
        const link = h('a', {
          href: item.href,
          'aria-current': isCurrent ? 'page' : false,
          onclick() {
            mobileDrawer.classList.remove('open');
            mobileToggle.setAttribute('aria-expanded', 'false');
          }
        });
        link.innerHTML = `${item.icon}<span>${item.label}</span>`;
        return link;
      }),
      h('button', {
        type: 'button',
        class: 'btn btn-danger-solid',
        style: 'margin-top: 16px;',
        onclick() {
          mobileDrawer.classList.remove('open');
          logout();
        }
      }, 'Sign out')
    );
    header.appendChild(mobileDrawer);

    // Assemble Footer
    if (footer) {
      footer.innerHTML = `
        <div class="footer-content">
          <div>
            <strong>JOBNEX</strong> &copy; ${new Date().getFullYear()} Career Intelligence Platform.
            <span class="text-muted" style="margin-left: 8px;">Restrained, accessible SaaS career management.</span>
          </div>
          <div>
            <span class="badge-demo" id="api-status-badge">Checking server…</span>
          </div>
        </div>
      `;
      const badge = $('#api-status-badge');
      if (badge && API().checkHealth) {
        API().checkHealth().then(res => {
          const online = res && res.status === 'ok';
          badge.textContent = online ? 'Connected to JOBNEX API' : 'Offline: showing demo data only';
        });
      }
    }
  }

  /* ---------- Application Data Model & Seed ---------- */
  const STATUSES = ['Applied', 'Interview', 'Offer', 'Rejected', 'Withdrawn'];
  const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

  const SEED_APPS = () => [
    { id: 'a1', jobId: 3, company: 'Orbit Analytics', title: 'Data Analyst', date: daysAgo(3), status: 'Applied' },
    { id: 'a2', jobId: 5, company: 'Cobalt Works', title: 'DevOps Engineer', date: daysAgo(8), status: 'Interview' },
    { id: 'a3', jobId: 1, company: 'Northwind Labs', title: 'Frontend Developer', date: daysAgo(14), status: 'Offer' },
    { id: 'a4', jobId: 6, company: 'Lumen Software', title: 'QA Engineer', date: daysAgo(20), status: 'Rejected' },
    { id: 'a5', jobId: 2, company: 'Brightpath Systems', title: 'Python Developer', date: daysAgo(1), status: 'Applied' }
  ];

  const getApps = () => store.get('apps', null) || SEED_APPS();
  const saveApps = apps => store.set('apps', apps);

  // Backend application -> the object shape the tables/kanban render.
  const toUiApp = a => ({
    id: a.application_id,
    jobId: a.job_id || null,
    company: a.company,
    title: a.job_title,
    date: a.created_at ? String(a.created_at).slice(0, 10) : daysAgo(0),
    status: a.status || 'Applied'
  });

  let offlineNoticeShown = false;
  /** Returns { apps, serverBacked }. An EMPTY server list is a real answer (no fake seed rows). */
  async function loadApplications() {
    if (API().getApplications) {
      try {
        const res = await API().getApplications();
        if (res && Array.isArray(res.applications)) {
          return { apps: res.applications.map(toUiApp), serverBacked: true };
        }
      } catch (e) {
        if (e && e.status === 401) throw e;           // api.js already redirects to login
        if (!offlineNoticeShown) {
          offlineNoticeShown = true;
          showToast('Server unreachable: showing local demo data.', 'error', 5000);
        }
      }
    }
    return { apps: getApps(), serverBacked: false };
  }

  const badgeEl = status => {
    const s = String(status || 'Applied').toLowerCase();
    const clean = s.charAt(0).toUpperCase() + s.slice(1);
    const span = h('span', { class: `badge s-${s}` });
    span.innerHTML = `<span class="badge-dot"></span>${clean}`;
    return span;
  };

  /* ---------- Page Registry ---------- */
  const pages = {};

  /* ==========================================================================
     PAGE 1: LOGIN (Authentication)
     ========================================================================== */
  pages.login = () => {
    const cardPanel = $('#auth-card-panel');
    const brandInteractive = $('#login-brand-interactive');
    const toggleAnimBtn = $('#toggle-animation-btn');
    const promptText = $('#prompt-text');
    const form = $('#login-form');
    const emailInput = $('#login-email');
    const passwordInput = $('#login-password');
    const rememberMe = $('#remember-me');
    const submitBtn = $('#login-button');
    const feedback = $('#login-feedback');
    const pwToggle = $('#password-toggle-btn');
    const modeToggle = $('#auth-mode-toggle');
    const nameWrap = $('#register-name-wrap');
    const nameInput = $('#register-name');
    const titleEl = $('#auth-title');
    const subtitleEl = $('#auth-subtitle');
    let registerMode = false;            // false = sign in, true = create account

    function setMode(register) {
      registerMode = register;
      if (nameWrap) nameWrap.hidden = !register;
      if (titleEl) titleEl.textContent = register ? 'Create Account' : 'Sign In';
      if (subtitleEl) subtitleEl.textContent = register
        ? 'Create your JOBNEX account. Use at least 8 characters for the password.'
        : 'Enter your credentials to access your career command center.';
      if (submitBtn) submitBtn.textContent = register ? 'Create Account' : 'Sign In to JOBNEX';
      if (modeToggle) modeToggle.textContent = register ? 'Already have an account? Sign in' : 'New here? Create an account';
      if (passwordInput) passwordInput.autocomplete = register ? 'new-password' : 'current-password';
      if (feedback) feedback.textContent = '';
    }
    if (modeToggle) modeToggle.addEventListener('click', () => setMode(!registerMode));

    // Interactive icon movement: Icon goes UP ⬆, Details reveal DOWN ⬇
    function revealDetails() {
      if (!cardPanel) return;
      cardPanel.classList.add('details-revealed');
      if (promptText) {
        promptText.textContent = '✨ Icon moved UP ⬆ • Details revealed DOWN ⬇ (Click icon to collapse/toggle) ✨';
      }
    }

    function toggleReveal(e) {
      if (e) e.stopPropagation();
      if (!cardPanel) return;
      const isRevealed = cardPanel.classList.toggle('details-revealed');
      if (promptText) {
        promptText.textContent = isRevealed
          ? '✨ Icon moved UP ⬆ • Details revealed DOWN ⬇ (Click icon to toggle) ✨'
          : '✨ Click icon to Sign In: Icon goes UP ⬆ Details reveal DOWN ⬇ ✨';
      }
    }

    if (brandInteractive) {
      brandInteractive.addEventListener('click', toggleReveal);
      brandInteractive.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleReveal(e);
        }
      });
    }

    if (toggleAnimBtn) {
      toggleAnimBtn.addEventListener('click', toggleReveal);
    }

    // Clicking anywhere on card panel when collapsed opens it
    if (cardPanel) {
      cardPanel.addEventListener('click', e => {
        if (!cardPanel.classList.contains('details-revealed')) {
          revealDetails();
        }
      });
    }

    // Auto-reveal when focusing form inputs
    [emailInput, passwordInput].forEach(inp => {
      if (inp) {
        inp.addEventListener('focus', revealDetails);
      }
    });

    // Show/hide password
    if (pwToggle) {
      pwToggle.addEventListener('click', () => {
        const isPw = passwordInput.type === 'password';
        passwordInput.type = isPw ? 'text' : 'password';
        pwToggle.setAttribute('aria-label', isPw ? 'Hide password' : 'Show password');
        pwToggle.innerHTML = isPw
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
          : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
      });
    }

    // Login submit
    if (form) {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const email = emailInput.value.trim();
        const password = passwordInput.value;

        // Validation
        let valid = true;
        const emailErr = $('#login-email-error');
        const pwErr = $('#login-password-error');

        if (!email) {
          if (emailErr) emailErr.textContent = 'Please enter your email address.';
          emailInput.setAttribute('aria-invalid', 'true');
          valid = false;
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          if (emailErr) emailErr.textContent = 'Please enter a valid email format.';
          emailInput.setAttribute('aria-invalid', 'true');
          valid = false;
        } else {
          if (emailErr) emailErr.textContent = '';
          emailInput.removeAttribute('aria-invalid');
        }

        if (!password) {
          if (pwErr) pwErr.textContent = 'Please enter your password.';
          passwordInput.setAttribute('aria-invalid', 'true');
          valid = false;
        } else if (password.length < 8) {
          if (pwErr) pwErr.textContent = 'Password must be at least 8 characters.';
          passwordInput.setAttribute('aria-invalid', 'true');
          valid = false;
        } else {
          if (pwErr) pwErr.textContent = '';
          passwordInput.removeAttribute('aria-invalid');
        }

        if (!valid) return;

        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span class="spinner"></span> ${registerMode ? 'Creating account…' : 'Signing in…'}`;

        try {
          // Real authentication: the backend validates the credentials and sets the session cookie.
          const res = registerMode
            ? await API().register({ email, password, name: nameInput ? nameInput.value.trim() : '' })
            : await API().signInWithEmail({ email, password });
          const user = (res && res.user) || { email };
          setSession({ email: user.email, name: user.name || null }, rememberMe && rememberMe.checked);
          showToast(registerMode ? 'Account created! Loading your dashboard…' : 'Welcome back! Loading your dashboard…', 'success');
          setTimeout(() => location.href = 'dashboard.html', 500);
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = registerMode ? 'Create Account' : 'Sign In to JOBNEX';
          if (feedback) {
            feedback.textContent = err.message || 'Sign in failed. Check your details.';
            feedback.style.color = 'var(--color-danger)';
          }
        }
      });
    }

    // Google Sign In
    const googleBtn = $('#google-login');
    if (googleBtn) {
      googleBtn.addEventListener('click', async () => {
        const providers = API().getAuthProviders ? await API().getAuthProviders() : { google: false };
        if (providers.google) {
          location.href = API().googleLoginUrl();   // server redirects to Google, then back to login.html
          return;
        }
        showModal({
          title: 'Google sign-in not configured',
          content: h('p', {}, 'The server has no Google OAuth credentials yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the backend .env file (see the integration guide), or sign in with email and password.'),
          confirmText: 'Understood',
          cancelText: 'Close'
        });
      });
    }

    // Already signed in (or just returned from Google)? Go straight to the dashboard.
    if (API().me) {
      API().me().then(res => {
        if (res && res.user) {
          setSession({ email: res.user.email, name: res.user.name || null }, true);
          location.replace('dashboard.html');
        }
      }).catch(() => { /* not signed in: stay on the form */ });
    }

    // Forgot Password
    const forgotPw = $('#forgot-password');
    if (forgotPw) {
      forgotPw.addEventListener('click', e => {
        e.preventDefault();
        showModal({
          title: 'Reset Password',
          content: h('p', {}, 'Password reset by email is not available yet. If you cannot sign in, create a new account with a different email address.'),
          confirmText: 'Got it',
          cancelText: 'Dismiss'
        });
      });
    }
  };

  /* ==========================================================================
     PAGE 2: DASHBOARD
     ========================================================================== */
  pages.dashboard = async () => {
    const { apps } = await loadApplications();

    const countStatus = status => apps.filter(x => (x.status || 'Applied').toLowerCase() === status.toLowerCase()).length;
    const totalApps = apps.length;
    const interviewCount = countStatus('Interview');
    const offerCount = countStatus('Offer');
    const rejectedCount = countStatus('Rejected');
    const appliedCount = countStatus('Applied');

    // Populate KPI numbers
    const statApplied = $('#stat-applied');
    const statInterview = $('#stat-interview');
    const statOffer = $('#stat-offer');
    const statRejected = $('#stat-rejected');

    if (statApplied) statApplied.textContent = totalApps;
    if (statInterview) statInterview.textContent = interviewCount;
    if (statOffer) statOffer.textContent = offerCount;
    if (statRejected) statRejected.textContent = rejectedCount;

    // Status Distribution Bar
    const distBar = $('#status-dist-bar');
    if (distBar && totalApps > 0) {
      distBar.innerHTML = '';
      const pApplied = (appliedCount / totalApps) * 100;
      const pInterview = (interviewCount / totalApps) * 100;
      const pOffer = (offerCount / totalApps) * 100;
      const pRejected = (rejectedCount / totalApps) * 100;

      if (pApplied > 0) distBar.appendChild(h('div', { class: 'status-seg applied', style: `width: ${pApplied}%`, title: `Applied: ${appliedCount} (${Math.round(pApplied)}%)` }));
      if (pInterview > 0) distBar.appendChild(h('div', { class: 'status-seg interview', style: `width: ${pInterview}%`, title: `Interview: ${interviewCount} (${Math.round(pInterview)}%)` }));
      if (pOffer > 0) distBar.appendChild(h('div', { class: 'status-seg offer', style: `width: ${pOffer}%`, title: `Offer: ${offerCount} (${Math.round(pOffer)}%)` }));
      if (pRejected > 0) distBar.appendChild(h('div', { class: 'status-seg rejected', style: `width: ${pRejected}%`, title: `Rejected: ${rejectedCount} (${Math.round(pRejected)}%)` }));
    }

    // Populate Recent Applications Table
    const tbody = $('#recent-body');
    if (tbody) {
      tbody.innerHTML = '';
      const sorted = apps.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5);

      if (sorted.length === 0) {
        tbody.appendChild(h('tr', {},
          h('td', { colspan: 5, class: 'text-center text-muted', style: 'padding: 24px;' }, 'No applications tracked yet. Use Find Jobs to discover and queue roles.')
        ));
      } else {
        sorted.forEach(app => {
          const row = h('tr', {},
            h('td', { style: 'font-weight: 600;' }, app.company),
            h('td', {}, app.title),
            h('td', { class: 'text-muted' }, app.date || daysAgo(0)),
            h('td', {}, badgeEl(app.status)),
            h('td', { style: 'text-align: right;' },
              h('a', { href: 'applications.html', class: 'btn btn-ghost btn-sm' }, 'Manage')
            )
          );
          tbody.appendChild(row);
        });
      }
    }

    // Upcoming Reminders Card
    const remindersBox = $('#upcoming-reminders');
    if (remindersBox) {
      const interviewApps = apps.filter(x => (x.status || '').toLowerCase() === 'interview');
      if (interviewApps.length > 0) {
        remindersBox.innerHTML = interviewApps.slice(0, 2).map(app => `
          <div class="activity-item">
            <span class="activity-dot" style="background: #F59E0B;"></span>
            <div>
              <strong>Interview Scheduled</strong>: ${escapeHtml(app.company)} (${escapeHtml(app.title)})
              <div class="text-sm text-muted">Prepare with Technical & Behavioral questions on the Interview Prep page.</div>
            </div>
          </div>
        `).join('');
      } else {
        remindersBox.innerHTML = `
          <div class="activity-item">
            <span class="activity-dot"></span>
            <div>
              <strong>Daily Resume Scan Ready</strong>
              <div class="text-sm text-muted">Upload your updated resume to get match scores against the latest job descriptions.</div>
            </div>
          </div>
        `;
      }
    }
  };

  /* ==========================================================================
     PAGE 3: RESUME ANALYZER
     ========================================================================== */
  pages.analyzer = () => {
    const form = $('#analyze-form');
    const resumeArea = $('#resume_text');
    const jdArea = $('#jd_text');
    const submitBtn = $('#analyze-button');
    const statusMsg = $('#status');
    const resultsSection = $('#results');
    const fileUploadInput = $('#resume-file-upload');
    const dropzone = $('#resume-dropzone');
    const fileNamePill = $('#file-name-pill');

    // Sample JDs for quick evaluation
    const SAMPLE_JDS = {
      python: `Python Developer (3+ Years)
Requirements:
- 3+ years experience with Python, FastAPI, and Flask
- Strong knowledge of SQL databases (PostgreSQL, MySQL)
- Hands-on experience with Docker, CI/CD pipelines, and AWS
- Building RESTful APIs and microservice architectures`,
      frontend: `Senior Frontend Engineer (React/TypeScript)
Requirements:
- 4+ years building responsive web apps with React and TypeScript
- Proficiency in modern CSS, semantic HTML5, and accessibility (WCAG AA)
- Experience with state management, REST APIs, and Jest testing
- Familiarity with CI/CD and web performance optimization`,
      data: `Data Analyst
Requirements:
- 2+ years working with SQL, Python (Pandas, NumPy), and BI tools (PowerBI/Tableau)
- Experience querying large relational databases and designing dashboards
- Understanding of data hygiene, reporting, and statistical modeling`,
      devops: `DevOps & Cloud Engineer
Requirements:
- Hands-on experience with AWS cloud infrastructure, Kubernetes, and Docker
- Terraform infrastructure as code (IaC)
- Automation of CI/CD pipelines using GitHub Actions or GitLab
- Linux systems engineering and observability (Prometheus/Grafana)`
    };

    // Attach sample JD buttons
    $$('[data-sample-jd]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.sampleJd;
        if (SAMPLE_JDS[key]) {
          jdArea.value = SAMPLE_JDS[key];
          showToast(`Loaded ${key} sample JD`, 'info');
        }
      });
    });

    // File Upload handling
    function handleFile(file) {
      if (!file) return;
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (ext !== '.txt') {
        // The backend analyzes text only; it has no PDF/Word parser yet. Never invent resume content.
        showToast('PDF/Word files cannot be read yet. Paste your resume text or upload a .txt file.', 'error', 5000);
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showToast('File size exceeds 5MB limit', 'error');
        return;
      }

      if (fileNamePill) {
        fileNamePill.innerHTML = `
          <span>${escapeHtml(file.name)} (${Math.round(file.size / 1024)} KB)</span>
          <button type="button" class="btn btn-ghost btn-sm" id="clear-file" style="padding: 2px 4px;">&times;</button>
        `;
        fileNamePill.hidden = false;
        $('#clear-file').addEventListener('click', () => {
          fileNamePill.hidden = true;
          fileUploadInput.value = '';
        });
      }

      const reader = new FileReader();
      reader.onload = e => {
        resumeArea.value = e.target.result;
        showToast('Resume content loaded from file', 'success');
      };
      reader.readAsText(file);
    }

    if (fileUploadInput) {
      fileUploadInput.addEventListener('change', e => handleFile(e.target.files[0]));
    }

    if (dropzone) {
      ['dragenter', 'dragover'].forEach(name => {
        dropzone.addEventListener(name, e => { e.preventDefault(); dropzone.classList.add('dragover'); });
      });
      ['dragleave', 'drop'].forEach(name => {
        dropzone.addEventListener(name, e => { e.preventDefault(); dropzone.classList.remove('dragover'); });
      });
      dropzone.addEventListener('drop', e => {
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
      });
      dropzone.addEventListener('click', () => fileUploadInput && fileUploadInput.click());
    }

    // Stop words for client-side comparison
    const STOP = new Set('and the for with you our are will have has this that from your their they not but can all any who use using able also into more must such than then them these those its was were been being work team years experience candidate knowledge'.split(' '));
    const extractKeywords = text => [...new Set((text.toLowerCase().match(/[a-z][a-z+#.]{2,}/g) || []).map(w => w.replace(/\.$/, '')).filter(w => !STOP.has(w)))];

    // Form Submission
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const resume = resumeArea.value.trim();
      const jd = jdArea.value.trim();

      let valid = true;
      const rErr = $('#resume_text-error');
      const jErr = $('#jd_text-error');

      if (!resume) {
        if (rErr) rErr.textContent = 'Please paste your resume or upload a document.';
        resumeArea.setAttribute('aria-invalid', 'true');
        valid = false;
      } else {
        if (rErr) rErr.textContent = '';
        resumeArea.removeAttribute('aria-invalid');
      }

      if (!jd) {
        if (jErr) jErr.textContent = 'Please paste the job description to compare against.';
        jdArea.setAttribute('aria-invalid', 'true');
        valid = false;
      } else {
        if (jErr) jErr.textContent = '';
        jdArea.removeAttribute('aria-invalid');
      }

      if (!valid) return;

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner"></span> Analyzing Resume…';
      if (statusMsg) statusMsg.textContent = 'Sending resume data for semantic matching…';
      if (resultsSection) resultsSection.hidden = true;

      try {
        let resultData = null;
        if (API().analyzeResume) {
          resultData = await API().analyzeResume({ resumeText: resume, jdText: jd });
        }

        // Fallback calculation if backend is missing or offline
        if (!resultData || typeof resultData !== 'object') {
          const rWords = new Set(extractKeywords(resume));
          const jWords = extractKeywords(jd);
          const matched = jWords.filter(w => rWords.has(w));
          const missing = jWords.filter(w => !rWords.has(w));
          const score = jWords.length ? Math.round((matched.length / jWords.length) * 100) : 0;

          resultData = {
            matched_score: score,
            matched_skills: matched.slice(0, 15),
            missing_skills: missing.slice(0, 8),
            suggestions: missing.slice(0, 4).map(s => `Consider highlighting or training on ${s} to align with this role requirements.`),
            mode: 'client_keyword_overlap'
          };
        }

        // Remember the result for the Courses, Interview Prep and Privacy pages
        if (Array.isArray(resultData.missing_skills)) {
          store.set('missing', resultData.missing_skills);
        }
        if (Array.isArray(resultData.matched_skills)) {
          store.set('matched', resultData.matched_skills);
        }
        if (resultData.analysis_id) {
          store.set('lastAnalysisId', resultData.analysis_id);
          // Apply the visibility chosen on the Privacy page to this new analysis (best effort).
          const vis = (store.get('privacy_settings', {}) || {}).vis;
          if (vis && vis !== 'private' && API().setPrivacy) {
            API().setPrivacy(resultData.analysis_id, vis).catch(() => {});
          }
        }

        // Render Report into structured DOM
        renderAnalysisReport(resultData);
        if (resultsSection) {
          resultsSection.hidden = false;
          resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        if (statusMsg) statusMsg.textContent = 'Analysis complete.';
        showToast('Resume analysis complete!', 'success');
      } catch (err) {
        if (statusMsg) statusMsg.textContent = 'Analysis error: ' + err.message;
        showToast('Analysis failed: ' + err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Analyze Resume';
      }
    });

    function renderAnalysisReport(data) {
      const score = Math.round(Number(data.matched_score) || 0);
      const scoreEl = $('#report-score-number');
      const labelEl = $('#report-score-label');
      const matchedEl = $('#report-matched-skills');
      const missingEl = $('#report-missing-skills');
      const suggestionsEl = $('#report-suggestions-list');

      if (scoreEl) scoreEl.textContent = `${score}%`;
      if (labelEl) {
        if (score >= 75) {
          labelEl.textContent = 'Strong Match';
          labelEl.style.color = '#15803D';
        } else if (score >= 50) {
          labelEl.textContent = 'Moderate Alignment';
          labelEl.style.color = '#B45309';
        } else {
          labelEl.textContent = 'Skill Gaps Detected';
          labelEl.style.color = '#DC2626';
        }
      }

      // Matched Skills
      if (matchedEl) {
        matchedEl.innerHTML = '';
        const matched = data.matched_skills || [];
        if (matched.length === 0) {
          matchedEl.innerHTML = '<span class="text-muted text-sm">No exact keyword matches found.</span>';
        } else {
          matched.forEach(skill => {
            const span = h('span', { class: 'skill-tag matched' });
            span.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> ${escapeHtml(skill)}`;
            matchedEl.appendChild(span);
          });
        }
      }

      // Missing Skills
      if (missingEl) {
        missingEl.innerHTML = '';
        const missing = data.missing_skills || [];
        if (missing.length === 0) {
          missingEl.innerHTML = '<span class="text-muted text-sm">All core keywords covered!</span>';
        } else {
          missing.forEach(skill => {
            const span = h('span', { class: 'skill-tag missing' });
            span.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> ${escapeHtml(skill)}`;
            missingEl.appendChild(span);
          });
        }
      }

      // Actionable Suggestions
      if (suggestionsEl) {
        suggestionsEl.innerHTML = '';
        const suggestions = data.suggestions || [];
        if (suggestions.length === 0) {
          suggestionsEl.innerHTML = '<p class="text-sm text-muted">Your resume aligns well with this job specification.</p>';
        } else {
          suggestions.forEach(s => {
            const div = h('div', { class: 'suggestion-card' },
              h('span', { style: 'color: var(--brand-green); font-size: 1.1rem; line-height: 1;' }, '✓'),
              h('div', {}, s)
            );
            suggestionsEl.appendChild(div);
          });
        }
      }
    }
  };

  /* ==========================================================================
     PAGE 4: FIND JOBS
     ========================================================================== */
  const SAMPLE_JOB_DATABASE = [
    { id: 1, company: 'Northwind Labs', title: 'Frontend Developer', location: 'Bengaluru, India', region: 'bengaluru', exp: 'junior', certs: [], match: 86, job_type: 'Full-time', skills: 'html css javascript react tailwind', description: 'Build customer-facing responsive applications in React and TypeScript. Collaborate with UX architects.' },
    { id: 2, company: 'Brightpath Systems', title: 'Python Developer', location: 'Hyderabad, India', region: 'india', exp: 'mid', certs: ['aws'], match: 78, job_type: 'Full-time', skills: 'python fastapi docker sql aws', description: 'Design robust backend microservices using FastAPI, SQLAlchemy, and Docker containers.' },
    { id: 3, company: 'Orbit Analytics', title: 'Data Analyst', location: 'Remote', region: 'global', exp: 'fresher', certs: [], match: 64, job_type: 'Contract', skills: 'sql python dashboards bi tableau', description: 'Analyze product event telemetry, generate recurring KPI dashboards, and write optimized SQL queries.' },
    { id: 4, company: 'Harbor & Finch', title: 'Java Developer', location: 'Austin, TX, USA', region: 'usa', exp: 'senior', certs: ['pmp'], match: 71, job_type: 'Full-time', skills: 'java spring microservices docker', description: 'Lead backend enterprise integrations using Spring Boot, Kafka, and PostgreSQL.' },
    { id: 5, company: 'Cobalt Works', title: 'DevOps Engineer', location: 'Bengaluru, India', region: 'bengaluru', exp: 'mid', certs: ['azure', 'aws'], match: 59, job_type: 'Full-time', skills: 'docker kubernetes ci cd terraform', description: 'Manage Kubernetes clusters, automate deployment pipelines, and maintain observability.' },
    { id: 6, company: 'Lumen Software', title: 'QA Engineer', location: 'Pune, India', region: 'india', exp: 'fresher', certs: [], match: 66, job_type: 'Full-time', skills: 'testing selenium python cypress', description: 'Write automated end-to-end regression suites and participate in manual exploratory testing.' },
    { id: 7, company: 'Fieldnote AI', title: 'Django Developer', location: 'Seattle, WA, USA', region: 'usa', exp: 'mid', certs: ['gcp'], match: 82, job_type: 'Full-time', skills: 'python django rest postgres aws', description: 'Implement REST APIs for internal workflow tools using Django REST framework and PostgreSQL.' },
    { id: 8, company: 'Tidewater Digital', title: 'Scrum Master', location: 'Remote', region: 'global', exp: 'mid', certs: ['scrum'], match: 52, job_type: 'Part-time', skills: 'agile scrum coaching jira', description: 'Facilitate agile sprint ceremonies and remove blockers for cross-functional engineering teams.' }
  ];

  pages.jobs = () => {
    const form = $('#job-search-form');
    const keywordInput = $('#job-keywords');
    const expFilter = $('#filter-experience');
    const regionFilter = $('#filter-region');
    const certFilter = $('#filter-cert');
    const sortSelect = $('#sort-jobs');
    const resultsContainer = $('#job-results');
    const resultCount = $('#result-count');
    const resumeContext = $('#application-resume');

    const savedJobs = new Set(store.get('savedJobs', []));

    // Show Job Details Modal
    function openJobDetailsModal(job, isApplied) {
      const modalContent = h('div', {},
        h('div', { class: 'job-meta-row', style: 'margin-top: 0;' },
          h('span', { class: 'badge badge-neutral' }, job.job_type || 'Full-time'),
          h('span', { class: 'text-sm text-muted' }, `📍 ${job.location}`),
          typeof job.match === 'number'
            ? h('span', { class: `job-match-pill ${job.match >= 75 ? 'high' : 'medium'}` }, `${job.match}% Match`)
            : null
        ),
        h('h4', { style: 'margin: 16px 0 8px;' }, 'Role Overview'),
        h('p', { class: 'text-sm', style: 'line-height: 1.6;' }, job.description || 'Full specification available on recruiter portal.'),
        h('h4', { style: 'margin: 16px 0 8px;' }, 'Required Skills & Technologies'),
        h('div', { class: 'job-tags' },
          (job.skills || '').split(' ').map(s => h('span', { class: 'chip active' }, s))
        ),
        h('div', { class: 'callout callout-info', style: 'margin-top: 20px;' },
          h('span', { class: 'callout-icon', html: 'ℹ️' }),
          h('div', {},
            'Queuing an application saves it to your JOBNEX application tracker (Dashboard and Applications pages).'
          )
        )
      );

      showModal({
        title: `${job.title} at ${job.company}`,
        content: modalContent,
        confirmText: isApplied ? 'Already Applied' : 'Queue Application',
        cancelText: 'Close',
        onConfirm: isApplied ? null : async () => queueJob(job)
      });
    }

    // Queue Application Action
    async function queueJob(job) {
      try {
        if (API().queueApplication) {
          await API().queueApplication({
            job_id: job.id,
            job_title: job.title,
            company: job.company,
            job_url: job.url || null
          });
          showToast(`Application queued for ${job.company}!`, 'success');
        } else {
          const apps = getApps();
          apps.push({
            id: 'app_' + Date.now(),
            jobId: job.id,
            company: job.company,
            title: job.title,
            date: daysAgo(0),
            status: 'Applied'
          });
          saveApps(apps);
          showToast(`Applied to ${job.company}`, 'success');
        }
        runSearch();
      } catch (err) {
        showToast(`Could not queue application: ${err.message}`, 'error');
      }
    }

    // Render Job Card
    function renderJobCard(job, isApplied) {
      const companyInitials = escapeHtml(job.company.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase());
      const hasMatch = typeof job.match === 'number';
      const matchClass = job.match >= 75 ? 'high' : 'medium';

      const card = h('article', { class: 'job-card' });
      card.innerHTML = `
        <div>
          <div class="job-card-top">
            <div style="display: flex; gap: 12px; align-items: center;">
              <div class="company-logo-avatar">${companyInitials}</div>
              <div class="job-main-info">
                <h3>${escapeHtml(job.title)}</h3>
                <div class="job-company">${escapeHtml(job.company)}</div>
              </div>
            </div>
            ${hasMatch ? `<span class="job-match-pill ${matchClass}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              ${job.match}% Match
            </span>` : ''}
          </div>

          <div class="job-meta-row">
            <span class="job-meta-item">📍 ${escapeHtml(job.location)}</span>
            <span class="job-meta-item">💼 ${escapeHtml(job.job_type || 'Full-time')}</span>
            <span class="job-meta-item">🎯 ${job.exp ? escapeHtml(job.exp.charAt(0).toUpperCase() + job.exp.slice(1)) : 'Any'}</span>
          </div>

          <div class="job-tags">
            ${(job.skills || '').split(' ').filter(Boolean).slice(0, 4).map(s => `<span class="chip">${escapeHtml(s)}</span>`).join('')}
          </div>
        </div>
      `;

      // Card Bottom Actions
      const actionsDiv = h('div', { class: 'job-actions' });

      const detailsBtn = h('button', {
        type: 'button',
        class: 'btn btn-outline btn-sm',
        onclick: () => openJobDetailsModal(job, isApplied)
      }, 'Details');

      const saveBtn = h('button', {
        type: 'button',
        class: 'btn btn-ghost btn-sm',
        title: savedJobs.has(job.id) ? 'Remove saved' : 'Save job',
        onclick() {
          if (savedJobs.has(job.id)) {
            savedJobs.delete(job.id);
            saveBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
            showToast('Job removed from saved', 'info');
          } else {
            savedJobs.add(job.id);
            saveBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
            showToast('Job saved to your bookmarks', 'success');
          }
          store.set('savedJobs', [...savedJobs]);
        }
      });
      saveBtn.innerHTML = savedJobs.has(job.id)
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';

      const applyBtn = h('button', {
        type: 'button',
        class: isApplied ? 'btn btn-secondary btn-sm' : 'btn btn-sm',
        disabled: isApplied,
        onclick: () => queueJob(job)
      }, isApplied ? '✓ Applied' : 'Queue Application');

      const leftActions = h('div', { style: 'display: flex; gap: 6px; align-items: center;' }, detailsBtn, saveBtn);
      actionsDiv.append(leftActions, applyBtn);
      card.appendChild(actionsDiv);

      return card;
    }

    // Search and Filtering Logic
    async function runSearch() {
      resultsContainer.innerHTML = `
        <div class="card text-center" style="grid-column: 1 / -1; padding: 48px;">
          <span class="spinner" style="margin-bottom: 12px;"></span>
          <p class="text-muted">Searching job catalog…</p>
        </div>
      `;

      try {
        const keyword = (keywordInput ? keywordInput.value : '').trim();
        let list = [];

        let serverAnswered = false;
        if (API().searchJobs) {
          try {
            const res = await API().searchJobs(keyword, 50);
            list = (res && res.jobs) || [];
            serverAnswered = true;
          } catch (e) {
            if (e && e.status === 401) throw e;
            showToast('Server unreachable: showing sample jobs.', 'error', 4000);
          }
        }

        if (!serverAnswered) {
          const terms = keyword.toLowerCase().split(/\s+/).filter(Boolean);
          list = SAMPLE_JOB_DATABASE.filter(j => {
            if (!terms.length) return true;
            const fullText = `${j.title} ${j.company} ${j.skills} ${j.description}`.toLowerCase();
            return terms.every(t => fullText.includes(t));
          });
        }

        // Apply filters
        const exp = expFilter ? expFilter.value : 'any';
        const region = regionFilter ? regionFilter.value : 'global';
        const cert = certFilter ? certFilter.value : 'any';

        list = list.filter(j => {
          const jExp = j.experience || j.exp || '';
          const jRegion = j.region || '';
          const jCerts = j.certifications || j.certs || [];

          const matchExp = exp === 'any' || jExp === exp;
          const matchRegion = region === 'global' || (region === 'india' ? (jRegion === 'india' || jRegion === 'bengaluru') : jRegion === region);
          const matchCert = cert === 'any' || jCerts.includes(cert);

          return matchExp && matchRegion && matchCert;
        });

        // Sorting
        const sortMode = sortSelect ? sortSelect.value : 'match';
        if (sortMode === 'match') {
          list.sort((a, b) => (b.match || b.match_score || 0) - (a.match || a.match_score || 0));
        } else if (sortMode === 'company') {
          list.sort((a, b) => a.company.localeCompare(b.company));
        }

        // Check applied status
        const { apps: trackedApps } = await loadApplications();
        const appliedKeys = new Set(trackedApps.flatMap(a => [a.jobId, `${a.title}|${a.company}`].filter(Boolean)));

        resultsContainer.innerHTML = '';
        if (list.length === 0) {
          resultsContainer.innerHTML = `
            <div class="empty-state card" style="grid-column: 1 / -1;">
              <div class="empty-state-icon">🔍</div>
              <h3>No matching jobs found</h3>
              <p>Try clearing some filters or searching for broader terms like "developer" or "analyst".</p>
              <button type="button" class="btn btn-secondary" id="reset-filters-btn">Reset All Filters</button>
            </div>
          `;
          $('#reset-filters-btn').addEventListener('click', () => {
            if (keywordInput) keywordInput.value = '';
            if (expFilter) expFilter.value = 'any';
            if (regionFilter) regionFilter.value = 'global';
            if (certFilter) certFilter.value = 'any';
            runSearch();
          });
          if (resultCount) resultCount.textContent = '0 jobs found';
          return;
        }

        if (resultCount) resultCount.textContent = `Showing ${list.length} verified job opportunities`;
        list.forEach(job => {
          const isApplied = appliedKeys.has(job.id) || appliedKeys.has(`${job.title}|${job.company}`);
          resultsContainer.appendChild(renderJobCard({ ...job, match: job.match ?? job.match_score ?? null }, isApplied));
        });

      } catch (err) {
        resultsContainer.innerHTML = `
          <div class="card callout-demo" style="grid-column: 1 / -1; padding: 24px;">
            <h3>Failed to load jobs</h3>
            <p>${escapeHtml(err.message)}</p>
            <button type="button" class="btn btn-secondary" onclick="location.reload()">Retry</button>
          </div>
        `;
      }
    }

    if (form) {
      form.addEventListener('submit', e => { e.preventDefault(); runSearch(); });
      form.addEventListener('reset', () => setTimeout(runSearch, 50));
    }
    if (expFilter) expFilter.addEventListener('change', runSearch);
    if (regionFilter) regionFilter.addEventListener('change', runSearch);
    if (certFilter) certFilter.addEventListener('change', runSearch);
    if (sortSelect) sortSelect.addEventListener('change', runSearch);

    $$('[data-q]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (keywordInput) keywordInput.value = btn.dataset.q;
        runSearch();
      });
    });

    runSearch();
  };



  /* ==========================================================================
     PAGE 6: INTERVIEW PREP
     ========================================================================== */
  const INTERVIEW_QUESTIONS = {
    technical: [
      { id: 't1', q: 'Explain a complex project you built and the architectural decisions you made.', diff: 'Advanced', tips: 'Start with business context and problem. Discuss technology stack trade-offs (e.g. why PostgreSQL over MongoDB, why FastAPI over Django). Emphasize monitoring, scaling bottlenecks, and what you would do differently.' },
      { id: 't2', q: 'How would you debug an API endpoint returning a 500 Internal Server Error?', diff: 'Intermediate', tips: '1. Inspect HTTP response body and error code.\n2. Check application and reverse-proxy (Nginx/Uvicorn) logs.\n3. Reproduce locally or with Postman/cURL.\n4. Isolate database query locks, unhandled exceptions, or schema mismatches.\n5. Write a regression test after patching.' },
      { id: 't3', q: 'Client-side vs Server-side validation: What are the differences and best practices?', diff: 'Beginner', tips: 'Client-side gives instant user feedback and reduces network requests. Server-side is mandatory because clients can be bypassed or tampered with. Never trust raw user inputs on the backend.' },
      { id: 't4', q: 'How do you prevent duplicate form submissions in distributed web apps?', diff: 'Intermediate', tips: 'Client: Disable submit button immediately upon click.\nServer: Use idempotency keys, unique database constraints, and Redis locks for financial/critical actions.' },
      { id: 't5', q: 'How do you ensure a web application is accessible (WCAG 2.2 AA compliant)?', diff: 'Intermediate', tips: 'Use semantic HTML5 elements, logical tabindex order, visible :focus-visible indicators, sufficient contrast (minimum 4.5:1), and ARIA attributes for dynamic dialogs and screen readers.' }
    ],
    behavioral: [
      { id: 'b1', q: 'Tell me about a time you had to learn a completely new technology under a tight deadline.', diff: 'Beginner', tips: 'Use STAR: Situation (new framework required for client deliverables), Task (ramp up within 2 weeks), Action (isolated core docs, built a proof-of-concept prototype, paired with senior peer), Result (delivered on time with zero release blockers).' },
      { id: 'b2', q: 'Describe a mistake you made on a project and how you handled the outcome.', diff: 'Intermediate', tips: 'Own the mistake immediately without shifting blame. Detail the root-cause analysis, corrective actions taken, post-mortem created, and systemic guards added (e.g., CI/CD linting rule).' },
      { id: 'b3', q: 'Tell me about a time you received constructive criticism that was difficult to hear.', diff: 'Beginner', tips: 'Highlight emotional maturity and receptiveness. Discuss asking clarifying questions to understand actionable steps, followed by measurable improvement in subsequent quarters.' },
      { id: 'b4', q: 'How do you prioritize competing deadlines when every stakeholder considers their request urgent?', diff: 'Intermediate', tips: 'Evaluate through business value vs effort matrices. Proactively communicate trade-offs, negotiate phases (MVP vs stretch), and keep documentation transparent.' },
      { id: 'b5', q: 'Describe working through ambiguous requirements with minimal product documentation.', diff: 'Advanced', tips: 'Break ambiguity into hypotheses. Schedule structured alignment sessions, diagram user journeys, validate assumptions with mockups, and build incrementally.' }
    ],
    hr: [
      { id: 'h1', q: 'Walk me through your background and career journey.', diff: 'Beginner', tips: 'Keep it tight (approx 2 minutes): Present (current role & key strengths), Past (notable previous projects/education), Future (why this role represents the logical next chapter).' },
      { id: 'h2', q: 'Why are you interested in joining our company specifically?', diff: 'Beginner', tips: 'Demonstrate company research. Reference their recent product launches, engineering culture, or public mission. Connect your individual goals directly to their roadmap.' },
      { id: 'h3', q: 'What work environment and team culture brings out your best performance?', diff: 'Beginner', tips: 'Balance autonomy with collaboration. Emphasize open code reviews, blameless post-mortems, clear documentation, and mutual accountability.' },
      { id: 'h4', q: 'What are your key professional strengths and one area you are developing?', diff: 'Intermediate', tips: 'Provide real examples for strengths (e.g. system reliability, clean API design). Frame your development area with active steps you are currently taking (e.g. studying distributed systems).' }
    ],
    system: [
      { id: 's1', q: 'Design a scalable URL shortening service (like Bitly).', diff: 'Intermediate', tips: 'Requirements: High read-to-write ratio (100:1). Short hash generation (Base62 with 7 characters = 3.5 trillion URLs). Storage: Key-value NoSQL or PostgreSQL with indexing. Caching: Redis for top 20% URLs. Rate limiting by IP/API token.' },
      { id: 's2', q: 'How would you architect a high-throughput Job Search and Filtering API?', diff: 'Advanced', tips: 'Decouple ingestion from search. Use Elasticsearch or OpenSearch for tokenized search and fuzzy match. PostgreSQL for source-of-truth records. Redis for caching popular query results. Asynchronous indexing via Kafka or RabbitMQ.' },
      { id: 's3', q: 'Design an automated notification delivery system (Email, SMS, Push).', diff: 'Advanced', tips: 'Microservice with message queues (Kafka/SQS) for delivery decoupling. Worker pools for third-party provider integration with exponential backoff retries. Deduplication tables to prevent repeat messages.' }
    ]
  };

  pages.interview = () => {
    const questionsContainer = $('#interview-questions');
    const tabs = $$('.tab-btn[data-cat]');
    const diffSelect = $('#filter-difficulty');
    const searchInput = $('#search-questions');
    const progressText = $('#practice-progress-text');
    const progressBar = $('#practice-progress-bar');
    const generateBtn = $('#generate-questions');

    let currentCategory = 'technical';
    let practicedSet = new Set(store.get('practiced_questions', []));

    function updateProgress() {
      const allQuestions = Object.values(INTERVIEW_QUESTIONS).flat();
      const total = allQuestions.length;
      const count = practicedSet.size;
      const percent = Math.round((count / total) * 100);

      if (progressText) progressText.textContent = `${count} of ${total} Questions Practiced (${percent}%)`;
      if (progressBar) progressBar.style.width = `${percent}%`;
    }

    function renderQuestions() {
      const list = INTERVIEW_QUESTIONS[currentCategory] || [];
      const diff = diffSelect ? diffSelect.value : 'all';
      const search = (searchInput ? searchInput.value : '').toLowerCase().trim();

      const filtered = list.filter(item => {
        const matchDiff = diff === 'all' || item.diff.toLowerCase() === diff.toLowerCase();
        const matchSearch = !search || item.q.toLowerCase().includes(search) || item.tips.toLowerCase().includes(search);
        return matchDiff && matchSearch;
      });

      questionsContainer.innerHTML = '';
      if (filtered.length === 0) {
        questionsContainer.innerHTML = `
          <div class="card text-center text-muted" style="padding: 32px;">
            No questions match your current search or difficulty filter.
          </div>
        `;
        return;
      }

      filtered.forEach(item => {
        const isPracticed = practicedSet.has(item.id);
        const card = h('article', { class: 'question-card' });
        card.innerHTML = `
          <div class="question-header">
            <div>
              <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
                <span class="badge badge-neutral">${currentCategory.toUpperCase()}</span>
                <span class="badge ${item.diff === 'Advanced' ? 's-rejected' : item.diff === 'Intermediate' ? 's-interview' : 's-offer'}">${item.diff}</span>
              </div>
              <h3 class="question-title">${item.q}</h3>
            </div>
            <button type="button" class="btn ${isPracticed ? 'btn-secondary' : 'btn-outline'} btn-sm" id="practice-${item.id}">
              ${isPracticed ? '✓ Practiced' : 'Mark as Practiced'}
            </button>
          </div>
          <details class="tips-accordion">
            <summary class="tips-summary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              View Answer Tips & Recommended Structure
            </summary>
            <div class="tips-content">${escapeHtml(item.tips).replace(/\n/g, '<br>')}</div>
          </details>
        `;

        // Toggle Practiced
        const btn = card.querySelector(`#practice-${item.id}`);
        btn.addEventListener('click', () => {
          if (practicedSet.has(item.id)) {
            practicedSet.delete(item.id);
            btn.className = 'btn btn-outline btn-sm';
            btn.textContent = 'Mark as Practiced';
          } else {
            practicedSet.add(item.id);
            btn.className = 'btn btn-secondary btn-sm';
            btn.textContent = '✓ Practiced';
            showToast('Question marked as practiced!', 'success');
          }
          store.set('practiced_questions', [...practicedSet]);
          updateProgress();
        });

        questionsContainer.appendChild(card);
      });
    }

    // Tabs
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.setAttribute('aria-selected', 'false'));
        tab.setAttribute('aria-selected', 'true');
        currentCategory = tab.dataset.cat;
        renderQuestions();
      });
    });

    if (diffSelect) diffSelect.addEventListener('change', renderQuestions);
    if (searchInput) searchInput.addEventListener('input', renderQuestions);

    if (generateBtn) {
      const GROUP_TITLES = { technical: 'Technical', gap_based: 'Skill-gap', behavioral: 'Behavioral' };
      function showPersonalizedQuestions(res) {
        const questions = (res && res.questions) || {};
        const sections = Object.keys(GROUP_TITLES).filter(k => Array.isArray(questions[k]) && questions[k].length).map(k =>
          h('div', {},
            h('h4', { style: 'margin: 12px 0 6px;' }, GROUP_TITLES[k]),
            h('ol', { style: 'padding-left: 20px; line-height: 1.7;' }, questions[k].map(q => h('li', {}, q)))
          )
        );
        showModal({
          title: 'Questions for your latest analysis',
          content: h('div', {},
            h('p', { class: 'text-sm text-muted' }, res.source === 'anthropic' ? 'Generated by AI from your matched and missing skills.' : 'Built from your matched and missing skills (template mode).'),
            sections.length ? sections : h('p', {}, 'No questions were returned.')
          ),
          confirmText: 'Done Practicing',
          cancelText: 'Close'
        });
      }

      generateBtn.addEventListener('click', async () => {
        const matched = store.get('matched', []);
        const missing = store.get('missing', []);
        if (API().generateInterviewQuestions && (matched.length || missing.length)) {
          generateBtn.disabled = true;
          try {
            const res = await API().generateInterviewQuestions({ matchedSkills: matched, missingSkills: missing, count: 10 });
            showPersonalizedQuestions(res);
            return;
          } catch (err) {
            if (err && err.status === 401) return;
            showToast('Question generator unavailable: showing a sample drill.', 'error');
          } finally {
            generateBtn.disabled = false;
          }
        }
        const list = INTERVIEW_QUESTIONS[currentCategory] || [];
        const randomSet = [...list].sort(() => 0.5 - Math.random()).slice(0, 3);
        showModal({
          title: `Rapid Practice: ${currentCategory.toUpperCase()}`,
          content: h('div', {},
            h('p', { class: 'text-sm text-muted' }, 'Here is a randomized 3-question drill set:'),
            h('ol', { style: 'padding-left: 20px; line-height: 1.8;' },
              randomSet.map(q => h('li', { style: 'margin-bottom: 8px;' }, h('strong', {}, q.q)))
            )
          ),
          confirmText: 'Done Practicing',
          cancelText: 'Close'
        });
      });
    }

    updateProgress();
    renderQuestions();
  };

  /* ==========================================================================
     PAGE 7: COURSES
     ========================================================================== */
  const COURSE_CATALOG = [
    { id: 'c1', title: 'Python for Production Backend', provider: 'SaaS Academy', level: 'Beginner', rating: 4.8, hours: '12 hours', category: 'backend', icon: '🐍', skills: ['Python', 'FastAPI', 'OOP'] },
    { id: 'c2', title: 'Modern REST & GraphQL API Design', provider: 'API Guild', level: 'Intermediate', rating: 4.7, hours: '8 hours', category: 'backend', icon: '🔌', skills: ['REST', 'HTTP', 'JSON Schema'] },
    { id: 'c3', title: 'SQL & Relational Data Mastery', provider: 'Database Insights', level: 'Beginner', rating: 4.9, hours: '10 hours', category: 'database', icon: '🗄️', skills: ['SQL', 'PostgreSQL', 'Indexing'] },
    { id: 'c4', title: 'Docker & Containerization in Practice', provider: 'DevOps Campus', level: 'Intermediate', rating: 4.6, hours: '6 hours', category: 'devops', icon: '🐳', skills: ['Docker', 'Compose', 'CI/CD'] },
    { id: 'c5', title: 'Cloud Architecture Essentials (AWS & Azure)', provider: 'CloudPro Institute', level: 'Beginner', rating: 4.7, hours: '14 hours', category: 'devops', icon: '☁️', skills: ['AWS', 'S3', 'IAM', 'EC2'] },
    { id: 'c6', title: 'Modern Frontend with React & TypeScript', provider: 'WebCraft Studio', level: 'Intermediate', rating: 4.8, hours: '16 hours', category: 'frontend', icon: '⚛️', skills: ['React', 'TypeScript', 'State'] },
    { id: 'c7', title: 'Distributed Systems & Microservices', provider: 'Enterprise Systems', level: 'Advanced', rating: 4.9, hours: '18 hours', category: 'architecture', icon: '🧩', skills: ['System Design', 'Kafka', 'Caching'] },
    { id: 'c8', title: 'Automated Testing with Jest & PyTest', provider: 'Quality Engineering', level: 'Intermediate', rating: 4.5, hours: '7 hours', category: 'backend', icon: '🧪', skills: ['PyTest', 'TDD', 'Unit Tests'] }
  ];

  pages.courses = () => {
    const container = $('#course-cards');
    const searchInput = $('#search-courses');
    const categoryTabs = $$('.tab-btn[data-course-cat]');
    const missingSkillsContainer = $('#missing-skills-list');
    const skillsSourceText = $('#skills-source');

    let activeCategory = 'all';

    // Populate missing skills from previous analysis
    const missing = store.get('missing', ['Docker', 'REST APIs', 'SQL']);
    if (skillsSourceText) {
      skillsSourceText.textContent = store.get('missing', null)
        ? 'Identified from your most recent Resume Analyzer report.'
        : 'Sample recommended skills. Analyze your resume against a job description to personalize.';
    }

    if (missingSkillsContainer) {
      missingSkillsContainer.innerHTML = '';
      missing.forEach(skill => {
        const li = h('li', { class: 'chip active' }, skill);
        li.addEventListener('click', () => {
          if (searchInput) {
            searchInput.value = skill;
            renderCourses();
          }
        });
        missingSkillsContainer.appendChild(li);
      });
    }

    // Learning resources for the skills found missing in the latest analysis (from the backend)
    const gapCard = $('#gap-resources-card');
    const gapBox = $('#gap-resources');
    const storedMissing = store.get('missing', null);
    if (gapCard && gapBox && API().suggestCourses && Array.isArray(storedMissing) && storedMissing.length) {
      API().suggestCourses(storedMissing).then(res => {
        const bySkill = (res && res.resources_by_skill) || {};
        const skills = Object.keys(bySkill);
        if (!skills.length) return;
        gapBox.innerHTML = '';
        skills.forEach(skill => {
          gapBox.appendChild(h('div', { style: 'margin-bottom: 14px;' },
            h('h4', { style: 'margin: 0 0 6px; text-transform: capitalize;' }, skill),
            h('ul', { style: 'margin: 0; padding-left: 18px; line-height: 1.7;' },
              bySkill[skill].filter(r => /^https?:\/\//.test(r.url)).map(r =>
                h('li', {}, h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.title),
                  h('span', { class: 'text-muted text-sm' }, ` · ${r.provider} · ${r.level}`))
              )
            )
          ));
        });
        gapCard.hidden = false;
      }).catch(() => { /* optional section: ignore failures */ });
    }

    function renderCourses() {
      const search = (searchInput ? searchInput.value : '').toLowerCase().trim();

      const filtered = COURSE_CATALOG.filter(c => {
        const matchCat = activeCategory === 'all' || c.category === activeCategory;
        const matchSearch = !search ||
          c.title.toLowerCase().includes(search) ||
          c.provider.toLowerCase().includes(search) ||
          c.skills.some(s => s.toLowerCase().includes(search));
        return matchCat && matchSearch;
      });

      container.innerHTML = '';
      if (filtered.length === 0) {
        container.innerHTML = `
          <div class="empty-state card" style="grid-column: 1 / -1;">
            <h3>No courses match your query</h3>
            <p>Try searching for a different skill or reset the category filter.</p>
          </div>
        `;
        return;
      }

      filtered.forEach(course => {
        const card = h('article', { class: 'course-card' });
        card.innerHTML = `
          <div class="course-header">
            <div class="course-icon-badge">${course.icon}</div>
            <span class="badge ${course.level === 'Advanced' ? 's-rejected' : course.level === 'Intermediate' ? 's-interview' : 's-offer'}">${course.level}</span>
          </div>
          <div class="course-body">
            <div>
              <h3>${course.title}</h3>
              <div class="course-provider">${course.provider}</div>
              <div class="course-meta">
                <span>⏱️ ${course.hours}</span>
                <span>★ ${course.rating} / 5.0</span>
              </div>
              <div class="job-tags">
                ${course.skills.map(s => `<span class="chip">${s}</span>`).join('')}
              </div>
            </div>
            <button type="button" class="btn btn-secondary" style="width: 100%; margin-top: 16px;" id="enroll-${course.id}">
              Enroll Course
            </button>
          </div>
        `;

        card.querySelector(`#enroll-${course.id}`).addEventListener('click', () => {
          showModal({
            title: `Enrollment: ${course.title}`,
            content: h('div', {},
              h('p', {}, `You are enrolling in <strong>${course.title}</strong> by ${course.provider}.`),
              h('div', { class: 'callout callout-info' },
                h('div', {}, 'This is a sample catalog curriculum entry. In production, this links to your enterprise LMS, Coursera, or Udemy enterprise workspace.')
              )
            ),
            confirmText: 'Confirm Enrollment',
            cancelText: 'Cancel',
            onConfirm: () => showToast(`Enrolled in ${course.title}!`, 'success')
          });
        });

        container.appendChild(card);
      });
    }

    categoryTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        categoryTabs.forEach(t => t.setAttribute('aria-selected', 'false'));
        tab.setAttribute('aria-selected', 'true');
        activeCategory = tab.dataset.courseCat;
        renderCourses();
      });
    });

    if (searchInput) searchInput.addEventListener('input', renderCourses);

    renderCourses();
  };

  /* ==========================================================================
     PAGE 8: APPLICATIONS TRACKER & REFERRAL GENERATOR
     ========================================================================== */
  pages.applications = async () => {
    // Server data when reachable; local demo data only if the server is down.
    const loaded = await loadApplications();
    let apps = loaded.apps;
    const isServerBacked = loaded.serverBacked;

    const tableBody = $('#apps-body');
    const kanbanBoard = $('#apps-kanban');
    const tableWrap = $('#table-view-wrap');
    const kanbanWrap = $('#kanban-view-wrap');
    const viewTableBtn = $('#view-table-btn');
    const viewKanbanBtn = $('#view-kanban-btn');
    const searchInput = $('#search-applications');
    const statusFilter = $('#filter-app-status');
    const referralAppSelect = $('#ref-app');

    // Mini KPI elements
    const kpiTotal = $('#app-kpi-total');
    const kpiApplied = $('#app-kpi-applied');
    const kpiInterview = $('#app-kpi-interview');
    const kpiOffer = $('#app-kpi-offer');

    // Persist a change: to the server when it is the source of truth, otherwise to localStorage.
    async function changeStatus(app, nextStatus) {
      if (isServerBacked && API().updateApplicationStatus) {
        await API().updateApplicationStatus(app.id, nextStatus);
      }
      app.status = nextStatus;
      if (!isServerBacked) saveApps(apps);
    }
    async function removeApplication(app) {
      if (isServerBacked && API().deleteApplication) {
        await API().deleteApplication(app.id);
      }
      apps = apps.filter(x => x !== app);
      if (!isServerBacked) saveApps(apps);
    }

    function updateKPIs() {
      if (kpiTotal) kpiTotal.textContent = apps.length;
      if (kpiApplied) kpiApplied.textContent = apps.filter(x => (x.status || 'Applied').toLowerCase() === 'applied').length;
      if (kpiInterview) kpiInterview.textContent = apps.filter(x => (x.status || '').toLowerCase() === 'interview').length;
      if (kpiOffer) kpiOffer.textContent = apps.filter(x => (x.status || '').toLowerCase() === 'offer').length;
    }

    function renderTable() {
      if (!tableBody) return;
      const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
      const statusF = statusFilter ? statusFilter.value : 'all';

      const filtered = apps.filter(app => {
        const matchStatus = statusF === 'all' || (app.status || 'Applied').toLowerCase() === statusF.toLowerCase();
        const matchQuery = !query || app.company.toLowerCase().includes(query) || (app.title || '').toLowerCase().includes(query);
        return matchStatus && matchQuery;
      });

      tableBody.innerHTML = '';
      if (filtered.length === 0) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="6" class="text-center text-muted" style="padding: 36px;">
              No applications match your filter.
            </td>
          </tr>
        `;
        return;
      }

      filtered.forEach((app, idx) => {
        const tr = h('tr', {});
        tr.innerHTML = `
          <td style="font-weight: 600;">${escapeHtml(app.company)}</td>
          <td>${escapeHtml(app.title)}</td>
          <td class="text-muted">${escapeHtml(app.date || daysAgo(0))}</td>
          <td></td>
          <td></td>
          <td style="text-align: right;"></td>
        `;

        // Status badge
        tr.children[3].appendChild(badgeEl(app.status));

        // Inline status updater
        const select = h('select', {
          'aria-label': `Update status for ${app.company}`,
          style: 'padding: 6px 10px; min-height: 32px; font-size: 0.8125rem;',
          async onchange(e) {
            try {
              await changeStatus(app, e.target.value);
              showToast(`Status updated to ${app.status} for ${app.company}`, 'success');
            } catch (err) {
              showToast(`Could not update status: ${err.message}`, 'error');
            }
            renderTable();
            renderKanban();
            updateKPIs();
          }
        }, STATUSES.map(s => h('option', { value: s, selected: s.toLowerCase() === (app.status || 'Applied').toLowerCase() }, s)));
        tr.children[4].appendChild(select);

        // Delete button
        const deleteBtn = h('button', {
          type: 'button',
          class: 'btn btn-ghost btn-sm',
          style: 'color: var(--color-danger);',
          title: 'Remove application',
          onclick() {
            showModal({
              title: 'Remove Application',
              content: h('p', {}, `Are you sure you want to remove the application record for ${app.company} (${app.title})?`),
              confirmText: 'Remove',
              isDanger: true,
              async onConfirm() {
                try {
                  await removeApplication(app);
                  showToast(`Removed application for ${app.company}`, 'info');
                } catch (err) {
                  showToast(`Could not remove application: ${err.message}`, 'error');
                }
                renderTable();
                renderKanban();
                populateReferralOptions();
                updateKPIs();
              }
            });
          }
        }, '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>');
        tr.children[5].appendChild(deleteBtn);

        tableBody.appendChild(tr);
      });
    }

    function renderKanban() {
      if (!kanbanBoard) return;
      kanbanBoard.innerHTML = '';

      const columns = ['Applied', 'Interview', 'Offer', 'Rejected'];
      columns.forEach(colStatus => {
        const colApps = apps.filter(x => (x.status || 'Applied').toLowerCase() === colStatus.toLowerCase());
        const colDiv = h('div', { class: 'kanban-col' });
        colDiv.innerHTML = `
          <div class="kanban-col-header">
            <span>${colStatus}</span>
            <span class="badge badge-neutral">${colApps.length}</span>
          </div>
          <div class="kanban-cards-wrap" style="display: flex; flex-direction: column; gap: 8px;"></div>
        `;

        const wrap = colDiv.querySelector('.kanban-cards-wrap');
        if (colApps.length === 0) {
          wrap.innerHTML = '<div class="text-xs text-muted text-center" style="padding: 16px;">No records</div>';
        } else {
          colApps.forEach(app => {
            const card = h('div', { class: 'kanban-card' });
            card.innerHTML = `
              <h4>${escapeHtml(app.company)}</h4>
              <p>${escapeHtml(app.title)}</p>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 0.75rem;" class="text-muted">
                <span>${escapeHtml(app.date || daysAgo(0))}</span>
                <button type="button" class="btn btn-ghost btn-sm" id="move-${app.id}" style="padding: 2px 6px; font-size: 0.75rem;">Move ▾</button>
              </div>
            `;
            card.querySelector(`#move-${app.id}`).addEventListener('click', async () => {
              const nextStatus = colStatus === 'Applied' ? 'Interview' : colStatus === 'Interview' ? 'Offer' : 'Applied';
              try {
                await changeStatus(app, nextStatus);
                showToast(`Moved to ${nextStatus}`, 'info');
              } catch (err) {
                showToast(`Could not move application: ${err.message}`, 'error');
              }
              renderTable();
              renderKanban();
              updateKPIs();
            });
            wrap.appendChild(card);
          });
        }
        kanbanBoard.appendChild(colDiv);
      });
    }

    function populateReferralOptions() {
      if (!referralAppSelect) return;
      referralAppSelect.innerHTML = '<option value="">Choose an existing application to auto-fill…</option>';
      apps.forEach((app, i) => {
        referralAppSelect.appendChild(h('option', { value: i }, `${app.company} — ${app.title}`));
      });
    }

    // View toggle handlers
    if (viewTableBtn && viewKanbanBtn) {
      viewTableBtn.addEventListener('click', () => {
        viewTableBtn.className = 'btn btn-secondary btn-sm';
        viewKanbanBtn.className = 'btn btn-outline btn-sm';
        if (tableWrap) tableWrap.hidden = false;
        if (kanbanWrap) kanbanWrap.hidden = true;
      });
      viewKanbanBtn.addEventListener('click', () => {
        viewKanbanBtn.className = 'btn btn-secondary btn-sm';
        viewTableBtn.className = 'btn btn-outline btn-sm';
        if (tableWrap) tableWrap.hidden = true;
        if (kanbanWrap) kanbanWrap.hidden = false;
      });
    }

    if (searchInput) searchInput.addEventListener('input', renderTable);
    if (statusFilter) statusFilter.addEventListener('change', renderTable);

    // Referral Generator logic
    const refForm = $('#referral-form');
    const refOutput = $('#referral-output');
    const copyBtn = $('#copy-referral');

    if (referralAppSelect) {
      referralAppSelect.addEventListener('change', () => {
        const idx = referralAppSelect.value;
        if (idx !== '' && apps[idx]) {
          const app = apps[idx];
          const compField = $('#company-name');
          const roleField = $('#job-role');
          if (compField) compField.value = app.company;
          if (roleField) roleField.value = app.title;
        }
      });
    }

    if (refForm) {
      refForm.addEventListener('submit', e => {
        e.preventDefault();
        const company = ($('#company-name') ? $('#company-name').value : '').trim();
        const role = ($('#job-role') ? $('#job-role').value : '').trim();
        const recruiter = ($('#recruiter-name') ? $('#recruiter-name').value : '').trim();
        const yourName = ($('#your-name') ? $('#your-name').value : '').trim();
        const background = ($('#your-background') ? $('#your-background').value : '').trim();

        let valid = true;
        const cErr = $('#company-name-error');
        const rErr = $('#job-role-error');

        if (!company) {
          if (cErr) cErr.textContent = 'Please enter the company name.';
          valid = false;
        } else {
          if (cErr) cErr.textContent = '';
        }

        if (!role) {
          if (rErr) rErr.textContent = 'Please enter the target role.';
          valid = false;
        } else {
          if (rErr) rErr.textContent = '';
        }

        if (!valid) return;

        const subjectField = $('#ref-subject');
        const bodyField = $('#ref-body');

        if (subjectField) subjectField.value = `Referral Request: ${role} position at ${company}`;
        if (bodyField) {
          bodyField.value = `Hello ${recruiter || '[Recruiter/Referrer Name]'},\n\nI hope you are doing well.\n\nI noticed an opening for the ${role} position at ${company} and wanted to reach out. ${background || 'My background includes hands-on experience in full-stack engineering, microservices, and modern API architectures.'}\n\nGiven the strong alignment between my experience and the role requirements, would you be open to referring my profile or pointing me toward the appropriate hiring manager? I would be delighted to share my resume and portfolio.\n\nThank you for your time and consideration.\n\nBest regards,\n${yourName || (session && session.email ? session.email.split('@')[0] : '[Your Name]')}`;
        }

        if (refOutput) refOutput.hidden = false;
        showToast('Referral draft generated! You can edit before copying.', 'success');
        if (refOutput) refOutput.scrollIntoView({ behavior: 'smooth' });
      });
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const subject = ($('#ref-subject') ? $('#ref-subject').value : '');
        const body = ($('#ref-body') ? $('#ref-body').value : '');
        const fullEmail = `Subject: ${subject}\n\n${body}`;

        try {
          await navigator.clipboard.writeText(fullEmail);
          showToast('Draft copied to clipboard!', 'success');
        } catch (err) {
          showToast('Copy blocked by browser permissions. Select and press Ctrl+C.', 'error');
        }
      });
    }

    updateKPIs();
    renderTable();
    renderKanban();
    populateReferralOptions();
  };

  /* ==========================================================================
     PAGE 9: PRIVACY & SETTINGS
     ========================================================================== */
  pages.privacy = () => {
    const form = $('#privacy-form');
    const saveBtn = $('#save-privacy');
    const resetBtn = $('#reset-demo-data');
    const exportBtn = $('#export-data');

    // Load saved settings
    const saved = store.get('privacy_settings', {
      vis: 'private',
      hideEmail: false,
      hidePhone: true,
      allowDownload: true
    });

    const radio = $(`input[name="resume-visibility"][value="${saved.vis}"]`);
    if (radio) radio.checked = true;

    const emailSwitch = $('#hide-email');
    const phoneSwitch = $('#hide-phone');
    const dlSwitch = $('#allow-download');

    if (emailSwitch) emailSwitch.checked = !!saved.hideEmail;
    if (phoneSwitch) phoneSwitch.checked = !!saved.hidePhone;
    if (dlSwitch) dlSwitch.checked = !!saved.allowDownload;

    async function saveSettings() {
      const selectedVis = ($('input[name="resume-visibility"]:checked') || {}).value || 'private';
      const settings = {
        vis: selectedVis,
        hideEmail: emailSwitch ? emailSwitch.checked : false,
        hidePhone: phoneSwitch ? phoneSwitch.checked : true,
        allowDownload: dlSwitch ? dlSwitch.checked : true,
        updatedAt: new Date().toISOString()
      };
      store.set('privacy_settings', settings);
      const analysisId = store.get('lastAnalysisId', null);
      if (analysisId && API().setPrivacy) {
        try {
          await API().setPrivacy(analysisId, selectedVis);
          showToast('Privacy preferences saved to your account.', 'success');
          return;
        } catch (err) {
          showToast(`Saved on this device only: ${err.message}`, 'error');
          return;
        }
      }
      showToast('Privacy preferences saved. They apply to analyses you run next.', 'success');
    }

    if (saveBtn) saveBtn.addEventListener('click', saveSettings);
    if (form) form.addEventListener('submit', e => { e.preventDefault(); saveSettings(); });

    // Reset data
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        showModal({
          title: 'Reset Local Data',
          content: h('p', {}, 'This clears cached preferences, chat history and practice progress on this device and signs you out here. Applications saved on the server are not deleted.'),
          confirmText: 'Reset Data',
          isDanger: true,
          onConfirm() {
            localStorage.clear();
            sessionStorage.clear();
            showToast('Local data cleared.', 'info');
            setTimeout(() => location.reload(), 600);
          }
        });
      });
    }

    // Export data
    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        const { apps: exportApps } = await loadApplications();
        const payload = {
          apps: exportApps,
          savedJobs: store.get('savedJobs', []),
          privacy: store.get('privacy_settings', {}),
          exportedAt: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `jobnex_candidate_backup_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Profile data exported as JSON.', 'success');
      });
    }
  };

  /* ==========================================================================
     GLOBAL FLOATING JOBNEX COPILOT
     Polished, production-quality career assistant component mounted on all
     authenticated candidate pages.
     ========================================================================== */
  function initJobNexCopilot() {
    // Mount exclusively on authenticated feature pages — NEVER on login or public auth pages
    if (page === 'login' || (document.body && (document.body.dataset.page === 'login' || document.body.classList.contains('auth-page'))) || location.pathname.endsWith('login.html')) {
      return;
    }

    // Prevent duplicate widgets
    if ($('#jobnex-copilot-pill') || $('#jobnex-copilot-panel')) return;

    // Detect active page name for contextual greeting and intelligence
    const rawPath = location.pathname.split('/').pop().replace('.html', '') || 'dashboard';
    const pageKey = (rawPath === 'interveiw') ? 'interview' : rawPath;

    const PAGE_NAMES = {
      dashboard: 'Career Dashboard',
      analyzer: 'Resume Analyzer',
      jobs: 'Job Search',
      interview: 'Interview Prep',
      courses: 'Upskilling Courses',
      applications: 'Application Pipeline',
      privacy: 'Privacy Settings'
    };
    const curPageName = PAGE_NAMES[pageKey] || 'JOBNEX';

    // Conversation state with local persistence across route changes
    const WELCOME_MSG = {
      role: 'copilot',
      text: `Hello! I am your JobNex Copilot ✨. You are currently on ${curPageName}. I can help you evaluate and improve your resume, locate matching positions, coach for behavioral and technical interviews, or recommend skills to acquire. What would you like assistance with?`,
      time: 'Just now'
    };

    let copilotMessages = store.get('jobnex_copilot_chat', [WELCOME_MSG]);

    // 1. Build Floating Pill Button
    const pill = h('button', {
      id: 'jobnex-copilot-pill',
      class: 'jobnex-copilot-pill',
      type: 'button',
      'aria-label': 'Open JobNex Copilot Career Assistant',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      title: 'Open JobNex Copilot'
    },
      h('span', { class: 'copilot-pill-icon', 'aria-hidden': 'true' },
        h('span', { html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><rect x="4" y="8" width="16" height="12" rx="3"/><line x1="9" y1="13" x2="9.01" y2="13"/><line x1="15" y1="13" x2="15.01" y2="13"/><path d="M9 17h6"/></svg>' })
      ),
      h('span', { class: 'copilot-pill-text' }, 'JobNex Copilot'),
      h('span', { class: 'copilot-status-indicator', title: 'Online & Ready', 'aria-hidden': 'true' })
    );

    // 2. Build Anchored Assistant Panel
    const panel = h('div', {
      id: 'jobnex-copilot-panel',
      class: 'jobnex-copilot-panel hidden',
      role: 'dialog',
      'aria-modal': 'false',
      'aria-label': 'JobNex Copilot Assistant'
    });

    // Panel Header
    const panelHeader = h('div', { class: 'copilot-panel-header' },
      h('div', { class: 'copilot-header-brand' },
        h('div', { class: 'copilot-avatar-badge', 'aria-hidden': 'true' },
          h('span', { html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><rect x="4" y="8" width="16" height="12" rx="3"/><line x1="9" y1="13" x2="9.01" y2="13"/><line x1="15" y1="13" x2="15.01" y2="13"/><path d="M9 17h6"/></svg>' })
        ),
        h('div', { class: 'copilot-header-info' },
          h('h3', { class: 'copilot-header-title' }, 'JobNex Copilot'),
          h('div', { class: 'copilot-header-subtitle' },
            h('span', { class: 'copilot-status-badge' }, 'Guidance Mode'),
            h('span', {}, `• ${curPageName}`)
          )
        )
      ),
      h('div', { class: 'copilot-header-controls' },
        h('button', {
          type: 'button',
          class: 'copilot-ctrl-btn',
          title: 'Reset conversation',
          'aria-label': 'Reset conversation',
          onclick() {
            copilotMessages = [WELCOME_MSG];
            store.set('jobnex_copilot_chat', copilotMessages);
            renderAllMessages();
            showToast('Copilot conversation reset.', 'info');
          }
        }, h('span', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>' })),
        h('button', {
          type: 'button',
          class: 'copilot-ctrl-btn',
          title: 'Minimize Copilot',
          'aria-label': 'Minimize Copilot',
          onclick() {
            panel.classList.toggle('minimized');
          }
        }, h('span', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>' })),
        h('button', {
          type: 'button',
          class: 'copilot-ctrl-btn',
          title: 'Close Copilot',
          'aria-label': 'Close Copilot',
          onclick() {
            closePanel();
          }
        }, h('span', { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' }))
      )
    );

    // Suggested Actions Chips Bar
    const SUGGESTED_ACTIONS = [
      { label: '📄 Improve Resume', prompt: 'How can I optimize and format my resume for maximum ATS scoring?' },
      { label: '💼 Find Matching Jobs', prompt: 'What strategies and keywords will help me find matching remote software roles?' },
      { label: '🎤 Prepare for Interviews', prompt: 'Give me a mock behavioral interview question with STAR guidance.' },
      { label: '🎯 Recommend Skills', prompt: 'What key technical skills should I bridge based on current market demand?' },
      { label: '🧭 Career Guidance', prompt: 'How do I structure a strategic roadmap to advance into senior engineering?' }
    ];

    const actionsBar = h('div', { class: 'copilot-actions-bar', 'aria-label': 'Suggested Actions' },
      SUGGESTED_ACTIONS.map(action => {
        return h('button', {
          type: 'button',
          class: 'copilot-action-chip',
          onclick: () => sendCopilotQuery(action.prompt)
        }, action.label);
      })
    );

    // Scrollable Conversation Area
    const messagesBody = h('div', { class: 'copilot-panel-body', id: 'copilot-messages-body', 'aria-live': 'polite' });

    // Thinking Indicator
    const thinkingIndicator = h('div', { class: 'copilot-thinking-indicator', style: 'display: none;' },
      h('span', {}, 'Formulating advice'),
      h('div', { class: 'copilot-thinking-dots' },
        h('span', { class: 'copilot-thinking-dot' }),
        h('span', { class: 'copilot-thinking-dot' }),
        h('span', { class: 'copilot-thinking-dot' })
      )
    );

    // Footer Form
    const inputField = h('input', {
      type: 'text',
      class: 'copilot-text-input',
      placeholder: `Ask JobNex Copilot about ${curPageName}…`,
      autocomplete: 'off',
      'aria-label': 'Message to JobNex Copilot'
    });

    const sendBtn = h('button', {
      type: 'submit',
      class: 'copilot-send-btn',
      title: 'Send message',
      'aria-label': 'Send message'
    }, h('span', { html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' }));

    const footerForm = h('form', {
      class: 'copilot-input-form',
      onsubmit(e) {
        e.preventDefault();
        sendCopilotQuery(inputField.value);
      }
    }, inputField, sendBtn);

    const panelFooter = h('div', { class: 'copilot-panel-footer' }, footerForm);

    // Assemble Panel
    panel.appendChild(panelHeader);
    panel.appendChild(actionsBar);
    panel.appendChild(messagesBody);
    messagesBody.appendChild(thinkingIndicator);
    panel.appendChild(panelFooter);

    // Mount to Document Body
    document.body.appendChild(pill);
    document.body.appendChild(panel);

    // Toggle Panel Functionality
    function openPanel() {
      panel.classList.remove('hidden');
      panel.classList.remove('minimized');
      pill.setAttribute('aria-expanded', 'true');
      setTimeout(() => inputField.focus(), 150);
    }

    function closePanel() {
      panel.classList.add('hidden');
      pill.setAttribute('aria-expanded', 'false');
      pill.focus();
    }

    pill.addEventListener('click', () => {
      if (panel.classList.contains('hidden')) {
        openPanel();
      } else {
        closePanel();
      }
    });

    // Message Renderer
    function renderMessage(msg) {
      const isCopilot = msg.role === 'copilot';
      const msgWrap = h('div', { class: `copilot-message ${isCopilot ? 'copilot' : 'user'}` },
        h('div', { class: 'copilot-message-bubble' }, msg.text),
        h('div', { class: 'copilot-message-meta' },
          h('span', {}, isCopilot ? 'JobNex Copilot' : 'You'),
          h('span', {}, '•'),
          h('span', {}, msg.time || 'Just now')
        )
      );
      messagesBody.insertBefore(msgWrap, thinkingIndicator);
      messagesBody.scrollTop = messagesBody.scrollHeight;
    }

    function renderAllMessages() {
      const existing = messagesBody.querySelectorAll('.copilot-message');
      existing.forEach(el => el.remove());
      copilotMessages.forEach(renderMessage);
    }

    renderAllMessages();

    // Career Guidance Response Generator
    async function getCopilotResponse(query) {
      const q = query.toLowerCase();

      // 1. If backend API chat is available, query real backend
      if (API().chat) {
        try {
          const res = await API().chat({ message: query });
          if (res && (res.text || res.reply || res.message)) {
            return res.text || res.reply || res.message;
          }
        } catch (e) {
          // Graceful fallback to rich guidance engine
        }
      }

      // Realistic response pause
      await new Promise(r => setTimeout(r, 450));

      // 2. Structured career intelligence responses
      if (/resume|ats|score|format|bullet/.test(q)) {
        return `📄 Resume Optimization Blueprint:\n\n1. Target Keyword Alignment: Mirror exact skills (e.g. Python, Docker, PostgreSQL, REST APIs) from job postings in your experience section.\n2. Impact-Driven Bullets: Structure achievements using: Action Verb + Context + Measurable Result (e.g., "Engineered FastAPI microservices handling 15k req/min, decreasing p99 latency by 28%").\n3. ATS Formatting: Use clean single-column layouts with standard headings.\n\nTip: Navigate to Resume Analyzer to upload your resume against any target job description!`;
      }

      if (/job|remote|match|apply|search|position/.test(q)) {
        return `💼 Job Search & Application Strategy:\n\n• Target Role Alignment: Focus on positions where your profile matches 70%+ of requirements.\n• Referral Boost: Applications submitted with internal referrals have a 4x higher interview invitation rate.\n• Tracking Pipeline: Use the Applications pipeline tab to log application stages and follow-up milestones.\n\nTip: Explore the Find Jobs tab to browse curated software roles tailored to your stack.`;
      }

      if (/interview|star|question|behavioral|technical|prep/.test(q)) {
        return `🎤 STAR Interview Coaching:\n\n• S (Situation): Briefly establish the business context and problem.\n• T (Task): Specify your exact goal and ownership responsibility.\n• A (Action): Detail technical decisions, architectural trade-offs, and actions you personally led.\n• R (Result): Quantify outcomes (uptime, cost reduction, efficiency).\n\nPractice Behavioral Prompt:\n"Describe a high-stakes production incident or outage you encountered. How did you diagnose, resolve, and prevent recurrence?"\n\nTip: Check out Interview Prep for interactive drills!`;
      }

      if (/skill|upskill|gap|course|learn|docker|python|cloud/.test(q)) {
        const storedMissing = store.get('missing', []);
        const missingText = storedMissing.length
          ? `\n\nIdentified competencies from your latest analysis:\n• ${storedMissing.slice(0, 5).join('\n• ')}`
          : '';
        return `🎯 High-Demand Skill Recommendations:${missingText}\n\n1. Cloud Native: Docker multi-stage builds, Kubernetes fundamentals, CI/CD pipelines.\n2. Backend Architecture: Async Python (FastAPI/Pydantic), Redis caching, database indexing.\n3. System Design: Event-driven patterns, microservice resiliency, and idempotent APIs.\n\nTip: Browse Courses to access practical modules.`;
      }

      if (/career|guidance|roadmap|salary|promotion|senior/.test(q)) {
        return `🧭 Strategic Career Roadmap:\n\n1. Proof of Impact: Maintain an engineering brag sheet documenting architecture decisions and business metric improvements.\n2. Continuous Upskilling: Dedicate 3-5 hours weekly to next-tier skills (system design, cloud certification).\n3. Proactive Outreach: Connect with tech leads and hiring managers using tailored referral messages.`;
      }

      return `Thank you for reaching out! In JobNex, your candidate profile is geared to help you stand out. Based on your current session on ${curPageName}, I recommend checking your resume ATS score or practicing top interview drills. How else can I assist your career progression?`;
    }

    async function sendCopilotQuery(text) {
      text = (text || '').trim();
      if (!text) return;

      const userMsg = {
        role: 'user',
        text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      copilotMessages.push(userMsg);
      renderMessage(userMsg);
      inputField.value = '';
      sendBtn.disabled = true;
      thinkingIndicator.style.display = 'inline-flex';
      messagesBody.scrollTop = messagesBody.scrollHeight;

      try {
        const reply = await getCopilotResponse(text);
        const botMsg = {
          role: 'copilot',
          text: reply,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        copilotMessages.push(botMsg);
        store.set('jobnex_copilot_chat', copilotMessages);
        renderMessage(botMsg);
      } catch (err) {
        const errMsg = {
          role: 'copilot',
          text: 'Unable to process request right now. Please try asking again!',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        copilotMessages.push(errMsg);
        renderMessage(errMsg);
      } finally {
        thinkingIndicator.style.display = 'none';
        sendBtn.disabled = false;
        messagesBody.scrollTop = messagesBody.scrollHeight;
      }
    }
  }

  /* ---------- Bootstrap on DOM Ready ---------- */
  renderChrome();
  initJobNexCopilot();
  if (pages[page]) {
    pages[page]();
  }

})();