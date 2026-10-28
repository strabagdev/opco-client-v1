/* Local worker; no images or decoded contents are logged or persisted. */
/* global importScripts, ZXingWASM */
importScripts("/vendor/zxing-wasm/3.1.6/reader.js");
let busy = false;
let ready = false;
const initialize = async () => {
  try {
    const response = await fetch("/vendor/zxing-wasm/3.1.6/zxing_reader.wasm", { credentials: "omit" });
    if (!response.ok) throw new Error("READER_ASSETS_UNAVAILABLE");
    await ZXingWASM.prepareZXingModule({
      overrides: { wasmBinary: await response.arrayBuffer(), print() {}, printErr() {} },
      fireImmediately: true,
    });
    ready = true;
    self.postMessage({ type: "ready" });
  } catch { self.postMessage({ type: "error", code: "READER_ASSETS_UNAVAILABLE" }); }
};
void initialize();
self.onmessage = async ({ data }) => {
  if (!ready || busy || data?.type !== "frame") return;
  busy = true;
  try {
    const image = new ImageData(new Uint8ClampedArray(data.buffer), data.width, data.height);
    const results = await ZXingWASM.readBarcodes(image, {
      formats: ["QRCode", "Code128", "PDF417"], maxNumberOfSymbols: 2, tryHarder: true,
    });
    self.postMessage({ type: "result", values: results.map(result => result.text) });
  } catch { self.postMessage({ type: "error", code: "READER_DECODE_FAILED" }); }
  finally { busy = false; }
};
