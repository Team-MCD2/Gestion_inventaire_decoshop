/* ===========================================================================
 * sheets.js — Synchronisation bidirectionnelle Google Sheets via Apps Script
 * =========================================================================
 *
 * USAGE :
 *   await Sheets.push();            // App  -> Sheet
 *   await Sheets.pull('merge');     // Sheet -> App (fusion, garde photos locales)
 *   await Sheets.pull('replace');   // Sheet -> App (remplace tout)
 *   await Sheets.test();            // Ping l'URL pour vérifier la config
 *
 * Les photos (Data URL) ne sont PAS envoyées à Sheets (trop lourdes pour une
 * cellule). Elles restent uniquement dans le localStorage du navigateur.
 * La colonne "hasPhoto" indique si un article a une photo côté app.
 * =========================================================================*/

const Sheets = (() => {

    // Champs envoyés/récupérés (doit correspondre au HEADERS de l'Apps Script)
    const FIELDS = [
        'id', 'numArticle', 'marque', 'modele', 'description',
        'categorie', 'quantite', 'numSerie', 'emplacement',
        'prix', 'valeurActuelle', 'fournisseur',
        'dateAjout', 'dateMaj', 'hasPhoto'
    ];

    /** Retourne l'URL configurée ou lève une erreur claire */
    function getUrl() {
        const url = (Storage.getSettings().sheetsUrl || '').trim();
        if (!url) {
            throw new Error("URL Google Apps Script non configurée. Ouvre la fenêtre Google Sheets pour configurer.");
        }
        if (!/^https:\/\/script\.google\.com\//.test(url)) {
            throw new Error("URL invalide. Elle doit commencer par https://script.google.com/");
        }
        return url;
    }

    /** Nettoie un item pour l'envoi : enlève la photo (trop gros) et ajoute hasPhoto */
    function sanitizeForSheet(item) {
        const clean = {};
        FIELDS.forEach(f => {
            if (f === 'hasPhoto') {
                clean.hasPhoto = item.photo ? 'oui' : '';
            } else {
                const v = item[f];
                clean[f] = (v === null || v === undefined) ? '' : v;
            }
        });
        return clean;
    }

    /** Convertit un objet reçu de Sheets en item normalisé */
    function normalizeFromSheet(row) {
        return {
            id:             String(row.id || ''),
            numArticle:     String(row.numArticle || ''),
            marque:         String(row.marque || ''),
            modele:         String(row.modele || ''),
            description:    String(row.description || ''),
            categorie:      String(row.categorie || ''),
            quantite:       Number(row.quantite) || 0,
            numSerie:       String(row.numSerie || ''),
            emplacement:    String(row.emplacement || ''),
            prix:           Number(row.prix) || 0,
            valeurActuelle: Number(row.valeurActuelle) || 0,
            fournisseur:    String(row.fournisseur || ''),
            dateAjout:      row.dateAjout ? String(row.dateAjout) : new Date().toISOString(),
            dateMaj:        row.dateMaj   ? String(row.dateMaj)   : new Date().toISOString(),
            photo:          ''  // Sera rempli depuis le local si id match
        };
    }

    /**
     * Envoie TOUS les items locaux vers le Sheet (mode replace côté serveur).
     * @returns {Promise<{count:number}>}
     */
    async function push() {
        const url = getUrl();
        const items = Storage.getItems().map(sanitizeForSheet);

        const res = await fetch(url, {
            method: 'POST',
            // Pas de Content-Type pour éviter le préflight CORS
            // Apps Script lira postData.contents comme du texte brut JSON
            body: JSON.stringify({ action: 'push', items }),
            redirect: 'follow'
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Erreur inconnue côté Sheets');

        // Sauvegarde date du dernier sync
        const s = Storage.getSettings();
        Storage.saveSettings({ ...s, lastSync: new Date().toISOString() });

        return { count: data.count || items.length };
    }

    /**
     * Récupère les items depuis le Sheet.
     * @param {'merge'|'replace'} mode
     *   - 'merge'  : remote override local pour les id communs, les nouveaux remote sont ajoutés,
     *                les items locaux absents du remote SONT CONSERVÉS.
     *   - 'replace': remplace complètement la liste locale par le contenu du Sheet
     *                (les photos locales sont préservées pour les id communs).
     */
    async function pull(mode = 'merge') {
        const url = getUrl();
        const res = await fetch(url, { method: 'GET', redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Erreur inconnue côté Sheets');

        const remote = (data.items || []).map(normalizeFromSheet);
        const local  = Storage.getItems();
        const localById  = Object.fromEntries(local.map(i => [i.id, i]));
        const remoteById = Object.fromEntries(remote.map(i => [i.id, i]));

        let finalItems;
        let stats = { added: 0, updated: 0, kept: 0, removed: 0 };

        if (mode === 'replace') {
            // Remote = source de vérité ; on préserve juste la photo si id commun
            finalItems = remote.map(r => ({
                ...r,
                photo: localById[r.id]?.photo || ''
            }));
            stats.added   = remote.filter(r => !localById[r.id]).length;
            stats.updated = remote.filter(r =>  localById[r.id]).length;
            stats.removed = local.filter(l => !remoteById[l.id]).length;
        } else {
            // merge : on combine
            finalItems = local.map(l => {
                const r = remoteById[l.id];
                if (r) {
                    stats.updated++;
                    // Merge : champs remote écrasent champs local, mais on garde la photo locale
                    return { ...l, ...r, photo: l.photo || '' };
                }
                stats.kept++;
                return l;
            });
            // Items présents dans remote uniquement → ajoutés
            remote.forEach(r => {
                if (!localById[r.id]) {
                    finalItems.push(r);
                    stats.added++;
                }
            });
        }

        Storage.replaceItems(finalItems);

        const s = Storage.getSettings();
        Storage.saveSettings({ ...s, lastSync: new Date().toISOString() });

        return { count: finalItems.length, ...stats };
    }

    /** Test rapide de la configuration (ping GET) */
    async function test() {
        const url = getUrl();
        const res = await fetch(url, { method: 'GET', redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Réponse invalide');
        return { ok: true, itemsInSheet: (data.items || []).length };
    }

    /** Code Apps Script à copier-coller dans script.google.com */
    const APPS_SCRIPT_CODE = `/**
 * Inventaire IA - Backend Google Apps Script
 * Deploy : Deploy > New deployment > Web app
 *          Execute as: Me — Who has access: Anyone
 */

const SHEET_NAME = 'Inventaire';

const HEADERS = [
  'id', 'numArticle', 'marque', 'modele', 'description',
  'categorie', 'quantite', 'numSerie', 'emplacement',
  'prix', 'valeurActuelle', 'fournisseur',
  'dateAjout', 'dateMaj', 'hasPhoto'
];

function doGet(e) {
  try {
    const sheet = getOrCreateSheet();
    const values = sheet.getDataRange().getValues();
    if (values.length <= 1) return jsonOut({ success: true, items: [] });

    const headers = values[0];
    const items = values.slice(1)
      .filter(row => row[0] !== '' && row[0] !== null)
      .map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i]; });
        return obj;
      });
    return jsonOut({ success: true, items: items });
  } catch (err) {
    return jsonOut({ success: false, error: err.toString() });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const items = body.items || [];
    const sheet = getOrCreateSheet();

    // Replace : on vide tout puis on r\u00e9-\u00e9crit
    sheet.clear();
    sheet.appendRow(HEADERS);

    if (items.length > 0) {
      const rows = items.map(item =>
        HEADERS.map(h => (item[h] !== undefined && item[h] !== null) ? item[h] : '')
      );
      sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
    }

    // Mise en forme du header
    const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setFontWeight('bold')
               .setBackground('#1e40af')
               .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, HEADERS.length);

    return jsonOut({ success: true, count: items.length });
  } catch (err) {
    return jsonOut({ success: false, error: err.toString() });
  }
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
  }
  return sheet;
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}`;

    return { push, pull, test, APPS_SCRIPT_CODE };
})();
