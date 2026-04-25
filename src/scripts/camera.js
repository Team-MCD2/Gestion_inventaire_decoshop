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
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  ctx.drawImage(videoEl, 0, 0, cw, ch);
  return canvas.toDataURL('image/jpeg', 0.85);
}
