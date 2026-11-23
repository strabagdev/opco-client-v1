import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserStorageDiagnostics } from "./browser-storage-diagnostics";
vi.mock("react-native", async () => import("react-native-web"));
afterEach(() => vi.unstubAllGlobals());

describe("storage section in the existing diagnostic", () => {
  it("does not query or request permissions while rendering server markup", () => {
    const persist = vi.fn(), persisted = vi.fn(), estimate = vi.fn();
    vi.stubGlobal("navigator", { storage: { persist, persisted, estimate } });
    const html = renderToStaticMarkup(<BrowserStorageDiagnostics />);
    expect(persist).not.toHaveBeenCalled();
    expect(persisted).not.toHaveBeenCalled();
    expect(estimate).not.toHaveBeenCalled();
    expect(html).toContain("Desconocida");
    expect(html).toContain("Uso estimado");
    expect(html).toContain("Cuota estimada");
    expect(html).toContain('aria-label="Solicitar persistencia"');
  });
  it("presents one explicit action and one limitation notice, without claiming a backup", () => {
    const html = renderToStaticMarkup(<BrowserStorageDiagnostics />);
    expect(html.match(/aria-label="Solicitar persistencia"/g)).toHaveLength(1);
    expect(html.match(/no espacio garantizado/g)).toHaveLength(1);
    expect(html.match(/no es un respaldo/g)).toHaveLength(1);
    expect(html).toContain("no protege frente al borrado explícito");
    expect(html).not.toContain("Espacio libre");
  });
});
