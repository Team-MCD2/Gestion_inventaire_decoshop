// CSV export — alignement schema MCD (cf. mcd_mld.md §2)
const HEADERS = [
  { key: 'numero_article',     label: 'Numero article' },
  { key: 'categorie',          label: 'Categorie' },
  { key: 'marque',             label: 'Marque' },
  { key: 'modele',             label: 'Modele' },
  { key: 'description',        label: 'Description' },
  { key: 'prix_achat',         label: 'Prix achat' },
  { key: 'prix_vente',         label: 'Prix vente' },
  { key: 'marge',              label: 'Marge' },
  { key: 'code_barres',        label: 'Code-barres' },
  { key: 'couleur',            label: 'Couleur' },
  { key: 'ref_couleur',        label: 'Ref couleur' },
  { key: 'taille',             label: 'Taille' },
  { key: 'taille_canape',      label: 'Taille canape' },
  { key: 'quantite_initiale',  label: 'Quantite initiale' },
  { key: 'quantite',           label: 'Quantite' },
  { key: 'statut',             label: 'Statut' },
  { key: 'shopify_product_id', label: 'Shopify product ID' },
];

const STATUT_LABELS = {
  en_stock: 'En stock',
  stock_faible: 'Stock faible',
  rupture: 'Rupture',
};

function escape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmtNumber(n) {
  if (n === null || n === undefined || n === '') return '';
  if (Number.isNaN(Number(n))) return '';
  return String(Number(n).toFixed(2)).replace('.', ',');
}

export function articlesToCSV(articles) {
  const head = HEADERS.map((h) => escape(h.label)).join(';');
  const rows = articles.map((a) =>
    HEADERS.map((h) => {
      const raw = a[h.key];
      if (['prix_achat', 'prix_vente', 'marge'].includes(h.key)) return escape(fmtNumber(raw));
      if (h.key === 'statut') return escape(STATUT_LABELS[raw] || '');
      return escape(raw ?? '');
    }).join(';')
  );
  return '\uFEFF' + [head, ...rows].join('\r\n');
}

export function downloadCSV(articles, { filename = null } = {}) {
  const csv = articlesToCSV(articles);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = filename || `inventaire-decoshop-${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
