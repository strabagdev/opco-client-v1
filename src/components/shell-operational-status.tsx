import { AlertCircle, CheckCircle2, CircleDashed, Clock3, Wifi, WifiOff } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AppShellPreparationProgress } from "../lib/app-shell-feedback";
import type { ShellOperationalStatus, ShellStatusPart } from "../lib/shell-status-presentation";
import { actionSurface, operationalPaint } from "../theme/operational-presentation";
import { colors } from "../theme/paint";
import { metrics, radii, space, typography } from "../theme/tokens";

/** One diagnostic entry, two independent states. No timers, subscriptions or network work. */
export function ShellOperationalStatusIndicator({ model, progress, onPress }: {
  model: ShellOperationalStatus;
  progress?: AppShellPreparationProgress;
  onPress(): void;
}) {
  return <Pressable
    testID="shell-operational-status"
    accessibilityRole="button"
    accessibilityLabel={`Conexión: ${model.connection.label}. Sincronización: ${model.sync.label}.${model.notice ? ` ${model.notice}.` : ""}`}
    accessibilityHint="Abre el diagnóstico de conexión y cambios locales"
    accessibilityLiveRegion="polite"
    onPress={onPress}
    style={interaction => [s.button, actionSurface(false, interaction)]}
  >
    <View style={s.summary}>
      <StatusPart part={model.connection} />
      <Text style={s.separator}>·</Text>
      <StatusPart part={model.sync} />
    </View>
    {model.notice ? <Text style={s.notice}>{model.notice}</Text> : null}
    {progress ? <View style={s.progress} accessibilityRole="progressbar" accessibilityLabel="Preparación offline" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.processed} aria-valuetext={`${progress.processed} de ${progress.total} experiencias procesadas`} accessibilityValue={{ min: 0, max: progress.total, now: progress.processed, text: `${progress.processed} de ${progress.total} experiencias procesadas` }}>
      <View style={s.track}>
        <View style={[s.fill, { flex: progress.processed }, progress.state !== "active" && s.incomplete]} />
        <View style={{ flex: progress.total - progress.processed }} />
      </View>
      <Text style={s.notice}>{progress.processed}/{progress.total} procesadas</Text>
    </View> : null}
  </Pressable>;
}

function StatusPart({ part }: { part: ShellStatusPart }) {
  const paint = operationalPaint(part.tone);
  const Icon = part.kind === "online" ? Wifi : part.kind === "offline" ? WifiOff
    : part.kind === "synced" ? CheckCircle2 : part.kind === "error" || part.kind === "conflict" ? AlertCircle
      : part.kind === "checking" || part.kind === "syncing" || part.kind === "pending" ? Clock3 : CircleDashed;
  return <View style={s.part}>
    <Icon color={paint.color} size={metrics.iconSmall} accessible={false} />
    <Text style={[s.label, { color: paint.color }]}>{part.label}</Text>
  </View>;
}

const s = StyleSheet.create({
  button: { minHeight: metrics.controlMinHeight, maxWidth: "100%", justifyContent: "center", alignItems: "flex-start", paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radii.control, gap: space.xs },
  summary: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm, maxWidth: "100%" },
  part: { flexDirection: "row", alignItems: "center", flexShrink: 1, gap: space.xs, minWidth: 0 },
  label: { flexShrink: 1, fontSize: typography.meta.fontSize, lineHeight: typography.meta.lineHeight, fontWeight: "600" },
  separator: { color: colors.textSecondary },
  notice: { color: colors.textSecondary, fontSize: typography.meta.fontSize, lineHeight: typography.meta.lineHeight },
  progress: { gap: space.hair, width: "100%", maxWidth: 240 },
  track: { flexDirection: "row", height: space.xs, backgroundColor: colors.surfaceSubtle, borderRadius: space.hair, overflow: "hidden" },
  fill: { backgroundColor: colors.primary },
  incomplete: { backgroundColor: colors.warning },
});
