// /statistiques page — KPI + graphes Chart.js sur les données d'inventaire.
// Les ventes Shopify viendront plus tard via une autre table (orders).
import Chart from 'chart.js/auto';
import { $, escapeHtml, fmtPrice, fmtPriceCompact, toast } from './ui.js';

const PALETTE = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#94a3b8',
];

function fmtInt(n) {
  return Number(n).toLocaleString('fr-FR');
}

// /api/stats : payload pré-agrégé (KPIs + by_category + top10). On ne
// récupère JAMAIS toutes les photos depuis le client, ce qui rendait la
// page très lente quand le catalogue contenait des photos en base64.
async function fetchStats() {
  const res = await fetch('/api/stats?top=10');
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  return await res.json();
}

function fillKpis(k) {
  $('#kpi-total').textContent = fmtInt(k.total);
  $('#kpi-units').textContent = fmtInt(k.units);
  $('#kpi-value').textContent = fmtPriceCompact(k.value);
  $('#kpi-low').textContent   = fmtInt(k.low);
  $('#kpi-out').textContent   = fmtInt(k.out);
}

// ─── Loading state helpers ──────────────────────────────────────────────────
// Removes skeleton placeholders and reveals real values with a soft fade-in.
function revealKpis() {
  document.querySelectorAll('.kpi-skel, .kpi-sub-skel').forEach((s) => s.remove());
  document.querySelectorAll('.kpi-val, .kpi-sub').forEach((v) => {
    v.classList.remove('hidden');
    v.style.opacity = '0';
    v.style.transition = 'opacity 250ms ease';
    requestAnimationFrame(() => { v.style.opacity = '1'; });
  });
}

function revealCharts() {
  document.querySelectorAll('.chart-loader').forEach((overlay) => {
    overlay.style.transition = 'opacity 250ms ease';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 280);
  });
}

function hidePageLoader() {
  const loader = $('#stats-loader');
  if (!loader) return;
  loader.style.transition = 'opacity 200ms ease';
  loader.style.opacity = '0';
  setTimeout(() => loader.remove(), 220);
}

function showError(msg) {
  // Replace KPI skeletons with neutral dashes
  document.querySelectorAll('.kpi-skel, .kpi-sub-skel').forEach((s) => s.remove());
  document.querySelectorAll('.kpi-val').forEach((v) => {
    v.classList.remove('hidden');
    v.classList.remove('text-slate-900', 'text-amber-600', 'text-red-600');
    v.classList.add('text-slate-300');
    v.textContent = '—';
  });
  document.querySelectorAll('.kpi-sub').forEach((v) => v.classList.remove('hidden'));

  // Replace chart loaders with an error state
  document.querySelectorAll('.chart-loader').forEach((overlay) => {
    overlay.innerHTML = `
      <div class="text-center px-3">
        <div class="text-xs font-semibold text-slate-600">Données indisponibles</div>
        <button class="stats-retry mt-2 text-xs underline font-semibold text-indigo-600 hover:text-indigo-700">Réessayer</button>
      </div>
    `;
  });

  // Replace top-skel with empty error placeholder
  const top = $('#top-list');
  if (top) {
    top.innerHTML = `
      <div class="py-8 text-center text-sm text-slate-400">
        Impossible de charger les statistiques.
        <button class="stats-retry block mx-auto mt-2 underline font-semibold text-indigo-600 hover:text-indigo-700">Réessayer</button>
      </div>
    `;
  }

  // Wire all retry buttons
  document.querySelectorAll('.stats-retry').forEach((btn) => {
    btn.addEventListener('click', () => window.location.reload());
  });

  hidePageLoader();
  if (msg) toast(msg, 'error');
}

function renderCategoryDonut(byCategory) {
  const ctx = $('#chart-categories');
  if (!ctx) return;
  const data = byCategory || [];
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: data.map((d) => d.name),
      datasets: [{
        data: data.map((d) => d.count),
        backgroundColor: data.map((_, i) => PALETTE[i % PALETTE.length]),
        borderColor: '#fff',
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (c) => `${c.label} : ${c.parsed} article${c.parsed > 1 ? 's' : ''}`,
          },
        },
      },
    },
  });
}

function renderValueByCategoryBar(byCategory) {
  const ctx = $('#chart-value-by-cat');
  if (!ctx) return;
  const data = (byCategory || []).slice(0, 8);
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map((d) => d.name),
      datasets: [{
        label: 'Valeur (€)',
        data: data.map((d) => Math.round(d.value)),
        backgroundColor: data.map((_, i) => PALETTE[i % PALETTE.length]),
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => fmtPriceCompact(c.parsed.x),
          },
        },
      },
      scales: {
        x: {
          ticks: { callback: (v) => fmtPriceCompact(v), font: { size: 11 } },
          grid: { color: '#f1f5f9' },
        },
        y: { ticks: { font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

function renderStatusPie(statusCounts) {
  const ctx = $('#chart-status');
  if (!ctx) return;
  const counts = {
    en_stock:     Number(statusCounts?.en_stock     || 0),
    stock_faible: Number(statusCounts?.stock_faible || 0),
    rupture:      Number(statusCounts?.rupture      || 0),
  };
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['En stock', 'Stock faible', 'Rupture'],
      datasets: [{
        data: [counts.en_stock, counts.stock_faible, counts.rupture],
        backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
        borderColor: '#fff',
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
      },
    },
  });
}

// Store des articles top pour la modale détail
let _topArticles = [];

function openStatArticleModal(article) {
  const modal = document.getElementById('stat-article-modal');
  const body  = document.getElementById('stat-modal-body');
  if (!modal || !body) return;

  function fmtTs(ts) {
    if (!ts) return '—';
    try {
      const d = new Date(typeof ts === 'number' ? ts : Number(ts));
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    } catch { return '—'; }
  }

  const STATUS = { en_stock: 'En stock', stock_faible: 'Stock faible', rupture: 'Rupture' };
  const STATUS_COLORS = {
    en_stock:     'bg-emerald-100 text-emerald-700',
    stock_faible: 'bg-amber-100 text-amber-700',
    rupture:      'bg-red-100 text-red-700',
  };
  const statut = article.statut || (Number(article.quantite) <= 0 ? 'rupture' : 'en_stock');
  const statutCls = STATUS_COLORS[statut] || 'bg-slate-100 text-slate-700';

  body.innerHTML = `
    <div class="flex items-start gap-4 mb-5">
      ${article.photo_url
        ? `<img src="${escapeHtml(article.photo_url)}" alt="" class="h-20 w-20 rounded-xl object-cover ring-1 ring-slate-200 shrink-0" />`
        : `<div class="h-20 w-20 shrink-0 rounded-xl bg-slate-100 ring-1 ring-slate-200 flex items-center justify-center text-slate-300"><svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div>`}
      <div class="min-w-0 flex-1">
        ${article.nom_produit ? `<div class="text-xs text-indigo-600 font-semibold mb-0.5">${escapeHtml(article.nom_produit)}</div>` : ''}
        <div class="text-lg font-bold text-slate-900 truncate">
          ${escapeHtml(article.marque || article.numero_article || '—')}
          ${article.couleur ? `<span class="text-slate-400 font-normal text-base"> · ${escapeHtml(article.couleur)}</span>` : ''}
        </div>
        <div class="flex flex-wrap gap-1.5 mt-1.5">
          <span class="font-mono text-xs text-slate-500">${escapeHtml(article.numero_article || '')}</span>
          ${article.categorie ? `<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">${escapeHtml(article.categorie)}</span>` : ''}
          <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statutCls}">${STATUS[statut] || statut}</span>
        </div>
      </div>
    </div>
    <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
      <div>
        <dt class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Prix vente</dt>
        <dd class="mt-0.5 font-bold text-slate-900">${fmtPrice(article.prix_vente) || '—'}</dd>
      </div>
      <div>
        <dt class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Valeur stock</dt>
        <dd class="mt-0.5 font-bold text-indigo-600">${fmtPrice(article._value) || '—'}</dd>
      </div>
      <div>
        <dt class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Quantité actuelle</dt>
        <dd class="mt-0.5 font-bold text-slate-900">${article.quantite ?? '—'}</dd>
      </div>
      <div>
        <dt class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Date d'ajout</dt>
        <dd class="mt-0.5 text-slate-700">${fmtTs(article.created_at)}</dd>
      </div>
      <div>
        <dt class="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Dernière mise à jour</dt>
        <dd class="mt-0.5 text-slate-700">${fmtTs(article.updated_at)}</dd>
      </div>
    </dl>
    <div class="mt-5 flex justify-end">
      <a href="/inventaire" class="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700">
        Voir dans l'inventaire
      </a>
    </div>
  `;

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeStatArticleModal() {
  const modal = document.getElementById('stat-article-modal');
  modal?.classList.add('hidden');
  modal?.classList.remove('flex');
}

function wireStatModal() {
  document.getElementById('stat-modal-close')?.addEventListener('click', closeStatArticleModal);
  document.getElementById('stat-article-backdrop')?.addEventListener('click', closeStatArticleModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeStatArticleModal();
  });
}

function renderTopList(topServer) {
  const list = $('#top-list');
  const empty = $('#top-empty');
  if (!list || !empty) return;

  const top = (topServer || []).map((a) => ({
    ...a,
    _value: Number(a._value ?? (Number(a.prix_vente) || 0) * (Number(a.quantite) || 0)),
  }));
  _topArticles = top;

  if (!top.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const maxValue = top[0]._value || 1;
  list.innerHTML = top.map((a, i) => `
    <div class="top-row flex items-center gap-3 p-2 rounded-lg hover:bg-indigo-50 cursor-pointer transition group" data-idx="${i}" title="Cliquer pour voir le détail">
      <div class="h-7 w-7 shrink-0 rounded-md bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600 group-hover:bg-indigo-100 group-hover:text-indigo-700 transition">${i + 1}</div>
      ${a.photo_url
        ? `<img src="${a.photo_url}" alt="" class="h-10 w-10 shrink-0 object-cover rounded-md ring-1 ring-slate-200" />`
        : '<div class="h-10 w-10 shrink-0 rounded-md bg-slate-100 flex items-center justify-center text-slate-300"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div>'}
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold text-slate-900 truncate group-hover:text-indigo-700 transition">
          ${escapeHtml(a.nom_produit || a.marque || a.numero_article || '—')}
          ${a.couleur ? `<span class="text-slate-400 font-normal"> · ${escapeHtml(a.couleur)}</span>` : ''}
        </div>
        <div class="mt-1 relative h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div class="absolute inset-y-0 left-0 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full" style="width: ${(a._value / maxValue * 100).toFixed(1)}%"></div>
        </div>
      </div>
      <div class="text-right shrink-0">
        <div class="text-sm font-bold text-slate-900 tabular-nums">${fmtPriceCompact(a._value)}</div>
        <div class="text-[11px] text-slate-500 tabular-nums">${a.quantite ?? 0} × ${fmtPrice(a.prix_vente)}</div>
      </div>
    </div>
  `).join('');

  // Wire click events
  list.querySelectorAll('.top-row').forEach((row) => {
    row.addEventListener('click', () => {
      const idx = Number(row.dataset.idx);
      const article = _topArticles[idx];
      if (article) openStatArticleModal(article);
    });
  });
}

async function boot() {
  wireStatModal();
  try {
    const stats = await fetchStats();

    // Fill values then reveal (skeletons → real values with fade-in)
    fillKpis(stats);
    revealKpis();

    // Render charts (canvas was already in DOM, just hidden behind overlays)
    renderCategoryDonut(stats.by_category);
    renderValueByCategoryBar(stats.by_category);
    renderStatusPie(stats.status_counts);
    renderTopList(stats.top);
    revealCharts();
    hidePageLoader();
  } catch (e) {
    console.error('Stats load error:', e);
    showError('Erreur de chargement des statistiques');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
