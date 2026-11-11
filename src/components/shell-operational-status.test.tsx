import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ShellOperationalStatusIndicator } from "./shell-operational-status";
import type { ShellOperationalStatus } from "../lib/shell-status-presentation";
vi.mock("react-native", async () => import("react-native-web"));
vi.mock("lucide-react-native", () => ({ AlertCircle: () => null, CheckCircle2: () => null, CircleDashed: () => null, Clock3: () => null, Wifi: () => null, WifiOff: () => null }));
const model: ShellOperationalStatus = { connection: { kind: "online", label: "Online", tone: "success" }, sync: { kind: "pending", label: "3 pendientes", tone: "warning" }, notice: null };
describe("one accessible status entry with separate connection and sync", () => {
  it("names both axes once and keeps one diagnostic action", () => {
    const onPress = vi.fn(); const element = ShellOperationalStatusIndicator({ model, onPress });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('aria-label="Conexión: Online. Sincronización: 3 pendientes."');
    expect(html.match(/role="button"/g)).toHaveLength(1); expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain("Sin operaciones en curso");
    element.props.onPress(); expect(onPress).toHaveBeenCalledTimes(1);
  });
  it("keeps preparation progress separate from synchronization and reports failures in plain text", () => {
    const html = renderToStaticMarkup(<ShellOperationalStatusIndicator model={{ ...model, notice: "Preparación offline incompleta" }} progress={{ processed: 11, failed: 2, total: 13, state: "incomplete" }} onPress={vi.fn()} />);
    expect(html).toContain('aria-label="Preparación offline"'); expect(html).toContain('aria-valuenow="11"');
    expect(html).toContain("Preparación offline incompleta"); expect(html).toContain("11/13 procesadas");
  });
});
