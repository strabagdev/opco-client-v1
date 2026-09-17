const DIAGNOSTICS_MODAL_MAX_HEIGHT = 820;
const DIAGNOSTICS_MODAL_COMPACT_GUTTER = 12;
const DIAGNOSTICS_MODAL_WIDE_GUTTER = 24;
const DIAGNOSTICS_MODAL_WIDE_BREAKPOINT = 760;

export function getDiagnosticsModalHeight({
  height,
  width,
}: {
  height: number;
  width: number;
}) {
  const gutter = width < DIAGNOSTICS_MODAL_WIDE_BREAKPOINT
    ? DIAGNOSTICS_MODAL_COMPACT_GUTTER
    : DIAGNOSTICS_MODAL_WIDE_GUTTER;

  return Math.max(0, Math.min(DIAGNOSTICS_MODAL_MAX_HEIGHT, height - gutter * 2));
}

export function shouldShowDiagnosticsTabScrollIndicator(width: number) {
  return width < DIAGNOSTICS_MODAL_WIDE_BREAKPOINT;
}
