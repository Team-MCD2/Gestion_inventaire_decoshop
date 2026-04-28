// Page-aware wiring. Each section attaches itself only when the matching
// DOM nodes are present, so the same script can be loaded from /ajouter,
// /inventaire and /scan without crashing on missing selectors.
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
import {
  $, escapeHtml, fmtPrice, renderStatusBadge, toast,
} from './ui.js';

// ─────────────────────────────────────────────────────────────────────────────
// Field config (MCD schema, cf. mcd_mld.md §2)
// ─────────────────────────────────────────────────────────────────────────────
const TEXT_FIELDS = [
  'numero_article', 'categorie', 'marque', 'couleur', 'description',
  'code_barres', 'taille',
];
const NUMBER_FIELDS = ['prix_vente', 'quantite_initiale', 'quantite'];
const FIELDS = [...TEXT_FIELDS, ...NUMBER_FIELDS];

const FORMS = {
  create: {
    form: '#article-form',
    photo: '#photo-preview',
    photoPlaceholder: '#photo-placeholder',
    statut: '#statut-preview',
    removePhotoBtn: null,
  },
  edit: {
    form: '#edit-form',
    photo: '#edit-photo-preview',
    photoPlaceholder: '#edit-photo-placeholder',
    statut: '#edit-statut-preview',
    removePhotoBtn: '#btn-edit-remove-photo',
  },
};

let scannerMode = 'photo';
let editingArticleId = null;

// ─────────────────────────────────────────────────────────────────────────────
// Form helpers (work for both create + edit modes)
// ─────────────────────────────────────────────────────────────────────────────
function getFormData(mode = 'create') {
  const cfg = FORMS[mode];
  const form = $(cfg.form);
  if (!form) return {};
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
  const photo = $(cfg.photo);
  out.photo_url = photo?.dataset.src || '';
  return out;
}

function setFormData(data, mode = 'create') {
  const cfg = FORMS[mode];
  const form = $(cfg.form);
  if (!form) return;
  FIELDS.forEach((k) => {
    const el = form.elements.namedItem(k);
    if (!el) return;
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
  updateStatutPreview(mode);
}

function updateStatutPreview(mode = 'create') {
  const cfg = FORMS[mode];
  const form = $(cfg.form);
  if (!form) return;
  const target = $(cfg.statut);
  if (!target) return;
  const qRaw = form.elements.namedItem('quantite')?.value;
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
  if (!img || !placeholder) return;
  img.src = dataUrl;
  img.dataset.src = dataUrl;
  img.classList.remove('hidden');
  placeholder.classList.add('hidden');
  if (cfg.removePhotoBtn) {
    const btn = $(cfg.removePhotoBtn);
    if (btn) btn.classList.remove('hidden');
  }
}

function clearPhoto(mode = 'create') {
  const cfg = FORMS[mode];
  const img = $(cfg.photo);
  const placeholder = $(cfg.photoPlaceholder);
  if (!img || !placeholder) return;
  img.src = '';
  img.dataset.src = '';
  img.classList.add('hidden');
  placeholder.classList.remove('hidden');
  if (cfg.removePhotoBtn) {
    const btn = $(cfg.removePhotoBtn);
    if (btn) btn.classList.add('hidden');
  }
}

async function clearForm() {
  const form = $('#article-form');
  if (!form) return;
  form.reset();
  clearPhoto('create');
  const qInit = form.elements.namedItem('quantite_initiale');
  const q     = form.elements.namedItem('quantite');
  if (qInit) qInit.value = 1;
  if (q)     q.value = 1;
  if (q)     delete q.dataset.touched;
  updateStatutPreview('create');
  const num = await getNextNumArticle();
  if (num) {
    const el = form.elements.namedItem('numero_article');
    if (el && !el.value) el.value = num;
  }
}

// Pré-remplit le formulaire à partir des query params (?code_barres=...&from=scan).
// Utilisé pour le flux : /scan → article inconnu → "Oui, ajouter" → /ajouter?code_barres=XXX
function prefillFromQuery() {
  const form = $('#article-form');
  if (!form) return;
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code_barres');
  const fromScan = params.get('from') === 'scan';

  if (code) {
    const el = form.elements.namedItem('code_barres');
    if (el) el.value = code;
  }

  if (fromScan) {
    // Toast d'orientation : on indique clairement la suite à faire
    const msg = code
      ? `Code-barres ${code} prérempli. Filmez ou importez la photo, puis enregistrez.`
      : `Filmez ou importez la photo de l'article, puis enregistrez.`;
    toast(msg, 'info', 6000);
    // Met le focus sur le bouton "Filmer l'article" pour guider visuellement
    setTimeout(() => $('#btn-open-photo')?.focus(), 200);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit modal — exposed globally so /scan can open it from outside
// ─────────────────────────────────────────────────────────────────────────────
function openEditModal(article) {
  if (!article) return;
  const modal = $('#edit-modal');
  if (!modal) return;
  editingArticleId = article.id;
  setFormData(article, 'edit');
  const q = $('#edit-form')?.elements.namedItem('quantite');
  if (q) q.dataset.touched = '1';
  const num = $('#edit-modal-num');
  if (num) num.textContent = article.numero_article || '—';
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.body.style.overflow = 'hidden';
}

function closeEditModal() {
  const modal = $('#edit-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  document.body.style.overflow = '';
  editingArticleId = null;
}

// Public API for other scripts (scan.js notably)
window.__decoshop = window.__decoshop || {};
window.__decoshop.openEditModal = openEditModal;
window.__decoshop.closeEditModal = closeEditModal;

// ─────────────────────────────────────────────────────────────────────────────
// Scanner (camera + barcode) — used by /ajouter (create) AND /scan (search)
// ─────────────────────────────────────────────────────────────────────────────
// scanCallback :
//   - 'create' (default) : capture/analyse remplit le formulaire #article-form
//   - 'search' : un code-barres détecté déclenche window.__decoshop.onScanFound(code)
let scannerCallback = 'create';

async function openScanner(mode, callback = 'create') {
  scannerMode = mode;
  scannerCallback = callback;
  const modal = $('#scanner-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.body.style.overflow = 'hidden';
  updateScannerUI();
  const video = $('#scanner-video');
  try {
    if (mode === 'photo') await startCamera(video);
    else                  await startBarcodeScanner(video, onBarcodeDetected);
  } catch (e) {
    toast(e.message || 'Erreur caméra', 'error');
    await closeScanner();
  }
}

function updateScannerUI() {
  const isPhoto = scannerMode === 'photo';
  const label   = $('#scanner-mode-label');
  const status  = $('#scanner-status');
  const capture = $('#btn-capture');
  const frame   = $('#barcode-frame');
  const switchBtn = $('#btn-switch-mode');
  if (label)  label.textContent = isPhoto ? 'Capture photo' : 'Scan code-barres';
  if (status) status.textContent = isPhoto
    ? 'Cadrez l\'article, puis appuyez sur Capturer'
    : 'Pointez la caméra vers le code-barres';
  if (capture)   capture.classList.toggle('hidden', !isPhoto);
  if (frame)     frame.classList.toggle('hidden', isPhoto);
  if (switchBtn) switchBtn.textContent = isPhoto ? 'Passer en mode Code-barres' : 'Passer en mode Photo';
  // In search mode we don't expose photo capture (it has no analyze workflow yet)
  if (scannerCallback === 'search' && switchBtn) switchBtn.classList.add('hidden');
  else if (switchBtn) switchBtn.classList.remove('hidden');
}

async function closeScanner() {
  const modal = $('#scanner-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  $('#scanner-loading')?.classList.add('hidden');
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
    else                  await startBarcodeScanner(video, onBarcodeDetected);
  } catch (e) {
    toast(e.message || 'Erreur caméra', 'error');
  }
}

async function captureAndAnalyze() {
  const video = $('#scanner-video');
  const overlay = $('#scanner-loading');
  const loadingLabel = $('#scanner-loading-label');
  if (!video || !overlay) return;
  try {
    if (loadingLabel) loadingLabel.textContent = 'Capture en cours…';
    overlay.classList.remove('hidden');
    const dataUrl = captureFrame(video);
    await stopCamera();
    if (loadingLabel) loadingLabel.textContent = 'Analyse IA en cours…';
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

let uploadProcessing = false;
async function handlePhotoUpload(file) {
  if (uploadProcessing || !file) return;
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

  // ─── Search mode (called from /scan) ────────────────────────────────────
  // We DON'T hit external barcode databases. We just close the scanner and
  // delegate the lookup to /scan's own JS (which queries our Supabase DB).
  if (scannerCallback === 'search') {
    await stopBarcodeScanner();
    await closeScanner();
    barcodeProcessing = false;
    if (typeof window.__decoshop?.onScanFound === 'function') {
      window.__decoshop.onScanFound(code);
    }
    return;
  }

  // ─── Create mode (called from /ajouter) ─────────────────────────────────
  if (loadingLabel) loadingLabel.textContent = `Code détecté: ${code} — recherche…`;
  overlay?.classList.remove('hidden');
  await stopBarcodeScanner();
  try {
    const { result, source, confidence, notice } = await analyzeBarcode(code);
    setFormData({ ...result, code_barres: result.code_barres || code }, 'create');
    const SOURCE_LABELS = {
      openfoodfacts: 'Open Food Facts', openbeautyfacts: 'Open Beauty Facts',
      openproductsfacts: 'Open Products Facts', openpetfoodfacts: 'Open Pet Food Facts',
      openlibrary: 'Open Library', upcitemdb: 'UPCitemDB',
    };
    const LLM_LABELS = { gemini: 'Gemini', groq: 'Groq Llama', mistral: 'Mistral' };
    if (confidence === 'high' && source && SOURCE_LABELS[source]) {
      toast(`Produit identifié via ${SOURCE_LABELS[source]} (${code})`, 'success');
    } else if (confidence === 'low' && typeof source === 'string' && source.startsWith('llm:')) {
      const provider = source.slice(4);
      toast(`⚠ Suggestion IA (${LLM_LABELS[provider] || provider}) pour ${code} — vérifiez avant validation.`, 'warning', 8000);
    } else {
      toast(notice || `Code ${code} : produit non identifié — complétez manuellement.`, 'info', 6000);
    }
    await closeScanner();
  } catch (e) {
    toast(e.message || 'Erreur analyse code-barres', 'error');
    overlay?.classList.add('hidden');
    try { await startBarcodeScanner($('#scanner-video'), onBarcodeDetected); } catch {}
  } finally {
    barcodeProcessing = false;
  }
}

// Expose the scanner opener so /scan can request a barcode-only lookup.
window.__decoshop.openScanner = openScanner;

// ─────────────────────────────────────────────────────────────────────────────
// Inventory table (used by /inventaire only)
// ─────────────────────────────────────────────────────────────────────────────
let tableFilter = { search: '', status: '' };

function filteredArticles() {
  const { articles } = getState();
  const { search, status } = tableFilter;
  let list = articles;
  if (status) list = list.filter((a) => a.statut === status);
  if (search) {
    const q = search.toLowerCase();
    list = list.filter((a) =>
      [a.numero_article, a.code_barres, a.marque, a.couleur, a.description, a.categorie, a.taille]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }
  return list;
}

function renderTable() {
  const tbody = $('#inventory-tbody');
  if (!tbody) return; // page n'a pas le tableau (par ex /ajouter)
  const { loading } = getState();
  const list = filteredArticles();
  const empty = $('#inventory-empty');
  const loadingEl = $('#inventory-loading');
  const count = $('#inventory-count');
  if (count) count.textContent = list.length;

  if (loading && !getState().articles.length) {
    tbody.innerHTML = '';
    empty?.classList.add('hidden');
    loadingEl?.classList.remove('hidden');
    return;
  }
  loadingEl?.classList.add('hidden');

  if (!list.length) {
    tbody.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');

  tbody.innerHTML = list.map((a) => `
    <tr class="hover:bg-slate-50 transition" data-id="${a.id}">
      <td class="px-3 py-2 whitespace-nowrap font-mono text-xs font-semibold text-slate-800">${escapeHtml(a.numero_article || '')}</td>
      <td class="px-3 py-2">${a.photo_url
        ? `<img src="${a.photo_url}" class="h-12 w-12 object-cover rounded-md ring-1 ring-slate-200" alt="" />`
        : '<span class="inline-flex h-12 w-12 items-center justify-center rounded-md bg-slate-100 text-slate-300 text-xs">—</span>'}</td>
      <td class="px-3 py-2"><span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">${escapeHtml(a.categorie || '—')}</span></td>
      <td class="px-3 py-2">${escapeHtml(a.marque || '')}</td>
      <td class="px-3 py-2">${escapeHtml(a.couleur || '')}</td>
      <td class="px-3 py-2 max-w-xs"><div class="line-clamp-2 text-slate-600">${escapeHtml(a.description || '')}</div></td>
      <td class="px-3 py-2 text-right tabular-nums">${fmtPrice(a.prix_vente)}</td>
      <td class="px-3 py-2 font-mono text-xs">${escapeHtml(a.code_barres || '')}</td>
      <td class="px-3 py-2 whitespace-nowrap text-xs">${escapeHtml(a.taille || '')}</td>
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

// ─────────────────────────────────────────────────────────────────────────────
// Wiring (defensive — each block checks for its anchors)
// ─────────────────────────────────────────────────────────────────────────────
function wireScannerModal() {
  if (!$('#scanner-modal')) return;
  $('#btn-close-scanner')?.addEventListener('click', closeScanner);
  $('#btn-capture')?.addEventListener('click', captureAndAnalyze);
  $('#btn-switch-mode')?.addEventListener('click', switchMode);
  $('#scanner-backdrop')?.addEventListener('click', closeScanner);
}

function wireCreateForm() {
  const form = $('#article-form');
  if (!form) return;

  $('#btn-open-photo')?.addEventListener('click', () => openScanner('photo', 'create'));
  $('#btn-open-barcode')?.addEventListener('click', () => openScanner('barcode', 'create'));

  const uploadInput = $('#photo-upload-input');
  if (uploadInput) {
    $('#btn-upload-photo')?.addEventListener('click', () => uploadInput.click());
    uploadInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      await handlePhotoUpload(file);
    });
  }

  $('#photo-preview')?.addEventListener('click', () => {
    const img = $('#photo-preview');
    if (img.dataset.src && confirm('Supprimer la photo ?')) clearPhoto('create');
  });

  const qInit = form.elements.namedItem('quantite_initiale');
  const q     = form.elements.namedItem('quantite');
  qInit?.addEventListener('input', () => {
    if (q && !q.dataset.touched) q.value = qInit.value;
    updateStatutPreview('create');
  });
  q?.addEventListener('input', () => {
    if (q) q.dataset.touched = '1';
    updateStatutPreview('create');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = $('#btn-submit');
    const data = getFormData('create');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.classList.add('opacity-60', 'cursor-not-allowed');
    }
    try {
      await createArticle(data);
      toast('Article ajouté à l\'inventaire', 'success');
      // Petit délai pour que le toast soit lisible avant la redirection
      setTimeout(() => { window.location.href = '/inventaire'; }, 700);
    } catch (err) {
      toast(err.message || 'Erreur lors de l\'enregistrement', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-60', 'cursor-not-allowed');
      }
    }
  });

  $('#btn-clear')?.addEventListener('click', async () => {
    const d = getFormData('create');
    const dirty = d.marque || d.couleur || d.description || d.photo_url;
    if (dirty && !confirm('Effacer le formulaire ?')) return;
    await clearForm();
  });

  // Initial fill on page load — d'abord le N° auto, puis le code-barres venant
  // d'un éventuel ?code_barres=... (flux /scan → /ajouter).
  clearForm().then(() => prefillFromQuery());
}

function wireInventoryTable() {
  const tbody = $('#inventory-tbody');
  if (!tbody) return;

  tbody.addEventListener('click', async (e) => {
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

  // Search + filter
  $('#inventory-search')?.addEventListener('input', (e) => {
    tableFilter.search = String(e.target.value || '').trim();
    renderTable();
  });
  $('#inventory-filter-status')?.addEventListener('change', (e) => {
    tableFilter.status = String(e.target.value || '');
    renderTable();
  });

  // Exports
  $('#btn-export-csv')?.addEventListener('click', () => {
    const articles = filteredArticles();
    if (!articles.length) { toast('Aucun article à exporter', 'error'); return; }
    downloadCSV(articles);
    toast('Export CSV téléchargé', 'success');
  });

  $('#btn-export-pdf')?.addEventListener('click', () => {
    const articles = filteredArticles();
    if (!articles.length) { toast('Aucun article à exporter', 'error'); return; }
    try {
      downloadPDF(articles);
      toast('Export PDF téléchargé', 'success');
    } catch (err) {
      toast(err.message || 'Erreur export PDF', 'error');
    }
  });

  $('#btn-clear-all')?.addEventListener('click', async () => {
    if (!getState().articles.length) return;
    if (!confirm('Supprimer TOUT l\'inventaire ? Cette action est irréversible.')) return;
    try {
      await clearAll();
      toast('Inventaire vidé');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function wireEditModal() {
  const editForm = $('#edit-form');
  if (!editForm) return;

  $('#btn-close-edit-modal')?.addEventListener('click', closeEditModal);
  $('#btn-edit-cancel')?.addEventListener('click', closeEditModal);
  $('#edit-backdrop')?.addEventListener('click', closeEditModal);

  editForm.elements.namedItem('quantite')?.addEventListener('input', () => updateStatutPreview('edit'));
  editForm.elements.namedItem('quantite_initiale')?.addEventListener('input', () => updateStatutPreview('edit'));

  const editUploadInput = $('#edit-photo-upload-input');
  if (editUploadInput) {
    $('#btn-edit-replace-photo')?.addEventListener('click', () => editUploadInput.click());
    editUploadInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      await handleEditPhotoUpload(file);
    });
  }

  $('#edit-photo-preview')?.addEventListener('click', () => {
    if ($('#edit-photo-preview').dataset.src && confirm('Retirer la photo ?')) clearPhoto('edit');
  });
  $('#btn-edit-remove-photo')?.addEventListener('click', () => {
    if (confirm('Retirer la photo ?')) clearPhoto('edit');
  });

  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editingArticleId) return;
    const saveBtn = $('#btn-edit-save');
    const data = getFormData('edit');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.classList.add('opacity-60', 'cursor-not-allowed');
    }
    try {
      await updateArticle(editingArticleId, data);
      toast('Article mis à jour', 'success');
      closeEditModal();
      // Notify scan page (if active) so it refreshes its currently-shown card
      if (typeof window.__decoshop?.onArticleUpdated === 'function') {
        window.__decoshop.onArticleUpdated(editingArticleId);
      }
    } catch (err) {
      toast(err.message || 'Erreur de mise à jour', 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.classList.remove('opacity-60', 'cursor-not-allowed');
      }
    }
  });

  $('#btn-edit-delete')?.addEventListener('click', async () => {
    if (!editingArticleId) return;
    const num = $('#edit-modal-num')?.textContent || '';
    if (!confirm(`Supprimer définitivement l'article ${num} ?`)) return;
    const delBtn = $('#btn-edit-delete');
    if (delBtn) delBtn.disabled = true;
    try {
      await deleteArticle(editingArticleId);
      toast('Article supprimé', 'success');
      closeEditModal();
    } catch (err) {
      toast(err.message || 'Erreur de suppression', 'error');
    } finally {
      if (delBtn) delBtn.disabled = false;
    }
  });
}

function wireGlobalKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#scanner-modal')?.classList.contains('hidden')) closeScanner();
    if (!$('#edit-modal')?.classList.contains('hidden'))    closeEditModal();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────
async function boot() {
  wireScannerModal();
  wireCreateForm();
  wireInventoryTable();
  wireEditModal();
  wireGlobalKeyboard();

  // Only fetch the inventory list when the page actually needs it.
  // /ajouter doesn't render the table but uses createArticle / nextNumArticle,
  // so we still subscribe — it's cheap (one fetch) and helps prefill the next num.
  subscribe(renderTable);
  await reload();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
