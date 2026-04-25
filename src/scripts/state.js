// Client state — articles via REST API (SQLite) + settings via localStorage
const SETTINGS_KEY = 'decoshop.settings.v1';
const DEFAULTS = {
  geminiApiKey: '',
  googleVisionApiKey: '',
  model: 'gemini-2.5-flash',
};

const listeners = new Set();
let state = {
  articles: [],
  settings: loadSettings(),
  loading: true,
  error: null,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function persistSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch {}
}

function emit() {
  listeners.forEach((fn) => {
    try { fn(state); } catch (e) { console.error(e); }
  });
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function getState() { return state; }

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json() : { error: await res.text() };
  if (!res.ok) throw new Error(body.error || `Erreur API (${res.status})`);
  return body;
}

export async function reload() {
  state.loading = true;
  state.error = null;
  emit();
  try {
    const { articles } = await api('/api/articles');
    state.articles = articles;
  } catch (e) {
    state.error = e.message;
    console.error('Reload failed:', e);
  } finally {
    state.loading = false;
    emit();
  }
}

export async function getNextNumArticle() {
  try {
    const { num } = await api('/api/next-num');
    return num;
  } catch {
    return '';
  }
}

export async function createArticle(data) {
  const { article } = await api('/api/articles', { method: 'POST', body: JSON.stringify(data) });
  state.articles = [article, ...state.articles.filter((a) => a.id !== article.id)];
  emit();
  return article;
}

export async function updateArticle(id, data) {
  const { article } = await api(`/api/articles/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  const idx = state.articles.findIndex((a) => a.id === id);
  if (idx >= 0) state.articles[idx] = article;
  else state.articles = [article, ...state.articles];
  emit();
  return article;
}

export async function deleteArticle(id) {
  await api(`/api/articles/${encodeURIComponent(id)}`, { method: 'DELETE' });
  state.articles = state.articles.filter((a) => a.id !== id);
  emit();
}

export async function clearAll() {
  await api('/api/articles/clear', { method: 'POST' });
  state.articles = [];
  emit();
}

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  persistSettings();
  emit();
}
