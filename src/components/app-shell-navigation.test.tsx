import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppShellHeader, createShellHeaderS } from "./app-shell-header";
import { AppNavigationMenu } from "./app-navigation-menu";
const scope = vi.hoisted(() => ({ pathname: "/view/assigned/record/new", category: undefined as string | undefined, assigned: [{ id: "assigned", name: "Experiencia configurada larga", type: "RECORDS", config: {}, sortOrder: 0 }] }));
vi.mock("react-native", async () => import("react-native-web"));
vi.mock("lucide-react-native", () => ({ ChevronDown: () => null }));
vi.mock("./desktop-navigation", () => ({ useAssignedAppViews: () => scope.assigned }));
vi.mock("expo-router", () => ({
  usePathname: () => scope.pathname, useGlobalSearchParams: () => ({ category: scope.category }), useRouter: () => ({ replace: vi.fn() }),
  Link: ({ children }: { children: ReactElement<{ style: unknown }> }) => { expect(Array.isArray(children.props.style)).toBe(false); return cloneElement(children); },
}));
vi.mock("../state/session", () => ({ useSession: () => ({ context: { organization: { name: "Organización sintética" }, contracts: [{ id: "c", name: "Contrato sintético", role: "ADMIN" }] }, selectedContractId: "c", setSelectedContractId: vi.fn() }) }));
const header = (width: number, pathname = scope.pathname, category?: string) => renderToStaticMarkup(<AppShellHeader pathname={pathname} category={category} contractName="Contrato sintético" width={width} wide={width >= 900} status={<span>Estado verificado</span>} menu={<button>Menú</button>} onBack={vi.fn()} />);
describe("one assigned navigation across viewport sizes", () => {
  it.each([390, 768, 1024, 1440])("keeps the configured experience and back action at %d", width => {
    const html = header(width);
    expect(html).toContain("Experiencia configurada larga"); expect(html).toContain('aria-label="Volver"'); expect(html).toContain("Estado verificado");
    expect(html).not.toContain("Opco Client");
    expect(html.match(/Estado verificado/g)).toHaveLength(1);
    expect(html.match(/>Menú<\/button>/g)).toHaveLength(1);
    const style = createShellHeaderS();
    expect(style.back.minWidth).toBeGreaterThanOrEqual(44);
    expect(style.back.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.middle.minWidth).toBe(0);
    if (width < 900) expect(html).toContain("Contrato: Contrato sintético");
  });
  it("never invents a category from an unassigned URL parameter", () => {
    expect(header(390, "/", "analytics")).toContain("Ubicación: Inicio");
    expect(header(390, "/", "records")).toContain("Ubicación: Registros");
    expect(header(390, "/")).not.toContain('aria-label="Volver"');
  });
  it("reuses only assigned categories and the existing contract selection", () => {
    const html = renderToStaticMarkup(<AppNavigationMenu showNavigation onNavigate={vi.fn()} />);
    expect(html).toContain("Inicio · Todas las experiencias"); expect(html).toContain("Registros"); expect(html).not.toContain("Flujos");
    expect(html).toContain("Contrato activo"); expect(html).toContain("Contrato sintético");
  });
  it("does not duplicate the desktop sidebar navigation in the account menu", () => {
    const html = renderToStaticMarkup(<AppNavigationMenu showNavigation={false} onNavigate={vi.fn()} />);
    expect(html).not.toContain("Todas las experiencias"); expect(html).toContain("Contrato activo");
  });
});
