// Scanner code-barres ultra-rapide.
// Stratégie en 2 étages :
//   1) BarcodeDetector natif (Chrome/Edge/Android) — instantané, accéléré GPU.
//   2) Fallback ZXing avec hints "1D produits" (EAN/UPC/Code128/QR) pour
//      éviter de tester tous les formats à chaque frame.
//
// L'API publique reste : startBarcodeScanner(video, onDetected) / stopBarcodeScanner()
import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';

let zxingReader = null;
let zxingControls = null;
let nativeStream = null;
let nativeRaf = null;
let nativeStopFlag = false;

// ─── 1) Voie native : BarcodeDetector (la plus rapide) ─────────────────────
function hasNativeDetector() {
  return typeof window !== 'undefined'
    && 'BarcodeDetector' in window;
}

async function startNative(videoEl, onDetected) {
  // Formats les plus courants en magasin (produits)
  const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'itf'];
  let supported = formats;
  try {
    const sup = await window.BarcodeDetector.getSupportedFormats?.();
    if (Array.isArray(sup) && sup.length) {
      supported = formats.filter((f) => sup.includes(f));
      if (!supported.length) supported = sup; // au pire, on prend tout ce qui marche
    }
  } catch {}

  const detector = new window.BarcodeDetector({ formats: supported });

  // Caméra arrière par défaut + résolution raisonnable pour la fluidité
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
            try { onDetected(raw); } catch (e) { console.error(e); }
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

async function startZxing(videoEl, onDetected) {
  zxingReader = new BrowserMultiFormatReader(makeZxingHints(), {
    delayBetweenScanAttempts:  120,  // ms entre chaque tentative (vitesse)
    delayBetweenScanSuccess:   600,  // anti-rebond après détection
  });
  zxingControls = await zxingReader.decodeFromVideoDevice(undefined, videoEl, (result) => {
    if (result) {
      try { onDetected(result.getText()); } catch (e) { console.error(e); }
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
  if (hasNativeDetector()) {
    try {
      await startNative(videoEl, onDetected);
      return;
    } catch (e) {
      console.warn('[barcode] BarcodeDetector natif indisponible, fallback ZXing :', e?.message || e);
      stopNative();
    }
  }
  await startZxing(videoEl, onDetected);
}

export async function stopBarcodeScanner() {
  stopNative();
  stopZxing();
}
