import { recordStatusPaint } from "../../theme/operational-presentation";
import { type ThemeColors } from "../../theme/tokens";
import { colors } from "../../theme/paint";
import { ReadLoadingState } from "@/components/read-loading-indicator";
import { useExperienceActivityReporter } from "@/renderers/use-experience-activity";
import { Link, router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { buildAppViewRecordConflictHref, buildEditAppViewRecordHref } from "@/lib/app-views";
import { getEntityDefinitionWithCache } from "@/lib/definition-cache";
import { FormLayout } from "../../components/form-layout";
import { FormActions } from "../../components/form-actions";
import { ReadFieldList } from "../../components/read-field-list";
import { buildRecordReadFields } from "./record-read-presentation";
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
  const {
    api,
    definitionCache,
    ownerKey,
    recordsReconnectRefreshKey,
    refreshRecordsSyncSummary,
    selectedContractId,
    syncPendingRecords,
    token,
  } = useSession();
  const [definition, setDefinition] = useState<EntityDefinition | null>(null);
  const [record, setRecord] = useState<CachedEntityRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  const detailFields = useMemo(
    () => (definition && record ? buildRecordReadFields(definition, record) : []),
    [definition, record],
  );

  useExperienceActivityReporter(appView, {
    activeCount: Number(isLoading), readCount: Number(isLoading),
    readMode: record ? "refresh" : "initial", errorCode: error ? "RECORDS_DETAIL_FAILED" : null,
    result: error ? "error" : isLoading ? null : "success",
  });
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
  }, [api, definitionCache, entityTypeId, ownerKey, recordId, recordsReconnectRefreshKey, retryCount, selectedContractId, token]);

  async function retryFailedRecord() {
    if (!record || !selectedContractId || !ownerKey) {
      return;
    }

    try {
      await definitionCache.retryFailedRecord({
        contractId: selectedContractId,
        entityTypeId,
        ownerKey,
        recordId: record.id,
      });
      await refreshRecordsSyncSummary();
      void syncPendingRecords();
      setRetryCount((count) => count + 1);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No fue posible reintentar.");
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <FormLayout>
      <View style={readStyles.heading}>
      {record ? (
        <View style={[styles.header, readStyles.titleGroup]}>
          <Text style={styles.kicker}>{appView.name}</Text>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{record.displayName || "Registro sin nombre"}</Text>
            <SyncBadge record={record} />
          </View>
          {definition ? <Text style={styles.meta}>{definition.name}</Text> : null}
          {record.syncErrorMessage ? <Text style={styles.error}>{record.syncErrorMessage}</Text> : null}
        </View>
      ) : null}
      <FormActions>
        <Pressable onPress={() => router.back()} style={[styles.secondaryButton, readStyles.backButton]}>
          <Text style={[styles.secondaryText, readStyles.backText]}>Volver</Text>
        </Pressable>
        <Link href={buildEditAppViewRecordHref(appView.id, recordId)} asChild>
          <Pressable style={StyleSheet.flatten([styles.primaryButton, readStyles.editButton])}>
            <Text style={styles.primaryText}>Editar</Text>
          </Pressable>
        </Link>
      </FormActions>
      </View>

      {record?.syncStatus === "conflict" ? (
        <View style={styles.conflictBanner}>
          <Text style={styles.conflictTitle}>Este registro cambió en Opco mientras tenías modificaciones locales pendientes.</Text>
          <Link href={buildAppViewRecordConflictHref(appView.id, record.id)} asChild>
            <Pressable style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>Revisar conflicto</Text>
            </Pressable>
          </Link>
        </View>
      ) : null}

      {record?.syncStatus === "failed" ? (
        <Pressable onPress={retryFailedRecord} style={styles.primaryButton}>
          <Text style={styles.primaryText}>Reintentar</Text>
        </Pressable>
      ) : null}

      {isLoading && !(record) ? <ReadLoadingState mode="initial" /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {error && !record ? (
        <Pressable onPress={() => setRetryCount((count) => count + 1)} style={styles.primaryButton}>
          <Text style={styles.primaryText}>Reintentar</Text>
        </Pressable>
      ) : null}

      {record && detailFields.length === 0 ? (
        <Text style={styles.empty}>Este registro no tiene campos activos para mostrar.</Text>
      ) : null}

      {detailFields.length ? <View style={readStyles.section}><ReadFieldList fields={detailFields} /></View> : null}
      </FormLayout>
    </ScrollView>
  );
}

function SyncBadge({ record }: { record: CachedEntityRecord }) {
  const label = getRecordSyncLabel(record);

  if (!label) {
    return null;
  }

  return (
    <View style={[
      styles.badge,
      record.syncStatus === "failed" && styles.badgeFailed,
      record.syncStatus === "conflict" && styles.badgeConflict,
      { backgroundColor: recordStatusPaint(record.syncStatus).backgroundColor, borderColor: recordStatusPaint(record.syncStatus).borderColor },
    ]}>
      <Text style={[
        styles.badgeText,
        record.syncStatus === "failed" && styles.badgeFailedText,
        record.syncStatus === "conflict" && styles.badgeConflictText,
        { color: recordStatusPaint(record.syncStatus).color },
      ]}>{label}</Text>
    </View>
  );
}

export function createRecordDetailNoticeStyles(p: ThemeColors = colors) {
  return StyleSheet.create({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: p.selection,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeFailed: {
    backgroundColor: p.dangerSurface,
  },
  badgeConflict: {
    backgroundColor: p.conflictSurface,
  },
  badgeConflictText: {
    color: p.conflict,
  },
  badgeFailedText: {
    color: p.danger,
  },
  badgeText: {
    color: p.text,
    fontSize: 12,
    fontWeight: "800",
  },
  content: {
    gap: 16,
    padding: 20,
    paddingBottom: 36,
  },
  conflictBanner: {
    backgroundColor: p.conflictSurface,
    borderColor: p.conflictBorder,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  conflictTitle: {
    color: p.conflict,
    fontWeight: "800",
    lineHeight: 20,
  },
  empty: {
    color: p.textSecondary,
    lineHeight: 21,
  },
  error: {
    color: p.danger,
    lineHeight: 20,
  },
  fieldLabel: {
    color: p.textSecondary,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  fieldList: {
    gap: 10,
  },
  fieldRow: {
    backgroundColor: p.surface,
    borderColor: p.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  fieldValue: {
    color: p.text,
    fontSize: 16,
    lineHeight: 22,
  },
  header: {
    gap: 4,
  },
  kicker: {
    color: p.textSecondary,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  meta: {
    color: p.textSecondary,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: p.primary,
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  primaryText: {
    color: p.onPrimary,
    fontWeight: "800",
  },
  screen: {
    backgroundColor: p.canvas,
    flex: 1,
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: p.controlBorder,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  secondaryText: {
    color: p.onSecondary,
    fontWeight: "800",
  },
  title: {
    color: p.text,
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
}
const styles = createRecordDetailNoticeStyles();

export function createRecordDetailReadStyles(p: ThemeColors = colors) {
  return StyleSheet.create({
  heading: { flexDirection: "row", flexWrap: "wrap", gap: 16, alignItems: "flex-start" },
  titleGroup: { flex: 1, minWidth: 220 },
  section: { backgroundColor: p.surface, borderColor: p.border, borderWidth: 1, borderRadius: 10, padding: 16, minWidth: 0 },
  editButton: { backgroundColor: p.primary, minHeight: 44 },
  backButton: { backgroundColor: p.surface, borderColor: p.controlBorder, minHeight: 44 },
  backText: { color: p.primary },
});
}
const readStyles = createRecordDetailReadStyles();
