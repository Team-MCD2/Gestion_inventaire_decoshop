// PDF export via jsPDF + jspdf-autotable
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const HEADERS = [
  'N°', 'Cat.', 'Marque', 'Modèle', 'Réf.', 'Couleur',
  'Dim.', 'P. achat', 'P. vente', 'Marge', 'Qté init', 'Qté act.', 'Statut',
];

const STATUT_LABELS = {
  en_stock: 'En stock',
  stock_faible: 'Stock faible',
  rupture: 'Rupture',
};

function fmt(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && !Number.isFinite(v)) return '';
  return typeof v === 'number' ? `${v.toFixed(2)} €` : String(v);
}

export function downloadPDF(articles) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const now = new Date();
  const ts = now.toLocaleString('fr-FR');

  // Title bar
  doc.setFillColor(30, 58, 138); // brand blue
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 54, 'F');
  doc.setTextColor(251, 191, 36); // brand yellow
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('DECO SHOP', 40, 28);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Inventaire', 40, 44);

  doc.setTextColor(120, 120, 120);
  doc.setFontSize(9);
  doc.text(`Exporté le ${ts} · ${articles.length} article${articles.length > 1 ? 's' : ''}`,
    doc.internal.pageSize.getWidth() - 40, 28, { align: 'right' });

  // Totals
  const totalAchat = articles.reduce((s, a) => s + (Number(a.prix_achat) || 0) * (Number(a.quantite_actuelle) || 0), 0);
  const totalVente = articles.reduce((s, a) => s + (Number(a.prix_vente) || 0) * (Number(a.quantite_actuelle) || 0), 0);
  doc.text(
    `Valeur stock — achat: ${totalAchat.toFixed(2)} €  ·  vente: ${totalVente.toFixed(2)} €  ·  marge potentielle: ${(totalVente - totalAchat).toFixed(2)} €`,
    doc.internal.pageSize.getWidth() - 40, 44, { align: 'right' }
  );

  const rows = articles.map((a) => [
    a.num_article || '',
    a.categorie || '',
    a.marque || '',
    a.modele || '',
    a.reference || '',
    a.couleur || '',
    a.dimension || '',
    fmt(Number(a.prix_achat)),
    fmt(Number(a.prix_vente)),
    fmt(Number(a.marge)),
    String(a.quantite_initiale ?? ''),
    String(a.quantite_actuelle ?? ''),
    STATUT_LABELS[a.statut] || '',
  ]);

  autoTable(doc, {
    startY: 70,
    head: [HEADERS],
    body: rows,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [30, 58, 138], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 55, fontStyle: 'bold' },
      1: { cellWidth: 65 },
      6: { cellWidth: 70 },
      7: { halign: 'right', cellWidth: 55 },
      8: { halign: 'right', cellWidth: 55 },
      9: { halign: 'right', cellWidth: 55, fontStyle: 'bold' },
      10: { halign: 'right', cellWidth: 45 },
      11: { halign: 'right', cellWidth: 45 },
      12: { cellWidth: 65, halign: 'center' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 12) {
        const s = articles[data.row.index]?.statut;
        if (s === 'rupture') {
          data.cell.styles.textColor = [185, 28, 28];
          data.cell.styles.fillColor = [254, 226, 226];
          data.cell.styles.fontStyle = 'bold';
        } else if (s === 'stock_faible') {
          data.cell.styles.textColor = [146, 64, 14];
          data.cell.styles.fillColor = [254, 243, 199];
          data.cell.styles.fontStyle = 'bold';
        } else if (s === 'en_stock') {
          data.cell.styles.textColor = [21, 128, 61];
          data.cell.styles.fillColor = [220, 252, 231];
        }
      }
    },
    didDrawPage: (data) => {
      const pageCount = doc.getNumberOfPages();
      const page = data.pageNumber;
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(
        `DECO SHOP · Inventaire · Page ${page}/${pageCount}`,
        doc.internal.pageSize.getWidth() / 2,
        doc.internal.pageSize.getHeight() - 16,
        { align: 'center' }
      );
    },
    margin: { top: 70, left: 40, right: 40, bottom: 30 },
  });

  const ts2 = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  doc.save(`inventaire-decoshop-${ts2}.pdf`);
}
