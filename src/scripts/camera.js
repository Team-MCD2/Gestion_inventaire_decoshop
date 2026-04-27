// Camera controls
let activeStream = null;

export async function startCamera(videoEl, { facingMode = 'environment' } = {}) {
  await stopCamera();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("Votre navigateur ne supporte pas l'accès à la caméra.");
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
  } catch (e) {
    // fallback: any available camera
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
  activeStream = stream;
  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline', 'true');
  videoEl.muted = true;
  await videoEl.play().catch(() => {});
  return stream;
}

export async function stopCamera() {
  if (activeStream) {
    activeStream.getTracks().forEach((t) => t.stop());
    activeStream = null;
  }
}

export function captureFrame(videoEl, maxDim = 1280) {
  if (!videoEl || !videoEl.videoWidth) throw new Error('Caméra non prête');
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  return drawToDataUrl((ctx, cw, ch) => ctx.drawImage(videoEl, 0, 0, cw, ch), w, h, maxDim);
}

// Reads an uploaded File, downscales to maxDim and returns a JPEG data URL.
// Mirrors captureFrame behaviour so server-side analysis sees the same format.
export async function fileToImageDataUrl(file, maxDim = 1280) {
  if (!file) throw new Error('Aucun fichier');
  if (!file.type || !file.type.startsWith('image/')) {
    throw new Error('Le fichier doit être une image.');
  }
  // 25 MB hard cap to avoid OOM on very large captures.
  if (file.size > 25 * 1024 * 1024) {
    throw new Error('Image trop lourde (max 25 Mo).');
  }
  const bitmap = await loadBitmap(file);
  try {
    return drawToDataUrl(
      (ctx, cw, ch) => ctx.drawImage(bitmap, 0, 0, cw, ch),
      bitmap.width,
      bitmap.height,
      maxDim,
    );
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close();
  }
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Impossible de lire l\'image.'));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function drawToDataUrl(drawFn, w, h, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  drawFn(ctx, cw, ch);
  return canvas.toDataURL('image/jpeg', 0.85);
}
