import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { buildAppViewRecordHref } from "@/lib/app-views";
import { getEntityDefinitionWithCache } from "@/lib/definition-cache";
import {
  CachedEntityRecord,
  getConflictDifferences,
  loadRecordWithOfflineCache,
  loadRecordsWithOfflineCache,
} from "@/lib/offline-records";
import { getRelationTargetEntityTypeId } from "@/lib/record-form";
import { EntityDefinition, RecordsAppView } from "@/lib/opco-api";
import { useSession } from "@/state/session";
import { formatConflictValue, formatTechnicalConflictValue } from "./record-conflict-values";

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
  const [relationLabels, setRelationLabels] = useState<Record<string, Record<string, string>>>({});
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

  useEffect(() => {
    let isMounted = true;

    async function loadRelationLabels() {
      if (!definition || !token || !selectedContractId || !ownerKey) {
        setRelationLabels({});
        return;
      }

      const relationFields = definition.fields
        .filter((field) => field.type === "RELATION")
        .map((field) => ({
          fieldKey: field.key,
          targetEntityTypeId: getRelationTargetEntityTypeId(field),
        }))
        .filter((field): field is { fieldKey: string; targetEntityTypeId: string } =>
          Boolean(field.targetEntityTypeId)
        );

      const entries = await Promise.all(relationFields.map(async ({ fieldKey, targetEntityTypeId }) => {
        try {
          const result = await loadRecordsWithOfflineCache({
            api,
            contractId: selectedContractId,
            direction: "asc",
            entityTypeId: targetEntityTypeId,
            ownerKey,
            page: 1,
            pageSize: 100,
            sort: "displayName",
            store: definitionCache,
            token,
          });

          return [fieldKey, Object.fromEntries(result.records.map((item) => [
            item.id,
            item.displayName || item.id,
          ]))] as const;
        } catch {
          return [fieldKey, {}] as const;
        }
      }));

      if (isMounted) {
        setRelationLabels(Object.fromEntries(entries));
      }
    }

    void loadRelationLabels();

    return () => {
      isMounted = false;
    };
  }, [api, definition, definitionCache, ownerKey, selectedContractId, token]);

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
        fields: definition?.fields ?? [],
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
      "Se descartará todo el cambio pendiente local mostrado en esta pantalla.",
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
        <Text style={styles.meta}>Las acciones aplican a todo el cambio pendiente; revisa todas las diferencias antes de continuar.</Text>
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
            {difference.fieldId ? <Text style={styles.technicalText}>fieldId: {difference.fieldId}</Text> : null}
            <View style={styles.versionGrid}>
              <View style={styles.versionColumn}>
                <Text style={styles.versionTitle}>Local</Text>
                <Text style={styles.versionValue}>{formatConflictValue(difference.localValue, difference.fieldKey, difference.fieldType, relationLabels)}</Text>
                <Text style={styles.technicalText}>{formatTechnicalConflictValue(difference.technicalLocalValue)}</Text>
              </View>
              <View style={styles.versionColumn}>
                <Text style={styles.versionTitle}>Opco</Text>
                <Text style={styles.versionValue}>{formatConflictValue(difference.remoteValue, difference.fieldKey, difference.fieldType, relationLabels)}</Text>
                <Text style={styles.technicalText}>{formatTechnicalConflictValue(difference.technicalRemoteValue)}</Text>
              </View>
            </View>
            {difference.fieldType === "RELATION" && difference.relationTargetEntityTypeId ? (
              <Text style={styles.technicalText}>relatedEntityTypeId: {difference.relationTargetEntityTypeId}</Text>
            ) : null}
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
  technicalText: {
    color: "#587078",
    fontSize: 12,
    lineHeight: 17,
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
