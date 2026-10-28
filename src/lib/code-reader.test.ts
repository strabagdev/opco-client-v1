import { afterEach, describe, expect, it, vi } from "vitest";
import { createCodeReaderSession, extractDirectCodeIdentifier, type CodeReaderPorts, type FrameDecoder } from "./code-reader";
import { normalizeAttendanceSearch } from "../renderers/workflows/attendance/attendance-workflow-logic";
import { normalizeStateUpdateSearch } from "../renderers/workflows/state-update/state-update-workflow-logic";

const frame = { data: new Uint8ClampedArray(16), width: 2, height: 2 };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(overrides: Partial<CodeReaderPorts> = {}) {
  const stop = vi.fn(); const close = vi.fn();
  const decode = vi.fn().mockResolvedValue([]);
  const ports: CodeReaderPorts = {
    requestCamera: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }),
    attach: vi.fn().mockResolvedValue(undefined), detach: vi.fn(), capture: () => frame,
    createDecoder: vi.fn().mockResolvedValue({ decode, close }), onRead: vi.fn(), onState: vi.fn(),
    schedule: callback => setTimeout(callback, 180), cancelScheduled: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    ...overrides,
  };
  return { session: createCodeReaderSession(ports), ports, stop, close, decode };
}
afterEach(() => { vi.useRealTimers(); });
describe("direct text interpretation, distinct from decoding or lookup", () => {
  it.each(["00123450-K", "00.123.450-k", "00123450K", "PERSONA FICTICIA", "EQ-0001"])("retains the textual identifier %s and existing trim-only search normalization", text => {
    const result = extractDirectCodeIdentifier(` ${text} `);
    expect(result).toEqual({ ok: true, value: text });
    expect(normalizeAttendanceSearch(text)).toBe(text);
    expect(normalizeStateUpdateSearch(text)).toBe(text);
  });
  it.each(["https://invalid.example/001", "javascript:alert(1)", "www.invalid.example", "//invalid.example", '{"id":"001"}', "ID=001;NAME=TEST", "001\nNAME", "001\tNAME", "001|TEST", "<id>001</id>", "", "a".repeat(257)])("rejects unsupported content without extracting or navigating", value => {
    expect(extractDirectCodeIdentifier(value).ok).toBe(false);
  });
});
describe("camera session ownership and cancellation", () => {
  it("accepts one read, stops all resources before the callback, and never invokes another frame", async () => {
    vi.useFakeTimers();
    const f = fixture(); f.decode.mockResolvedValue(["EQ-0001", "EQ-0001"]);
    vi.mocked(f.ports.onRead).mockImplementation(() => { expect(f.stop).toHaveBeenCalledOnce(); expect(f.close).toHaveBeenCalledOnce(); });
    await f.session.start(); await vi.runAllTimersAsync();
    expect(f.ports.onRead).toHaveBeenCalledExactlyOnceWith("EQ-0001"); expect(f.decode).toHaveBeenCalledOnce();
  });
  it("does not request permission on construction and merges duplicate start clicks", async () => {
    const pending = deferred<Awaited<ReturnType<CodeReaderPorts["requestCamera"]>>>();
    const f = fixture({ requestCamera: vi.fn(() => pending.promise) });
    expect(f.ports.requestCamera).not.toHaveBeenCalled();
    const opening = f.session.start(); await f.session.start();
    expect(f.ports.requestCamera).toHaveBeenCalledOnce(); f.session.stop();
    const stop = vi.fn(); pending.resolve({ getTracks: () => [{ stop }] }); await opening;
    expect(stop).toHaveBeenCalledOnce(); expect(f.ports.attach).not.toHaveBeenCalled(); expect(f.ports.onRead).not.toHaveBeenCalled();
  });
  it("closes an initializing decoder on cancellation", async () => {
    const decoder = deferred<FrameDecoder>();
    let signal: AbortSignal | undefined;
    const f = fixture({ createDecoder: vi.fn(next => { signal = next; return decoder.promise; }) });
    const opening = f.session.start(); await Promise.resolve(); await Promise.resolve();
    f.session.stop(); expect(signal?.aborted).toBe(true);
    const close = vi.fn(); decoder.resolve({ decode: vi.fn(), close }); await opening;
    expect(close).toHaveBeenCalledOnce(); expect(f.ports.onRead).not.toHaveBeenCalled();
  });
  it("ignores late decode after navigation/scope disposal and keeps a new session independent", async () => {
    const decode = deferred<string[]>(); const f = fixture(); f.decode.mockReturnValueOnce(decode.promise);
    await f.session.start(); f.session.stop(); decode.resolve(["OLD-001"]); await Promise.resolve(); await Promise.resolve();
    expect(f.ports.onRead).not.toHaveBeenCalled(); expect(f.stop).toHaveBeenCalledOnce(); expect(f.close).toHaveBeenCalledOnce();
    f.decode.mockResolvedValue(["NEW-002"]); await f.session.start(); await Promise.resolve();
    expect(f.ports.onRead).toHaveBeenCalledExactlyOnceWith("NEW-002");
  });
  it("does not accept one of multiple distinct codes and schedules only after the current decode", async () => {
    vi.useFakeTimers(); const pending = deferred<string[]>(); const f = fixture(); f.decode.mockReturnValueOnce(pending.promise);
    await f.session.start(); await vi.advanceTimersByTimeAsync(5000); expect(f.decode).toHaveBeenCalledOnce();
    pending.resolve(["ONE", "TWO"]); await Promise.resolve(); await Promise.resolve();
    expect(f.ports.onRead).not.toHaveBeenCalled(); expect(f.ports.onState).toHaveBeenCalledWith("reading", expect.stringContaining("varios"));
    f.session.stop(); await vi.runAllTimersAsync(); expect(f.decode).toHaveBeenCalledOnce();
  });
  it("rejects a URL without invoking the search callback", async () => {
    const f = fixture(); f.decode.mockResolvedValue(["https://invalid.example"]); await f.session.start(); await Promise.resolve();
    expect(f.ports.onRead).not.toHaveBeenCalled(); expect(f.stop).toHaveBeenCalledOnce();
    expect(f.ports.onState).toHaveBeenLastCalledWith("closed", expect.stringContaining("texto directo"));
  });
  it.each(["NotAllowedError", "NotFoundError", "NotReadableError"])("ends %s safely, exposing only a safe message", async name => {
    const f = fixture({ requestCamera: vi.fn().mockRejectedValue({ name, message: "untrusted personal content" }) });
    await f.session.start(); expect(f.ports.onRead).not.toHaveBeenCalled();
    expect(f.ports.onState).toHaveBeenLastCalledWith("closed", expect.not.stringContaining("untrusted"));
    expect(f.ports.createDecoder).not.toHaveBeenCalled();
  });
  it("stops the stream if decoder resources fail, preserving the manual search path", async () => {
    const f = fixture({ createDecoder: vi.fn().mockRejectedValue(new Error("offline")) });
    await f.session.start(); expect(f.stop).toHaveBeenCalledOnce(); expect(f.ports.onRead).not.toHaveBeenCalled();
    expect(f.ports.onState).toHaveBeenLastCalledWith("closed", expect.stringContaining("búsqueda manual"));
  });
});
