import { ComponentProps, createElement } from "react";

import { FALLBACK_APP_ICON, getAppIconComponent } from "../lib/app-icons";

type AppIconProps = {
  color?: string;
  fallback?: "generic" | "none";
  icon?: string | null;
  size?: number;
  strokeWidth?: number;
} & Pick<ComponentProps<typeof FALLBACK_APP_ICON>, "style" | "testID">;

export function AppIcon({
  color = "#135d66",
  fallback = "generic",
  icon,
  size = 24,
  strokeWidth = 2,
  style,
  testID,
}: AppIconProps) {
  const Icon = getAppIconComponent(icon) ?? (icon || fallback === "generic" ? FALLBACK_APP_ICON : null);

  if (!Icon) {
    return null;
  }

  return createElement(Icon, {
    color,
    height: size,
    size,
    strokeWidth,
    style,
    testID,
    width: size,
  });
}
