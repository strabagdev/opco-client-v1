import { type ThemeColors } from "../../theme/tokens";
import { colors } from "../../theme/paint";
import { DateFieldInput, MonthFieldInput } from "@/renderers/records/temporal-input";
import { useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ReadLoadingState } from "@/components/read-loading-indicator";
import { FormAction, FormActions } from "../../components/form-actions";
import { reportReadRows } from "./report-read-presentation";

import { ReportAppView, ReportResponse } from "@/lib/opco-api";
import { loadReportWithOfflineCache } from "@/lib/offline-reports";
import { stableTextInputStyle } from "@/lib/visual-stability";
import { AppViewRendererProps } from "@/renderers/types";
import { useExperienceOpeningTelemetry } from "@/renderers/experience-opening";
import { useExperienceActivityReporter } from "@/renderers/use-experience-activity";
import { useSession } from "@/state/session";

import {
  buildReportCurrentStatusModel,
  buildReportMatrixModel,
  buildReportTableModel,
  isCurrentStatusReport,
} from "./report-renderer-logic";
import {
  initialReportPeriod,
  normalizeReportTimeFilter,
  reportPeriodToRange,
  shiftMonth,
  type ReportPeriodState,
} from "./report-time-filter";

export function ReportRenderer({ appView }: AppViewRendererProps<ReportAppView>) {
  const { api, connectivityStatus, definitionCache, ownerKey, selectedContractId, token } = useSession();
  const timeFilter = useMemo(() => normalizeReportTimeFilter(appView.config), [appView.config]);
  const [period, setPeriod] = useState<ReportPeriodState>(() => initialReportPeriod(appView.config));
  const range = useMemo(() => reportPeriodToRange(period), [period]);
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshCount, setRefreshCount] = useState(0);
  const isCurrentStatus = isCurrentStatusReport(appView.config);
  const reportQuery = useMemo(() => isCurrentStatus ? { search: debouncedSearch } : range, [debouncedSearch, isCurrentStatus, range]);
  const reportQueryKey = JSON.stringify(reportQuery);
  const visibleReport = report && loadedQueryKey === reportQueryKey ? report : null;
  useExperienceActivityReporter(appView, {
    activeCount: Number(isLoading),
    readCount: Number(isLoading),
    readMode: visibleReport ? "refresh" : "initial",
    errorCode: error ? "REPORT_READ_FAILED" : null,
    result: error ? "error" : !isLoading && visibleReport ? "success" : null,
  });

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedSearch(searchText.trim());
    }, 350);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [searchText]);

  useEffect(() => {
    let isMounted = true;

    async function loadReport() {
      if (!token || !selectedContractId || !ownerKey) {
        setError("Selecciona un contrato antes de abrir reportes.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await loadReportWithOfflineCache({
          api,
          appViewId: appView.id,
          contractId: selectedContractId,
          ownerKey,
          query: reportQuery,
          store: definitionCache,
          token,
        });

        if (isMounted) {
          setReport(result.report);
          setLoadedQueryKey(reportQueryKey);
          setFromCache(result.fromCache);
        }
      } catch (nextError) {
        if (isMounted) {
          setError(nextError instanceof Error ? nextError.message : "No fue posible cargar el reporte.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadReport();

    return () => {
      isMounted = false;
    };
  }, [api, appView.id, definitionCache, ownerKey, refreshCount, reportQuery, reportQueryKey, selectedContractId, token]);

  const table = useMemo(() => visibleReport ? buildReportTableModel(visibleReport) : null, [visibleReport]);
  const matrix = useMemo(() => visibleReport ? buildReportMatrixModel(visibleReport) : null, [visibleReport]);
  const currentStatus = useMemo(() => visibleReport ? buildReportCurrentStatusModel(visibleReport) : null, [visibleReport]);
  useExperienceOpeningTelemetry(appView, useMemo(() => ({
    errorCode: error ? "REPORT_LOAD_FAILED" : null,
    firstUseful: Boolean(visibleReport) && !error,
    processedCount: visibleReport?.records.length ?? 0,
    ready: !isLoading,
    result: isLoading ? "in_progress" as const : error ? "error" as const : "completed" as const,
    shownCount: visibleReport?.records.length ?? 0,
    source: visibleReport ? (fromCache ? "local" as const : "remote" as const) : "unknown" as const,
  }), [error, fromCache, isLoading, visibleReport]));

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{appView.name}</Text>
        <Text style={styles.subtitle}>{fromCache || connectivityStatus === "offline" ? "Reporte offline" : "Reporte"}</Text>
      </View>

      {isCurrentStatus ? (
        <View style={styles.filters}>
          <TextInput
            autoCapitalize="none"
            clearButtonMode="while-editing"
            onChangeText={setSearchText}
            placeholder="Buscar registros"
            returnKeyType="search"
            style={[stableTextInputStyle, styles.searchInput]}
            value={searchText}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => setRefreshCount((count) => count + 1)}
            style={styles.filterButton}
          >
            <Text style={styles.filterButtonText}>Actualizar</Text>
          </Pressable>
        </View>
      ) : appView.config.presentationMode === "TABLE" ? (
        <ReportTableControls allowChange={timeFilter.allowChange} onChange={setPeriod} period={period}
          onRefresh={() => setRefreshCount((count) => count + 1)} />
      ) : (
        <View style={styles.filters}>
          <PeriodControl
            allowChange={timeFilter.allowChange}
            onChange={setPeriod}
            period={period}
          />
          <Pressable
            accessibilityRole="button"
            disabled={!timeFilter.allowChange}
            onPress={() => setRefreshCount((count) => count + 1)}
            style={[styles.filterButton, !timeFilter.allowChange ? styles.disabledButton : null]}
          >
            <Text style={styles.filterButtonText}>Actualizar</Text>
          </Pressable>
        </View>
      )}

      {isLoading && !visibleReport ? (
        <View style={styles.stateBox}><ReadLoadingState mode="initial" /></View>
      ) : error && !visibleReport ? (
        <View style={styles.stateBox}><Text style={styles.stateText}>{error}</Text></View>
      ) : !visibleReport ||
        (visibleReport.config.presentationMode === "TABLE" && !table) ||
        (visibleReport.config.presentationMode === "MATRIX" && !matrix) ||
        (isCurrentStatusReport(visibleReport.config) && !currentStatus) ? (
        <View style={styles.stateBox}><Text style={styles.stateText}>Este reporte necesita configuración.</Text></View>
      ) : (
        <>
          {visibleReport.config.presentationMode === "TABLE" && isLoading ? <Text accessibilityLiveRegion="polite" style={tableStyles.refreshText}>Actualizando reporte…</Text> : null}
          {error ? <View style={styles.stateBox}><Text style={styles.stateText}>{error}</Text></View> : null}
          {visibleReport.records.length === 0 ? (
            <View style={styles.stateBox}><Text style={styles.stateText}>{isCurrentStatus ? "No hay registros con estado." : "No hay registros para el período seleccionado."}</Text></View>
          ) : isCurrentStatusReport(visibleReport.config) && currentStatus ? (
            <CurrentStatusReport model={currentStatus} />
          ) : visibleReport.config.presentationMode === "TABLE" && table ? (
            <ReportTable table={table} report={visibleReport} />
          ) : matrix ? (
            <ReportMatrix matrix={matrix} />
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function CurrentStatusReport({ model }: { model: NonNullable<ReturnType<typeof buildReportCurrentStatusModel>> }) {
  return (
    <ScrollView horizontal style={styles.horizontalScroll}>
      <View style={styles.statusTable}>
      <View accessibilityRole="header" style={styles.statusHeaderRow}>
        {model.columns.map((column) => (
          <Text key={column.id} numberOfLines={1} style={[styles.statusCell, styles.statusHeaderText]}>{column.name}</Text>
        ))}
      </View>
      {model.rows.map((row) => (
        <View
          accessibilityLabel={row.values.map((value, index) => `${model.columns[index]?.name ?? "Campo"}: ${value || "-"}`).join(". ")}
          key={row.id}
          style={styles.statusRow}
        >
          {row.values.map((value, index) => (
            <Text key={`${row.id}-${model.columns[index]?.id ?? index}`} numberOfLines={1} style={styles.statusCell}>
              {value || "-"}
            </Text>
          ))}
        </View>
      ))}
      </View>
    </ScrollView>
  );
}

function PeriodControl({
  allowChange,
  onChange,
  period,
}: {
  allowChange: boolean;
  onChange: (value: ReportPeriodState) => void;
  period: ReportPeriodState;
}) {
  if (period.mode === "MONTH") {
    return (
      <View style={styles.monthControl}>
        <Pressable
          accessibilityLabel="Mes anterior"
          accessibilityRole="button"
          disabled={!allowChange}
          onPress={() => onChange({ mode: "MONTH", month: shiftMonth(period.month, -1) })}
          style={[styles.monthButton, !allowChange ? styles.disabledButton : null]}
        >
          <Text style={styles.monthButtonText}>‹</Text>
        </Pressable>
        <View style={{ flexShrink: 1, minWidth: 140 }}><MonthFieldInput label="Mes del informe" required disabled={!allowChange} value={period.month} onChange={month => onChange({ mode: "MONTH", month })} /></View>
        <Pressable
          accessibilityLabel="Mes siguiente"
          accessibilityRole="button"
          disabled={!allowChange}
          onPress={() => onChange({ mode: "MONTH", month: shiftMonth(period.month, 1) })}
          style={[styles.monthButton, !allowChange ? styles.disabledButton : null]}
        >
          <Text style={styles.monthButtonText}>›</Text>
        </Pressable>
      </View>
    );
  }

  if (!allowChange) {
    return (
      <View style={styles.fixedRange}>
        <Text style={styles.inputLabel}>Período</Text>
        <Text style={styles.fixedRangeText}>{period.from} - {period.to}</Text>
      </View>
    );
  }

  return (
    <>
      <DateInput
        label="Desde"
        onChangeText={(from) => onChange({ ...period, from })}
        value={period.from}
      />
      <DateInput
        label="Hasta"
        onChangeText={(to) => onChange({ ...period, to })}
        value={period.to}
      />
    </>
  );
}

function DateInput({
  label,
  onChangeText,
  value,
}: {
  label: string;
  onChangeText: (value: string) => void;
  value: string;
}) {
  return (
    <View style={styles.dateControl}>
      <Text style={styles.inputLabel}>{label}</Text>
      <DateFieldInput label={label} required onChange={onChangeText} value={value} />
    </View>
  );
}

function ReportTableControls({ allowChange, onChange, period, onRefresh }: {
  allowChange: boolean; onChange(value: ReportPeriodState): void; period: ReportPeriodState; onRefresh(): void;
}) {
  return <View testID="report-table-controls" style={tableStyles.controls}>
    <View style={[tableStyles.period, (period.mode === "MONTH" || !allowChange) && tableStyles.naturalPeriod]}><PeriodControl allowChange={allowChange} onChange={onChange} period={period} /></View>
    <FormActions><FormAction label="Actualizar" onPress={onRefresh} disabled={!allowChange} /></FormActions>
  </View>;
}

function ReportTable({ table, report }: { table: NonNullable<ReturnType<typeof buildReportTableModel>>; report: ReportResponse }) {
  const [width, setWidth] = useState(0);
  const compact = width < table.columns.length * 160;
  const rows = reportReadRows(report, table);
  return <View testID="report-table-content" style={tableStyles.table} onLayout={event => {
    const next = Math.floor(event.nativeEvent.layout.width);
    setWidth(current => current === next ? current : next);
  }}>
    <View accessibilityRole="header" style={[tableStyles.headerRow, compact && tableStyles.hidden]}>
      {table.columns.map(column => <Text key={column.id} style={tableStyles.headerCell}>{column.name}</Text>)}
    </View>
    {rows.map(row => <View key={row.id} style={[tableStyles.row, compact && tableStyles.compactRow]}>
      {row.cells.map((values, index) => {
        const column = table.columns[index];
        const fullWidth = width < 600 || column.type === "TEXTAREA" || values.length > 1 || values.some(value => value.text.length > 120);
        return <View key={column.id} style={[tableStyles.cell, compact && [tableStyles.compactCell,
          { width: fullWidth ? "100%" : "50%", flexBasis: fullWidth ? "100%" : "50%" }]]}>
          <Text style={[tableStyles.cellLabel, !compact && tableStyles.hidden]}>{column.name}</Text>
          {values.map((value, item) => <View key={item} style={tableStyles.valueGroup}>
            <Text selectable accessibilityLabel={`${column.name}: ${value.text}`} style={[tableStyles.value, value.status !== "value" && tableStyles.unavailable]}>{value.text}</Text>
            {value.detail ? <Text selectable style={tableStyles.trace}>{value.detail}</Text> : null}
          </View>)}
        </View>;
      })}
    </View>)}
  </View>;
}

function ReportMatrix({ matrix }: { matrix: NonNullable<ReturnType<typeof buildReportMatrixModel>> }) {
  const [width, setWidth] = useState(0);
  const [focused, setFocused] = useState(false);
  const labelWidth = width > 0 && width < 600 ? 144 : 220;
  const columnWidths = matrix.columns.map(column => column.label.length > 12 ? 160 : 72);
  const hasSummary = matrix.rows.some(row => row.summary !== null);
  // Leave room for the pinned row label, borders and a vertical scrollbar in a narrow viewport.
  const summaryWidth = width > 0 ? Math.max(100, Math.min(220, width - labelWidth - 32)) : 220;
  const gridWidth = labelWidth + columnWidths.reduce((sum, value) => sum + value, 0) + (hasSummary ? summaryWidth : 0) + 2;
  const webSticky = Platform.OS === "web";
  return <View style={matrixStyles.section}>
    {width > 0 && gridWidth > width ? <Text style={matrixStyles.hint}>Desplázate dentro de la matriz para consultar todas las filas y columnas.</Text> : null}
    <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator showsVerticalScrollIndicator
      testID="report-matrix-viewport" accessibilityLabel="Matriz del reporte" tabIndex={0}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onLayout={event => { const next = Math.floor(event.nativeEvent.layout.width); setWidth(current => current === next ? current : next); }}
      style={[matrixStyles.viewport, webSticky && ({ maxHeight: "min(68vh, 720px)", overflowY: "auto" } as never),
        webSticky && focused && ({ outline: `3px solid ${colors.focus}`, outlineOffset: 2 } as never)]}>
      <View testID="report-matrix-table" style={[matrixStyles.table, { width: gridWidth }]}>
        <View accessibilityRole="header" style={[matrixStyles.headerRow, webSticky && ({ position: "sticky", top: 0, zIndex: 2 } as never)]}>
          <Text style={[matrixStyles.cell, matrixStyles.rowLabel, matrixStyles.headerCell, { width: labelWidth },
            webSticky && ({ position: "sticky", left: 0, zIndex: 3 } as never)]}>Fila</Text>
          {matrix.columns.map((column, index) => <Text key={column.key}
            style={[matrixStyles.cell, matrixStyles.valueCell, matrixStyles.headerCell, { width: columnWidths[index] }]}>{column.label}</Text>)}
          {hasSummary ? <Text style={[matrixStyles.cell, matrixStyles.summary, matrixStyles.headerCell, { width: summaryWidth }]}>Resumen</Text> : null}
        </View>
        {matrix.rows.map((row, rowIndex) => <View key={row.id} style={[matrixStyles.row, rowIndex % 2 === 1 && matrixStyles.alternateRow]}>
          <Text style={[matrixStyles.cell, matrixStyles.rowLabel, { width: labelWidth }, rowIndex % 2 === 1 && matrixStyles.alternateRow,
            webSticky && ({ position: "sticky", left: 0, zIndex: 1 } as never)]}>{row.label}</Text>
          {matrix.columns.map((column, index) => <Text key={`${row.id}-${column.key}`} selectable
            accessibilityLabel={`${row.label}, ${column.label}: ${row.values[column.key] || "-"}`}
            style={[matrixStyles.cell, matrixStyles.valueCell, { width: columnWidths[index] }, !row.values[column.key] && matrixStyles.emptyCell]}>
            {row.values[column.key] || "-"}
          </Text>)}
          {row.summary !== null ? <Text selectable style={[matrixStyles.cell, matrixStyles.summary, { width: summaryWidth }]}>{row.summary}</Text> : null}
        </View>)}
      </View>
    </ScrollView>
  </View>;
}

export function createReportStyles(p: ThemeColors = colors) {
  return StyleSheet.create({
  cell: {
    borderBottomColor: p.border,
    borderBottomWidth: 1,
    color: p.text,
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    width: 160,
  },
  compactCell: {
    textAlign: "center",
    width: 72,
  },
  container: {
    gap: 16,
    padding: 16,
  },
  dateControl: {
    flex: 1,
    gap: 6,
    minWidth: 140,
  },
  filterButton: {
    alignItems: "center",
    alignSelf: "flex-end",
    backgroundColor: p.primary,
    borderRadius: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  filterButtonText: {
    color: p.onPrimary,
    fontSize: 14,
    fontWeight: "600",
  },
  disabledButton: {
    opacity: 0.45,
  },
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  fixedRange: {
    gap: 6,
    minWidth: 220,
  },
  fixedRangeText: {
    color: p.text,
    fontSize: 16,
    minHeight: 44,
    paddingVertical: 12,
  },
  header: {
    gap: 2,
  },
  headerCell: {
    backgroundColor: p.surfaceSubtle,
    color: p.text,
    fontWeight: "700",
  },
  horizontalScroll: {
    maxWidth: "100%",
  },
  input: {
    fontSize: 16,
  },
  searchInput: {
    backgroundColor: p.surface,
    borderColor: p.controlBorder,
    borderRadius: 8,
    borderWidth: 1,
    color: p.text,
    flex: 1,
    minHeight: 44,
    minWidth: 180,
    paddingHorizontal: 12,
  },
  inputLabel: {
    color: p.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  monthButton: {
    alignItems: "center",
    borderColor: p.controlBorder,
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  monthButtonText: {
    color: p.text,
    fontSize: 24,
    lineHeight: 28,
  },
  monthControl: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 44,
  },
  monthLabel: {
    color: p.textSecondary,
    fontSize: 16,
    fontWeight: "600",
    minWidth: 148,
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
  },
  stateBox: {
    alignItems: "center",
    borderColor: p.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 20,
  },
  stateText: {
    color: p.textSecondary,
    fontSize: 14,
    textAlign: "center",
  },
  stickyCell: {
    backgroundColor: p.surface,
    fontWeight: "600",
    width: 180,
  },
  statusCell: {
    color: p.text,
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    width: 156,
  },
  statusHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    minHeight: 32,
    paddingHorizontal: 12,
  },
  statusHeaderText: {
    color: p.textSecondary,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  statusRow: {
    alignItems: "center",
    backgroundColor: p.surface,
    borderBottomColor: p.border,
    borderBottomWidth: 1,
    flexDirection: "row",
  },
  statusTable: {
    borderColor: p.border,
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  subtitle: {
    color: p.textSecondary,
    fontSize: 14,
  },
  table: {
    borderColor: p.border,
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  title: {
    color: p.text,
    fontSize: 24,
    fontWeight: "700",
  },
});
}
const styles = createReportStyles();


export function createReportTableStyles(p: ThemeColors = colors) {
  return StyleSheet.create({
  controls: { flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "flex-end", minWidth: 0 },
  period: { flexDirection: "row", flexWrap: "wrap", flexGrow: 1, flexBasis: 280, maxWidth: 620, gap: 12, minWidth: 0 },
  naturalPeriod: { flexGrow: 0, flexBasis: "auto" },
  refreshText: { color: p.textSecondary, fontSize: 13, lineHeight: 18 },
  table: { width: "100%", minWidth: 0, borderWidth: 1, borderColor: p.border, borderRadius: 8, overflow: "hidden", backgroundColor: p.surface },
  headerRow: { flexDirection: "row", backgroundColor: p.surfaceSubtle },
  headerCell: { flexBasis: 0, flexGrow: 1, flexShrink: 1, minWidth: 160, padding: 10, color: p.textSecondary, fontSize: 13, fontWeight: "700" },
  row: { flexDirection: "row", borderTopWidth: 1, borderColor: p.border, minWidth: 0 },
  compactRow: { flexWrap: "wrap", paddingVertical: 4 },
  cell: { flexBasis: 0, flexGrow: 1, flexShrink: 1, padding: 10, gap: 4, minWidth: 160 },
  compactCell: { flexGrow: 0, flexShrink: 0, minWidth: 0, paddingVertical: 6 },
  cellLabel: { color: p.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  valueGroup: { gap: 2, minWidth: 0 },
  value: { color: p.text, fontSize: 14, lineHeight: 20, minWidth: 0 },
  unavailable: { color: p.textSecondary },
  trace: { color: p.textSecondary, fontSize: 12, lineHeight: 18 },
  hidden: { display: "none" },
});
}
const tableStyles = createReportTableStyles();


export function createReportMatrixStyles(p: ThemeColors = colors) {
  return StyleSheet.create({
  section: { gap: 8, minWidth: 0 },
  hint: { color: p.textSecondary, fontSize: 13, lineHeight: 18 },
  viewport: { maxWidth: "100%", minWidth: 0, borderWidth: 1, borderColor: p.border, borderRadius: 8, backgroundColor: p.surface },
  table: { minWidth: 0, backgroundColor: p.surface },
  headerRow: { flexDirection: "row", backgroundColor: p.surfaceSubtle },
  row: { flexDirection: "row", backgroundColor: p.surface },
  alternateRow: { backgroundColor: p.surfaceAlternate },
  cell: { flexShrink: 0, minHeight: 44, paddingHorizontal: 10, paddingVertical: 10, fontSize: 14, lineHeight: 20, color: p.text,
    borderBottomWidth: 1, borderRightWidth: 1, borderColor: p.border },
  headerCell: { backgroundColor: p.surfaceSubtle, color: p.text, fontWeight: "700" },
  rowLabel: { backgroundColor: p.surface, fontWeight: "600" },
  valueCell: { textAlign: "center", fontVariant: ["tabular-nums"] },
  summary: { width: 220, backgroundColor: p.surfaceSubtle, fontWeight: "600" },
  emptyCell: { color: p.textSecondary },
});
}
const matrixStyles = createReportMatrixStyles();
