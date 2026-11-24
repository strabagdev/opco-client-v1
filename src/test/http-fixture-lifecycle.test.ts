// @ts-expect-error Node types are intentionally absent from Expo's application tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node types are intentionally absent from Expo's application tsconfig.
import { EventEmitter } from "node:events";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Exercise the actual C-01 fixture startup, without creating a second HTTP harness.
const source = ts.createSourceFile("fixture.ts", readFileSync(`${process.cwd()}/src/sync/records-sync.recovery.sqlite.test.ts`, "utf8"), ts.ScriptTarget.Latest, true);
let declaration = "";
source.forEachChild(node => {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "listenFixtureServer") declaration = node.getText(source);
});
if (!declaration) throw Error("Missing C-01 fixture startup");
const listenFixtureServer = new Function(ts.transpileModule(`${declaration};return listenFixtureServer;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)() as (server: unknown) => Promise<void>;

class TestListener extends EventEmitter {
  // Expo deliberately excludes Node declarations. These describe the real emitter;
  // declare fields are erased and do not replace its methods at runtime.
  declare once: (event: string, listener: (value: unknown) => void) => this;
  declare on: (event: string, listener: (value: unknown) => void) => this;
  declare emit: (event: string, ...values: unknown[]) => boolean;
  declare listenerCount: (event: string) => number;
  readonly startupError = Object.assign(Error("Synthetic fixture bind denied"), { code: "EPERM" });
  constructor(private readonly outcome: "ready" | "error" | "throw") { super(); }
  listen(port: number, host: string, ready: () => void) {
    expect(port).toBe(0); expect(host).toBe("127.0.0.1");
    if (this.outcome === "throw") throw this.startupError;
    this.once("listening", ready);
    queueMicrotask(() => this.emit(this.outcome === "ready" ? "listening" : "error", this.startupError));
    return this;
  }
}

describe("C-01 HTTP fixture startup lifecycle", () => {
  it("rejects the original async listen error in the same event-loop turn instead of waiting for the hook deadline", async () => {
    const server = new TestListener("error");
    // External observer models the test runner seeing an error; it must not be
    // mistaken for the fixture settling its own startup promise.
    const observed: unknown[] = [];
    server.on("error", (error: unknown) => observed.push(error));
    let outcome: unknown = "pending";
    const startup = listenFixtureServer(server).then(() => { outcome = "ready"; }, error => { outcome = error; });
    await new Promise<void>(resolve => queueMicrotask(() => queueMicrotask(resolve)));
    expect(observed).toEqual([server.startupError]);
    expect(outcome).toBe(server.startupError);
    expect(server.listenerCount("listening")).toBe(0);
    expect(server.listenerCount("error")).toBe(1); // Only the external observer.
    await startup;
  });

  it("resolves only after listening and removes its error listener", async () => {
    const server = new TestListener("ready");
    let ready = false;
    const startup = listenFixtureServer(server).then(() => { ready = true; });
    expect(ready).toBe(false);
    await startup;
    expect(ready).toBe(true);
    expect(server.listenerCount("error")).toBe(0);
    expect(server.listenerCount("listening")).toBe(0);
  });

  it("also rejects a synchronous listen failure without leaving listeners", async () => {
    const server = new TestListener("throw");
    await expect(listenFixtureServer(server)).rejects.toBe(server.startupError);
    expect(server.listenerCount("error")).toBe(0);
    expect(server.listenerCount("listening")).toBe(0);
  });
});
