import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { buildAppViewRecordHref } from "@/lib/app-views";
import { getEntityDefinitionWithCache } from "@/lib/definition-cache";
import {
  CachedEntityRecord,
  getConflictDifferences,
  loadRecordWithOfflineCache,
} from "@/lib/offline-records";
import { EntityDefinition, EntityRecordValue, RecordsAppView } from "@/lib/opco-api";
import { useSession } from "@/state/session";

type Props = {
  appView: RecordsAppView;
  recordId: string;
};

export function RecordConflictScreen({ appView, recordId }: Props) {
  const entityTypeId = appView.config.entityTypeId;
  const { api, definitionCache, ownerKey, refreshRecordsSyncSummary, selectedContractId, syncPendingRecords, token } = useSession();
  const [definition, setDefinition] = useState<EntityDefinition | null>(null);
  const [record, setRecord] = useState<CachedEntityRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isResolving, setIsResolving] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const differences = useMemo(
    () => (definition && record ? getConflictDifferences(definition.fields, record) : []),
    [definition, record],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadConflict() {
      if (!token || !selectedContractId || !entityTypeId || !ownerKey) {
        setError("Selecciona un contrato antes de revisar el conflicto.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

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
          if (recordResult.record?.syncStatus !== "conflict") {
            setError("Este registro no tiene un conflicto pendiente.");
          }
        }
      } catch (nextError) {
        if (isMounted) {
          setError(nextError instanceof Error ? nextError.message : "No fue posible cargar el conflicto.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadConflict();

    return () => {
      isMounted = false;
    };
  }, [api, definitionCache, entityTypeId, ownerKey, recordId, retryCount, selectedContractId, token]);

  async function useLocalVersion() {
    if (!record || !selectedContractId || !ownerKey || !token) {
      return;
    }

    setIsResolving(true);
    setError(null);

    try {
      await definitionCache.resolveRecordConflictWithLocal({
        api,
        contractId: selectedContractId,
        entityTypeId,
        ownerKey,
        recordId: record.id,
        token,
      });
      await refreshRecordsSyncSummary();
      await syncPendingRecords();
      router.replace(buildAppViewRecordHref(appView.id, record.id));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No fue posible usar la version local.");
    } finally {
      setIsResolving(false);
    }
  }

  function confirmUseRemoteVersion() {
    Alert.alert(
      "Usar version de Opco",
      "Se descartarán tus cambios locales.",
      [
        { style: "cancel", text: "Cancelar" },
        { onPress: useRemoteVersion, style: "destructive", text: "Usar Opco" },
      ],
    );
  }

  async function useRemoteVersion() {
    if (!record || !selectedContractId || !ownerKey || !token) {
      return;
    }

    setIsResolving(true);
    setError(null);

    try {
      await definitionCache.resolveRecordConflictWithRemote({
        api,
        contractId: selectedContractId,
        entityTypeId,
        ownerKey,
        recordId: record.id,
        token,
      });
      await refreshRecordsSyncSummary();
      router.replace(buildAppViewRecordHref(appView.id, record.id));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No fue posible usar la version de Opco.");
    } finally {
      setIsResolving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.kicker}>{appView.name}</Text>
        <Text style={styles.title}>Revisar conflicto</Text>
        <Text style={styles.meta}>Este registro cambió en Opco mientras tenías modificaciones locales pendientes.</Text>
      </View>

      {isLoading ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {error && !record ? (
        <Pressable onPress={() => setRetryCount((count) => count + 1)} style={styles.primaryButton}>
          <Text style={styles.primaryText}>Reintentar</Text>
        </Pressable>
      ) : null}

      {record && differences.length === 0 ? (
        <Text style={styles.empty}>Las diferencias ya no estan disponibles para mostrar.</Text>
      ) : null}

      <View style={styles.diffList}>
        {differences.map((difference) => (
          <View key={difference.fieldKey} style={styles.diffCard}>
            <Text style={styles.diffLabel}>{difference.label}</Text>
            <View style={styles.versionGrid}>
              <View style={styles.versionColumn}>
                <Text style={styles.versionTitle}>Local</Text>
                <Text style={styles.versionValue}>{formatConflictValue(difference.localValue)}</Text>
              </View>
              <View style={styles.versionColumn}>
                <Text style={styles.versionTitle}>Opco</Text>
                <Text style={styles.versionValue}>{formatConflictValue(difference.remoteValue)}</Text>
              </View>
            </View>
          </View>
        ))}
      </View>

      {record?.syncStatus === "conflict" ? (
        <View style={styles.actions}>
          <Pressable disabled={isResolving} onPress={useLocalVersion} style={styles.primaryButton}>
            {isResolving ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryText}>Usar mi versión</Text>}
          </Pressable>
          <Pressable disabled={isResolving} onPress={confirmUseRemoteVersion} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Usar versión de Opco</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

function formatConflictValue(value: EntityRecordValue | undefined): string {
  if (value === undefined || value === null || value === "") {
    return "Sin valor";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(formatConflictArrayItem).join(", ") || "Sin valor";
  }

  if (typeof value === "object" && "displayName" in value && typeof value.displayName === "string") {
    return value.displayName;
  }

  return "Valor complejo";
}

function formatConflictArrayItem(value: unknown) {
  if (typeof value === "object" && value && "displayName" in value && typeof value.displayName === "string") {
    return value.displayName;
  }

  return String(value);
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  content: {
    gap: 16,
    padding: 20,
    paddingBottom: 36,
  },
  diffCard: {
    backgroundColor: "#ffffff",
    borderColor: "#d4dddf",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  diffLabel: {
    color: "#17363c",
    fontSize: 16,
    fontWeight: "800",
  },
  diffList: {
    gap: 10,
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
    fontSize: 26,
    fontWeight: "800",
  },
  versionColumn: {
    flexBasis: 220,
    flexGrow: 1,
    gap: 4,
    minWidth: 0,
  },
  versionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  versionTitle: {
    color: "#587078",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  versionValue: {
    color: "#17363c",
    lineHeight: 20,
  },
});
