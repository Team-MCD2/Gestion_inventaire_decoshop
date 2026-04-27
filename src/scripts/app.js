// Main application — wires UI events, scanner, form, table
import {
  subscribe, getState, reload,
  createArticle, updateArticle, deleteArticle,
  clearAll, getNextNumArticle,
} from './state.js';
import { startCamera, stopCamera, captureFrame, fileToImageDataUrl } from './camera.js';
import { startBarcodeScanner, stopBarcodeScanner } from './barcode.js';
import { analyzeImage, analyzeBarcode } from './gemini.js';
import { downloadCSV } from './csv.js';
import { downloadPDF } from './pdf.js';

const $  = (sel, root = document) => root.querySelector(sel);

// Field names match the MCD schema (cf. mcd_mld.md §2 articles)
const TEXT_FIELDS = [
  'numero_article', 'categorie', 'marque', 'modele', 'description',
  'code_barres', 'couleur', 'ref_couleur', 'taille', 'taille_canape',
  'shopify_product_id',
];
const NUMBER_FIELDS = [
  'prix_achat', 'prix_vente', 'quantite_initiale', 'quantite',
];
const FIELDS = [...TEXT_FIELDS, ...NUMBER_FIELDS];

// Selectors for each of the 2 forms (create at top of page, edit in modal)
const FORMS = {
  create: {
    form: '#article-form',
    photo: '#photo-preview',
    photoPlaceholder: '#photo-placeholder',
    marge: '#marge-display',
    statut: '#statut-preview',
    removePhotoBtn: null,
  },
  edit: {
    form: '#edit-form',
    photo: '#edit-photo-preview',
    photoPlaceholder: '#edit-photo-placeholder',
    marge: '#edit-marge-display',
    statut: '#edit-statut-preview',
    removePhotoBtn: '#btn-edit-remove-photo',
  },
};

let scannerMode = 'photo';
let editingArticleId = null; // id of the article being edited in the modal (null when modal closed)

// ---------- Form helpers (work for both create + edit modes) ----------
function getFormData(mode = 'create') {
  const cfg = FORMS[mode];
  const form = $(cfg.form);
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
  out.photo_url = $(cfg.photo).dataset.src || '';
  return out;
}

function setFormData(data, mode = 'create') {
  const cfg = FORMS[mode];
  const form = $(cfg.form);
  FIELDS.forEach((k) => {
    const el = form.elements.namedItem(k);
    if (!el) return;
    // For edit mode we always want to overwrite (including with empty string)
    // For create mode we keep the previous behavior (only fill non-empty)
    if (mode === 'edit') {
      const v = (k in data && data[k] !== null && data[k] !== undefined) ? data[k] : '';
      el.value = v;
    } else if (k in data && data[k] !== null && data[k] !== undefined && data[k] !== '') {
      el.value = data[k];
    }
  });
  const photo = data.photo_url || data.photo;
  if (photo) setPhoto(photo, mode);
  else if (mode === 'edit') clearPhoto(mode);
  updateMarge(mode);
  updateStatutPreview(mode);
}

function updateMarge(mode = 'create') {
  const cfg = FORMS[mode];
  const form = $(cfg.form);
  if (!form) return;
  const achat = Number(form.elements.namedItem('prix_achat')?.value || 0);
  const vente = Number(form.elements.namedItem('prix_vente')?.value || 0);
  const marge = (vente - achat) || 0;
  const el = $(cfg.marge);
  if (!el) return;
  el.textContent = marge.toFixed(2).replace('.', ',') + ' €';
  el.classList.remove('text-emerald-600', 'text-red-600', 'text-slate-500');
  if (marge > 0) el.classList.add('text-emerald-600');
  else if (marge < 0) el.classList.add('text-red-600');
  else el.classList.add('text-slate-500');
}

function updateStatutPreview(mode = 'create') {
  const cfg = FORMS[mode];
  const form = $(cfg.form);
  if (!form) return;
  const qRaw = form.elements.namedItem('quantite')?.value;
  const target = $(cfg.statut);
  if (!target) return;
  if (qRaw === '' || qRaw === null || qRaw === undefined) {
    target.innerHTML = '';
    return;
  }
  const q = Number(qRaw);
  const seuil = 5;
  const s = q <= 0 ? 'rupture' : (q <= seuil ? 'stock_faible' : 'en_stock');
  target.innerHTML = renderStatusBadge(s);
}

function setPhoto(dataUrl, mode = 'create') {
  const cfg = FORMS[mode];
  const img = $(cfg.photo);
  const placeholder = $(cfg.photoPlaceholder);
  img.src = dataUrl;
  img.dataset.src = dataUrl;
  img.classList.remove('hidden');
  placeholder.classList.add('hidden');
  if (cfg.removePhotoBtn) $(cfg.removePhotoBtn).classList.remove('hidden');
}

function clearPhoto(mode = 'create') {
  const cfg = FORMS[mode];
  const img = $(cfg.photo);
  img.src = '';
  img.dataset.src = '';
  img.classList.add('hidden');
  $(cfg.photoPlaceholder).classList.remove('hidden');
  if (cfg.removePhotoBtn) $(cfg.removePhotoBtn).classList.add('hidden');
}

async function clearForm() {
  const form = $('#article-form');
  form.reset();
  clearPhoto('create');
  form.elements.namedItem('quantite_initiale').value = 1;
  form.elements.namedItem('quantite').value = 1;
  delete form.elements.namedItem('quantite').dataset.touched;
  updateMarge('create');
  updateStatutPreview('create');
  // Fetch next num async
  const num = await getNextNumArticle();
  if (num) {
    const el = form.elements.namedItem('numero_article');
    if (el && !el.value) el.value = num;
  }
}

// ---------- Edit modal ----------
function openEditModal(article) {
  if (!article) return;
  editingArticleId = article.id;
  // Populate fields
  setFormData(article, 'edit');
  // Mark qty as 'touched' so we don't auto-overwrite from qty initiale
  const q = $('#edit-form').elements.namedItem('quantite');
  if (q) q.dataset.touched = '1';
  // Update title with numero_article
  $('#edit-modal-num').textContent = article.numero_article || '—';
  // Show modal
  const modal = $('#edit-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.body.style.overflow = 'hidden';
}

function closeEditModal() {
  const modal = $('#edit-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  document.body.style.overflow = '';
  editingArticleId = null;
}

// ---------- Toast ----------
// Returns a handle with `update(msg)` and `dismiss()`.
// Pass duration=0 to keep the toast on screen until dismiss() is called.
function toast(msg, type = 'info', duration = 3600) {
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

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    el.style.transition = 'all 300ms ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    setTimeout(() => el.remove(), 320);
  };
  let timer = null;
  if (duration > 0) timer = setTimeout(dismiss, duration);

  return {
    update(newMsg) { if (!dismissed) el.textContent = newMsg; },
    dismiss() { if (timer) clearTimeout(timer); dismiss(); },
  };
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
    setFormData({ ...analysis, photo_url: dataUrl }, 'create');
    toast('Article analysé avec succès', 'success');
    await closeScanner();
  } catch (e) {
    toast(e.message || 'Erreur d\'analyse', 'error');
    overlay.classList.add('hidden');
    try { await startCamera(video); } catch {}
  }
}

// Upload from disk: convert to data URL, run AI analysis, then prefill the form.
let uploadProcessing = false;
async function handlePhotoUpload(file) {
  if (uploadProcessing) return;
  if (!file) return;
  uploadProcessing = true;
  const btn = $('#btn-upload-photo');
  if (btn) btn.classList.add('opacity-60', 'pointer-events-none');
  const pendingToast = toast('Lecture de la photo…', 'info', 0);
  try {
    const dataUrl = await fileToImageDataUrl(file);
    setPhoto(dataUrl, 'create');
    pendingToast.update?.('Analyse IA en cours…');
    const analysis = await analyzeImage(dataUrl);
    setFormData({ ...analysis, photo_url: dataUrl }, 'create');
    toast('Photo analysée avec succès', 'success');
  } catch (e) {
    toast(e.message || 'Erreur lors de l\'analyse', 'error');
  } finally {
    pendingToast.dismiss?.();
    if (btn) btn.classList.remove('opacity-60', 'pointer-events-none');
    uploadProcessing = false;
  }
}

// Replace photo in the edit modal (no AI, just swap the image).
async function handleEditPhotoUpload(file) {
  if (!file) return;
  const btn = $('#btn-edit-replace-photo');
  if (btn) btn.classList.add('opacity-60', 'pointer-events-none');
  try {
    const dataUrl = await fileToImageDataUrl(file);
    setPhoto(dataUrl, 'edit');
    toast('Photo remplacée', 'success');
  } catch (e) {
    toast(e.message || 'Erreur lors du chargement', 'error');
  } finally {
    if (btn) btn.classList.remove('opacity-60', 'pointer-events-none');
  }
}

let barcodeProcessing = false;
async function onBarcodeDetected(code) {
  if (barcodeProcessing) return;
  barcodeProcessing = true;
  const overlay = $('#scanner-loading');
  const loadingLabel = $('#scanner-loading-label');
  loadingLabel.textContent = `Code détecté: ${code} — recherche dans les bases publiques…`;
  overlay.classList.remove('hidden');
  await stopBarcodeScanner();
  try {
    const { result, source, notice } = await analyzeBarcode(code);
    setFormData({ ...result, code_barres: result.code_barres || code }, 'create');
    const SOURCE_LABELS = {
      openfoodfacts:    'Open Food Facts',
      openbeautyfacts:  'Open Beauty Facts',
      openproductsfacts:'Open Products Facts',
      openpetfoodfacts: 'Open Pet Food Facts',
      openlibrary:      'Open Library',
      upcitemdb:        'UPCitemDB',
    };
    if (source && SOURCE_LABELS[source]) {
      toast(`Produit identifié via ${SOURCE_LABELS[source]} (${code})`, 'success');
    } else {
      // Unknown product or invalid checksum — show the explanatory notice
      // and let the user fill the form by hand. Better than a wrong guess.
      toast(notice || `Code ${code} : produit non identifié — complétez manuellement.`, 'info', 6000);
    }
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
      <td class="px-3 py-2 whitespace-nowrap font-mono text-xs font-semibold text-slate-800">${escapeHtml(a.numero_article || '')}</td>
      <td class="px-3 py-2">${a.photo_url
        ? `<img src="${a.photo_url}" class="h-12 w-12 object-cover rounded-md ring-1 ring-slate-200" alt="" />`
        : '<span class="inline-flex h-12 w-12 items-center justify-center rounded-md bg-slate-100 text-slate-300 text-xs">—</span>'}</td>
      <td class="px-3 py-2"><span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">${escapeHtml(a.categorie || '—')}</span></td>
      <td class="px-3 py-2">${escapeHtml(a.marque || '')}</td>
      <td class="px-3 py-2">${escapeHtml(a.modele || '')}</td>
      <td class="px-3 py-2 max-w-xs"><div class="line-clamp-2 text-slate-600">${escapeHtml(a.description || '')}</div></td>
      <td class="px-3 py-2 text-right tabular-nums">${fmtPrice(a.prix_achat)}</td>
      <td class="px-3 py-2 text-right tabular-nums">${fmtPrice(a.prix_vente)}</td>
      <td class="px-3 py-2 text-right tabular-nums font-semibold ${a.marge > 0 ? 'text-emerald-600' : a.marge < 0 ? 'text-red-600' : 'text-slate-500'}">${fmtPrice(a.marge)}</td>
      <td class="px-3 py-2 font-mono text-xs">${escapeHtml(a.code_barres || '')}</td>
      <td class="px-3 py-2">${escapeHtml(a.couleur || '')}</td>
      <td class="px-3 py-2 font-mono text-xs">${escapeHtml(a.ref_couleur || '')}</td>
      <td class="px-3 py-2 whitespace-nowrap text-xs">${escapeHtml(a.taille || '')}</td>
      <td class="px-3 py-2 whitespace-nowrap text-xs">${escapeHtml(a.taille_canape || '')}</td>
      <td class="px-3 py-2 text-right tabular-nums">${a.quantite_initiale ?? ''}</td>
      <td class="px-3 py-2 text-right tabular-nums font-semibold">${a.quantite ?? ''}</td>
      <td class="px-3 py-2 whitespace-nowrap">${renderStatusBadge(a.statut)}</td>
      <td class="px-3 py-2 text-right whitespace-nowrap">
        <button data-action="edit" data-id="${a.id}" class="text-indigo-600 hover:text-indigo-800 text-xs font-semibold mr-2">Éditer</button>
        <button data-action="delete" data-id="${a.id}" class="text-red-600 hover:text-red-800 text-xs font-semibold">Suppr.</button>
      </td>
    </tr>
  `).join('');
}

// ---------- Wire events ----------
function wireEvents() {
  $('#btn-open-photo').addEventListener('click', () => openScanner('photo'));
  $('#btn-open-barcode').addEventListener('click', () => openScanner('barcode'));
  $('#btn-close-scanner').addEventListener('click', closeScanner);
  $('#btn-capture').addEventListener('click', captureAndAnalyze);
  $('#btn-switch-mode').addEventListener('click', switchMode);

  // Upload photo (create form) — opens OS file picker, then runs AI analysis
  const uploadInput = $('#photo-upload-input');
  $('#btn-upload-photo').addEventListener('click', () => uploadInput.click());
  uploadInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    await handlePhotoUpload(file);
  });

  // Replace photo (edit modal) — opens OS file picker, no AI analysis
  const editUploadInput = $('#edit-photo-upload-input');
  $('#btn-edit-replace-photo').addEventListener('click', () => editUploadInput.click());
  editUploadInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    await handleEditPhotoUpload(file);
  });
  $('#scanner-backdrop').addEventListener('click', closeScanner);

  // Photo click to remove (create form)
  $('#photo-preview').addEventListener('click', () => {
    if ($('#photo-preview').dataset.src) {
      if (confirm('Supprimer la photo ?')) clearPhoto('create');
    }
  });

  // Form
  const form = $('#article-form');

  // Auto-recalc marge when prices change
  form.elements.namedItem('prix_achat').addEventListener('input', () => updateMarge('create'));
  form.elements.namedItem('prix_vente').addEventListener('input', () => updateMarge('create'));

  // Sync quantite_initiale → quantite on create (as long as user hasn't touched quantite)
  const qInit = form.elements.namedItem('quantite_initiale');
  const q = form.elements.namedItem('quantite');
  qInit.addEventListener('input', () => {
    if (!q.dataset.touched) q.value = qInit.value;
    updateStatutPreview('create');
  });
  q.addEventListener('input', () => {
    q.dataset.touched = '1';
    updateStatutPreview('create');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = $('#btn-submit');
    const data = getFormData('create');
    submitBtn.disabled = true;
    submitBtn.classList.add('opacity-60', 'cursor-not-allowed');
    try {
      await createArticle(data);
      toast('Article ajouté à l\'inventaire', 'success');
      await clearForm();
    } catch (err) {
      toast(err.message || 'Erreur lors de l\'enregistrement', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove('opacity-60', 'cursor-not-allowed');
    }
  });

  $('#btn-clear').addEventListener('click', async () => {
    const d = getFormData('create');
    const dirty = d.marque || d.modele || d.description || d.photo_url;
    if (dirty && !confirm('Effacer le formulaire ?')) return;
    await clearForm();
  });

  // Table actions: 'edit' opens the dedicated modal, 'delete' confirms + removes
  $('#inventory-tbody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === 'edit') {
      const article = getState().articles.find((a) => a.id === id);
      if (!article) { toast('Article introuvable', 'error'); return; }
      openEditModal(article);
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

  // ---- Edit modal events ----
  const editForm = $('#edit-form');
  $('#btn-close-edit-modal').addEventListener('click', closeEditModal);
  $('#btn-edit-cancel').addEventListener('click', closeEditModal);
  $('#edit-backdrop').addEventListener('click', closeEditModal);

  // Auto-recalc marge in edit modal
  editForm.elements.namedItem('prix_achat').addEventListener('input', () => updateMarge('edit'));
  editForm.elements.namedItem('prix_vente').addEventListener('input', () => updateMarge('edit'));
  // Auto-recalc statut in edit modal
  editForm.elements.namedItem('quantite').addEventListener('input', () => updateStatutPreview('edit'));
  editForm.elements.namedItem('quantite_initiale').addEventListener('input', () => updateStatutPreview('edit'));

  // Photo preview click in edit modal -> remove photo
  $('#edit-photo-preview').addEventListener('click', () => {
    if ($('#edit-photo-preview').dataset.src && confirm('Retirer la photo ?')) {
      clearPhoto('edit');
    }
  });
  $('#btn-edit-remove-photo').addEventListener('click', () => {
    if (confirm('Retirer la photo ?')) clearPhoto('edit');
  });

  // Submit edit form -> updateArticle
  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editingArticleId) return;
    const saveBtn = $('#btn-edit-save');
    const data = getFormData('edit');
    saveBtn.disabled = true;
    saveBtn.classList.add('opacity-60', 'cursor-not-allowed');
    try {
      await updateArticle(editingArticleId, data);
      toast('Article mis à jour', 'success');
      closeEditModal();
    } catch (err) {
      toast(err.message || 'Erreur de mise à jour', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.classList.remove('opacity-60', 'cursor-not-allowed');
    }
  });

  // Delete from edit modal
  $('#btn-edit-delete').addEventListener('click', async () => {
    if (!editingArticleId) return;
    const num = $('#edit-modal-num').textContent;
    if (!confirm(`Supprimer définitivement l'article ${num} ?`)) return;
    const delBtn = $('#btn-edit-delete');
    delBtn.disabled = true;
    try {
      await deleteArticle(editingArticleId);
      toast('Article supprimé', 'success');
      closeEditModal();
    } catch (err) {
      toast(err.message || 'Erreur de suppression', 'error');
    } finally {
      delBtn.disabled = false;
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

  // Escape to close modals
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#scanner-modal').classList.contains('hidden')) closeScanner();
    if (!$('#edit-modal').classList.contains('hidden')) closeEditModal();
  });
}

// ---------- Boot ----------
async function boot() {
  wireEvents();
  subscribe(renderTable);
  await clearForm();
  await reload();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
