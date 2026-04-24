/* ===========================================================================
 * storage.js — Persistance locale (localStorage) et export CSV
 * ========================================================================= */

const Storage = (() => {
    const KEY_ITEMS    = 'inv_items_v1';
    const KEY_SETTINGS = 'inv_settings_v1';
    const KEY_COUNTER  = 'inv_counter_v1';

    // ⚠️ SÉCURITÉ : Clé API pré-configurée pour usage LOCAL uniquement.
    // Ne JAMAIS déployer publiquement ce fichier avec une vraie clé
    // (elle serait visible par tous dans le code source du site).
    // Ne JAMAIS pousser sur GitHub (public) : remplacer par '' avant commit.
    // Pour la production : laisser vide et demander à chaque utilisateur
    // de coller sa propre clé via la fenêtre Paramètres.
    const DEFAULT_SETTINGS = {
        apiKey:    'AIzaSyDFnYo9g8_6oFEvZhDb9QX9Zd-0-jL3LhA',  // ⚠️ Clé Pro, ne pas partager
        model:     'gemini-2.0-flash',
        lang:      'fr',
        sheetsUrl: '',         // URL de l'Apps Script Web App pour sync Google Sheets
        lastSync:  null        // Date ISO du dernier sync Sheets
    };

    // ----- Items ------------------------------------------------------------
    function getItems() {
        try { return JSON.parse(localStorage.getItem(KEY_ITEMS) || '[]'); }
        catch { return []; }
    }

    function saveItems(items) {
        localStorage.setItem(KEY_ITEMS, JSON.stringify(items));
    }

    function upsertItem(item) {
        const items = getItems();
        const idx = items.findIndex(i => i.id === item.id);
        if (idx >= 0) items[idx] = item;
        else items.unshift(item);
        saveItems(items);
        return item;
    }

    function deleteItem(id) {
        const items = getItems().filter(i => i.id !== id);
        saveItems(items);
    }

    function clearItems() {
        localStorage.removeItem(KEY_ITEMS);
    }

    /** Remplace complètement la liste d'articles (utilisé lors d'un pull Sheets) */
    function replaceItems(items) {
        saveItems(Array.isArray(items) ? items : []);
    }

    function generateId() {
        return 'itm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    /**
     * Génère un numéro d'article robuste au format ART-YYMMDD-XXXXXX
     * - YYMMDD : date du jour (tri chronologique naturel)
     * - XXXXXX : 6 caractères alphanumériques non-ambigus
     *            (sans 0/O, 1/I/L pour éviter les confusions)
     * Exemple : ART-260424-A7K9B2
     * Collision : 31^6 ≈ 887 millions par jour → quasi impossible
     */
    function nextArticleNumber() {
        const now = new Date();
        const yy = String(now.getFullYear()).slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');

        const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        const existing = new Set(getItems().map(i => i.numArticle));

        // Re-tirer en cas de (très improbable) collision avec un article existant
        for (let attempt = 0; attempt < 10; attempt++) {
            let rand = '';
            for (let i = 0; i < 6; i++) {
                rand += CHARS[Math.floor(Math.random() * CHARS.length)];
            }
            const candidate = `ART-${yy}${mm}${dd}-${rand}`;
            if (!existing.has(candidate)) return candidate;
        }
        // Fallback (ne devrait jamais arriver)
        return `ART-${yy}${mm}${dd}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    }

    // ----- Settings ---------------------------------------------------------
    function getSettings() {
        try {
            const s = JSON.parse(localStorage.getItem(KEY_SETTINGS) || '{}');
            return { ...DEFAULT_SETTINGS, ...s };
        } catch { return { ...DEFAULT_SETTINGS }; }
    }

    function saveSettings(s) {
        localStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
    }

    // ----- Migration auto : remplace les clés API obsolètes --------------
    // Si l'utilisateur avait une ancienne clé (quota épuisé ou compromise)
    // sauvegardée dans localStorage, on la remplace par la clé actuelle.
    const DEPRECATED_KEYS = new Set([
        'AIzaSyCe7J6Xlzfe9G9keyOjJyXLT80TIbywXao'
    ]);
    (function migrateApiKey() {
        try {
            const raw = localStorage.getItem(KEY_SETTINGS);
            if (!raw) return;
            const s = JSON.parse(raw);
            if (s.apiKey && DEPRECATED_KEYS.has(s.apiKey)) {
                s.apiKey = DEFAULT_SETTINGS.apiKey;
                localStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
                console.info('[Storage] Clé API mise à jour automatiquement');
            }
        } catch {}
    })();

    // ----- CSV Export -------------------------------------------------------
    const CSV_COLUMNS = [
        { key: 'numArticle',     label: 'Num Article' },
        { key: 'photo',          label: 'Photo' },
        { key: 'marque',         label: 'Marque' },
        { key: 'modele',         label: 'Modèle' },
        { key: 'description',    label: 'Description' },
        { key: 'categorie',      label: 'Catégorie' },
        { key: 'quantite',       label: 'Quantité' },
        { key: 'numSerie',       label: 'Numéro de série' },
        { key: 'emplacement',    label: 'Emplacement' },
        { key: 'prix',           label: 'Prix' },
        { key: 'valeurActuelle', label: 'Valeur actuelle' },
        { key: 'fournisseur',    label: 'Fournisseur' },
        { key: 'dateAjout',      label: 'Date ajout' }
    ];

    function escapeCsv(v) {
        if (v === null || v === undefined) return '';
        const s = String(v);
        if (/[",;\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    function exportCsv(items) {
        if (!items || items.length === 0) {
            alert('Aucun article à exporter');
            return;
        }

        const header = CSV_COLUMNS.map(c => escapeCsv(c.label)).join(';');
        const rows = items.map(item =>
            CSV_COLUMNS.map(c => {
                if (c.key === 'photo') {
                    // En CSV on n'inclut pas l'image complète (trop lourd)
                    return item.photo ? '[image]' : '';
                }
                return escapeCsv(item[c.key] ?? '');
            }).join(';')
        );

        // BOM UTF-8 pour que Excel reconnaisse les accents
        const csv = '\ufeff' + [header, ...rows].join('\r\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        a.href = url;
        a.download = `inventaire_${ts}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Export ZIP avec photos (optionnel — utilise une version simple : images en base64 dans un dossier virtuel)
    // Ici on exporte juste le CSV avec colonnes pour les photos en Data URL si présentes
    function exportCsvWithPhotos(items) {
        if (!items || items.length === 0) {
            alert('Aucun article à exporter');
            return;
        }
        const header = CSV_COLUMNS.map(c => escapeCsv(c.label)).join(';');
        const rows = items.map(item =>
            CSV_COLUMNS.map(c => escapeCsv(item[c.key] ?? '')).join(';')
        );
        const csv = '\ufeff' + [header, ...rows].join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        a.href = url;
        a.download = `inventaire_complet_${ts}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    return {
        getItems, saveItems, upsertItem, deleteItem, clearItems, replaceItems,
        generateId, nextArticleNumber,
        getSettings, saveSettings,
        exportCsv, exportCsvWithPhotos
    };
})();
