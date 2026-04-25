// Main application — wires UI events, scanner, form, table
import {
  subscribe, getState, reload,
  createArticle, updateArticle, deleteArticle,
  clearAll, updateSettings, getNextNumArticle,
} from './state.js';
import { startCamera, stopCamera, captureFrame } from './camera.js';
import { startBarcodeScanner, stopBarcodeScanner } from './barcode.js';
import { analyzeImage, analyzeBarcode, getServerStatus } from './gemini.js';
import { downloadCSV } from './csv.js';
import { downloadPDF } from './pdf.js';

const $  = (sel, root = document) => root.querySelector(sel);

const TEXT_FIELDS = [
  'num_article', 'categorie', 'marque', 'modele', 'description',
  'reference', 'couleur', 'dimension',
];
const NUMBER_FIELDS = [
  'prix_achat', 'prix_vente', 'quantite_initiale', 'quantite_actuelle',
];
const FIELDS = [...TEXT_FIELDS, ...NUMBER_FIELDS];

let scannerMode = 'photo';

// ---------- Form ----------
function getFormData() {
  const form = $('#article-form');
  const out = {};
  FIELDS.forEach((k) => {
    const el = form.elements.namedItem(k);
    if (!el) return;
    let v = el.value;
    if (NUMBER_FIELDS.includes(k)) {
      v = v === '' ? 0 : Number(v);
      if (!Number.isFinite(v)) v = 0;
    }
    out[k] = v;
  });
  out.photo = $('#photo-preview').dataset.src || '';
  return out;
}

function setFormData(data) {
  const form = $('#article-form');
  FIELDS.forEach((k) => {
    const el = form.elements.namedItem(k);
    if (!el) return;
    if (k in data && data[k] !== null && data[k] !== undefined && data[k] !== '') {
      el.value = data[k];
    }
  });
  if (data.photo) setPhoto(data.photo);
  updateMarge();
  updateStatutPreview();
}

function updateMarge() {
  const form = $('#article-form');
  const achat = Number(form.elements.namedItem('prix_achat')?.value || 0);
  const vente = Number(form.elements.namedItem('prix_vente')?.value || 0);
  const marge = (vente - achat) || 0;
  const el = $('#marge-display');
  if (!el) return;
  el.textContent = marge.toFixed(2).replace('.', ',') + ' €';
  el.classList.remove('text-emerald-600', 'text-red-600', 'text-slate-500');
  if (marge > 0) el.classList.add('text-emerald-600');
  else if (marge < 0) el.classList.add('text-red-600');
  else el.classList.add('text-slate-500');
}

function updateStatutPreview() {
  const form = $('#article-form');
  const qActRaw = form.elements.namedItem('quantite_actuelle')?.value;
  if (qActRaw === '' || qActRaw === null || qActRaw === undefined) {
    $('#statut-preview').innerHTML = '';
    return;
  }
  const q = Number(qActRaw);
  const seuil = 5;
  const s = q <= 0 ? 'rupture' : (q <= seuil ? 'stock_faible' : 'en_stock');
  $('#statut-preview').innerHTML = renderStatusBadge(s);
}

function setPhoto(dataUrl) {
  const img = $('#photo-preview');
  const placeholder = $('#photo-placeholder');
  img.src = dataUrl;
  img.dataset.src = dataUrl;
  img.classList.remove('hidden');
  placeholder.classList.add('hidden');
}

function clearPhoto() {
  const img = $('#photo-preview');
  img.src = '';
  img.dataset.src = '';
  img.classList.add('hidden');
  $('#photo-placeholder').classList.remove('hidden');
}

async function clearForm() {
  const form = $('#article-form');
  form.reset();
  clearPhoto();
  form.elements.namedItem('quantite_initiale').value = 1;
  form.elements.namedItem('quantite_actuelle').value = 1;
  form.dataset.editing = '';
  $('#form-title').textContent = 'Nouvel article';
  $('#btn-submit').textContent = 'Ajouter à l\'inventaire';
  updateMarge();
  updateStatutPreview();
  // Fetch next num async
  const num = await getNextNumArticle();
  if (num && !form.dataset.editing) {
    const el = form.elements.namedItem('num_article');
    if (el && !el.value) el.value = num;
  }
}

// ---------- Toast ----------
function toast(msg, type = 'info') {
  const host = $('#toast-host');
  const el = document.createElement('div');
  const base = 'px-4 py-3 rounded-xl shadow-lg text-sm font-medium max-w-sm flex items-start gap-2 pointer-events-auto';
  const color =
    type === 'error'   ? 'bg-red-600 text-white' :
    type === 'success' ? 'bg-emerald-600 text-white' :
                         'bg-slate-900 text-white';
  el.className = `${base} ${color} toast-enter`;
  el.textContent = msg;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-enter-active'));
  setTimeout(() => {
    el.style.transition = 'all 300ms ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    setTimeout(() => el.remove(), 320);
  }, 3600);
}

// ---------- Scanner ----------
async function openScanner(mode) {
  scannerMode = mode;
  $('#scanner-modal').classList.remove('hidden');
  $('#scanner-modal').classList.add('flex');
  document.body.style.overflow = 'hidden';
  updateScannerUI();
  const video = $('#scanner-video');
  try {
    if (mode === 'photo') {
      await startCamera(video);
    } else {
      await startBarcodeScanner(video, onBarcodeDetected);
    }
  } catch (e) {
    toast(e.message || 'Erreur caméra', 'error');
    await closeScanner();
  }
}

function updateScannerUI() {
  const isPhoto = scannerMode === 'photo';
  $('#scanner-mode-label').textContent = isPhoto ? 'Capture photo' : 'Scan code-barres';
  $('#scanner-status').textContent = isPhoto
    ? 'Cadrez l\'article, puis appuyez sur Capturer'
    : 'Pointez la caméra vers le code-barres';
  $('#btn-capture').classList.toggle('hidden', !isPhoto);
  $('#barcode-frame').classList.toggle('hidden', isPhoto);
  $('#btn-switch-mode').textContent = isPhoto ? 'Passer en mode Code-barres' : 'Passer en mode Photo';
}

async function closeScanner() {
  $('#scanner-modal').classList.add('hidden');
  $('#scanner-modal').classList.remove('flex');
  $('#scanner-loading').classList.add('hidden');
  document.body.style.overflow = '';
  await stopCamera();
  await stopBarcodeScanner();
}

async function switchMode() {
  const next = scannerMode === 'photo' ? 'barcode' : 'photo';
  await stopCamera();
  await stopBarcodeScanner();
  scannerMode = next;
  updateScannerUI();
  const video = $('#scanner-video');
  try {
    if (next === 'photo') await startCamera(video);
    else await startBarcodeScanner(video, onBarcodeDetected);
  } catch (e) {
    toast(e.message || 'Erreur caméra', 'error');
  }
}

async function captureAndAnalyze() {
  const video = $('#scanner-video');
  const overlay = $('#scanner-loading');
  const loadingLabel = $('#scanner-loading-label');
  try {
    loadingLabel.textContent = 'Capture en cours…';
    overlay.classList.remove('hidden');
    const dataUrl = captureFrame(video);
    await stopCamera();
    loadingLabel.textContent = 'Analyse IA en cours…';
    const analysis = await analyzeImage(dataUrl);
    setFormData({ ...analysis, photo: dataUrl });
    toast('Article analysé avec succès', 'success');
    await closeScanner();
  } catch (e) {
    toast(e.message || 'Erreur d\'analyse', 'error');
    overlay.classList.add('hidden');
    try { await startCamera(video); } catch {}
  }
}

let barcodeProcessing = false;
async function onBarcodeDetected(code) {
  if (barcodeProcessing) return;
  barcodeProcessing = true;
  const overlay = $('#scanner-loading');
  const loadingLabel = $('#scanner-loading-label');
  loadingLabel.textContent = `Code détecté: ${code} — recherche IA…`;
  overlay.classList.remove('hidden');
  await stopBarcodeScanner();
  try {
    const analysis = await analyzeBarcode(code);
    setFormData({ ...analysis, reference: analysis.reference || code });
    toast(`Code ${code} identifié`, 'success');
    await closeScanner();
  } catch (e) {
    toast(e.message || 'Erreur analyse code-barres', 'error');
    overlay.classList.add('hidden');
    try { await startBarcodeScanner($('#scanner-video'), onBarcodeDetected); } catch {}
  } finally {
    barcodeProcessing = false;
  }
}

// ---------- Table ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtPrice(v) {
  if (v === '' || v == null || Number.isNaN(Number(v))) return '';
  return Number(v).toFixed(2).replace('.', ',') + ' €';
}

function renderStatusBadge(statut) {
  if (statut === 'rupture') {
    return `<span class="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-200">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 14.14 14.14"/></svg>
      Rupture
    </span>`;
  }
  if (statut === 'stock_faible') {
    return `<span class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-300">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
      Stock faible
    </span>`;
  }
  return `<span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
    En stock
  </span>`;
}

function renderTable() {
  const { articles, loading } = getState();
  const tbody = $('#inventory-tbody');
  const empty = $('#inventory-empty');
  const count = $('#inventory-count');
  if (count) count.textContent = articles.length;

  if (loading && !articles.length) {
    tbody.innerHTML = '';
    empty.classList.add('hidden');
    $('#inventory-loading').classList.remove('hidden');
    return;
  }
  $('#inventory-loading').classList.add('hidden');

  if (!articles.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  tbody.innerHTML = articles.map((a) => `
    <tr class="hover:bg-slate-50 transition" data-id="${a.id}">
      <td class="px-3 py-2 whitespace-nowrap font-mono text-xs font-semibold text-slate-800">${escapeHtml(a.num_article || '')}</td>
      <td class="px-3 py-2">${a.photo
        ? `<img src="${a.photo}" class="h-12 w-12 object-cover rounded-md ring-1 ring-slate-200" alt="" />`
        : '<span class="inline-flex h-12 w-12 items-center justify-center rounded-md bg-slate-100 text-slate-300 text-xs">—</span>'}</td>
      <td class="px-3 py-2"><span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">${escapeHtml(a.categorie || '—')}</span></td>
      <td class="px-3 py-2">${escapeHtml(a.marque || '')}</td>
      <td class="px-3 py-2">${escapeHtml(a.modele || '')}</td>
      <td class="px-3 py-2 max-w-xs"><div class="line-clamp-2 text-slate-600">${escapeHtml(a.description || '')}</div></td>
      <td class="px-3 py-2 text-right tabular-nums">${fmtPrice(a.prix_achat)}</td>
      <td class="px-3 py-2 text-right tabular-nums">${fmtPrice(a.prix_vente)}</td>
      <td class="px-3 py-2 text-right tabular-nums font-semibold ${a.marge > 0 ? 'text-emerald-600' : a.marge < 0 ? 'text-red-600' : 'text-slate-500'}">${fmtPrice(a.marge)}</td>
      <td class="px-3 py-2 font-mono text-xs">${escapeHtml(a.reference || '')}</td>
      <td class="px-3 py-2">${escapeHtml(a.couleur || '')}</td>
      <td class="px-3 py-2 whitespace-nowrap text-xs">${escapeHtml(a.dimension || '')}</td>
      <td class="px-3 py-2 text-right tabular-nums">${a.quantite_initiale ?? ''}</td>
      <td class="px-3 py-2 text-right tabular-nums font-semibold">${a.quantite_actuelle ?? ''}</td>
      <td class="px-3 py-2 whitespace-nowrap">${renderStatusBadge(a.statut)}</td>
      <td class="px-3 py-2 text-right whitespace-nowrap">
        <button data-action="edit" data-id="${a.id}" class="text-indigo-600 hover:text-indigo-800 text-xs font-semibold mr-2">Éditer</button>
        <button data-action="delete" data-id="${a.id}" class="text-red-600 hover:text-red-800 text-xs font-semibold">Suppr.</button>
      </td>
    </tr>
  `).join('');
}

// ---------- Settings ----------
function renderKeyBadge(el, present, labelOk, labelKo) {
  if (!el) return;
  if (present) {
    el.className = 'mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200';
    el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> ${labelOk}`;
  } else {
    el.className = 'mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-300';
    el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg> ${labelKo}`;
  }
}

async function openSettings() {
  const s = getState().settings;
  $('#settings-apikey').value = s.geminiApiKey || '';
  $('#settings-vision-key').value = s.googleVisionApiKey || '';
  $('#settings-model').value = s.model || 'gemini-2.5-flash';
  $('#settings-modal').classList.remove('hidden');
  $('#settings-modal').classList.add('flex');
  const status = await getServerStatus(true);
  renderKeyBadge(
    $('#settings-server-status'),
    status.geminiKey,
    `Clé Gemini serveur active (.env) — modèle ${status.model}`,
    'Aucune clé Gemini serveur — saisissez la vôtre ci-dessous'
  );
  renderKeyBadge(
    $('#settings-vision-status'),
    status.visionKey,
    'Clé Cloud Vision serveur active (.env) — enrichissement actif',
    'Aucune clé Cloud Vision (optionnel) — Gemini seul est utilisé'
  );
}

function closeSettings() {
  $('#settings-modal').classList.add('hidden');
  $('#settings-modal').classList.remove('flex');
}

// ---------- Wire events ----------
function wireEvents() {
  $('#btn-open-photo').addEventListener('click', () => openScanner('photo'));
  $('#btn-open-barcode').addEventListener('click', () => openScanner('barcode'));
  $('#btn-close-scanner').addEventListener('click', closeScanner);
  $('#btn-capture').addEventListener('click', captureAndAnalyze);
  $('#btn-switch-mode').addEventListener('click', switchMode);
  $('#scanner-backdrop').addEventListener('click', closeScanner);

  // Photo click to remove
  $('#photo-preview').addEventListener('click', () => {
    if ($('#photo-preview').dataset.src) {
      if (confirm('Supprimer la photo ?')) clearPhoto();
    }
  });

  // Form
  const form = $('#article-form');

  // Auto-recalc marge when prices change
  form.elements.namedItem('prix_achat').addEventListener('input', updateMarge);
  form.elements.namedItem('prix_vente').addEventListener('input', updateMarge);

  // Sync quantite_initiale → quantite_actuelle on create (as long as user hasn't touched actuelle)
  const qInit = form.elements.namedItem('quantite_initiale');
  const qAct = form.elements.namedItem('quantite_actuelle');
  qInit.addEventListener('input', () => {
    if (!form.dataset.editing && !qAct.dataset.touched) qAct.value = qInit.value;
    updateStatutPreview();
  });
  qAct.addEventListener('input', () => {
    qAct.dataset.touched = '1';
    updateStatutPreview();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = $('#btn-submit');
    const data = getFormData();
    const editing = form.dataset.editing;
    submitBtn.disabled = true;
    submitBtn.classList.add('opacity-60', 'cursor-not-allowed');
    try {
      if (editing) {
        await updateArticle(editing, data);
        toast('Article mis à jour', 'success');
      } else {
        await createArticle(data);
        toast('Article ajouté à l\'inventaire', 'success');
      }
      await clearForm();
    } catch (err) {
      toast(err.message || 'Erreur lors de l\'enregistrement', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove('opacity-60', 'cursor-not-allowed');
    }
  });

  $('#btn-clear').addEventListener('click', async () => {
    const d = getFormData();
    const dirty = form.dataset.editing || d.marque || d.modele || d.description || d.photo;
    if (dirty && !confirm('Effacer le formulaire ?')) return;
    await clearForm();
  });

  // Table actions
  $('#inventory-tbody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === 'edit') {
      const article = getState().articles.find((a) => a.id === id);
      if (!article) return;
      await clearForm();
      setFormData(article);
      form.dataset.editing = id;
      const qAct = form.elements.namedItem('quantite_actuelle');
      qAct.dataset.touched = '1';
      $('#form-title').textContent = `Édition — ${article.num_article}`;
      $('#btn-submit').textContent = 'Enregistrer les modifications';
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (action === 'delete') {
      if (!confirm('Supprimer cet article ?')) return;
      try {
        await deleteArticle(id);
        toast('Article supprimé');
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  // Exports
  $('#btn-export-csv').addEventListener('click', () => {
    const articles = getState().articles;
    if (!articles.length) { toast('Aucun article à exporter', 'error'); return; }
    downloadCSV(articles);
    toast('Export CSV téléchargé', 'success');
  });

  $('#btn-export-pdf').addEventListener('click', () => {
    const articles = getState().articles;
    if (!articles.length) { toast('Aucun article à exporter', 'error'); return; }
    try {
      downloadPDF(articles);
      toast('Export PDF téléchargé', 'success');
    } catch (err) {
      toast(err.message || 'Erreur export PDF', 'error');
    }
  });

  $('#btn-clear-all').addEventListener('click', async () => {
    if (!getState().articles.length) return;
    if (!confirm('Supprimer TOUT l\'inventaire ? Cette action est irréversible.')) return;
    try {
      await clearAll();
      toast('Inventaire vidé');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Settings
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-close-settings').addEventListener('click', closeSettings);
  $('#settings-backdrop').addEventListener('click', closeSettings);
  $('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    updateSettings({
      geminiApiKey: $('#settings-apikey').value.trim(),
      googleVisionApiKey: $('#settings-vision-key').value.trim(),
      model: $('#settings-model').value,
    });
    toast('Paramètres enregistrés', 'success');
    closeSettings();
  });

  // Toggle password visibility (both keys)
  $('#btn-toggle-apikey').addEventListener('click', () => {
    const input = $('#settings-apikey');
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  $('#btn-toggle-vision-key').addEventListener('click', () => {
    const input = $('#settings-vision-key');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Escape to close modals
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#scanner-modal').classList.contains('hidden')) closeScanner();
    if (!$('#settings-modal').classList.contains('hidden')) closeSettings();
  });
}

// ---------- Boot ----------
async function boot() {
  wireEvents();
  subscribe(renderTable);
  await clearForm();
  await reload();
  const status = await getServerStatus();
  if (!status.geminiKey && !getState().settings.geminiApiKey) {
    setTimeout(() => {
      toast('Configurez votre clé Gemini dans Paramètres pour activer l\'IA', 'info');
    }, 400);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
