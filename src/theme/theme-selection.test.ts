// @ts-expect-error Node types intentionally absent from Expo config.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { themes } from "./tokens";
const source = readFileSync("public/theme-controller.js", "utf8");
function boot(stored: string | null, dark = false, storageError = false) {
  const callbacks: Record<string, () => void> = {}, root = { dataset: {} as Record<string,string> }, meta = { content: "" };
  const storage = { getItem: vi.fn(() => { if(storageError) throw Error("blocked"); return stored; }), setItem: vi.fn(() => { if(storageError) throw Error("blocked"); }) };
  const media = { matches: dark, addEventListener: vi.fn((event:string, fn:()=>void) => { callbacks[event] = fn; }) };
  const win = { __opcoTheme: undefined as undefined | { getSnapshot(): { preference:string;resolved:string;persistence:string }; setPreference(value:string):boolean; subscribe(fn:()=>void):()=>void }, __opcoThemeCanvases: { light: themes.light.canvas, dark: themes.dark.canvas }, matchMedia: () => media, addEventListener: vi.fn((event:string, fn:()=>void) => { callbacks[event] = fn; }) };
  const run = () => new Function("window", "document", "localStorage", source)(win, { documentElement: root, querySelector: () => meta }, storage);
  run(); return { win, root, meta, storage, media, callbacks, run, controller:win.__opcoTheme! };
}
describe("web appearance preference isolated from operational storage", () => {
  it.each(["light", "dark", "auto"])("restores %s before consumers with stable snapshots", preference => {
    const b=boot(preference,true);expect(b.controller.getSnapshot().preference).toBe(preference);
    expect(b.root.dataset.opcoTheme).toBe(preference === "light" ? "light" : "dark");
    expect(b.controller.getSnapshot()).toBe(b.controller.getSnapshot());expect(b.storage.setItem).not.toHaveBeenCalled();
  });
  it("uses system for absent/invalid preference and follows later changes only in auto",()=>{
    const b=boot("obsolete",true);expect(b.root.dataset.opcoTheme).toBe("dark");b.media.matches=false;b.callbacks.change();expect(b.root.dataset.opcoTheme).toBe("light");
    b.controller.setPreference("dark");b.callbacks.change();expect(b.root.dataset.opcoTheme).toBe("dark");expect(b.storage.setItem).toHaveBeenCalledWith("opco.appearance.v1","dark");
  });
  it("reports unavailable persistence without changing business stores or blocking rendering",()=>{
    const b=boot(null,true,true);expect(b.controller.getSnapshot().persistence).toBe("unavailable");expect(b.controller.setPreference("light")).toBe(false);
    expect(b.root.dataset.opcoTheme).toBe("light");expect(b.controller.getSnapshot().persistence).toBe("unavailable");
  });
  it("does not install duplicate controllers/listeners and ignores unsupported input",()=>{
    const b=boot(null), original=b.controller;const fn=vi.fn(),unsubscribe=b.controller.subscribe(fn);b.run();expect(b.win.__opcoTheme).toBe(original);
    expect(b.media.addEventListener).toHaveBeenCalledTimes(1);expect(b.controller.setPreference("arbitrary")).toBe(false);expect(b.storage.setItem).not.toHaveBeenCalled();
    b.controller.setPreference("dark");expect(fn).toHaveBeenCalledTimes(1);unsubscribe();b.controller.setPreference("light");expect(fn).toHaveBeenCalledTimes(1);
  });
});
