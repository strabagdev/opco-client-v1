import { actionColors } from "./control-presentation";
import { type ThemeColors } from "./tokens";
import { colors } from "./paint";

export type OperationalTone = "neutral" | "info" | "success" | "warning" | "danger" | "conflict";
/** Paint only: authoritative labels, priorities, activity and ACKs remain caller-owned. */
export function operationalPaint(tone: OperationalTone, p: ThemeColors = colors) {
  if (tone === "neutral") return { color: p.textSecondary, backgroundColor: p.surfaceSubtle, borderColor: p.controlBorder };
  return { color: p[tone], backgroundColor: p[`${tone}Surface`], borderColor: p[`${tone}Border`] };
}
export function recordStatusPaint(status: string, p: ThemeColors = colors) {
  const tone: OperationalTone = status === "conflict" ? "conflict" : status === "failed" ? "danger"
    : status === "pending_create" || status === "pending_update" ? "warning" : "neutral";
  return operationalPaint(tone, p);
}
/** Interaction paint never decides whether an action is allowed or changes its handler. */
export function actionSurface(primary: boolean, interaction: { pressed?: boolean; hovered?: boolean }, disabled = false, p: ThemeColors = colors) {
  const { backgroundColor, borderColor } = actionColors(primary, { ...interaction, disabled }, p);
  return { backgroundColor, borderColor, opacity: 1 };
}
