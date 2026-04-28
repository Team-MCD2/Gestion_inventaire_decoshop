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

async function fetchArticles() {
  const res = await fetch('/api/articles');
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  // L'API renvoie { articles: [...] }
  const { articles = [] } = await res.json();
  return articles;
}

function computeKpi(articles) {
  const total = articles.length;
  const units = articles.reduce((s, a) => s + (Number(a.quantite) || 0), 0);
  const value = articles.reduce((s, a) => s + (Number(a.prix_vente) || 0) * (Number(a.quantite) || 0), 0);
  const low   = articles.filter((a) => a.statut === 'stock_faible').length;
  const out   = articles.filter((a) => a.statut === 'rupture').length;
  return { total, units, value, low, out };
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

function groupByCategory(articles) {
  const map = new Map();
  for (const a of articles) {
    const cat = (a.categorie || 'Sans catégorie').trim();
    if (!map.has(cat)) map.set(cat, { count: 0, qty: 0, value: 0 });
    const e = map.get(cat);
    e.count += 1;
    e.qty   += Number(a.quantite) || 0;
    e.value += (Number(a.prix_vente) || 0) * (Number(a.quantite) || 0);
  }
  return [...map.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.value - a.value);
}

function renderCategoryDonut(articles) {
  const ctx = $('#chart-categories');
  if (!ctx) return;
  const data = groupByCategory(articles);
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

function renderValueByCategoryBar(articles) {
  const ctx = $('#chart-value-by-cat');
  if (!ctx) return;
  const data = groupByCategory(articles).slice(0, 8);
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

function renderStatusPie(articles) {
  const ctx = $('#chart-status');
  if (!ctx) return;
  const counts = {
    en_stock: articles.filter((a) => a.statut === 'en_stock').length,
    stock_faible: articles.filter((a) => a.statut === 'stock_faible').length,
    rupture: articles.filter((a) => a.statut === 'rupture').length,
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

function renderTopList(articles) {
  const list = $('#top-list');
  const empty = $('#top-empty');
  if (!list || !empty) return;
  const top = [...articles]
    .map((a) => ({
      ...a,
      _value: (Number(a.prix_vente) || 0) * (Number(a.quantite) || 0),
    }))
    .filter((a) => a._value > 0)
    .sort((a, b) => b._value - a._value)
    .slice(0, 10);

  if (!top.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const maxValue = top[0]._value || 1;
  list.innerHTML = top.map((a, i) => `
    <div class="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition">
      <div class="h-7 w-7 shrink-0 rounded-md bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">${i + 1}</div>
      ${a.photo_url
        ? `<img src="${a.photo_url}" alt="" class="h-10 w-10 shrink-0 object-cover rounded-md ring-1 ring-slate-200" />`
        : '<div class="h-10 w-10 shrink-0 rounded-md bg-slate-100 flex items-center justify-center text-slate-300"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg></div>'}
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold text-slate-900 truncate">
          ${escapeHtml(a.marque || a.numero_article || '—')}
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
}

async function boot() {
  try {
    const articles = await fetchArticles();
    const k = computeKpi(articles);

    // Fill values then reveal (skeletons → real values with fade-in)
    fillKpis(k);
    revealKpis();

    // Render charts (canvas was already in DOM, just hidden behind overlays)
    renderCategoryDonut(articles);
    renderValueByCategoryBar(articles);
    renderStatusPie(articles);
    renderTopList(articles);
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
