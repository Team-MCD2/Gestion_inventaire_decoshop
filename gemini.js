/* ===========================================================================
 * gemini.js — Intégration Google Gemini Vision + recherche produit barcode
 * ========================================================================= */

const AI = (() => {

    const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

    // Schéma JSON pour obliger Gemini à répondre au bon format (types en UPPERCASE per docs Gemini)
    const RESPONSE_SCHEMA = {
        type: 'OBJECT',
        properties: {
            marque:         { type: 'STRING', description: "Marque du produit" },
            modele:         { type: 'STRING', description: "Modèle / référence du produit" },
            description:    { type: 'STRING', description: "Description courte (2-3 phrases)" },
            categorie:      { type: 'STRING', description: "Catégorie (Électronique, Outillage, Mobilier, Électroménager, etc.)" },
            numSerie:       { type: 'STRING', description: "Numéro de série ou référence visible sur l'étiquette, sinon vide" },
            prixEstime:     { type: 'NUMBER', description: "Prix neuf estimé en euros (0 si inconnu)" },
            valeurActuelle: { type: 'NUMBER', description: "Valeur actuelle estimée en euros (0 si inconnu)" },
            fournisseur:    { type: 'STRING', description: "Fournisseur ou distributeur courant (vide si inconnu)" }
        },
        required: ['marque', 'modele', 'description', 'categorie']
    };

    function buildPrompt(lang, hint = '') {
        const extra = hint ? `\n\nInfo supplémentaire : ${hint}` : '';
        if (lang === 'en') {
            return `You are an inventory assistant. Analyze the product in the image and extract:
- brand, model, short description, category
- visible serial number (if any)
- estimated new price in EUR
- estimated current/used value in EUR
- typical supplier/distributor

Fill every field. If unsure, give your best guess. Never reply with null — use "" for empty strings and 0 for unknown numbers.${extra}`;
        }
        return `Tu es un assistant d'inventaire. Analyse le produit sur l'image et extrais :
- marque, modèle, description courte, catégorie
- numéro de série visible sur l'étiquette (si présent)
- prix neuf estimé en euros
- valeur actuelle / occasion estimée en euros
- fournisseur ou distributeur courant

Remplis TOUS les champs. En cas de doute, donne ta meilleure estimation. Ne réponds jamais null — utilise "" pour les chaînes vides et 0 pour les nombres inconnus.${extra}`;
    }

    /** Extraction base64 pure depuis une Data URL */
    function dataUrlToBase64(dataUrl) {
        const idx = dataUrl.indexOf(',');
        return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
    }

    function dataUrlMime(dataUrl) {
        const m = /^data:([^;]+);base64,/.exec(dataUrl);
        return m ? m[1] : 'image/jpeg';
    }

    /**
     * Analyse une image avec Gemini Vision
     * @param {string} imageDataUrl - Data URL de l'image (jpg/png)
     * @param {object} settings - { apiKey, model, lang }
     * @param {string} hint - Info supplémentaire (ex: code-barres)
     */
    async function analyzeImage(imageDataUrl, settings, hint = '') {
        if (!settings.apiKey) throw new Error('Clé API Gemini manquante (Paramètres ⚙️)');
        if (!imageDataUrl) throw new Error('Aucune image fournie');

        const url = `${API_BASE}/${settings.model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;
        const body = {
            contents: [{
                role: 'user',
                parts: [
                    { text: buildPrompt(settings.lang, hint) },
                    { inline_data: { mime_type: dataUrlMime(imageDataUrl), data: dataUrlToBase64(imageDataUrl) } }
                ]
            }],
            generationConfig: {
                temperature: 0.2,
                responseMimeType: 'application/json',
                responseSchema: RESPONSE_SCHEMA
            }
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errText = await res.text();
            let msg = `Erreur Gemini (${res.status})`;
            try {
                const j = JSON.parse(errText);
                if (j.error?.message) msg += ' : ' + j.error.message;
            } catch { msg += ' : ' + errText.slice(0, 200); }
            throw new Error(msg);
        }

        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Réponse Gemini vide');

        try {
            return JSON.parse(text);
        } catch {
            // Parfois Gemini ajoute du markdown autour
            const m = text.match(/\{[\s\S]*\}/);
            if (m) return JSON.parse(m[0]);
            throw new Error('Réponse Gemini non-JSON : ' + text.slice(0, 150));
        }
    }

    /**
     * Recherche un produit par code-barres via l'API Open Food Facts
     * (gratuite, couvre principalement produits alimentaires, cosmétiques, etc.)
     */
    async function lookupBarcodeOFF(barcode) {
        try {
            const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`);
            if (!res.ok) return null;
            const data = await res.json();
            if (data.status !== 1 || !data.product) return null;
            const p = data.product;
            return {
                marque:       p.brands || '',
                modele:       p.product_name || '',
                description:  p.generic_name || p.product_name || '',
                categorie:    (p.categories || '').split(',').pop()?.trim() || '',
                numSerie:     barcode,
                photo:        p.image_url || p.image_front_url || '',
                source:       'openfoodfacts'
            };
        } catch { return null; }
    }

    /**
     * Recherche produit par code-barres + enrichissement Gemini
     * Si la photo du produit est disponible en ligne, on peut demander à Gemini de l'enrichir
     */
    async function lookupBarcode(barcode, settings) {
        // 1) Essai Open Food Facts
        const off = await lookupBarcodeOFF(barcode);

        // 2) Si Gemini dispo : demander à Gemini une estimation via texte (sans image)
        let geminiGuess = null;
        if (settings.apiKey) {
            try {
                geminiGuess = await analyzeBarcodeText(barcode, settings, off);
            } catch (e) {
                console.warn('Gemini barcode lookup failed:', e);
            }
        }

        // 3) Fusionner : Gemini complète ce que Open Food Facts n'a pas
        const merged = {
            marque:         off?.marque         || geminiGuess?.marque         || '',
            modele:         off?.modele         || geminiGuess?.modele         || '',
            description:    off?.description    || geminiGuess?.description    || '',
            categorie:      off?.categorie      || geminiGuess?.categorie      || '',
            numSerie:       barcode,
            prixEstime:     geminiGuess?.prixEstime     || 0,
            valeurActuelle: geminiGuess?.valeurActuelle || 0,
            fournisseur:    geminiGuess?.fournisseur    || '',
            photo:          off?.photo || ''
        };
        return merged;
    }

    /** Demande à Gemini d'identifier un produit uniquement via son code-barres (texte) */
    async function analyzeBarcodeText(barcode, settings, hintData = null) {
        const url = `${API_BASE}/${settings.model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;
        const hintText = hintData
            ? `Des informations partielles ont été trouvées : ${JSON.stringify(hintData)}. Complète et corrige.`
            : '';
        const prompt = `Identifie le produit correspondant au code-barres EAN/UPC/GTIN : ${barcode}.
${hintText}
Donne marque, modèle, description, catégorie, prix neuf estimé en €, valeur actuelle en €, fournisseur.
Si tu n'es pas certain, donne ta meilleure estimation basée sur le préfixe du code-barres et les bases de données publiques.`;

        const body = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.3,
                responseMimeType: 'application/json',
                responseSchema: RESPONSE_SCHEMA
            }
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error('Gemini ' + res.status);
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) return null;
        try { return JSON.parse(text); }
        catch {
            const m = text.match(/\{[\s\S]*\}/);
            return m ? JSON.parse(m[0]) : null;
        }
    }

    /** Convertit une image distante en Data URL (pour l'enregistrer localement) */
    async function urlToDataUrl(imgUrl) {
        try {
            const res = await fetch(imgUrl);
            const blob = await res.blob();
            return await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(r.result);
                r.onerror = reject;
                r.readAsDataURL(blob);
            });
        } catch { return ''; }
    }

    return { analyzeImage, lookupBarcode, urlToDataUrl };
})();
