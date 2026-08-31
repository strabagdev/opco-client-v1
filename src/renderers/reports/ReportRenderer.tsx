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
import { stableTextInputStyle } from "@/lib/visual-stability";
import { AppViewRendererProps } from "@/renderers/types";
import { useSession } from "@/state/session";

import { buildReportMatrixModel, buildReportTableModel } from "./report-renderer-logic";

export function ReportRenderer({ appView }: AppViewRendererProps<ReportAppView>) {
  const { api, selectedContractId, token } = useSession();
  const [from, setFrom] = useState(defaultMonthStart());
  const [to, setTo] = useState(formatLocalDateInput(new Date()));
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function loadReport() {
      if (!token || !selectedContractId) {
        setError("Selecciona un contrato antes de abrir reportes.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const nextReport = await api.getReport(token, selectedContractId, appView.id, { from, to });

        if (isMounted) {
          setReport(nextReport);
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
  }, [api, appView.id, from, refreshCount, selectedContractId, to, token]);

  const table = useMemo(() => report ? buildReportTableModel(report) : null, [report]);
  const matrix = useMemo(() => report ? buildReportMatrixModel(report) : null, [report]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{appView.name}</Text>
        <Text style={styles.subtitle}>Reporte</Text>
      </View>

      <View style={styles.filters}>
        <DateInput label="Desde" onChangeText={setFrom} value={from} />
        <DateInput label="Hasta" onChangeText={setTo} value={to} />
        <Pressable
          accessibilityRole="button"
          onPress={() => setRefreshCount((count) => count + 1)}
          style={styles.filterButton}
        >
          <Text style={styles.filterButtonText}>Actualizar</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.stateBox}>
          <ActivityIndicator />
          <Text style={styles.stateText}>Cargando reporte...</Text>
        </View>
      ) : error ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>{error}</Text>
        </View>
      ) : !report || (report.config.presentationMode === "TABLE" && !table) || (report.config.presentationMode === "MATRIX" && !matrix) ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>Este reporte necesita configuración.</Text>
        </View>
      ) : report.records.length === 0 ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>No hay registros para el período seleccionado.</Text>
        </View>
      ) : report.config.presentationMode === "TABLE" && table ? (
        <ReportTable table={table} />
      ) : matrix ? (
        <ReportMatrix matrix={matrix} />
      ) : null}
    </ScrollView>
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

function defaultMonthStart() {
  const today = new Date();
  return formatLocalDateInput(new Date(today.getFullYear(), today.getMonth(), 1));
}

function formatLocalDateInput(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
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
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
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
  inputLabel: {
    color: "#4b5563",
    fontSize: 13,
    fontWeight: "600",
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
