// /codes-barres page — analyse la BD, repère les articles sans code-barres,
// génère un EAN-13 conforme GS1 France (préfixe 300-379, checksum mod-10),
// met à jour la base, affiche les étiquettes prêtes à imprimer.
import JsBarcode from 'jsbarcode';
import { $, escapeHtml, toast } from './ui.js';

// ─── EAN-13 GS1 France ─────────────────────────────────────────────────────
// Préfixes France officiels GS1 : 300 → 379 inclus.
// Source : https://gs1.fr (préfixes pays officiels)
const FR_PREFIX_MIN = 300;
const FR_PREFIX_MAX = 379;

function pickFrenchPrefix() {
  return String(FR_PREFIX_MIN + Math.floor(Math.random() * (FR_PREFIX_MAX - FR_PREFIX_MIN + 1)));
}

// Checksum EAN-13 :
//   somme = Σ(chiffres en pos impaire) + 3·Σ(chiffres en pos paire)  [pos 1..12]
//   checksum = (10 - somme % 10) % 10
function ean13Checksum(twelveDigits) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = +twelveDigits[i];
    sum += (i % 2 === 0) ? d : 3 * d;
  }
  return String((10 - (sum % 10)) % 10);
}

function randomDigits(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

// Génère un EAN-13 français unique (vérifie contre `taken` Set).
function generateEAN13(taken = new Set()) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const prefix = pickFrenchPrefix();          // 3 chiffres
    const body   = randomDigits(9);             // 9 chiffres
    const base12 = prefix + body;
    const code   = base12 + ean13Checksum(base12);
    if (!taken.has(code)) {
      taken.add(code);
      return code;
    }
  }
  // Statistiquement impossible mais on garde un fallback
  throw new Error('Impossible de générer un EAN-13 unique après 200 tentatives.');
}

// ─── State ─────────────────────────────────────────────────────────────────
let allArticles = [];
let missing = [];           // articles sans code_barres
let selected = new Set();   // ids sélectionnés
let generating = false;
let lastGenerated = [];     // [{ article, code }] de la dernière génération

// ─── Rendering ─────────────────────────────────────────────────────────────
function setLoading(on) {
  $('#loading')?.classList.toggle('hidden', !on);
}

function updateKPIs() {
  const total = allArticles.length;
  const with_ = allArticles.filter((a) => a.code_barres && String(a.code_barres).trim()).length;
  const without = total - with_;
  const elTotal = $('#kpi-total');
  const elWith  = $('#kpi-with');
  const elWho   = $('#kpi-without');
  if (elTotal) elTotal.textContent = String(total);
  if (elWith)  elWith.textContent  = String(with_);
  if (elWho)   elWho.textContent   = String(without);
}

function renderMissing() {
  const tbody = $('#missing-tbody');
  const summary = $('#missing-summary');
  const section = $('#missing-section');
  const empty = $('#empty');
  const btnGen = $('#btn-generate');
  const checkAll = $('#check-all');
  if (!tbody) return;

  if (!missing.length) {
    section?.classList.add('hidden');
    empty?.classList.remove('hidden');
    if (summary) summary.textContent = 'Aucun article sans code-barres.';
    if (btnGen) btnGen.disabled = true;
    return;
  }

  empty?.classList.add('hidden');
  section?.classList.remove('hidden');
  if (summary) summary.textContent = `${missing.length} article${missing.length > 1 ? 's' : ''} sans code-barres. Sélectionnez ceux à traiter (tous cochés par défaut).`;
  if (btnGen) btnGen.disabled = selected.size === 0;
  if (checkAll) checkAll.checked = selected.size === missing.length;

  tbody.innerHTML = missing.map((a) => `
    <tr class="hover:bg-slate-50">
      <td class="px-3 py-2">
        <input type="checkbox" class="row-check rounded border-slate-300"
          data-id="${escapeHtml(a.id)}" ${selected.has(a.id) ? 'checked' : ''} />
      </td>
      <td class="px-3 py-2 font-mono text-xs text-slate-700">${escapeHtml(a.numero_article || '')}</td>
      <td class="px-3 py-2">
        ${a.photo_url
          ? `<img src="${a.photo_url}" alt="" class="h-10 w-10 rounded-md object-cover ring-1 ring-slate-200" loading="lazy" />`
          : '<div class="h-10 w-10 rounded-md bg-slate-100 ring-1 ring-slate-200"></div>'}
      </td>
      <td class="px-3 py-2 max-w-xs">
        <div class="line-clamp-2 text-slate-700">${escapeHtml(a.description || '—')}</div>
      </td>
      <td class="px-3 py-2 text-slate-700">${escapeHtml(a.marque || '—')}</td>
      <td class="px-3 py-2 text-slate-700">${escapeHtml(a.categorie || '—')}</td>
      <td class="px-3 py-2 text-right tabular-nums font-semibold">${a.quantite ?? 0}</td>
    </tr>
  `).join('');

  // Wire checkboxes
  tbody.querySelectorAll('.row-check').forEach((el) => {
    el.addEventListener('change', () => {
      const id = el.getAttribute('data-id');
      if (el.checked) selected.add(id); else selected.delete(id);
      if (btnGen) btnGen.disabled = selected.size === 0;
      if (checkAll) checkAll.checked = selected.size === missing.length;
    });
  });
}

// ─── Data ──────────────────────────────────────────────────────────────────
async function fetchArticles() {
  setLoading(true);
  try {
    const res = await fetch('/api/articles');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { articles = [] } = await res.json();
    allArticles = articles;
    missing = allArticles.filter((a) => !a.code_barres || !String(a.code_barres).trim());
    selected = new Set(missing.map((a) => a.id)); // tout sélectionné par défaut
    updateKPIs();
    renderMissing();
  } catch (e) {
    toast(e.message || 'Erreur de chargement', 'error');
  } finally {
    setLoading(false);
  }
}

async function updateArticleCode(id, code_barres) {
  // updateArticle() côté serveur fusionne déjà avec les champs existants,
  // on n'envoie donc que ce qu'on veut modifier.
  const res = await fetch(`/api/articles/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code_barres }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Generation flow ───────────────────────────────────────────────────────
async function generateAll() {
  if (generating) return;
  if (!selected.size) { toast('Aucun article sélectionné', 'info'); return; }

  generating = true;
  const btn = $('#btn-generate');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <div class="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin"></div>
      Génération en cours…
    `;
  }

  // Codes déjà utilisés en base — pour éviter les doublons
  const taken = new Set(
    allArticles
      .map((a) => String(a.code_barres || '').trim())
      .filter((c) => /^\d{13}$/.test(c))
  );

  const toUpdate = missing.filter((a) => selected.has(a.id));
  const generated = []; // { article, code }

  for (const article of toUpdate) {
    try {
      const code = generateEAN13(taken);
      await updateArticleCode(article.id, code);
      generated.push({ article: { ...article, code_barres: code }, code });
    } catch (e) {
      console.error('Erreur génération pour', article.numero_article, e);
      toast(`Échec sur ${article.numero_article} : ${e.message}`, 'error');
    }
  }

  generating = false;
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5v14"/><path d="M7 5v14"/><path d="M11 5v14"/><path d="M15 5v14"/><path d="M19 5v14"/></svg>
      Générer les codes-barres
    `;
  }

  if (!generated.length) { toast('Aucun code-barres généré', 'warning'); return; }

  toast(`${generated.length} code${generated.length > 1 ? 's' : ''}-barres généré${generated.length > 1 ? 's' : ''} et enregistré${generated.length > 1 ? 's' : ''}`, 'success');
  lastGenerated = generated;
  renderLabels(generated);
  // Refresh table to show updated state
  await fetchArticles();
}

// ─── Labels rendering (print-friendly) ─────────────────────────────────────
function renderLabels(items) {
  const grid = $('#labels-grid');
  const section = $('#labels-section');
  if (!grid || !section) return;

  grid.innerHTML = items.map((it, idx) => `
    <div class="label-card flex flex-col items-center justify-center p-3 rounded-lg ring-1 ring-slate-200 bg-white">
      <div class="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 truncate w-full text-center">
        ${escapeHtml(it.article.marque || it.article.categorie || 'DECO SHOP')}
      </div>
      <div class="text-xs font-medium text-slate-800 line-clamp-2 mb-2 text-center min-h-[2.5em]">
        ${escapeHtml(it.article.description || it.article.numero_article)}
      </div>
      <svg id="bc-${idx}" class="w-full h-auto"></svg>
      <div class="mt-1 font-mono text-[10px] text-slate-500 truncate w-full text-center">
        N° ${escapeHtml(it.article.numero_article)}
      </div>
    </div>
  `).join('');

  // Render barcodes via JsBarcode
  items.forEach((it, idx) => {
    const target = document.getElementById(`bc-${idx}`);
    if (!target) return;
    try {
      JsBarcode(target, it.code, {
        format:       'EAN13',
        width:        1.6,
        height:       50,
        displayValue: true,
        fontSize:     14,
        textMargin:   2,
        margin:       0,
        background:   '#ffffff',
        lineColor:    '#0f172a',
      });
    } catch (e) {
      console.error('Erreur JsBarcode pour', it.code, e);
      target.outerHTML = `<div class="text-xs text-red-600">${escapeHtml(it.code)}</div>`;
    }
  });

  section.classList.remove('hidden');
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── PDF download (réutilise jsPDF déjà installé) ──────────────────────────
async function downloadPdf() {
  if (!lastGenerated.length) { toast('Aucune étiquette à exporter', 'info'); return; }
  try {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW  = doc.internal.pageSize.getWidth();
    const pageH  = doc.internal.pageSize.getHeight();
    const margin = 8;
    const cols   = 3;
    const gap    = 4;
    const cellW  = (pageW - 2 * margin - gap * (cols - 1)) / cols;
    const cellH  = 34;
    const rowsPerPage = Math.floor((pageH - 2 * margin) / (cellH + gap));

    let i = 0;
    let page = 0;
    while (i < lastGenerated.length) {
      if (page > 0) doc.addPage();
      for (let r = 0; r < rowsPerPage && i < lastGenerated.length; r++) {
        for (let c = 0; c < cols && i < lastGenerated.length; c++, i++) {
          const x = margin + c * (cellW + gap);
          const y = margin + r * (cellH + gap);
          const { article, code } = lastGenerated[i];

          // Cadre
          doc.setDrawColor(203, 213, 225);
          doc.rect(x, y, cellW, cellH);

          // Titre (marque ou catégorie)
          const brand = (article.marque || article.categorie || 'DECO SHOP').toString();
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7);
          doc.setTextColor(100);
          doc.text(brand.slice(0, 30), x + cellW / 2, y + 4, { align: 'center' });

          // Description (2 lignes max)
          const desc = (article.description || article.numero_article || '').toString();
          if (desc) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(6.5);
            doc.setTextColor(30);
            const lines = doc.splitTextToSize(desc, cellW - 4).slice(0, 2);
            doc.text(lines, x + cellW / 2, y + 8, { align: 'center' });
          }

          // Code-barres EAN-13 → canvas → PNG → addImage
          const canvas = document.createElement('canvas');
          try {
            JsBarcode(canvas, code, {
              format: 'EAN13', width: 2, height: 40,
              displayValue: true, fontSize: 12, margin: 0,
            });
            const imgW = cellW - 6;
            const imgH = 16;
            const imgX = x + 3;
            const imgY = y + 14;
            doc.addImage(canvas.toDataURL('image/png'), 'PNG', imgX, imgY, imgW, imgH);
          } catch (err) {
            console.error('Erreur encodage canvas EAN-13', code, err);
          }

          // N° article (footer)
          doc.setFont('courier', 'normal');
          doc.setFontSize(6);
          doc.setTextColor(120);
          doc.text(`N° ${article.numero_article || ''}`.slice(0, 36), x + cellW / 2, y + cellH - 1.8, { align: 'center' });
        }
      }
      page++;
    }

    const ts = new Date().toISOString().slice(0, 10);
    doc.save(`codes-barres-deco-shop-${ts}.pdf`);
    toast('PDF téléchargé', 'success');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Erreur PDF', 'error');
  }
}

// ─── Wiring ────────────────────────────────────────────────────────────────
function wire() {
  $('#btn-refresh')?.addEventListener('click', fetchArticles);
  $('#btn-generate')?.addEventListener('click', generateAll);
  $('#btn-print')?.addEventListener('click', () => window.print());
  $('#btn-download-pdf')?.addEventListener('click', downloadPdf);

  $('#check-all')?.addEventListener('change', (e) => {
    if (e.target.checked) selected = new Set(missing.map((a) => a.id));
    else                  selected = new Set();
    renderMissing();
  });
}

function boot() {
  wire();
  fetchArticles();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
