import { Link } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { buildAppViewRecordHref, buildEditAppViewRecordHref } from "@/lib/app-views";
import { CachedEntityRecord, RecordsFailedOperationDiagnostics } from "@/lib/offline-records";
import { RecordsAppView } from "@/lib/opco-api";
import { getRecordSyncLabel } from "@/sync/records-sync";
import { useSession } from "@/state/session";

type Props = {
  appView: RecordsAppView;
};

const noTranslateProps = Platform.OS === "web"
  ? ({ translate: "no" } as Record<string, string>)
  : {};

export function RecordProblemsScreen({ appView }: Props) {
  const entityTypeId = appView.config.entityTypeId;
  const { definitionCache, discardFailedRecordOperation, ownerKey, recordsFailedOperations, refreshRecordsSyncSummary, retryFailedRecordOperation, selectedContractId } = useSession();
  const [records, setRecords] = useState<CachedEntityRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyRecordId, setBusyRecordId] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const busyRecordsRef = useRef(new Set<string>());

  useEffect(() => {
    let isMounted = true;

    async function loadProblems() {
      if (!selectedContractId || !ownerKey) {
        setError("Selecciona un contrato antes de ver problemas.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await definitionCache.listProblemRecords({
          contractId: selectedContractId,
          entityTypeId,
          ownerKey,
        });

        if (isMounted) {
          setRecords(result);
        }
      } catch (nextError) {
        if (isMounted) {
          setError(nextError instanceof Error ? nextError.message : "No fue posible cargar problemas.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadProblems();

    return () => {
      isMounted = false;
    };
  }, [definitionCache, entityTypeId, ownerKey, retryCount, selectedContractId]);

  async function retryRecord(record: CachedEntityRecord) {
    if (!record.syncErrorCode || isUniqueRecordError(record)) {
      return;
    }

    if (busyRecordsRef.current.has(record.localId)) {
      return;
    }

    busyRecordsRef.current.add(record.localId);
    setBusyRecordId(record.localId);
    try {
      await retryFailedRecordOperation(`records:${record.localId}`);
      await refreshRecordsSyncSummary();
      setRetryCount((count) => count + 1);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No fue posible reintentar.");
    } finally {
      busyRecordsRef.current.delete(record.localId);
      setBusyRecordId(null);
    }
  }

  function confirmDiscard(record: CachedEntityRecord) {
    const title = record.serverId
      ? "Descartar cambios locales"
      : "Descartar registro local";
    const message = record.serverId
      ? "Se conservara el registro del servidor y se eliminaran los cambios locales retenidos."
      : "Se eliminara solo el borrador local y su operacion pendiente.";

    Alert.alert(title, message, [
      { style: "cancel", text: "Cancelar" },
      {
        style: "destructive",
        text: "Descartar",
        onPress: () => {
          void discardRecord(record);
        },
      },
    ]);
  }

  async function discardRecord(record: CachedEntityRecord) {
    if (busyRecordsRef.current.has(record.localId)) {
      return;
    }

    busyRecordsRef.current.add(record.localId);
    setBusyRecordId(record.localId);
    try {
      await discardFailedRecordOperation(`records:${record.localId}`);
      await refreshRecordsSyncSummary();
      setRetryCount((count) => count + 1);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No fue posible descartar el cambio local.");
    } finally {
      busyRecordsRef.current.delete(record.localId);
      setBusyRecordId(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.kicker}>{appView.name}</Text>
        <Text style={styles.title}>Problemas de sincronizacion</Text>
      </View>

      {isLoading ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {error ? (
        <Pressable onPress={() => setRetryCount((count) => count + 1)} style={styles.primaryButton}>
          <Text style={styles.primaryText}>Reintentar</Text>
        </Pressable>
      ) : null}

      {!isLoading && !error && records.length === 0 ? (
        <Text style={styles.empty}>No hay errores ni conflictos pendientes.</Text>
      ) : null}

      <View style={styles.list}>
        {records.map((record) => {
          const uniqueError = isUniqueRecordError(record);
          const failedOperation = recordsFailedOperations.find((operation) => operation.localRecordId === record.localId) ?? null;
          const conflictDetail = formatConflictDetail(failedOperation);
          const isBusy = busyRecordId === record.localId;

          return (
            <View key={record.localId} style={styles.card}>
              <Link href={buildAppViewRecordHref(appView.id, record.id)} asChild>
                <Pressable>
                  <View style={styles.titleRow}>
                    <Text {...noTranslateProps} style={styles.cardTitle}>{record.displayName || "Registro sin nombre"}</Text>
                    <Badge record={record} />
                  </View>
                  {record.syncErrorMessage ? <Text {...noTranslateProps} style={styles.meta}>{record.syncErrorMessage}</Text> : null}
                  {conflictDetail ? (
                    <Text {...noTranslateProps} style={styles.metaStrong}>{conflictDetail}</Text>
                  ) : null}
                  {uniqueError ? <Text style={styles.warning}>Corrige el valor antes de reintentar.</Text> : null}
                </Pressable>
              </Link>
              {record.syncStatus === "failed" ? (
                <View style={styles.cardActions}>
                  <Link href={buildEditAppViewRecordHref(appView.id, record.id)} asChild>
                    <Pressable accessibilityRole="button" style={styles.primaryButton}>
                      <Text style={styles.primaryText}>Resolver error</Text>
                    </Pressable>
                  </Link>
                  {uniqueError ? null : (
                    <Pressable
                      accessibilityRole="button"
                      disabled={isBusy}
                      onPress={() => {
                        void retryRecord(record);
                      }}
                      style={[styles.secondaryButton, isBusy ? styles.buttonDisabled : null]}
                    >
                      <Text style={styles.secondaryText}>{isBusy ? "Reintentando" : "Reintentar"}</Text>
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    disabled={isBusy}
                    onPress={() => confirmDiscard(record)}
                    style={[styles.dangerButton, isBusy ? styles.buttonDisabled : null]}
                  >
                    <Text style={styles.dangerText}>
                      {record.serverId ? "Descartar cambios locales" : "Descartar registro local"}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function formatConflictDetail(operation: RecordsFailedOperationDiagnostics | null) {
  const field = operation?.lastErrorDetails?.fields[0] ?? null;

  if (!field) {
    return null;
  }

  const fieldName = field.fieldLabel ?? field.fieldId;
  const value = formatFieldValue(field.rejectedValue ?? field.submittedRecordIds);

  return value ? `${fieldName}: ${value}` : fieldName;
}

function formatFieldValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(formatFieldValue).filter((item): item is string => Boolean(item)).join(", ");
  }

  return null;
}

function isUniqueRecordError(record: CachedEntityRecord) {
  const code = record.syncErrorCode;
  const message = record.syncErrorMessage ?? "";

  if (code === "UNIQUE_FIELD_CONFLICT") {
    return true;
  }

  return code === "INVALID_RELATION" &&
    /\bdebe ser [úu]nico\b/i.test(message) &&
    /\bdentro de este tipo de entidad\b/i.test(message);
}

function Badge({ record }: { record: CachedEntityRecord }) {
  const label = getRecordSyncLabel(record);

  if (!label) {
    return null;
  }

  return (
    <View style={[styles.badge, record.syncStatus === "failed" ? styles.badgeFailed : styles.badgeConflict]}>
      <Text style={[styles.badgeText, record.syncStatus === "failed" ? styles.badgeFailedText : styles.badgeConflictText]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeConflict: {
    backgroundColor: "#fff7ed",
  },
  badgeConflictText: {
    color: "#9a3412",
  },
  badgeFailed: {
    backgroundColor: "#fef3f2",
  },
  badgeFailedText: {
    color: "#b42318",
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "800",
  },
  card: {
    backgroundColor: "#ffffff",
    borderColor: "#d4dddf",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  cardTitle: {
    color: "#17363c",
    flexShrink: 1,
    fontSize: 17,
    fontWeight: "800",
  },
  cardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  content: {
    gap: 16,
    padding: 20,
    paddingBottom: 36,
  },
  empty: {
    color: "#587078",
    lineHeight: 21,
  },
  error: {
    color: "#b42318",
    lineHeight: 20,
  },
  dangerButton: {
    alignItems: "center",
    borderColor: "#fecaca",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 12,
  },
  dangerText: {
    color: "#b42318",
    fontWeight: "800",
  },
  header: {
    gap: 4,
  },
  kicker: {
    color: "#587078",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  list: {
    gap: 10,
  },
  meta: {
    color: "#587078",
    lineHeight: 20,
  },
  metaStrong: {
    color: "#17363c",
    fontWeight: "800",
    lineHeight: 20,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#135d66",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  primaryText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#b8c7ca",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 12,
  },
  secondaryText: {
    color: "#17363c",
    fontWeight: "800",
  },
  screen: {
    backgroundColor: "#eef4f4",
    flex: 1,
  },
  title: {
    color: "#0f3036",
    fontSize: 26,
    fontWeight: "800",
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
  },
  warning: {
    color: "#9a3412",
    lineHeight: 20,
  },
});
