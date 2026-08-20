import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { buildAppViewRecordHref } from "@/lib/app-views";
import { CachedEntityRecord } from "@/lib/offline-records";
import { RecordsAppView } from "@/lib/opco-api";
import { getRecordSyncLabel } from "@/sync/records-sync";
import { useSession } from "@/state/session";

type Props = {
  appView: RecordsAppView;
};

export function RecordProblemsScreen({ appView }: Props) {
  const entityTypeId = appView.config.entityTypeId;
  const { definitionCache, ownerKey, selectedContractId } = useSession();
  const [records, setRecords] = useState<CachedEntityRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

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
        {records.map((record) => (
          <Link href={buildAppViewRecordHref(appView.id, record.id)} key={record.localId} asChild>
            <Pressable style={styles.card}>
              <View style={styles.titleRow}>
                <Text style={styles.cardTitle}>{record.displayName || "Registro sin nombre"}</Text>
                <Badge record={record} />
              </View>
              {record.syncErrorMessage ? <Text style={styles.meta}>{record.syncErrorMessage}</Text> : null}
            </Pressable>
          </Link>
        ))}
      </View>
    </ScrollView>
  );
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
});
