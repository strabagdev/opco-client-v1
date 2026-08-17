import { describe, expect, it, vi } from "vitest";

import {
  appIconOptions,
  FALLBACK_APP_ICON,
  getAppIconComponent,
  normalizeAppIcon,
  resolvePreferredAppIcon,
} from "./app-icons";

vi.mock("lucide-react-native", () => {
  const createIcon = (name: string) => {
    function MockIcon() {
      return null;
    }
    MockIcon.displayName = name;
    return MockIcon;
  };

  return {
    Boxes: createIcon("Boxes"),
    Building: createIcon("Building"),
    Calendar: createIcon("Calendar"),
    ChartNoAxesColumn: createIcon("ChartNoAxesColumn"),
    Circle: createIcon("Circle"),
    CircleDollarSign: createIcon("CircleDollarSign"),
    Clipboard: createIcon("Clipboard"),
    ClipboardCheck: createIcon("ClipboardCheck"),
    Clock: createIcon("Clock"),
    Construction: createIcon("Construction"),
    Database: createIcon("Database"),
    Factory: createIcon("Factory"),
    FileQuestion: createIcon("FileQuestion"),
    FileText: createIcon("FileText"),
    Folder: createIcon("Folder"),
    HardHat: createIcon("HardHat"),
    LayoutDashboard: createIcon("LayoutDashboard"),
    Map: createIcon("Map"),
    MapPin: createIcon("MapPin"),
    Package: createIcon("Package"),
    Pickaxe: createIcon("Pickaxe"),
    Ruler: createIcon("Ruler"),
    Settings: createIcon("Settings"),
    Shield: createIcon("Shield"),
    Tag: createIcon("Tag"),
    TriangleAlert: createIcon("TriangleAlert"),
    Truck: createIcon("Truck"),
    UserRound: createIcon("UserRound"),
    Users: createIcon("Users"),
    Warehouse: createIcon("Warehouse"),
    Workflow: createIcon("Workflow"),
    Wrench: createIcon("Wrench"),
  };
});

describe("app icons", () => {
  it("maps stable keys to real icon components", () => {
    expect(getAppIconComponent("warehouse")).toBeTruthy();
    expect(getAppIconComponent("truck")).toBeTruthy();
    expect(getAppIconComponent("file-text")).toBeTruthy();
  });

  it("normalizes null and unknown keys without exposing them as valid icons", () => {
    expect(normalizeAppIcon(null)).toBeNull();
    expect(normalizeAppIcon("")).toBeNull();
    expect(normalizeAppIcon("missing-icon")).toBeNull();
  });

  it("keeps AppView.icon ahead of EntityType.icon", () => {
    expect(resolvePreferredAppIcon("truck", "warehouse")).toBe("truck");
  });

  it("falls back to EntityType.icon when AppView.icon is empty", () => {
    expect(resolvePreferredAppIcon(null, "warehouse")).toBe("warehouse");
  });

  it("uses a generic fallback component for unknown keys at render time", () => {
    expect(getAppIconComponent("missing-icon") ?? FALLBACK_APP_ICON).toBe(FALLBACK_APP_ICON);
  });

  it("does not include raw icon keys as render labels", () => {
    expect(appIconOptions.map((option) => option.key)).toContain("file-text");
    expect(appIconOptions.every((option) => option.label !== String(option.key))).toBe(true);
  });
});
