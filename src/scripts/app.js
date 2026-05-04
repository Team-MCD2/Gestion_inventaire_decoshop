// Page-aware wiring. Each section attaches itself only when the matching
// DOM nodes are present, so the same script can be loaded from /ajouter,
// /inventaire and /scan without crashing on missing selectors.
import {
  subscribe, getState, reload,
  createArticle, updateArticle, deleteArticle,
  clearAll, getNextNumArticle, startAutoSync, stopAutoSync
} from './state.js';
import { startCamera, stopCamera, captureFrame, fileToImageDataUrl } from './camera.js';
import { startBarcodeScanner, stopBarcodeScanner } from './barcode.js';
import { analyzeImage, analyzeBarcode } from './gemini.js';
import { downloadCSV } from './csv.js';
import { downloadPDF } from './pdf.js';
import { playScanBeep, unlockAudioOnce } from './sound.js';
import {
  $, escapeHtml, fmtPrice, renderStatusBadge, toast,
} from './ui.js';

// Pré-débloquer le contexte audio à la première interaction utilisateur
// (politique d'autoplay des navigateurs).
unlockAudioOnce();

// ─────────────────────────────────────────────────────────────────────────────
// Field config (MCD schema, cf. mcd_mld.md §2)
// ─────────────────────────────────────────────────────────────────────────────
const TEXT_FIELDS = [
  'numero_article', 'nom_produit', 'categorie', 'marque', 'couleur', 'description',
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
//   - 'fill'   : un code-barres détecté est inséré DANS LE SEUL champ #code_barres
//                du formulaire actif, sans appel à l'API barcode (l'utilisateur a
//                déjà rempli les autres champs via la photo).
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
  // Bip immédiat dès que la caméra a reconnu quelque chose — feedback instantané.
  try { playScanBeep(); } catch {}
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

  // ─── Fill mode (bouton scanner DANS le champ code_barres de /ajouter) ──
  // L'utilisateur a déjà rempli les autres champs via la photo : on ne
  // remplit QUE le champ code_barres et on ne fait AUCUN lookup API.
  if (scannerCallback === 'fill') {
    await stopBarcodeScanner();
    await closeScanner();
    barcodeProcessing = false;
    const input = document.querySelector('#code_barres');
    if (input) {
      input.value = String(code);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.focus();
    }
    toast(`Code-barres scanné : ${code}`, 'success');
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
      toast(notice || 'Données indisponibles', 'info', 6000);
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
      [a.numero_article, a.nom_produit, a.code_barres, a.marque, a.couleur, a.description, a.categorie, a.taille]
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

  // Pendant le chargement, toujours afficher le spinner (pas "inventaire vide")
  if (loading) {
    tbody.innerHTML = '';
    empty?.classList.add('hidden');
    loadingEl?.classList.remove('hidden');
    if (count) count.textContent = '…';
    return;
  }
  loadingEl?.classList.add('hidden');
  if (count) count.textContent = list.length;



  if (!list.length) {
    tbody.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');

  tbody.innerHTML = list.map((a) => `
    <tr class="hover:bg-slate-50 transition cursor-pointer group" data-action="row-edit" data-id="${a.id}">
      <td class="px-3 py-2 whitespace-nowrap font-mono text-xs font-semibold text-slate-400 group-hover:text-indigo-600 transition">${escapeHtml(a.numero_article || '')}</td>
      <td class="px-3 py-2">${a.photo_url
        ? `<img src="${a.photo_url}" class="h-12 w-12 object-cover rounded-md ring-1 ring-slate-200" alt="" />`
        : '<span class="inline-flex h-12 w-12 items-center justify-center rounded-md bg-slate-100 text-slate-300 text-xs">—</span>'}</td>
      <td class="px-3 py-2 max-w-[140px]"><div class="font-bold text-slate-900 text-sm truncate">${escapeHtml(a.nom_produit || '—')}</div></td>
      <td class="px-3 py-2"><span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">${escapeHtml(a.categorie || '—')}</span></td>
      <td class="px-3 py-2 font-medium text-slate-700">${escapeHtml(a.marque || '')}</td>
      <td class="px-3 py-2 text-slate-600">${escapeHtml(a.couleur || '')}</td>
      <td class="px-3 py-2 max-w-xs"><div class="line-clamp-2 text-xs text-slate-500">${escapeHtml(a.description || '')}</div></td>
      <td class="px-3 py-2 text-right tabular-nums font-bold text-slate-900">${fmtPrice(a.prix_vente)}</td>
      <td class="px-3 py-2 font-mono text-xs group relative">
        <div class="flex items-center gap-2">
          <span class="inline-barcode-val" data-id="${a.id}">${escapeHtml(a.code_barres || '—')}</span>
          <button data-action="inline-edit-barcode" data-id="${a.id}" class="hidden md:inline-flex opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-indigo-600 shrink-0 print:hidden" title="Éditer le code-barres rapidement">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
        </div>
      </td>
      <td class="px-3 py-2 whitespace-nowrap text-xs text-slate-500">${escapeHtml(a.taille || '')}</td>
      <td class="px-3 py-2 text-right tabular-nums text-slate-400">${a.quantite_initiale ?? ''}</td>
      <td class="px-3 py-2 text-right tabular-nums font-bold ${a.quantite <= 0 ? 'text-red-600' : 'text-slate-900'}">${a.quantite ?? ''}</td>
      <td class="px-3 py-2 whitespace-nowrap">${renderStatusBadge(a.statut)}</td>
      <td class="px-3 py-2 text-right whitespace-nowrap print:hidden">
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
  // Petit bouton "scanner" intégré au champ code_barres : ne remplit QUE ce
  // champ (utile quand l'utilisateur a déjà filmé l'article et veut juste
  // ajouter le code-barres sans écraser les autres données pré-remplies).
  $('#btn-scan-barcode-field')?.addEventListener('click', () => openScanner('barcode', 'fill'));

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
  let lastAutoNum = '';
  clearForm().then(() => {
    prefillFromQuery();
    const el = form.elements.namedItem('numero_article');
    if (el) lastAutoNum = el.value;

    // Polling auto-update for numero_article to avoid conflicts
    setInterval(async () => {
      const num = await getNextNumArticle();
      if (num && el && el.value === lastAutoNum && num !== lastAutoNum) {
        el.value = num;
        lastAutoNum = num;
      }
    }, 5000);
  });
}

function wireInventoryTable() {
  const tbody = $('#inventory-tbody');
  if (!tbody) return;

  tbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    const row = e.target.closest('tr[data-action="row-edit"]');

    // 1. Si clic sur un bouton d'action
    if (btn) {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      const article = getState().articles.find((a) => a.id === id);
      if (!article) return;

      if (action === 'edit') {
        openEditModal(article);
      } else if (action === 'delete') {
        if (!confirm(`Supprimer définitivement l'article ${article.numero_article} ?`)) return;
        try {
          await deleteArticle(id);
          toast('Article supprimé', 'success');
        } catch (err) {
          toast(err.message, 'error');
        }
      } else if (action === 'inline-edit-barcode') {
        const newCode = prompt(`Modifier le code-barres pour l'article ${article.numero_article} :`, article.code_barres || '');
        if (newCode !== null && newCode.trim() !== (article.code_barres || '')) {
          try {
            await updateArticle(id, { code_barres: newCode.trim() });
            toast('Code-barres mis à jour', 'success');
          } catch (err) {
            toast(err.message || 'Erreur lors de la mise à jour', 'error');
          }
        }
      }
      return; // Stop pour ne pas déclencher l'edit de la ligne
    }

    // 2. Si clic sur la ligne elle-même (en dehors des boutons)
    if (row) {
      const id = row.dataset.id;
      const article = getState().articles.find((a) => a.id === id);
      if (article) openEditModal(article);
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

  // ─── "Vider l'inventaire" : modale de confirmation avec saisie obligatoire ──
  // Action irréversible → on exige que l'utilisateur tape "VIDER" pour activer
  // le bouton de confirmation. Échap, clic backdrop ou Annuler ferme la modale.
  const clearModal       = $('#confirm-clear-modal');
  const clearInput       = $('#confirm-clear-input');
  const clearBtnOk       = $('#btn-confirm-clear-ok');
  const clearBtnCancel   = $('#btn-confirm-clear-cancel');
  const clearBackdrop    = $('#confirm-clear-backdrop');
  const clearCountLabel  = $('#confirm-clear-count');

  function openClearModal() {
    if (!clearModal || !clearInput || !clearBtnOk) return;
    if (clearCountLabel) clearCountLabel.textContent = String(getState().articles.length);
    clearInput.value = '';
    clearBtnOk.disabled = true;
    clearModal.classList.remove('hidden');
    clearModal.classList.add('flex');
    document.body.style.overflow = 'hidden';
    setTimeout(() => clearInput.focus(), 50);
  }

  function closeClearModal() {
    if (!clearModal) return;
    clearModal.classList.add('hidden');
    clearModal.classList.remove('flex');
    document.body.style.overflow = '';
  }

  clearInput?.addEventListener('input', () => {
    if (!clearBtnOk) return;
    clearBtnOk.disabled = clearInput.value.trim().toUpperCase() !== 'VIDER';
  });

  // Enter dans l'input = valider si activé
  clearInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !clearBtnOk?.disabled) {
      e.preventDefault();
      clearBtnOk?.click();
    }
  });

  clearBtnCancel?.addEventListener('click', closeClearModal);
  clearBackdrop?.addEventListener('click', closeClearModal);

  clearBtnOk?.addEventListener('click', async () => {
    if (clearBtnOk.disabled) return;
    clearBtnOk.disabled = true;
    closeClearModal();
    try {
      await clearAll();
      toast('Inventaire vidé');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#btn-clear-all')?.addEventListener('click', () => {
    if (!getState().articles.length) {
      toast('L\'inventaire est déjà vide', 'info');
      return;
    }
    openClearModal();
  });

  // Start real-time sync for the inventory table
  startAutoSync(5000);
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
    const cc = $('#confirm-clear-modal');
    if (cc && !cc.classList.contains('hidden')) {
      cc.classList.add('hidden');
      cc.classList.remove('flex');
      document.body.style.overflow = '';
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Inventory recap — computed from already-loaded state (no extra API call)
// ─────────────────────────────────────────────────────────────────────────────
function fmtDateFr(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(typeof ts === 'number' ? ts : Number(ts));
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch { return '—'; }
}

function fmtCurrency(v) {
  return Number(v).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function renderInventoryRecap() {
  const { articles, loading } = getState();
  if (loading || !articles.length) return; // sera appelé à nouveau après reload

  let totalValue = 0;
  let totalUnits = 0;
  let low = 0;
  let out = 0;
  let minCreated = Infinity;
  let maxCreated = -Infinity;
  let maxUpdated = -Infinity;

  for (const a of articles) {
    const q = Number(a.quantite || 0);
    const p = Number(a.prix_vente || 0);
    const seuil = Number(a.seuil_stock_faible || 5);
    totalValue += p * q;
    totalUnits += q;
    if (q <= 0) out++;
    else if (q <= seuil) low++;

    const cr = Number(a.created_at || 0);
    const up = Number(a.updated_at || 0);
    if (cr && cr < minCreated) minCreated = cr;
    if (cr && cr > maxCreated) maxCreated = cr;
    if (up && up > maxUpdated) maxUpdated = up;
  }

  const setEl = (id, val) => { const el = $(`#${id}`); if (el) el.textContent = val; };
  setEl('recap-value', fmtCurrency(totalValue));
  setEl('recap-units', String(totalUnits));
  setEl('recap-low',   String(low));
  setEl('recap-out',   String(out));
  setEl('recap-date-start',   minCreated === Infinity ? '—' : fmtDateFr(minCreated));
  setEl('recap-date-last',    maxCreated === -Infinity ? '—' : fmtDateFr(maxCreated));
  setEl('recap-date-updated', maxUpdated === -Infinity ? '—' : fmtDateFr(maxUpdated));
}

// Lit les filtres dans l'URL (?status=...) pour pré-filtrer l'inventaire
function handleUrlFilters() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('status');
  if (!status) return;

  const select = $('#inventory-filter-status');
  if (select) {
    select.value = status;
    tableFilter.status = status;
    // On laisse le reload() initial déclencher le premier renderTable()
  }
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
  
  handleUrlFilters();

  // Subscribe to state changes for both table AND recap
  subscribe((s) => {
    renderTable();
    renderInventoryRecap();
  });
  await reload();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
