// Tiny UI helpers shared by every page-level script (app.js, scan.js, stats.js).
// Kept dependency-free so any page can import only what it needs.

export const $ = (sel, root = document) => root.querySelector(sel);

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function fmtPrice(v) {
  if (v === '' || v == null || Number.isNaN(Number(v))) return '';
  return Number(v).toFixed(2).replace('.', ',') + ' €';
}

export function fmtPriceCompact(v) {
  const n = Number(v) || 0;
  if (n >= 1e6)  return (n / 1e6).toFixed(1).replace('.', ',') + ' M€';
  if (n >= 1e3)  return (n / 1e3).toFixed(1).replace('.', ',') + ' k€';
  return n.toFixed(0) + ' €';
}

export function renderStatusBadge(statut) {
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

// Toast — host element ('#toast-host') is provided by Layout.astro on every page.
// Returns { update(msg), dismiss() }. Pass duration=0 to keep it visible until dismiss().
export function toast(msg, type = 'info', duration = 3600) {
  const host = $('#toast-host');
  if (!host) return { update() {}, dismiss() {} };
  const el = document.createElement('div');
  const base = 'px-4 py-3 rounded-xl shadow-lg text-sm font-medium max-w-sm flex items-start gap-2 pointer-events-auto';
  const color =
    type === 'error'   ? 'bg-red-600 text-white' :
    type === 'success' ? 'bg-emerald-600 text-white' :
    type === 'warning' ? 'bg-amber-500 text-white' :
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
