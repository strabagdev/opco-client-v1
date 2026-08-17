import { Link } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AppIcon } from "@/components/app-icon";
import { buildAppViewHref, getAppViewTypeLabel, sortAppViews } from "@/lib/app-views";
import { selectContractId } from "@/lib/contract-selection";
import { AppView } from "@/lib/opco-api";
import { useSession } from "@/state/session";

export default function HomeScreen() {
  const {
    api,
    context,
    me,
    selectedContractId,
    setSelectedContractId,
    signOut,
    status,
    token,
  } = useSession();
  const [views, setViews] = useState<AppView[]>([]);
  const [isLoadingViews, setIsLoadingViews] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedContract = useMemo(
    () => context?.contracts.find((contract) => contract.id === selectedContractId) ?? null,
    [context?.contracts, selectedContractId],
  );

  useEffect(() => {
    if (!context) {
      return;
    }

    const nextContractId = selectContractId(context.contracts, selectedContractId);

    if (nextContractId && nextContractId !== selectedContractId) {
      void setSelectedContractId(nextContractId);
    }
  }, [context, selectedContractId, setSelectedContractId]);

  useEffect(() => {
    let isMounted = true;

    async function loadViews() {
      if (!token || !selectedContractId) {
        setViews([]);
        return;
      }

      setIsLoadingViews(true);
      setError(null);

      try {
        const data = await api.getAppViews(token, selectedContractId);

        if (isMounted) {
          setViews(sortAppViews(data.views));
        }
      } catch (nextError) {
        if (isMounted) {
          setError(nextError instanceof Error ? nextError.message : "No fue posible cargar experiencias.");
        }
      } finally {
        if (isMounted) {
          setIsLoadingViews(false);
        }
      }
    }

    void loadViews();

    return () => {
      isMounted = false;
    };
  }, [api, selectedContractId, token]);

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>Sesion activa</Text>
          <Text style={styles.title}>{me?.app.name ?? "Opco"}</Text>
        </View>
        <Pressable onPress={signOut} style={styles.logoutButton}>
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Usuario</Text>
        <Text style={styles.value}>{me?.user.name ?? me?.user.email ?? "Sesion conservada"}</Text>
        <Text style={styles.meta}>
          {status === "offline"
            ? "Sin conexion al iniciar. El token sigue guardado en SecureStore."
            : me?.user.email}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Organizacion</Text>
        <Text style={styles.value}>
          {context?.organization.name ??
            (status === "offline" ? "Contexto no disponible sin red" : "Cargando contexto...")}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Contrato</Text>
        {!context && status !== "offline" ? <ActivityIndicator /> : null}
        {context?.contracts.length === 0 ? (
          <Text style={styles.empty}>No hay contratos activos para este usuario.</Text>
        ) : null}
        {context && context.contracts.length === 1 && selectedContract ? (
          <Text style={styles.value}>{selectedContract.name}</Text>
        ) : null}
        {context && context.contracts.length > 1 ? (
          <View style={styles.contractList}>
            {context.contracts.map((contract) => {
              const isSelected = contract.id === selectedContractId;

              return (
                <Pressable
                  key={contract.id}
                  onPress={() => setSelectedContractId(contract.id)}
                  style={[styles.contractButton, isSelected && styles.contractButtonSelected]}
                >
                  <Text style={[styles.contractName, isSelected && styles.contractNameSelected]}>
                    {contract.name}
                  </Text>
                  <Text style={[styles.contractRole, isSelected && styles.contractRoleSelected]}>
                    {contract.role}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Experiencias</Text>
        {isLoadingViews ? <ActivityIndicator /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!isLoadingViews && selectedContractId && views.length === 0 && !error ? (
          <Text style={styles.empty}>No tienes experiencias asignadas para este contrato.</Text>
        ) : null}
        <View style={styles.viewList}>
          {views.map((appView) => (
            <Link href={buildAppViewHref(appView.id)} key={appView.id} asChild>
              <Pressable style={styles.viewButton}>
                <View style={styles.viewIcon}>
                  <AppIcon icon={appView.icon} size={22} />
                </View>
                <View style={styles.viewText}>
                  <Text style={styles.viewName}>{appView.name}</Text>
                  <View style={styles.typeBadge}>
                    <Text style={styles.typeBadgeText}>{getAppViewTypeLabel(appView.type)}</Text>
                  </View>
                </View>
              </Pressable>
            </Link>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 36,
  },
  contractButton: {
    backgroundColor: "#ffffff",
    borderColor: "#c8d2d5",
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  contractButtonSelected: {
    backgroundColor: "#135d66",
    borderColor: "#135d66",
  },
  contractList: {
    gap: 10,
  },
  contractName: {
    color: "#17363c",
    fontSize: 16,
    fontWeight: "700",
  },
  contractNameSelected: {
    color: "#ffffff",
  },
  contractRole: {
    color: "#587078",
    fontSize: 13,
  },
  contractRoleSelected: {
    color: "#dceff1",
  },
  empty: {
    color: "#587078",
    lineHeight: 21,
  },
  viewButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#d4dddf",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 64,
    padding: 12,
  },
  viewIcon: {
    alignItems: "center",
    backgroundColor: "#e4f1f2",
    borderRadius: 8,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  viewList: {
    gap: 10,
  },
  viewName: {
    color: "#17363c",
    fontSize: 16,
    fontWeight: "700",
  },
  viewText: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  error: {
    color: "#b42318",
    lineHeight: 20,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  kicker: {
    color: "#587078",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  label: {
    color: "#587078",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  logoutButton: {
    borderColor: "#b8c7ca",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  logoutText: {
    color: "#17363c",
    fontWeight: "700",
  },
  meta: {
    color: "#587078",
    marginTop: 3,
  },
  screen: {
    backgroundColor: "#eef4f4",
    flex: 1,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: "#17363c",
    fontSize: 18,
    fontWeight: "800",
  },
  title: {
    color: "#0f3036",
    fontSize: 26,
    fontWeight: "800",
    marginTop: 4,
  },
  typeBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#edf6f6",
    borderColor: "#cfe1e3",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  typeBadgeText: {
    color: "#2f5e66",
    fontSize: 12,
    fontWeight: "800",
  },
  value: {
    color: "#17363c",
    fontSize: 17,
    fontWeight: "700",
  },
});
