import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ReportAppView, ReportResponse } from "@/lib/opco-api";
import { loadReportWithOfflineCache } from "@/lib/offline-reports";
import { stableTextInputStyle } from "@/lib/visual-stability";
import { AppViewRendererProps } from "@/renderers/types";
import { useSession } from "@/state/session";

import { buildReportCurrentStatusModel, buildReportMatrixModel, buildReportTableModel } from "./report-renderer-logic";
import {
  formatMonthLabel,
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
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshCount, setRefreshCount] = useState(0);
  const isCurrentStatus = appView.config.presentationMode === "CURRENT_STATUS";

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
      setFromCache(false);

      try {
        const query = isCurrentStatus
          ? { search: debouncedSearch }
          : range;
        const result = await loadReportWithOfflineCache({
          api,
          appViewId: appView.id,
          contractId: selectedContractId,
          ownerKey,
          query,
          store: definitionCache,
          token,
        });

        if (isMounted) {
          setReport(result.report);
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
  }, [api, appView.id, debouncedSearch, definitionCache, isCurrentStatus, ownerKey, range, refreshCount, selectedContractId, token]);

  const table = useMemo(() => report ? buildReportTableModel(report) : null, [report]);
  const matrix = useMemo(() => report ? buildReportMatrixModel(report) : null, [report]);
  const currentStatus = useMemo(() => report ? buildReportCurrentStatusModel(report) : null, [report]);

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

      {isLoading ? (
        <View style={styles.stateBox}>
          <ActivityIndicator />
          <Text style={styles.stateText}>Cargando reporte...</Text>
        </View>
      ) : error ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>{error}</Text>
        </View>
      ) : !report ||
        (report.config.presentationMode === "TABLE" && !table) ||
        (report.config.presentationMode === "MATRIX" && !matrix) ||
        (report.config.presentationMode === "CURRENT_STATUS" && !currentStatus) ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>Este reporte necesita configuración.</Text>
        </View>
      ) : report.records.length === 0 ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>{isCurrentStatus ? "No hay registros con estado." : "No hay registros para el período seleccionado."}</Text>
        </View>
      ) : report.config.presentationMode === "CURRENT_STATUS" && currentStatus ? (
        <CurrentStatusReport model={currentStatus} />
      ) : report.config.presentationMode === "TABLE" && table ? (
        <ReportTable table={table} />
      ) : matrix ? (
        <ReportMatrix matrix={matrix} />
      ) : null}
    </ScrollView>
  );
}

function CurrentStatusReport({ model }: { model: NonNullable<ReturnType<typeof buildReportCurrentStatusModel>> }) {
  return (
    <View style={styles.statusList}>
      {model.rows.map((row) => (
        <View key={row.id} style={styles.statusRow}>
          <Text numberOfLines={1} style={styles.statusName}>{row.name}</Text>
          <Text numberOfLines={1} style={styles.statusValue}>{row.state}</Text>
          {model.showDate ? <Text numberOfLines={1} style={styles.statusDate}>{row.date ?? ""}</Text> : null}
        </View>
      ))}
    </View>
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
        <Text style={styles.monthLabel}>{formatMonthLabel(period.month)}</Text>
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
      <TextInput
        inputMode="numeric"
        onChangeText={onChangeText}
        placeholder="YYYY-MM-DD"
        style={[stableTextInputStyle, styles.input]}
        value={value}
      />
    </View>
  );
}

function ReportTable({ table }: { table: NonNullable<ReturnType<typeof buildReportTableModel>> }) {
  return (
    <ScrollView horizontal style={styles.horizontalScroll}>
      <View style={styles.table}>
        <View style={styles.row}>
          {table.columns.map((column) => (
            <Text key={column.id} style={[styles.cell, styles.headerCell]}>{column.name}</Text>
          ))}
        </View>
        {table.rows.map((row) => (
          <View key={row.id} style={styles.row}>
            {row.values.map((value, index) => (
              <Text key={`${row.id}-${index}`} style={styles.cell}>{value || "-"}</Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function ReportMatrix({ matrix }: { matrix: NonNullable<ReturnType<typeof buildReportMatrixModel>> }) {
  return (
    <ScrollView horizontal style={styles.horizontalScroll}>
      <View style={styles.table}>
        <View style={styles.row}>
          <Text style={[styles.cell, styles.stickyCell, styles.headerCell]}>Fila</Text>
          {matrix.columns.map((column) => (
            <Text key={column.key} style={[styles.cell, styles.compactCell, styles.headerCell]}>{column.label}</Text>
          ))}
          {matrix.rows.some((row) => row.summary !== null) ? (
            <Text style={[styles.cell, styles.headerCell]}>Resumen</Text>
          ) : null}
        </View>
        {matrix.rows.map((row) => (
          <View key={row.id} style={styles.row}>
            <Text style={[styles.cell, styles.stickyCell]}>{row.label}</Text>
            {matrix.columns.map((column) => (
              <Text key={`${row.id}-${column.key}`} style={[styles.cell, styles.compactCell]}>
                {row.values[column.key] || "-"}
              </Text>
            ))}
            {row.summary !== null ? <Text style={styles.cell}>{row.summary}</Text> : null}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  cell: {
    borderBottomColor: "#e5e7eb",
    borderBottomWidth: 1,
    color: "#111827",
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
    backgroundColor: "#111827",
    borderRadius: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  filterButtonText: {
    color: "#ffffff",
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
    color: "#111827",
    fontSize: 16,
    minHeight: 44,
    paddingVertical: 12,
  },
  header: {
    gap: 2,
  },
  headerCell: {
    backgroundColor: "#f9fafb",
    color: "#374151",
    fontWeight: "700",
  },
  horizontalScroll: {
    maxWidth: "100%",
  },
  input: {
    fontSize: 16,
  },
  searchInput: {
    backgroundColor: "#ffffff",
    borderColor: "#d1d5db",
    borderRadius: 8,
    borderWidth: 1,
    color: "#111827",
    flex: 1,
    minHeight: 44,
    minWidth: 180,
    paddingHorizontal: 12,
  },
  inputLabel: {
    color: "#4b5563",
    fontSize: 13,
    fontWeight: "600",
  },
  monthButton: {
    alignItems: "center",
    borderColor: "#d1d5db",
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  monthButtonText: {
    color: "#111827",
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
    color: "#111827",
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
    borderColor: "#e5e7eb",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 20,
  },
  stateText: {
    color: "#4b5563",
    fontSize: 14,
    textAlign: "center",
  },
  stickyCell: {
    backgroundColor: "#ffffff",
    fontWeight: "600",
    width: 180,
  },
  statusDate: {
    color: "#6b7280",
    flexBasis: 104,
    fontSize: 13,
    fontWeight: "600",
  },
  statusList: {
    gap: 10,
  },
  statusName: {
    color: "#111827",
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    minWidth: 140,
  },
  statusRow: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#e5e7eb",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  statusValue: {
    color: "#135d66",
    flexBasis: 120,
    fontSize: 14,
    fontWeight: "800",
  },
  subtitle: {
    color: "#6b7280",
    fontSize: 14,
  },
  table: {
    borderColor: "#e5e7eb",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  title: {
    color: "#111827",
    fontSize: 24,
    fontWeight: "700",
  },
});
