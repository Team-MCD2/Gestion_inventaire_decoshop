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
    // Pour la production : laisser vide et demander à chaque utilisateur
    // de coller sa propre clé via la fenêtre Paramètres.
    const DEFAULT_SETTINGS = {
        apiKey: 'AIzaSyCe7J6Xlzfe9G9keyOjJyXLT80TIbywXao',
        model:  'gemini-2.0-flash',
        lang:   'fr'
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

    function generateId() {
        return 'itm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    function nextArticleNumber() {
        const c = parseInt(localStorage.getItem(KEY_COUNTER) || '0', 10) + 1;
        localStorage.setItem(KEY_COUNTER, String(c));
        return 'ART-' + String(c).padStart(5, '0');
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
        getItems, saveItems, upsertItem, deleteItem, clearItems,
        generateId, nextArticleNumber,
        getSettings, saveSettings,
        exportCsv, exportCsvWithPhotos
    };
})();
