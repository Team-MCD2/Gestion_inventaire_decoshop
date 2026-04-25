// Barcode scanning via @zxing/browser
import { BrowserMultiFormatReader } from '@zxing/browser';

let reader = null;
let controls = null;

export async function startBarcodeScanner(videoEl, onDetected) {
  await stopBarcodeScanner();
  reader = new BrowserMultiFormatReader();
  // decodeFromVideoDevice: first arg = deviceId or undefined (default)
  controls = await reader.decodeFromVideoDevice(undefined, videoEl, (result) => {
    if (result) {
      try { onDetected(result.getText()); } catch (e) { console.error(e); }
    }
  });
  return controls;
}

export async function stopBarcodeScanner() {
  try { if (controls) controls.stop(); } catch {}
  controls = null;
  reader = null;
}
