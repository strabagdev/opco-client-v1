import type { FrameDecoder } from "./code-reader";

/** Same-origin worker and WASM only. No default library CDN fallback. */
export function createBrowserCodeDecoder(signal?: AbortSignal): Promise<FrameDecoder> {
  return new Promise((resolve, reject) => {
    const worker = new window.Worker("/code-reader-worker.js");
    let closed = false;
    let ready = false;
    let pending: { resolve(values: string[]): void; reject(error: Error): void; timeout: ReturnType<typeof setTimeout> } | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(initializationTimeout);
      signal?.removeEventListener("abort", fail);
      worker.terminate();
      if (pending) { clearTimeout(pending.timeout); pending.reject(new Error("READER_CLOSED")); pending = undefined; }
    };
    const fail = () => { close(); reject(new Error("READER_UNAVAILABLE")); };
    const initializationTimeout = setTimeout(fail, 15000);
    signal?.addEventListener("abort", fail, { once: true });
    if (signal?.aborted) { fail(); return; }
    worker.onerror = fail;
    worker.onmessage = ({ data }) => {
      if (closed) return;
      if (data?.type === "error") { fail(); return; }
      if (data?.type === "ready" && !ready) {
        ready = true;
        clearTimeout(initializationTimeout);
        resolve({ close, decode(frame) {
          if (closed || pending) return Promise.reject(new Error("READER_UNAVAILABLE"));
          return new Promise((resolveFrame, rejectFrame) => {
            const timeout = setTimeout(() => { close(); }, 10000);
            pending = { resolve: resolveFrame, reject: rejectFrame, timeout };
            // Own a copy so the caller's canvas buffer is never detached.
            const buffer = new Uint8ClampedArray(frame.data).buffer;
            worker.postMessage({ type: "frame", buffer, width: frame.width, height: frame.height }, [buffer]);
          });
        } });
      }
      if (data?.type === "result" && pending) {
        clearTimeout(pending.timeout);
        pending.resolve(Array.isArray(data.values) ? data.values.filter((value: unknown) => typeof value === "string") : []);
        pending = undefined;
      }
    };
  });
}
