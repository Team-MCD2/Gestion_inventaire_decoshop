// Petits effets sonores via Web Audio API.
// Pas de fichiers MP3/WAV à charger : tout est synthétisé instantanément.

let audioCtx = null;
function ctx() {
  if (audioCtx) return audioCtx;
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (Ctor) audioCtx = new Ctor();
  } catch {}
  return audioCtx;
}

// Bip court et clair — type "scanner de caisse" (≈ 80 ms)
export function playScanBeep() {
  const ac = ctx();
  if (!ac) return;
  // Reprendre le contexte si suspendu (politique d'autoplay)
  if (ac.state === 'suspended') { try { ac.resume(); } catch {} }

  const t0 = ac.currentTime;
  const osc  = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1200, t0);     // ton aigu typique scanner
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.005);  // attack
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08); // release
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + 0.1);
}

// Double bip "succès produit reconnu"
export function playSuccessBeep() {
  const ac = ctx();
  if (!ac) return;
  if (ac.state === 'suspended') { try { ac.resume(); } catch {} }
  const t0 = ac.currentTime;
  const tones = [
    { f: 1000, start: 0,    dur: 0.07 },
    { f: 1500, start: 0.09, dur: 0.10 },
  ];
  for (const t of tones) {
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(t.f, t0 + t.start);
    gain.gain.setValueAtTime(0.0001, t0 + t.start);
    gain.gain.exponentialRampToValueAtTime(0.22, t0 + t.start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + t.start + t.dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0 + t.start);
    osc.stop(t0 + t.start + t.dur + 0.02);
  }
}

// Bip d'erreur — ton plus grave et plus long
export function playErrorBeep() {
  const ac = ctx();
  if (!ac) return;
  if (ac.state === 'suspended') { try { ac.resume(); } catch {} }
  const t0 = ac.currentTime;
  const osc  = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(220, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + 0.27);
}

// Pré-débloquer le contexte audio sur la première interaction utilisateur
// (politique d'autoplay des navigateurs).
export function unlockAudioOnce() {
  const handler = () => {
    const ac = ctx();
    if (ac && ac.state === 'suspended') { try { ac.resume(); } catch {} }
    document.removeEventListener('click', handler);
    document.removeEventListener('touchstart', handler);
    document.removeEventListener('keydown', handler);
  };
  document.addEventListener('click', handler, { once: true, passive: true });
  document.addEventListener('touchstart', handler, { once: true, passive: true });
  document.addEventListener('keydown', handler, { once: true });
}
