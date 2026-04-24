/* ===========================================================================
 * app.js — Logique principale : caméra, scan, formulaire, tableau
 * ========================================================================= */

(() => {

    // ---------- State -------------------------------------------------------
    const state = {
        stream:       null,    // MediaStream caméra
        facingMode:   'environment',
        cameraTarget: 'capture', // 'capture' (analyse IA) | ...
        barcodeScanner: null,
        currentPhotoDataUrl: '',
        editing: null          // item en cours d'édition
    };

    // ---------- DOM helpers -------------------------------------------------
    const $  = sel => document.querySelector(sel);
    const $$ = sel => document.querySelectorAll(sel);

    function showModal(el)  { el.classList.remove('hidden'); el.classList.add('flex', 'modal-enter'); }
    function hideModal(el)  { el.classList.add('hidden');    el.classList.remove('flex', 'modal-enter'); }

    function toast(msg, duration = 2500) {
        const t = $('#toast');
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(toast._t);
        toast._t = setTimeout(() => t.classList.remove('show'), duration);
    }

    // ---------- Camera ------------------------------------------------------
    async function openCamera() {
        showModal($('#cameraModal'));
        await startStream();
    }

    async function startStream() {
        stopStream();
        try {
            state.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: state.facingMode },
                    width:  { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: false
            });
            const video = $('#cameraVideo');
            video.srcObject = state.stream;
            await video.play().catch(() => {});
        } catch (err) {
            console.error('Camera error:', err);
            toast('Impossible d\'accéder à la caméra : ' + err.message, 4000);
            closeCamera();
        }
    }

    function stopStream() {
        if (state.stream) {
            state.stream.getTracks().forEach(t => t.stop());
            state.stream = null;
        }
        const video = $('#cameraVideo');
        if (video) video.srcObject = null;
    }

    function closeCamera() {
        stopStream();
        hideModal($('#cameraModal'));
    }

    async function switchCamera() {
        state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
        await startStream();
    }

    function captureFrame() {
        const video = $('#cameraVideo');
        if (!video.videoWidth) { toast('Caméra pas encore prête'); return null; }

        const canvas = $('#cameraCanvas');
        const maxW = 1280;
        const ratio = Math.min(1, maxW / video.videoWidth);
        canvas.width  = Math.round(video.videoWidth  * ratio);
        canvas.height = Math.round(video.videoHeight * ratio);

        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.85);
    }

    async function handleCapture() {
        const dataUrl = captureFrame();
        if (!dataUrl) return;
        closeCamera();
        state.currentPhotoDataUrl = dataUrl;

        if (state.cameraTarget === 'reanalyze' && state.editing) {
            // Ré-analyse d'un item existant
            state.editing.photo = dataUrl;
            openForm(state.editing, { analyzeWith: dataUrl });
        } else {
            openForm(null, { analyzeWith: dataUrl });
        }
    }

    function handleFileUpload(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            closeCamera();
            state.currentPhotoDataUrl = reader.result;
            openForm(null, { analyzeWith: reader.result });
        };
        reader.readAsDataURL(file);
    }

    // ---------- Barcode scanner --------------------------------------------
    async function openBarcodeScanner() {
        showModal($('#barcodeModal'));
        $('#barcodeStatus').textContent = '';

        // Petit délai pour que le DOM soit prêt
        setTimeout(async () => {
            try {
                if (!window.Html5Qrcode) throw new Error('Librairie html5-qrcode non chargée');

                const formats = (typeof Html5QrcodeSupportedFormats !== 'undefined') ? [
                    Html5QrcodeSupportedFormats.EAN_13,
                    Html5QrcodeSupportedFormats.EAN_8,
                    Html5QrcodeSupportedFormats.UPC_A,
                    Html5QrcodeSupportedFormats.UPC_E,
                    Html5QrcodeSupportedFormats.CODE_128,
                    Html5QrcodeSupportedFormats.CODE_39,
                    Html5QrcodeSupportedFormats.CODE_93,
                    Html5QrcodeSupportedFormats.ITF,
                    Html5QrcodeSupportedFormats.QR_CODE,
                    Html5QrcodeSupportedFormats.DATA_MATRIX
                ] : undefined;

                state.barcodeScanner = new Html5Qrcode('barcodeReader', {
                    verbose: false,
                    formatsToSupport: formats,
                    useBarCodeDetectorIfSupported: true
                });

                const config = {
                    fps: 10,
                    qrbox: (w, h) => {
                        const side = Math.floor(Math.min(w, h) * 0.75);
                        return { width: side, height: Math.floor(side * 0.5) };
                    },
                    aspectRatio: window.innerWidth < window.innerHeight ? 1.0 : 1.777
                };

                await state.barcodeScanner.start(
                    { facingMode: 'environment' },
                    config,
                    (decodedText) => handleBarcodeDetected(decodedText),
                    () => {} // erreur silencieuse par frame
                );
            } catch (err) {
                console.error('Barcode error:', err);
                toast('Erreur scanner : ' + err.message, 4000);
                closeBarcodeScanner();
            }
        }, 100);
    }

    async function closeBarcodeScanner() {
        if (state.barcodeScanner) {
            try {
                if (state.barcodeScanner.isScanning) {
                    await state.barcodeScanner.stop();
                }
                await state.barcodeScanner.clear();
            } catch {}
            state.barcodeScanner = null;
        }
        hideModal($('#barcodeModal'));
    }

    let lastBarcode = null;
    let lastBarcodeTime = 0;

    async function handleBarcodeDetected(code) {
        const now = Date.now();
        // Anti-doublon
        if (code === lastBarcode && now - lastBarcodeTime < 3000) return;
        lastBarcode = code;
        lastBarcodeTime = now;

        $('#barcodeStatus').textContent = `Code détecté : ${code} — recherche…`;
        await closeBarcodeScanner();

        // Ouvre formulaire vide puis lance la recherche
        openForm(null, { barcode: code });
    }

    // ---------- Form --------------------------------------------------------
    function openForm(item, opts = {}) {
        state.editing = item || {
            id: Storage.generateId(),
            numArticle: Storage.nextArticleNumber(),
            dateAjout: new Date().toISOString()
        };
        state.currentPhotoDataUrl = state.editing.photo || opts.analyzeWith || '';

        // Remplir les champs
        fillForm(state.editing);

        $('#formTitle').textContent = item ? 'Modifier l\'article' : 'Nouvel article';
        showModal($('#formModal'));

        // Analyse IA si photo fournie
        if (opts.analyzeWith) {
            runAiAnalysis(opts.analyzeWith, opts.barcode);
        } else if (opts.barcode) {
            runBarcodeLookup(opts.barcode);
        }
    }

    function fillForm(item) {
        $('#f_id').value             = item.id || '';
        $('#f_numArticle').value     = item.numArticle || '';
        $('#f_marque').value          = item.marque || '';
        $('#f_modele').value          = item.modele || '';
        $('#f_description').value     = item.description || '';
        $('#f_categorie').value       = item.categorie || '';
        $('#f_quantite').value        = item.quantite ?? 1;
        $('#f_numSerie').value        = item.numSerie || '';
        $('#f_emplacement').value     = item.emplacement || '';
        $('#f_prix').value             = item.prix ?? '';
        $('#f_valeurActuelle').value  = item.valeurActuelle ?? '';
        $('#f_fournisseur').value     = item.fournisseur || '';

        updatePhotoPreview(item.photo || state.currentPhotoDataUrl);
    }

    function updatePhotoPreview(dataUrl) {
        const img = $('#f_photoPreview');
        const ph  = $('#f_photoPlaceholder');
        if (dataUrl) {
            img.src = dataUrl;
            img.classList.remove('hidden');
            ph.classList.add('hidden');
            $('#btnReanalyze').classList.remove('hidden');
        } else {
            img.classList.add('hidden');
            ph.classList.remove('hidden');
            $('#btnReanalyze').classList.add('hidden');
        }
    }

    function readForm() {
        return {
            id:             $('#f_id').value || Storage.generateId(),
            numArticle:     $('#f_numArticle').value.trim(),
            photo:          state.currentPhotoDataUrl,
            marque:         $('#f_marque').value.trim(),
            modele:         $('#f_modele').value.trim(),
            description:    $('#f_description').value.trim(),
            categorie:      $('#f_categorie').value.trim(),
            quantite:       parseInt($('#f_quantite').value || '1', 10),
            numSerie:       $('#f_numSerie').value.trim(),
            emplacement:    $('#f_emplacement').value.trim(),
            prix:           parseFloat($('#f_prix').value || '0') || 0,
            valeurActuelle: parseFloat($('#f_valeurActuelle').value || '0') || 0,
            fournisseur:    $('#f_fournisseur').value.trim(),
            dateAjout:      state.editing?.dateAjout || new Date().toISOString()
        };
    }

    function closeForm() {
        hideModal($('#formModal'));
        state.editing = null;
        state.currentPhotoDataUrl = '';
    }

    function saveForm() {
        const item = readForm();
        if (!item.numArticle) {
            toast('Numéro d\'article obligatoire');
            return;
        }
        Storage.upsertItem(item);
        closeForm();
        renderInventory();
        toast('Article enregistré ✓');
    }

    // ---------- AI Analysis -------------------------------------------------
    async function runAiAnalysis(dataUrl, barcodeHint = '') {
        const settings = Storage.getSettings();
        const loader   = $('#aiLoading');
        const loaderTx = $('#aiLoadingText');

        if (!settings.apiKey) {
            toast('Configurez votre clé API Gemini dans les paramètres ⚙️', 4000);
            return;
        }

        loader.classList.remove('hidden');
        loaderTx.textContent = barcodeHint
            ? `Analyse IA (+ code-barres ${barcodeHint})…`
            : 'Analyse IA de l\'image en cours…';

        try {
            const result = await AI.analyzeImage(dataUrl, settings, barcodeHint);
            applyAiResult(result);
            toast('Champs remplis par l\'IA ✓');
        } catch (err) {
            console.error(err);
            toast(err.message || 'Erreur analyse IA', 4000);
        } finally {
            loader.classList.add('hidden');
        }
    }

    async function runBarcodeLookup(barcode) {
        const settings = Storage.getSettings();
        const loader   = $('#aiLoading');
        const loaderTx = $('#aiLoadingText');

        loader.classList.remove('hidden');
        loaderTx.textContent = `Recherche du code-barres ${barcode}…`;

        try {
            const result = await AI.lookupBarcode(barcode, settings);

            // Si une photo distante est trouvée → l'enregistrer en Data URL
            if (result.photo && result.photo.startsWith('http')) {
                const dataUrl = await AI.urlToDataUrl(result.photo);
                if (dataUrl) {
                    state.currentPhotoDataUrl = dataUrl;
                    updatePhotoPreview(dataUrl);
                }
            }

            applyAiResult(result);
            toast('Produit trouvé ✓');
        } catch (err) {
            console.error(err);
            toast('Recherche échouée : ' + (err.message || 'inconnue'), 4000);
            // Au minimum, on met le code-barres dans numéro de série
            if (!$('#f_numSerie').value) $('#f_numSerie').value = barcode;
        } finally {
            loader.classList.add('hidden');
        }
    }

    function applyAiResult(r) {
        if (!r) return;
        const setIfEmpty = (id, val) => {
            if (val === undefined || val === null || val === '') return;
            const el = $(id);
            if (!el.value || el.value === '0') el.value = val;
        };
        setIfEmpty('#f_marque',         r.marque);
        setIfEmpty('#f_modele',         r.modele);
        setIfEmpty('#f_description',    r.description);
        setIfEmpty('#f_categorie',      r.categorie);
        setIfEmpty('#f_numSerie',       r.numSerie);
        setIfEmpty('#f_prix',           r.prixEstime);
        setIfEmpty('#f_valeurActuelle', r.valeurActuelle);
        setIfEmpty('#f_fournisseur',    r.fournisseur);
    }

    // ---------- Inventory table --------------------------------------------
    function renderInventory() {
        const q = $('#searchInput').value.trim().toLowerCase();
        const all = Storage.getItems();
        const items = q
            ? all.filter(i => JSON.stringify(i).toLowerCase().includes(q))
            : all;

        const tbody = $('#inventoryBody');
        tbody.innerHTML = '';

        if (items.length === 0) {
            $('#emptyState').classList.remove('hidden');
            tbody.parentElement.classList.add('hidden');
        } else {
            $('#emptyState').classList.add('hidden');
            tbody.parentElement.classList.remove('hidden');

            // Helper : génère une cellule éditable inline
            const cell = (field, value, type = 'text', extraClass = '') => {
                const display = (value === null || value === undefined) ? '' : String(value);
                return `<td class="px-3 py-2 cell-edit ${extraClass}"
                            contenteditable="true"
                            spellcheck="false"
                            data-field="${field}"
                            data-type="${type}"
                            title="Clique pour modifier">${escapeHtml(display)}</td>`;
            };

            items.forEach(item => {
                const tr = document.createElement('tr');
                tr.dataset.id = item.id;
                tr.innerHTML = `
                    ${cell('numArticle', item.numArticle, 'text', 'font-mono text-xs')}
                    <td class="px-3 py-2">
                        ${item.photo
                            ? `<img src="${item.photo}" class="thumb" alt="">`
                            : `<div class="thumb flex items-center justify-center text-slate-300 text-xs">—</div>`}
                    </td>
                    ${cell('marque', item.marque, 'text', 'font-medium')}
                    ${cell('modele', item.modele)}
                    ${cell('description', item.description, 'text', 'max-w-xs')}
                    ${cell('categorie', item.categorie, 'text', 'cell-badge')}
                    ${cell('quantite', item.quantite ?? 1, 'number', 'text-center')}
                    ${cell('numSerie', item.numSerie, 'text', 'font-mono text-xs')}
                    ${cell('emplacement', item.emplacement)}
                    ${cell('prix', item.prix || '', 'number', 'cell-money')}
                    ${cell('valeurActuelle', item.valeurActuelle || '', 'number', 'cell-money')}
                    ${cell('fournisseur', item.fournisseur)}
                    <td class="px-3 py-2">
                        <div class="flex gap-1">
                            <button class="p-1.5 hover:bg-blue-100 rounded text-blue-600" data-edit="${item.id}" title="Édition complète (photo, etc.)">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                            </button>
                            <button class="p-1.5 hover:bg-red-100 rounded text-red-600" data-del="${item.id}" title="Supprimer">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3"/></svg>
                            </button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            // ----- Édition inline : brancher chaque cellule -----
            tbody.querySelectorAll('.cell-edit').forEach(td => {
                td.addEventListener('focus', () => {
                    td.dataset.original = td.textContent;
                    td.classList.add('editing');
                });
                td.addEventListener('blur', () => saveCellEdit(td));
                td.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        td.blur();
                    } else if (e.key === 'Escape') {
                        td.textContent = td.dataset.original || '';
                        td.blur();
                    } else if (e.key === 'Tab') {
                        // Laisser le tab naviguer vers la cellule suivante
                    }
                });
                // Empêcher le paste de coller du HTML (garder uniquement du texte)
                td.addEventListener('paste', (e) => {
                    e.preventDefault();
                    const text = (e.clipboardData || window.clipboardData).getData('text');
                    document.execCommand('insertText', false, text);
                });
            });

            // Bouton "édition complète" (ouvre la modal, utile pour changer la photo)
            tbody.querySelectorAll('[data-edit]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.edit;
                    const it = Storage.getItems().find(i => i.id === id);
                    if (it) openForm(it);
                });
            });
            // Suppression
            tbody.querySelectorAll('[data-del]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm('Supprimer cet article ?')) {
                        Storage.deleteItem(btn.dataset.del);
                        renderInventory();
                        toast('Article supprimé');
                    }
                });
            });
            // Agrandissement photo
            tbody.querySelectorAll('img.thumb').forEach(img => {
                img.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const win = window.open('');
                    if (win) win.document.write(`<img src="${img.src}" style="max-width:100%">`);
                });
            });
        }

        updateStats(all);
    }

    /** Sauvegarde une modification inline dans une cellule */
    function saveCellEdit(td) {
        td.classList.remove('editing');
        const tr    = td.closest('tr');
        const id    = tr?.dataset.id;
        const field = td.dataset.field;
        const type  = td.dataset.type;
        if (!id || !field) return;

        let value = td.textContent.trim();
        if (type === 'number') {
            const n = parseFloat(value.replace(/[^\d.,-]/g, '').replace(',', '.'));
            value = isNaN(n) ? 0 : n;
            td.textContent = value || '';
        }

        const items = Storage.getItems();
        const item  = items.find(i => i.id === id);
        if (!item) return;

        const oldVal = item[field];
        const newVal = (type === 'number') ? value : value;

        // Aucun changement
        if (oldVal === newVal) return;
        if ((oldVal == null || oldVal === '') && (newVal === '' || newVal === 0)) return;

        item[field] = newVal;
        Storage.upsertItem(item);
        updateStats(Storage.getItems());
        toast('✓ Modifié');
    }

    function updateStats(items) {
        $('#statCount').textContent = items.length;
        $('#statQty').textContent   = items.reduce((s, i) => s + (i.quantite || 0), 0);
        const value = items.reduce((s, i) => s + (i.valeurActuelle || 0) * (i.quantite || 1), 0);
        $('#statValue').textContent = value.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
        const cats = new Set(items.map(i => i.categorie).filter(Boolean));
        $('#statCat').textContent   = cats.size;
    }

    function formatMoney(v) {
        if (!v) return '<span class="text-slate-300">—</span>';
        return Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' €';
    }

    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ---------- Settings ----------------------------------------------------
    function openSettings() {
        const s = Storage.getSettings();
        $('#s_apiKey').value    = s.apiKey;
        $('#s_model').value     = s.model;
        $('#s_lang').value      = s.lang;
        $('#s_sheetsUrl').value = s.sheetsUrl || '';
        showModal($('#settingsModal'));
    }

    function saveSettings() {
        const current = Storage.getSettings();
        Storage.saveSettings({
            ...current,
            apiKey:    $('#s_apiKey').value.trim(),
            model:     $('#s_model').value,
            lang:      $('#s_lang').value,
            sheetsUrl: $('#s_sheetsUrl').value.trim()
        });
        hideModal($('#settingsModal'));
        toast('Paramètres enregistrés ✓');
    }

    // ---------- Google Sheets sync -----------------------------------------
    function openSheetsModal() {
        const s = Storage.getSettings();
        const hasUrl = !!(s.sheetsUrl || '').trim();

        $('#sheetsSyncSection').classList.toggle('hidden', !hasUrl);
        $('#sheetsSetupSection').classList.toggle('hidden', hasUrl);

        if (hasUrl) {
            $('#sheetsLastSync').textContent = s.lastSync
                ? new Date(s.lastSync).toLocaleString('fr-FR')
                : 'jamais';
        } else {
            $('#appsScriptCode').textContent = Sheets.APPS_SCRIPT_CODE;
            $('#sheetsUrlInput').value = s.sheetsUrl || '';
        }
        showModal($('#sheetsModal'));
    }

    async function runSheetsAction(name, fn) {
        toast('⏳ ' + name + ' en cours...', 15000);
        try {
            const result = await fn();
            return result;
        } catch (err) {
            console.error('Sheets error:', err);
            toast('❌ ' + err.message, 5000);
            throw err;
        }
    }

    async function doPushSheets() {
        try {
            const r = await runSheetsAction('Envoi vers Sheets', () => Sheets.push());
            toast(`✓ ${r.count} article(s) envoyé(s) vers Google Sheets`, 4000);
            $('#sheetsLastSync').textContent = new Date().toLocaleString('fr-FR');
        } catch {}
    }

    async function doPullSheets(mode) {
        if (mode === 'replace') {
            if (!confirm('⚠️ Remplacer TOUTE la liste locale par le contenu du Sheet ?\n\nLes items locaux absents du Sheet seront SUPPRIMÉS (sauf leurs photos si les ID correspondent).')) return;
        }
        try {
            const r = await runSheetsAction('Import depuis Sheets', () => Sheets.pull(mode));
            renderInventory();
            const msg = mode === 'replace'
                ? `✓ ${r.count} article(s) — +${r.added} / ↕${r.updated} / −${r.removed}`
                : `✓ ${r.count} article(s) — +${r.added} nouveaux, ↕${r.updated} mis à jour`;
            toast(msg, 5000);
            $('#sheetsLastSync').textContent = new Date().toLocaleString('fr-FR');
        } catch {}
    }

    async function doTestSheets() {
        try {
            const r = await runSheetsAction('Test connexion', () => Sheets.test());
            toast(`✓ Connexion OK — ${r.itemsInSheet} article(s) dans le Sheet`, 4000);
        } catch {}
    }

    function doDisconnectSheets() {
        if (!confirm('Déconnecter Google Sheets ? L\'URL sera effacée des paramètres.')) return;
        const s = Storage.getSettings();
        Storage.saveSettings({ ...s, sheetsUrl: '', lastSync: null });
        hideModal($('#sheetsModal'));
        toast('Google Sheets déconnecté');
    }

    async function doSaveSheetsUrl() {
        const url = $('#sheetsUrlInput').value.trim();
        if (!url) { toast('❌ URL manquante', 3000); return; }
        if (!/^https:\/\/script\.google\.com\//.test(url)) {
            toast('❌ L\'URL doit commencer par https://script.google.com/', 4000);
            return;
        }
        const s = Storage.getSettings();
        Storage.saveSettings({ ...s, sheetsUrl: url });
        // Test immédiat
        try {
            toast('⏳ Test de la connexion...', 10000);
            const r = await Sheets.test();
            toast(`✓ Connexion réussie ! ${r.itemsInSheet} article(s) déjà dans le Sheet`, 4000);
            openSheetsModal(); // Rafraîchit l'affichage pour montrer la section sync
        } catch (err) {
            toast('⚠️ URL enregistrée mais test échoué : ' + err.message, 6000);
            openSheetsModal();
        }
    }

    function doCopyAppsScript() {
        const code = Sheets.APPS_SCRIPT_CODE;
        navigator.clipboard.writeText(code).then(() => {
            toast('✓ Code copié dans le presse-papiers');
            const btn = $('#btnCopyAppsScript');
            const old = btn.textContent;
            btn.textContent = '✓ Copié';
            setTimeout(() => { btn.textContent = old; }, 1500);
        }).catch(() => {
            // Fallback : sélectionner le texte pour copie manuelle
            const range = document.createRange();
            range.selectNodeContents($('#appsScriptCode'));
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            toast('Sélectionné. Appuie Ctrl+C pour copier');
        });
    }

    // ---------- Event wiring ------------------------------------------------
    function wireEvents() {
        // Actions principales
        $('#btnOpenCamera').addEventListener('click', () => {
            state.cameraTarget = 'capture';
            openCamera();
        });
        $('#btnOpenUpload').addEventListener('click', () => $('#mainFileInput').click());
        $('#mainFileInput').addEventListener('change', (e) => {
            handleFileUpload(e.target.files[0]);
            e.target.value = ''; // Reset pour pouvoir re-sélectionner le même fichier
        });
        $('#btnOpenBarcode').addEventListener('click', openBarcodeScanner);
        $('#btnExport').addEventListener('click', () => Storage.exportCsv(Storage.getItems()));
        $('#btnSettings').addEventListener('click', openSettings);
        $('#btnClearAll').addEventListener('click', () => {
            if (confirm('Effacer TOUS les articles ? Cette action est irréversible.')) {
                Storage.clearItems();
                renderInventory();
                toast('Inventaire vidé');
            }
        });

        // Caméra
        $('#btnCloseCamera').addEventListener('click', closeCamera);
        $('#btnSwitchCamera').addEventListener('click', switchCamera);
        $('#btnCapture').addEventListener('click', handleCapture);
        $('#btnUploadFile').addEventListener('click', () => $('#fileInput').click());
        $('#fileInput').addEventListener('change', (e) => {
            handleFileUpload(e.target.files[0]);
            e.target.value = '';
        });

        // Scanner code-barres
        $('#btnCloseBarcode').addEventListener('click', closeBarcodeScanner);

        // Formulaire
        $('#btnCloseForm').addEventListener('click', closeForm);
        $('#btnCancelForm').addEventListener('click', closeForm);
        $('#btnSaveForm').addEventListener('click', saveForm);
        $('#btnRetakePhoto').addEventListener('click', () => {
            // Préserver les champs déjà saisis par l'utilisateur
            if (state.editing) {
                state.editing = { ...state.editing, ...readForm() };
            }
            state.cameraTarget = 'reanalyze';
            hideModal($('#formModal'));
            openCamera();
            // Quand on capturera, handleCapture rouvrira le form
        });
        $('#btnReanalyze').addEventListener('click', () => {
            if (state.currentPhotoDataUrl) runAiAnalysis(state.currentPhotoDataUrl);
        });

        // Paramètres
        $('#btnCloseSettings').addEventListener('click', () => hideModal($('#settingsModal')));
        $('#btnCancelSettings').addEventListener('click', () => hideModal($('#settingsModal')));
        $('#btnSaveSettings').addEventListener('click', saveSettings);

        // Google Sheets
        $('#btnSheets').addEventListener('click', openSheetsModal);
        $('#btnCloseSheets').addEventListener('click', () => hideModal($('#sheetsModal')));
        $('#btnSaveSheetsUrl').addEventListener('click', doSaveSheetsUrl);
        $('#btnCopyAppsScript').addEventListener('click', doCopyAppsScript);
        $('#btnPushSheets').addEventListener('click', doPushSheets);
        $('#btnPullSheets').addEventListener('click', () => doPullSheets('merge'));
        $('#btnPullReplaceSheets').addEventListener('click', () => doPullSheets('replace'));
        $('#btnTestSheets').addEventListener('click', doTestSheets);
        $('#btnDisconnectSheets').addEventListener('click', doDisconnectSheets);

        // Recherche
        $('#searchInput').addEventListener('input', renderInventory);

        // Empêche la fermeture par Échap sur les inputs iOS
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (!$('#cameraModal').classList.contains('hidden')) closeCamera();
                if (!$('#barcodeModal').classList.contains('hidden')) closeBarcodeScanner();
                if (!$('#formModal').classList.contains('hidden')) closeForm();
                if (!$('#settingsModal').classList.contains('hidden')) hideModal($('#settingsModal'));
                if (!$('#sheetsModal').classList.contains('hidden')) hideModal($('#sheetsModal'));
            }
        });
    }

    // ---------- Init --------------------------------------------------------
    function init() {
        wireEvents();
        renderInventory();

        // Premier lancement : ouvrir paramètres si pas de clé
        if (!Storage.getSettings().apiKey) {
            setTimeout(() => {
                openSettings();
                toast('👋 Configurez votre clé API Gemini pour activer l\'IA', 4500);
            }, 500);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
