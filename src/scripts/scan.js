// /scan page — looks up an article by code-barres / numero_article in the
// Supabase database and shows a card the user can click to edit.
// The actual edit is delegated to app.js (it owns the EditModal wiring).
import { $, escapeHtml, fmtPrice, renderStatusBadge, toast } from './ui.js';
import { playSuccessBeep, playErrorBeep } from './sound.js';

const STATUS_LABELS = {
  en_stock: 'En stock',
  stock_faible: 'Stock faible',
  rupture: 'Rupture',
};

let lastQuery = '';

function showState(state) {
  // state ∈ 'empty' | 'loading' | 'result'
  $('#scan-empty')?.classList.toggle('hidden', state !== 'empty');
  $('#scan-loading')?.classList.toggle('hidden', state !== 'loading');
  $('#scan-result')?.classList.toggle('hidden', state !== 'result');
}

// EAN/UPC : 8 à 14 chiffres uniquement. Pas de DECO-..., pas de lettres.
function looksLikeBarcode(s) {
  return /^\d{8,14}$/.test(String(s || '').trim().replace(/[\s\-]/g, ''));
}

function renderNotFound(query) {
  const result = $('#scan-result');
  if (!result) return;
  showState('result');

  const isBarcode = looksLikeBarcode(query);
  const ajouterHref = isBarcode
    ? `/ajouter?code_barres=${encodeURIComponent(query)}&from=scan`
    : `/ajouter?from=scan`;

  result.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 overflow-hidden">
      <div class="p-6 md:p-8 text-center border-b border-slate-100">
        <div class="mx-auto h-16 w-16 rounded-2xl bg-amber-50 ring-1 ring-amber-200 flex items-center justify-center text-amber-500 mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <h2 class="text-lg font-semibold text-slate-900">Article inconnu de l'inventaire</h2>
        <p class="text-sm text-slate-500 mt-1">
          Aucun article ne correspond à <span class="font-mono font-semibold text-slate-700">${escapeHtml(query)}</span>.
        </p>
      </div>

      <div class="p-6 md:p-8 bg-gradient-to-br from-indigo-50 to-blue-50">
        <div class="flex flex-col md:flex-row items-start md:items-center gap-4">
          <div class="flex-1">
            <h3 class="text-base font-bold text-slate-900">Voulez-vous l'ajouter à l'inventaire ?</h3>
            <p class="text-sm text-slate-600 mt-1">
              ${isBarcode
                ? `On prérempli le code-barres pour vous. Il ne vous restera qu'à <strong class="font-semibold text-slate-900">filmer le produit</strong> puis <strong class="font-semibold text-slate-900">enregistrer</strong>.`
                : `Le numéro d'article sera généré automatiquement. Il vous restera juste à <strong class="font-semibold text-slate-900">filmer le produit</strong> et <strong class="font-semibold text-slate-900">enregistrer</strong>.`}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2 shrink-0">
            <button id="btn-scan-retry" type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Non, recommencer
            </button>
            <a href="${ajouterHref}"
              class="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
              Oui, ajouter cet article
            </a>
          </div>
        </div>
      </div>
    </div>
  `;
  $('#btn-scan-retry')?.addEventListener('click', () => {
    const input = $('#scan-input');
    if (input) {
      input.value = '';
      input.focus();
    }
    lastQuery = '';
    showState('empty');
  });
}

function articleCardHTML(article) {
  return `
    <div class="p-5 md:p-6 grid grid-cols-1 md:grid-cols-[200px_1fr] gap-5 md:gap-6">
      <!-- Photo -->
      <div class="relative aspect-square w-full max-w-[220px] mx-auto md:mx-0 rounded-xl ring-1 ring-slate-200 bg-slate-50 overflow-hidden">
        ${article.photo_url
          ? `<img src="${article.photo_url}" alt="${escapeHtml(article.description || '')}" class="absolute inset-0 w-full h-full object-cover" />`
          : '<div class="absolute inset-0 flex items-center justify-center text-slate-300"><svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div>'}
      </div>

      <!-- Infos -->
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2 mb-2">
          <span class="font-mono text-xs font-semibold text-slate-500">${escapeHtml(article.numero_article || '')}</span>
          ${article.categorie ? `<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">${escapeHtml(article.categorie)}</span>` : ''}
          ${renderStatusBadge(article.statut)}
        </div>
        ${article.nom_produit ? `<h3 class="text-base font-semibold text-indigo-700 mb-0.5">${escapeHtml(article.nom_produit)}</h3>` : ''}
        <h2 class="text-lg md:text-xl font-bold text-slate-900 truncate">
          ${escapeHtml(article.marque || '')}${article.marque && article.couleur ? ' · ' : ''}${escapeHtml(article.couleur || '')}
        </h2>
        ${article.description ? `<p class="text-sm text-slate-600 mt-1 line-clamp-3">${escapeHtml(article.description)}</p>` : ''}

        <dl class="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Prix vente</dt>
            <dd class="mt-0.5 font-bold text-slate-900 tabular-nums">${fmtPrice(article.prix_vente) || '—'}</dd>
          </div>
          <div>
            <dt class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Quantité</dt>
            <dd class="mt-0.5 font-bold text-slate-900 tabular-nums">${article.quantite ?? 0} <span class="text-xs font-normal text-slate-500">/ ${article.quantite_initiale ?? 0}</span></dd>
          </div>
          <div>
            <dt class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Code-barres</dt>
            <dd class="mt-0.5 font-mono text-xs text-slate-700 truncate">${escapeHtml(article.code_barres || '—')}</dd>
          </div>
          <div>
            <dt class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Taille</dt>
            <dd class="mt-0.5 text-slate-700 truncate">${escapeHtml(article.taille || '—')}</dd>
          </div>
        </dl>

        <div class="mt-5 flex flex-wrap items-center gap-2">
          <button data-article-edit="true" data-article-id="${escapeHtml(article.id)}" type="button"
            class="btn-scan-edit inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            Éditer cet article
          </button>
        </div>
      </div>
    </div>
  `;
}

// Affiche un seul article
function renderArticle(article) {
  const result = $('#scan-result');
  if (!result) return;
  showState('result');
  result.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 overflow-hidden">
      ${articleCardHTML(article)}
      <div class="px-5 pb-5 flex gap-2">
        <button id="btn-scan-new" type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Nouveau scan
        </button>
      </div>
    </div>
  `;
  wireResultButtons(result, [article]);
}

// Affiche plusieurs articles avec le même code-barres
function renderArticles(articles) {
  if (!articles || !articles.length) { showState('empty'); return; }
  if (articles.length === 1) { renderArticle(articles[0]); return; }

  const result = $('#scan-result');
  if (!result) return;
  showState('result');

  result.innerHTML = `
    <div class="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 overflow-hidden">
      <div class="px-6 py-4 border-b border-slate-100 bg-amber-50">
        <div class="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span class="text-sm font-semibold text-amber-800">
            ${articles.length} articles partagent ce code-barres
          </span>
        </div>
      </div>
      <div class="divide-y divide-slate-100">
        ${articles.map((a) => `
          <div class="hover:bg-slate-50 transition">
            ${articleCardHTML(a)}
          </div>
        `).join('')}
      </div>
      <div class="px-5 pb-5 pt-2">
        <button id="btn-scan-new" type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Nouveau scan
        </button>
      </div>
    </div>
  `;
  wireResultButtons(result, articles);
}

// Wire les boutons "Éditer" et "Nouveau scan" dans le bloc résultat
function wireResultButtons(result, articlesArr) {
  result.querySelectorAll('.btn-scan-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.articleId;
      const article = articlesArr.find((a) => a.id === id) || articlesArr[0];
      if (typeof window.__decoshop?.openEditModal === 'function') {
        window.__decoshop.openEditModal(article);
      }
    });
  });
  result.querySelector('#btn-scan-new')?.addEventListener('click', () => {
    const input = $('#scan-input');
    if (input) { input.value = ''; input.focus(); }
    lastQuery = '';
    showState('empty');
  });
}

async function searchAndShow(query) {
  const q = String(query || '').trim().replace(/[\s\-]/g, '');
  if (!q) { showState('empty'); return; }
  if (q === lastQuery) return;
  lastQuery = q;

  const codeLabel = $('#scan-loading-code');
  if (codeLabel) codeLabel.textContent = q;
  showState('loading');
  try {
    const res = await fetch(`/api/articles/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Erreur ${res.status}`);
    }
    const data = await res.json();
    if (data.found) {
      try { playSuccessBeep(); } catch {}
      // Utilise articles[] si disponible (nouveau format multi), sinon article
      const articles = data.articles && data.articles.length ? data.articles : (data.article ? [data.article] : []);
      renderArticles(articles);
    } else {
      try { playErrorBeep(); } catch {}
      renderNotFound(q);
    }
  } catch (e) {
    try { playErrorBeep(); } catch {}
    toast(e.message || 'Erreur de recherche', 'error');
    showState('empty');
  }
}

function wireSearchForm() {
  const form  = $('#scan-search-form');
  const input = $('#scan-input');
  if (!form || !input) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    searchAndShow(input.value);
  });

  input.addEventListener('input', () => { lastQuery = ''; });
}

function wireCameraButton() {
  $('#btn-scan-camera')?.addEventListener('click', () => {
    if (typeof window.__decoshop?.openScanner === 'function') {
      window.__decoshop.openScanner('barcode', 'search');
    }
  });
}

// Called by app.js when a barcode is detected in 'search' mode.
window.__decoshop = window.__decoshop || {};
window.__decoshop.onScanFound = (code) => {
  const input = $('#scan-input');
  if (input) input.value = code;
  searchAndShow(code);
};

// Called by app.js after a successful edit — refresh the displayed card.
window.__decoshop.onArticleUpdated = (id) => {
  if (lastQuery) {
    const prev = lastQuery;
    lastQuery = '';
    searchAndShow(prev);
  }
};

function boot() {
  wireSearchForm();
  wireCameraButton();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
