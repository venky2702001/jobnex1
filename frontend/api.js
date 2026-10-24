/* ==========================================================================
   JOBNEX - API client (frontend <-> FastAPI backend)

   * Every function here calls a REAL backend route (see backend/main.py, analyzer.py).
   * Backend JSON is translated ("adapted") into the shapes common.js already renders,
     so the page code did not need to change.
   * Auth is a signed session cookie (jobnex_session) set by the backend, so every request
     is sent with credentials. Best setup: let FastAPI serve this folder and open
     http://127.0.0.1:8000/  -> same origin, no CORS, cookie "just works".
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- 1. Where is the backend? ---------- */
  function resolveBase() {
    // Explicit override (set before api.js loads):  <script>window.JOBNEX_API_BASE='https://api.example.com'</script>
    if (typeof window.JOBNEX_API_BASE === 'string') return window.JOBNEX_API_BASE.replace(/\/$/, '');
    try {
      const saved = localStorage.getItem('jobnex.apiBase');           // dev override from the console
      if (saved) return saved.replace(/\/$/, '');
    } catch (e) { /* storage blocked */ }
    const { protocol, hostname, port } = location;
    if (protocol === 'file:') return 'http://127.0.0.1:8000';          // works only for public calls (CORS blocks cookies)
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
    if (isLocal && port && port !== '8000') return `${protocol}//${hostname}:8000`; // Live Server / Vite -> API on :8000
    return '';                                                         // served by FastAPI itself: same origin
  }
  const BASE = resolveBase();

  const SESSION_KEY = 'jobnex.session';
  const AUTH_PATHS = ['/api/auth/login', '/api/auth/register', '/api/auth/me', '/api/auth/providers'];

  function clearLocalSession() {
    try { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  /* ---------- 2. One fetch wrapper for everything ---------- */
  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || 15000);
    const { timeout, noAuthRedirect, ...fetchOptions } = options;
    let response;
    try {
      response = await fetch(BASE + path, {
        credentials: 'include',                       // send/receive the session cookie
        ...fetchOptions,
        signal: controller.signal,
        headers: { 'Accept': 'application/json', ...(fetchOptions.body ? { 'Content-Type': 'application/json' } : {}), ...(fetchOptions.headers || {}) }
      });
    } catch (err) {
      clearTimeout(timer);
      const e = new Error(err.name === 'AbortError'
        ? 'The server took too long to respond. Please try again.'
        : 'Cannot reach the JOBNEX server. Start the backend (uvicorn main:app --reload in /backend) and open http://127.0.0.1:8000');
      e.status = err.name === 'AbortError' ? 408 : 0;
      throw e;
    }
    clearTimeout(timer);

    const isJson = (response.headers.get('content-type') || '').includes('application/json');
    const payload = isJson ? await response.json() : { error: await response.text() };

    if (!response.ok) {
      // Session expired / not signed in -> back to the login page (but not while logging in).
      if (response.status === 401 && !noAuthRedirect && !AUTH_PATHS.includes(path)) {
        clearLocalSession();
        if (!location.pathname.endsWith('login.html')) location.replace('login.html');
      }
      const err = new Error(errorMessage(payload, response.status));
      err.status = response.status;
      err.code = payload && payload.code;
      err.payload = payload;
      throw err;
    }
    return payload;
  }

  // Backend errors look like {"error": "...", "code": "..."} (+ "details" for validation errors).
  function errorMessage(payload, status) {
    if (payload && Array.isArray(payload.details) && payload.details.length) {
      return payload.details
        .map(d => `${d.field ? d.field + ': ' : ''}${String(d.message || '').replace(/^Value error, /, '')}`)
        .join('; ');
    }
    if (payload && typeof payload.error === 'string' && payload.error) return payload.error;
    if (payload && typeof payload.detail === 'string') return payload.detail;
    return `Request failed with status ${status}`;
  }

  /* ---------- 3. Adapters: backend JSON -> shapes common.js renders ---------- */
  const REGION_TO_UI = { BANGALORE: 'bengaluru', INDIA: 'india', US: 'usa', GLOBAL: 'global' };
  const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  function adaptAnalysis(data) {
    return {
      ...data,
      matched_score: Number(data.match_score) || 0,                       // UI reads matched_score
      suggestions: (data.sugesstions || []).map(s => (typeof s === 'string' ? s : s.text)).filter(Boolean) // backend key keeps its spelling
    };
  }

  function adaptJob(job) {
    return {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location || 'Remote',
      region: REGION_TO_UI[job.region] || 'global',
      exp: job.experience_level || '',
      certs: (job.certifications || '').split(',').map(c => c.trim()).filter(Boolean),
      job_type: job.job_type || 'Full-time',
      skills: job.skills || '',
      description: job.description,
      match: null,                                                         // unknown until a resume is matched; UI hides the pill
      url: null
    };
  }

  function adaptApplication(a) {
    return {
      application_id: a.id,
      job_id: a.job_id,
      company: a.company,
      job_title: a.job_title,
      created_at: a.created_at,
      status: cap(a.status)                                               // 'applied' -> 'Applied'
    };
  }

  /* ---------- 4. Public API ---------- */
  const api = window.JOBNEX_API || {};
  api.baseUrl = BASE;

  // --- health & auth ---
  api.checkHealth = async () => {
    try { return await request('/api/health', { timeout: 4000 }); }
    catch (e) { return { status: 'offline' }; }
  };
  api.getAuthProviders = async () => {
    try { return await request('/api/auth/providers', { timeout: 4000 }); }
    catch (e) { return { password: true, google: false }; }
  };
  api.register = ({ email, password, name }) =>
    request('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name: name || null }) });
  api.signInWithEmail = ({ email, password }) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  api.me = () => request('/api/auth/me', { noAuthRedirect: true });
  api.logout = async () => {
    try { await request('/api/auth/logout', { method: 'POST', noAuthRedirect: true }); } catch (e) { /* already signed out */ }
    sessionStorage.removeItem('jobnex.chatHistory');
  };
  api.googleLoginUrl = () => `${BASE}/api/auth/google/login`;

  // --- resume analyzer ---
  api.analyzeResume = async ({ resumeText, jdText, region }) => {
    const body = { resume_text: resumeText, jd_text: jdText };
    if (region) body.region_filter = region;
    return adaptAnalysis(await request('/api/analyzer/analyze', { method: 'POST', body: JSON.stringify(body), timeout: 30000 }));
  };
  api.getAnalyses = () => request('/api/applications');                  // saved analyses (summaries)

  // --- jobs ---
  api.searchJobs = async (keyword = '', limit = 20) => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (keyword && keyword.trim()) query.set('q', keyword.trim());
    const res = await request(`/api/jobs?${query}`);
    return { jobs: (res.items || []).map(adaptJob), total: res.total };
  };

  // --- application tracker ---
  api.queueApplication = async (application) => {
    const created = await request('/api/job-applications', {
      method: 'POST',
      body: JSON.stringify({
        company: application.company,
        job_title: application.job_title || application.jobTitle,
        job_id: typeof application.job_id === 'number' ? application.job_id : null,
        job_url: application.job_url || application.jobUrl || null
      })
    });
    return adaptApplication(created);
  };
  api.getApplications = async () => {
    const res = await request('/api/job-applications');
    return { applications: (res.items || []).map(adaptApplication), total: res.total };
  };
  api.updateApplicationStatus = async (id, status) =>
    adaptApplication(await request(`/api/job-applications/${encodeURIComponent(id)}/status`, {
      method: 'PATCH', body: JSON.stringify({ status: String(status).toLowerCase() })
    }));
  api.deleteApplication = (id) =>
    request(`/api/job-applications/${encodeURIComponent(id)}`, { method: 'DELETE' });

  // --- interview + courses (AI/catalog helpers) ---
  api.generateInterviewQuestions = ({ matchedSkills = [], missingSkills = [], count = 10 }) =>
    request('/api/interview/questions', {
      method: 'POST', timeout: 30000,
      body: JSON.stringify({ matched_skills: matchedSkills, missing_skills: missingSkills, count })
    });
  api.suggestCourses = (missingSkills = []) =>
    request('/api/courses/suggest', { method: 'POST', body: JSON.stringify({ missing_skills: missingSkills }) });

  // --- privacy (per saved analysis) ---
  api.setPrivacy = (analysisId, privacySetting) =>
    request(`/api/privacy/${encodeURIComponent(analysisId)}`, { method: 'PUT', body: JSON.stringify({ privacy_setting: privacySetting }) });

  // --- AI chat copilot ---
  // The backend is stateless: we send the recent turns with every message and keep them
  // in sessionStorage so a page refresh keeps the conversation going.
  const HISTORY_KEY = 'jobnex.chatHistory';
  const loadHistory = () => { try { return JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; } };
  const saveHistory = h => { try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-20))); } catch (e) { /* ignore */ } };

  api.chat = async ({ message }) => {
    const history = loadHistory().slice(-20).map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    const payload = await request('/api/chat', {
      method: 'POST', timeout: 40000,
      body: JSON.stringify({ message: String(message).slice(0, 4000), history })
    });
    saveHistory([...history, { role: 'user', content: message }, { role: 'assistant', content: payload.reply }]);
    return { ...payload, text: payload.reply || '' };
  };
  api.clearChat = async () => { sessionStorage.removeItem(HISTORY_KEY); };

  window.JOBNEX_API = api;
})();
