import { cloneElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DesktopSidebar } from "./desktop-navigation";

vi.mock("react-native", async () => import("react-native-web"));
vi.mock("lucide-react-native", () => ({ ChevronDown: () => null }));
vi.mock("expo-router", () => ({
  usePathname: () => "/",
  useGlobalSearchParams: () => ({}),
  useRouter: () => ({ replace: vi.fn() }),
  Link: ({ children }: { children: ReactElement<{ style: unknown }> }) => {
    // Expo Link's Slot merges style props. Array indexes must not reach DOM style.
    expect(Array.isArray(children.props.style)).toBe(false);
    return cloneElement(children);
  },
}));
vi.mock("../state/session", () => ({ useSession: () => ({
  context: { organization: { id: "org", name: "Organización sintética" }, contracts: [{ id: "contract", name: "Contrato sintético con nombre largo completo", role: "ADMIN" }] },
  selectedContractId: "contract", setSelectedContractId: vi.fn(),
}) }));
vi.mock("../lib/local-db", () => ({ subscribeLocalDatabaseCacheChanges: vi.fn() }));

describe("desktop sidebar renders real links without style indexes", () => {
  it("keeps full contract accessible and uses flattened Link styles", () => {
    const html = renderToStaticMarkup(<DesktopSidebar width={264} visible />);
    expect(html).toContain("Contrato: Contrato sintético con nombre largo completo");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Inicio");
    expect(html).not.toContain("Registro de Asistencia");
  });
  it("hides the same sidebar instance in compact presentation", () => {
    expect(renderToStaticMarkup(<DesktopSidebar width={0} visible={false} />)).toContain("display:none");
  });
});
