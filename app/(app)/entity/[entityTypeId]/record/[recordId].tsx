import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { getEntityDefinitionWithCache } from "@/lib/definition-cache";
import { getRecordDetailFields } from "@/lib/entity-record-display";
import { EntityDefinition, EntityRecord } from "@/lib/opco-api";
import { useSession } from "@/state/session";

export default function EntityRecordDetailScreen() {
  const { entityTypeId, recordId } = useLocalSearchParams<{ entityTypeId: string; recordId: string }>();
  const { api, definitionCache, selectedContractId, token } = useSession();
  const [definition, setDefinition] = useState<EntityDefinition | null>(null);
  const [record, setRecord] = useState<EntityRecord | null>(null);
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
      if (!token || !selectedContractId || !entityTypeId || !recordId) {
        setError("Selecciona un contrato antes de abrir un registro.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      setDefinition(null);
      setRecord(null);

      try {
        const [definitionResult, recordResult] = await Promise.all([
          getEntityDefinitionWithCache({
            api,
            cache: definitionCache,
            contractId: selectedContractId,
            entityTypeId,
            token,
          }),
          api.getEntityRecord(token, selectedContractId, entityTypeId, recordId),
        ]);

        if (isMounted) {
          setDefinition(definitionResult.definition);
          setRecord(recordResult.record);
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
  }, [api, definitionCache, entityTypeId, recordId, retryCount, selectedContractId, token]);

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      {record ? (
        <View style={styles.header}>
          <Text style={styles.title}>{record.displayName || "Registro sin nombre"}</Text>
          {definition ? <Text style={styles.meta}>{definition.name}</Text> : null}
        </View>
      ) : null}

      {isLoading ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {error && !record ? (
        <Pressable onPress={() => setRetryCount((count) => count + 1)} style={styles.retryButton}>
          <Text style={styles.retryText}>Reintentar</Text>
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

const styles = StyleSheet.create({
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
  meta: {
    color: "#587078",
  },
  retryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#135d66",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  retryText: {
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
});
