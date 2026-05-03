// Scanner code-barres ultra-rapide.
// Stratégie en 2 étages :
//   1) BarcodeDetector natif (Chrome/Edge/Android) — instantané, accéléré GPU.
//   2) Fallback ZXing avec hints "1D produits" (EAN/UPC/Code128/QR) pour
//      éviter de tester tous les formats à chaque frame.
//
// STABILITÉ : pour éviter les lectures partielles/erronées dues à la rapidité
// de la caméra, un même code doit être détecté au moins 2 fois consécutives
// avant de déclencher le callback. Un cooldown de 2 s empêche aussi les
// double-détections après un scan accepté.
//
// L'API publique reste : startBarcodeScanner(video, onDetected) / stopBarcodeScanner()
import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';

let zxingReader = null;
let zxingControls = null;
let nativeStream = null;
let nativeRaf = null;
let nativeStopFlag = false;

// ─── Filtre de stabilité partagé ───────────────────────────────────────────
// Exige 2 détections consécutives du même code avant d'appeler le callback,
// + un cooldown de 2 s pour éviter les doubles déclenchements.
const CONFIRM_COUNT  = 2;     // nombre de détections consécutives requises
const COOLDOWN_MS    = 2000;  // pause après un scan accepté

let _lastRaw        = '';
let _confirmCount   = 0;
let _lastAcceptedAt = 0;
let _userCallback   = null;

function createStableCallback(onDetected) {
  _lastRaw        = '';
  _confirmCount   = 0;
  _lastAcceptedAt = 0;
  _userCallback   = onDetected;

  return (raw) => {
    const code = String(raw || '').trim();
    if (!code) return;

    const now = Date.now();
    // Respecter le cooldown après le dernier scan accepté
    if (now - _lastAcceptedAt < COOLDOWN_MS) return;

    if (code === _lastRaw) {
      _confirmCount++;
    } else {
      // Nouveau code différent → réinitialiser le compteur
      _lastRaw      = code;
      _confirmCount = 1;
    }

    if (_confirmCount >= CONFIRM_COUNT) {
      // Code suffisamment stable : on l'accepte
      _lastAcceptedAt = now;
      _lastRaw        = '';   // reset pour le prochain cycle
      _confirmCount   = 0;
      try { _userCallback(code); } catch (e) { console.error(e); }
    }
  };
}

function resetStableFilter() {
  _lastRaw      = '';
  _confirmCount = 0;
  // Ne pas resetter _lastAcceptedAt ici — préserver le cooldown entre appels
}

// ─── 1) Voie native : BarcodeDetector (la plus rapide) ─────────────────────
function hasNativeDetector() {
  return typeof window !== 'undefined'
    && 'BarcodeDetector' in window;
}

async function startNative(videoEl, stableCallback) {
  // Formats les plus courants en magasin (produits)
  const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'itf'];
  let supported = formats;
  try {
    const sup = await window.BarcodeDetector.getSupportedFormats?.();
    if (Array.isArray(sup) && sup.length) {
      supported = formats.filter((f) => sup.includes(f));
      if (!supported.length) supported = sup;
    }
  } catch {}

  const detector = new window.BarcodeDetector({ formats: supported });

  nativeStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width:  { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  videoEl.srcObject = nativeStream;
  videoEl.setAttribute('playsinline', 'true');
  videoEl.muted = true;
  await videoEl.play().catch(() => {});

  nativeStopFlag = false;
  let detecting = false;
  const tick = async () => {
    if (nativeStopFlag) return;
    if (!detecting && videoEl.readyState >= 2) {
      detecting = true;
      try {
        const codes = await detector.detect(videoEl);
        if (codes && codes.length) {
          const raw = String(codes[0].rawValue || '').trim();
          if (raw) {
            try { stableCallback(raw); } catch (e) { console.error(e); }
          }
        }
      } catch {
        // Frame ratée — on continue, pas de spam de log
      } finally {
        detecting = false;
      }
    }
    nativeRaf = requestAnimationFrame(tick);
  };
  nativeRaf = requestAnimationFrame(tick);
}

function stopNative() {
  nativeStopFlag = true;
  if (nativeRaf) { cancelAnimationFrame(nativeRaf); nativeRaf = null; }
  if (nativeStream) {
    nativeStream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    nativeStream = null;
  }
}

// ─── 2) Fallback ZXing avec hints rapides ──────────────────────────────────
function makeZxingHints() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.QR_CODE,
    BarcodeFormat.ITF,
  ]);
  // TRY_HARDER ralentit beaucoup → on le laisse OFF pour la vitesse.
  return hints;
}

async function startZxing(videoEl, stableCallback) {
  zxingReader = new BrowserMultiFormatReader(makeZxingHints(), {
    delayBetweenScanAttempts:  120,
    delayBetweenScanSuccess:   600,
  });
  zxingControls = await zxingReader.decodeFromVideoDevice(undefined, videoEl, (result) => {
    if (result) {
      try { stableCallback(result.getText()); } catch (e) { console.error(e); }
    }
  });
  return zxingControls;
}

function stopZxing() {
  try { if (zxingControls) zxingControls.stop(); } catch {}
  zxingControls = null;
  zxingReader = null;
}

// ─── API publique ──────────────────────────────────────────────────────────
export async function startBarcodeScanner(videoEl, onDetected) {
  await stopBarcodeScanner();
  resetStableFilter();
  const stableCallback = createStableCallback(onDetected);

  if (hasNativeDetector()) {
    try {
      await startNative(videoEl, stableCallback);
      return;
    } catch (e) {
      console.warn('[barcode] BarcodeDetector natif indisponible, fallback ZXing :', e?.message || e);
      stopNative();
    }
  }
  await startZxing(videoEl, stableCallback);
}

export async function stopBarcodeScanner() {
  stopNative();
  stopZxing();
}
