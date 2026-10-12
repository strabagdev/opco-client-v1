export const APP_SHELL_HORIZONTAL_GUTTER = 20;
export const APP_SHELL_WIDE_BREAKPOINT = 900;
export const APP_SHELL_DESKTOP_GUTTER = 24;
export const HOME_MAX_WIDTH = 1280;
export const HOME_THREE_COLUMN_BREAKPOINT = 1200;
export const HOME_DESKTOP_CARD_GAP = 16;

export function getHomeGridLayout(viewportWidth: number, measuredContentWidth?: number) {
  const wide = viewportWidth >= APP_SHELL_WIDE_BREAKPOINT;
  const columns = viewportWidth >= HOME_THREE_COLUMN_BREAKPOINT ? 3 : wide ? 2 : 1;
  const padding = wide ? APP_SHELL_DESKTOP_GUTTER : APP_SHELL_HORIZONTAL_GUTTER;
  const gap = wide ? HOME_DESKTOP_CARD_GAP : 10;
  const contentWidth = measuredContentWidth ?? Math.max(0, Math.min(viewportWidth, wide ? HOME_MAX_WIDTH : viewportWidth) - padding * 2);
  return { columns, padding, gap, cardWidth: Math.max(0, (contentWidth - gap * (columns - 1)) / columns) };
}

export function getDesktopSidebarWidth(viewportWidth: number) {
  return viewportWidth < APP_SHELL_WIDE_BREAKPOINT ? 0 : viewportWidth >= HOME_THREE_COLUMN_BREAKPOINT ? 264 : 224;
}
