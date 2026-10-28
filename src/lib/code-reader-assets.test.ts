// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { readFileSync } from "node:fs";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { createHash } from "node:crypto";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { gunzipSync } from "node:zlib";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import vm from "node:vm";
import { expect, it } from "vitest";
import frames from "./code-reader-fixtures.json";
import provenance from "../../public/vendor/zxing-wasm/3.1.6/provenance.json";

const vendor = "public/vendor/zxing-wasm/3.1.6/";
it("pins the JS/WASM and license bytes rather than relying on a CDN", () => {
  expect(provenance.version).toBe("3.1.6");
  for (const [name, sha] of Object.entries(provenance.files)) expect(createHash("sha256").update(readFileSync(vendor + name)).digest("hex")).toBe(sha);
});

it("runs the actual local worker and reader WASM against QR, Code128 and PDF417 fictional frames", async () => {
  const requests: string[] = []; const messages: { type: string; values?: string[]; code?: string }[] = [];
  let ready!: () => void; const initialized = new Promise<void>(resolve => { ready = resolve; });
  const sandbox = vm.createContext({
    WebAssembly, TextDecoder, TextEncoder, Uint8Array, Uint8ClampedArray, ArrayBuffer, performance,
    ImageData: class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} },
    fetch: async (url: string) => {
      requests.push(url); if (url !== `/${vendor}zxing_reader.wasm`.replace("/public/", "/")) throw Error("External fetch forbidden");
      const buffer = readFileSync(`${vendor}zxing_reader.wasm`);
      return { ok: true, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
    },
    postMessage(message: { type: string }) { messages.push(message); if (message.type === "ready" || message.type === "error") ready(); },
  });
  sandbox.self = sandbox;
  sandbox.importScripts = (url: string) => {
    expect(url).toBe("/vendor/zxing-wasm/3.1.6/reader.js");
    vm.runInContext(readFileSync(`${vendor}reader.js`, "utf8"), sandbox);
  };
  vm.runInContext(readFileSync("public/code-reader-worker.js", "utf8"), sandbox);
  await initialized; expect(messages).toEqual([{ type: "ready" }]);
  for (const frame of frames) {
    const rgba = gunzipSync(Uint8Array.from(atob(frame.rgbaGzipBase64), character => character.charCodeAt(0)));
    await sandbox.onmessage({ data: { type: "frame", width: frame.width, height: frame.height, buffer: new Uint8ClampedArray(rgba).buffer } });
    expect(messages.at(-1)).toEqual({ type: "result", values: [frame.text] });
  }
  expect(requests).toEqual(["/vendor/zxing-wasm/3.1.6/zxing_reader.wasm"]);
});
