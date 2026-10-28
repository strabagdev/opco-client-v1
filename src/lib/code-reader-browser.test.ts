import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBrowserCodeDecoder } from "./code-reader-browser";

const workers: FakeWorker[] = [];
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminate = vi.fn(); postMessage = vi.fn();
  constructor(public url: string) { workers.push(this); }
  emit(data: unknown) { this.onmessage?.({ data }); }
}
beforeEach(() => { workers.length = 0; vi.useFakeTimers(); vi.stubGlobal("window", { Worker: FakeWorker }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("loads the pinned local worker, owns one frame, transfers a copy, and terminates on close", async () => {
  const opening = createBrowserCodeDecoder(); const worker = workers[0];
  expect(worker.url).toBe("/code-reader-worker.js"); worker.emit({ type: "ready" });
  const decoder = await opening; const data = new Uint8ClampedArray(16);
  const frame = decoder.decode({ data, width: 2, height: 2 });
  await expect(decoder.decode({ data, width: 2, height: 2 })).rejects.toThrow("READER_UNAVAILABLE");
  const sent = worker.postMessage.mock.calls[0][0]; expect(sent.buffer).not.toBe(data.buffer); expect(data.byteLength).toBe(16);
  worker.emit({ type: "result", values: ["0001", 2] }); expect(await frame).toEqual(["0001"]);
  decoder.close(); decoder.close(); expect(worker.terminate).toHaveBeenCalledOnce();
});
it("terminates immediately if the dialog closes while initialization is pending", async () => {
  const abort = new AbortController(); const opening = createBrowserCodeDecoder(abort.signal);
  const rejected = expect(opening).rejects.toThrow("READER_UNAVAILABLE"); abort.abort(); await rejected;
  expect(workers[0].terminate).toHaveBeenCalledOnce();
});
it("has bounded initialization and decode failures rather than a permanently active camera", async () => {
  const opening = createBrowserCodeDecoder(); const rejected = expect(opening).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(15000); await rejected; expect(workers[0].terminate).toHaveBeenCalledOnce();
  const next = createBrowserCodeDecoder(); workers[1].emit({ type: "ready" }); const decoder = await next;
  const frame = decoder.decode({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
  const failed = expect(frame).rejects.toThrow("READER_CLOSED"); await vi.advanceTimersByTimeAsync(10000); await failed;
  expect(workers[1].terminate).toHaveBeenCalledOnce();
});
it("does not fall back to a CDN after missing offline assets", async () => {
  const opening = createBrowserCodeDecoder(); workers[0].emit({ type: "error", code: "READER_ASSETS_UNAVAILABLE" });
  await expect(opening).rejects.toThrow("READER_UNAVAILABLE"); expect(workers).toHaveLength(1);
});
