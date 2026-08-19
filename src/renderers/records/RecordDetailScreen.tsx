import { Link, router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { buildEditAppViewRecordHref } from "@/lib/app-views";
import { getEntityDefinitionWithCache } from "@/lib/definition-cache";
import { getRecordDetailFields } from "@/lib/entity-record-display";
import { CachedEntityRecord, loadRecordWithOfflineCache } from "@/lib/offline-records";
import { EntityDefinition, RecordsAppView } from "@/lib/opco-api";
import { getRecordSyncLabel } from "@/sync/records-sync";
import { useSession } from "@/state/session";

type Props = {
  appView: RecordsAppView;
  recordId: string;
};

export function RecordDetailScreen({ appView, recordId }: Props) {
  const entityTypeId = appView.config.entityTypeId;
  const { api, definitionCache, ownerKey, selectedContractId, token } = useSession();
  const [definition, setDefinition] = useState<EntityDefinition | null>(null);
  const [record, setRecord] = useState<CachedEntityRecord | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  const detailFields = useMemo(
    () => (definition && record ? getRecordDetailFields(definition, record) : []),
    [definition, record],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadRecord() {
      if (!token || !selectedContractId || !entityTypeId || !recordId || !ownerKey) {
        setError("Selecciona un contrato antes de abrir un registro.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      setDefinition(null);
      setRecord(null);
      setFromCache(false);

      try {
        const [definitionResult, recordResult] = await Promise.all([
          getEntityDefinitionWithCache({
            api,
            cache: definitionCache,
            contractId: selectedContractId,
            entityTypeId,
            token,
          }),
          loadRecordWithOfflineCache({
            api,
            contractId: selectedContractId,
            entityTypeId,
            ownerKey,
            recordId,
            store: definitionCache,
            token,
          }),
        ]);

        if (isMounted) {
          setDefinition(definitionResult.definition);
          setRecord(recordResult.record);
          setFromCache(recordResult.fromCache);
          if (!recordResult.record) {
            setError("No hay una copia local de este registro.");
          }
        }
      } catch (nextError) {
        if (isMounted) {
          setError(nextError instanceof Error ? nextError.message : "No fue posible cargar el registro.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadRecord();

    return () => {
      isMounted = false;
    };
  }, [api, definitionCache, entityTypeId, ownerKey, recordId, retryCount, selectedContractId, token]);

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.actions}>
        <Pressable onPress={() => router.back()} style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>Volver</Text>
        </Pressable>
        <Link href={buildEditAppViewRecordHref(appView.id, recordId)} asChild>
          <Pressable style={styles.primaryButton}>
            <Text style={styles.primaryText}>Editar</Text>
          </Pressable>
        </Link>
      </View>

      {record ? (
        <View style={styles.header}>
          <Text style={styles.kicker}>{appView.name}</Text>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{record.displayName || "Registro sin nombre"}</Text>
            <SyncBadge record={record} />
          </View>
          {definition ? <Text style={styles.meta}>{definition.name}</Text> : null}
          {fromCache ? <Text style={styles.meta}>Datos guardados localmente.</Text> : null}
          {record.syncErrorMessage ? <Text style={styles.error}>{record.syncErrorMessage}</Text> : null}
        </View>
      ) : null}

      {isLoading ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {error && !record ? (
        <Pressable onPress={() => setRetryCount((count) => count + 1)} style={styles.primaryButton}>
          <Text style={styles.primaryText}>Reintentar</Text>
        </Pressable>
      ) : null}

      {record && detailFields.length === 0 ? (
        <Text style={styles.empty}>Este registro no tiene valores activos para mostrar.</Text>
      ) : null}

      <View style={styles.fieldList}>
        {detailFields.map((field) => (
          <View key={field.key} style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{field.label}</Text>
            <Text style={styles.fieldValue}>{field.value}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function SyncBadge({ record }: { record: CachedEntityRecord }) {
  const label = getRecordSyncLabel(record);

  if (!label) {
    return null;
  }

  return (
    <View style={[styles.badge, record.syncStatus === "failed" && styles.badgeFailed]}>
      <Text style={[styles.badgeText, record.syncStatus === "failed" && styles.badgeFailedText]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#eef4f4",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeFailed: {
    backgroundColor: "#fef3f2",
  },
  badgeFailedText: {
    color: "#b42318",
  },
  badgeText: {
    color: "#466068",
    fontSize: 12,
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
  fieldLabel: {
    color: "#587078",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  fieldList: {
    gap: 10,
  },
  fieldRow: {
    backgroundColor: "#ffffff",
    borderColor: "#d4dddf",
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  fieldValue: {
    color: "#17363c",
    fontSize: 16,
    lineHeight: 22,
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
  meta: {
    color: "#587078",
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
  secondaryButton: {
    alignItems: "center",
    borderColor: "#b8c7ca",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  secondaryText: {
    color: "#17363c",
    fontWeight: "800",
  },
  title: {
    color: "#0f3036",
    flexShrink: 1,
    fontSize: 26,
    fontWeight: "800",
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
});
