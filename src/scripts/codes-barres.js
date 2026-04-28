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
let filteredArticles = [];
let selected = new Set();   // ids sélectionnés
let generating = false;
let lastGenerated = [];     // [{ article, code }] de la dernière génération
let currentFilter = 'missing';

// ─── Rendering ─────────────────────────────────────────────────────────────
function setLoading(on) {
  $('#missing-loading')?.classList.toggle('hidden', !on);
  $('#missing-table')?.classList.toggle('hidden', on);
  
  if (on) {
    $('#missing-section')?.classList.remove('hidden');
    $('#empty')?.classList.add('hidden');
    $('#labels-section')?.classList.add('hidden');
  }
}

// ─── Génération : barre de progression overlay ─────────────────────────────
function showGenOverlay(total) {
  const ov = $('#gen-overlay');
  if (!ov) return;
  const totalEl = $('#gen-total');
  const doneEl = $('#gen-done');
  const pctEl  = $('#gen-pct');
  const bar    = $('#gen-bar');
  const cur    = $('#gen-current');
  if (totalEl) totalEl.textContent = String(total);
  if (doneEl)  doneEl.textContent  = '0';
  if (pctEl)   pctEl.textContent   = '0 %';
  if (bar)     bar.style.width     = '0%';
  if (cur)     cur.textContent     = '\u00a0'; // nbsp pour préserver la hauteur
  ov.classList.remove('hidden');
}

function updateGenProgress(done, total, label) {
  const doneEl = $('#gen-done');
  const pctEl  = $('#gen-pct');
  const bar    = $('#gen-bar');
  const cur    = $('#gen-current');
  const pct = total ? Math.round((done / total) * 100) : 0;
  if (doneEl) doneEl.textContent = String(done);
  if (pctEl)  pctEl.textContent  = `${pct} %`;
  if (bar)    bar.style.width    = `${pct}%`;
  if (cur && label) cur.textContent = label;
}

function hideGenOverlay() {
  $('#gen-overlay')?.classList.add('hidden');
}

function showPdfOverlay(on) {
  $('#pdf-overlay')?.classList.toggle('hidden', !on);
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

function applyFilter() {
  currentFilter = $('#filter-status')?.value || 'missing';
  if (currentFilter === 'missing') {
    filteredArticles = allArticles.filter((a) => !a.code_barres || !String(a.code_barres).trim());
  } else if (currentFilter === 'with') {
    filteredArticles = allArticles.filter((a) => a.code_barres && String(a.code_barres).trim());
  } else {
    filteredArticles = [...allArticles];
  }
  selected = new Set(filteredArticles.map((a) => a.id));
  renderTable();
}

function renderTable() {
  const tbody = $('#missing-tbody');
  const summary = $('#missing-summary');
  const section = $('#missing-section');
  const empty = $('#empty');
  const btnGen = $('#btn-generate');
  const btnExport = $('#btn-export-selected');
  const checkAll = $('#check-all');
  if (!tbody) return;

  if (!filteredArticles.length) {
    section?.classList.add('hidden');
    empty?.classList.remove('hidden');
    if (summary) summary.textContent = currentFilter === 'missing' ? 'Aucun article sans code-barres.' : 'Aucun article trouvé.';
    if (btnGen) btnGen.disabled = true;
    if (btnExport) btnExport.disabled = true;
    return;
  }

  empty?.classList.add('hidden');
  section?.classList.remove('hidden');
  $('#missing-table')?.classList.remove('hidden');
  
  if (summary) {
    const text = currentFilter === 'missing' ? 'sans code-barres' : (currentFilter === 'with' ? 'avec code-barres' : 'au total');
    summary.textContent = `${filteredArticles.length} article${filteredArticles.length > 1 ? 's' : ''} ${text}. Sélectionnez ceux à traiter.`;
  }
  
  const hasMissingInSelection = Array.from(selected).some(id => {
    const a = allArticles.find(x => x.id === id);
    return a && (!a.code_barres || !String(a.code_barres).trim());
  });
  
  const hasCodeInSelection = Array.from(selected).some(id => {
    const a = allArticles.find(x => x.id === id);
    return a && a.code_barres && String(a.code_barres).trim();
  });

  if (btnGen) btnGen.disabled = !hasMissingInSelection;
  if (btnExport) btnExport.disabled = !hasCodeInSelection;
  if (checkAll) checkAll.checked = selected.size === filteredArticles.length && filteredArticles.length > 0;

  tbody.innerHTML = filteredArticles.map((a) => `
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
      <td class="px-3 py-2 font-mono text-xs font-semibold text-slate-600">${a.code_barres ? escapeHtml(a.code_barres) : '—'}</td>
      <td class="px-3 py-2 text-right tabular-nums font-semibold">${a.quantite ?? 0}</td>
    </tr>
  `).join('');

  // Wire checkboxes
  tbody.querySelectorAll('.row-check').forEach((el) => {
    el.addEventListener('change', () => {
      const id = el.getAttribute('data-id');
      if (el.checked) selected.add(id); else selected.delete(id);
      
      const hasMissing = Array.from(selected).some(sId => {
        const a = allArticles.find(x => x.id === sId);
        return a && (!a.code_barres || !String(a.code_barres).trim());
      });
      const hasCode = Array.from(selected).some(sId => {
        const a = allArticles.find(x => x.id === sId);
        return a && a.code_barres && String(a.code_barres).trim();
      });

      if (btnGen) btnGen.disabled = !hasMissing;
      if (btnExport) btnExport.disabled = !hasCode;
      if (checkAll) checkAll.checked = selected.size === filteredArticles.length && filteredArticles.length > 0;
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
    updateKPIs();
    applyFilter();
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

  const toUpdate = Array.from(selected)
    .map(id => allArticles.find(a => a.id === id))
    .filter(a => a && (!a.code_barres || !String(a.code_barres).trim()));
    
  if (!toUpdate.length) {
    toast('Aucun article sélectionné nécessitant un code-barres', 'info');
    return;
  }
  
  const generated = []; // { article, code }

  // Affiche l'overlay modal avec barre de progression
  showGenOverlay(toUpdate.length);

  let done = 0;
  for (const article of toUpdate) {
    // Met à jour le label en cours AVANT le PUT pour montrer l'article courant
    updateGenProgress(done, toUpdate.length,
      `${article.numero_article || '—'} · ${article.description || article.marque || ''}`.slice(0, 60)
    );
    try {
      const code = generateEAN13(taken);
      await updateArticleCode(article.id, code);
      generated.push({ article: { ...article, code_barres: code }, code });
    } catch (e) {
      console.error('Erreur génération pour', article.numero_article, e);
      toast(`Échec sur ${article.numero_article} : ${e.message}`, 'error');
    }
    done++;
    updateGenProgress(done, toUpdate.length);
  }

  // Petit délai pour laisser voir 100 % avant de fermer l'overlay
  await new Promise((r) => setTimeout(r, 300));
  hideGenOverlay();

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

  grid.innerHTML = items.map((it, idx) => {
    // Cascade : chaque carte apparaît avec un petit décalage (max 600 ms)
    const delay = Math.min(idx * 30, 600);
    return `
    <div class="label-card flex flex-col items-center justify-center p-3 rounded-lg ring-1 ring-slate-200 bg-white"
         style="animation-delay: ${delay}ms;">
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
    </div>`;
  }).join('');

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

async function downloadPdf(itemsToExport = null) {
  const items = Array.isArray(itemsToExport) ? itemsToExport : lastGenerated;
  if (!items || !items.length) { toast('Aucune étiquette à exporter', 'info'); return; }
  
  showPdfOverlay(true);
  try {
    const { jsPDF } = await import('jspdf');
    // Format thermique normé (ex: rouleau 50x30 mm)
    const doc = new jsPDF({ unit: 'mm', format: [50, 30] });

    let page = 0;
    for (const it of items) {
      if (page > 0) doc.addPage();
      const { article, code } = it;

      // Titre (marque ou catégorie)
      const brand = (article.marque || article.categorie || 'DECO SHOP').toString();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(0);
      doc.text(brand.slice(0, 30), 25, 4, { align: 'center' });

      // Code-barres EAN-13 normé
      const canvas = document.createElement('canvas');
      try {
        JsBarcode(canvas, code, {
          format: 'EAN13', width: 2, height: 40,
          displayValue: true, fontSize: 14, margin: 0,
        });
        // 37.29 x 18 mm (proportions GS1 pour tenir sur la hauteur de l'étiquette)
        doc.addImage(canvas.toDataURL('image/png'), 'PNG', (50 - 37.29) / 2, 7, 37.29, 18);
      } catch (err) {
        console.error('Erreur encodage canvas EAN-13', code, err);
      }

      // N° article (footer)
      doc.setFont('courier', 'normal');
      doc.setFontSize(6);
      doc.setTextColor(50);
      doc.text(`N° ${article.numero_article || ''}`.slice(0, 36), 25, 28, { align: 'center' });
      
      page++;
    }

    const ts = new Date().toISOString().slice(0, 10);
    doc.save(`etiquettes-deco-shop-${ts}.pdf`);
    toast('PDF téléchargé', 'success');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Erreur PDF', 'error');
  } finally {
    showPdfOverlay(false);
  }
}

function exportSelectedPdf() {
  const items = Array.from(selected)
    .map(id => allArticles.find(a => a.id === id))
    .filter(a => a && a.code_barres && String(a.code_barres).trim())
    .map(a => ({ article: a, code: a.code_barres }));
  if (!items.length) {
    toast('Aucun article avec code-barres sélectionné', 'warning');
    return;
  }
  downloadPdf(items);
}

// ─── Wiring ────────────────────────────────────────────────────────────────
function wire() {
  $('#filter-status')?.addEventListener('change', applyFilter);
  $('#btn-refresh')?.addEventListener('click', fetchArticles);
  $('#btn-generate')?.addEventListener('click', generateAll);
  $('#btn-export-selected')?.addEventListener('click', exportSelectedPdf);
  $('#btn-print')?.addEventListener('click', () => window.print());
  $('#btn-download-pdf')?.addEventListener('click', () => downloadPdf(lastGenerated));

  $('#check-all')?.addEventListener('change', (e) => {
    if (e.target.checked) selected = new Set(filteredArticles.map((a) => a.id));
    else                  selected = new Set();
    renderTable();
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
