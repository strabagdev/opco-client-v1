import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { AppIcon } from "./app-icon";

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

describe("AppIcon", () => {
  it("renders a valid icon key as an icon element", () => {
    const element = AppIcon({ icon: "file-text", testID: "icon" });

    expect(isValidElement(element)).toBe(true);
    expect(String(isValidElement(element) ? element.type : "")).not.toContain("file-text");
  });

  it("can render nothing for null when the context asks for no fallback", () => {
    expect(AppIcon({ fallback: "none", icon: null })).toBeNull();
  });

  it("uses the generic fallback for an unknown key without rendering the raw string", () => {
    const element = AppIcon({ icon: "unknown-icon" });

    expect(isValidElement(element)).toBe(true);
    expect(JSON.stringify(isValidElement(element) ? element.props : {})).not.toContain("unknown-icon");
  });
});
