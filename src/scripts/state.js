// Client state — articles via REST API (SQLite/Turso)
const listeners = new Set();
let state = {
  articles: [],
  loading: true,
  error: null,
};

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
    // cache: 'no-store' force le navigateur à toujours interroger le serveur.
    // Cela évite le problème où la liste d'articles semble vide juste après
    // un ajout parce que le navigateur renvoie une réponse cachée périmée.
    const res = await fetch('/api/articles', {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      cache: 'no-store',
    });
    const ct = res.headers.get('content-type') || '';
    const body = ct.includes('application/json') ? await res.json() : { error: await res.text() };
    if (!res.ok) throw new Error(body.error || `Erreur API (${res.status})`);
    state.articles = body.articles || [];
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

let syncInterval = null;
let lastSyncStatus = null;

export function startAutoSync(intervalMs = 5000) {
  if (syncInterval) return;
  syncInterval = setInterval(async () => {
    try {
      const status = await api('/api/sync-status');
      if (!lastSyncStatus) {
        lastSyncStatus = status;
        return;
      }
      if (status.count !== lastSyncStatus.count || status.last_updated !== lastSyncStatus.last_updated) {
        lastSyncStatus = status;
        await reload();
      }
    } catch (e) {
      // Ignore errors for silent background sync
    }
  }, intervalMs);
}

export function stopAutoSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}
