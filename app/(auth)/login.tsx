import { actionSurface } from "../../src/theme/operational-presentation";
import { type ThemeColors } from "../../src/theme/tokens";
import { colors } from "../../src/theme/paint";
import { useFieldAccessibility } from "@/components/field-accessibility";
import { Redirect } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { LOCAL_DATABASE_NAME } from "@/lib/local-db";
import { getExecutingWebBundleName } from "@/lib/pwa";
import { useSession } from "@/state/session";

export default function LoginScreen() {
  const {
    completeSignInSelection,
    pendingLoginSelection,
    signIn,
    status,
  } = useSession();
  const emailA11y = useFieldAccessibility("Correo", undefined, true);
  const passwordA11y = useFieldAccessibility("Contraseña", undefined, true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedOrganization, setSelectedOrganization] = useState<string | null>(null);

  if (status === "authenticated") {
    return <Redirect href="/(app)" />;
  }

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);

    try {
      await signIn(email, password);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No fue posible iniciar sesion.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSelection(selectionId: string) {
    setError(null);
    setSelectedOrganization(selectionId);

    try {
      await completeSignInSelection(selectionId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No fue posible seleccionar la empresa.");
    } finally {
      setSelectedOrganization(null);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: "padding", default: undefined })}
      style={styles.screen}
    >
      <View style={styles.panel}>
        <Text style={styles.title}>Opco</Text>
        <Text style={styles.subtitle}>Cliente generico movil</Text>

        {pendingLoginSelection ? (
          <View style={styles.form}>
            {pendingLoginSelection.organizations.map((option) => (
              <Pressable
                accessibilityRole="button" accessibilityState={{ disabled: Boolean(selectedOrganization) }}
                disabled={Boolean(selectedOrganization)}
                key={option.selectionId}
                onPress={() => {
                  void handleSelection(option.selectionId);
                }}
                style={interaction => [
                  styles.companyButton,
                  actionSurface(false, interaction, Boolean(selectedOrganization)),
                  pendingLoginSelection.preferredSelectionId === option.selectionId && styles.companyButtonPreferred,
                ]}
              >
                <Text style={[styles.companyButtonText, Boolean(selectedOrganization) && { color: colors.onDisabled }]}>{option.organization.name}</Text>
              </Pressable>
            ))}

            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          </View>
        ) : (
          <View style={styles.form}>
            <Text nativeID={emailA11y.labelId} style={styles.label}>Correo</Text>
            <TextInput
              {...emailA11y.controlProps}
              autoCapitalize="none"
              autoComplete="email"
              editable={!isSubmitting}
              inputMode="email"
              onChangeText={setEmail}
              placeholder="nombre@ejemplo.cl"
              style={styles.input}
              value={email}
            />
            <Text nativeID={passwordA11y.labelId} style={styles.label}>Contraseña</Text>
            <TextInput
              {...passwordA11y.controlProps}
              autoCapitalize="none"
              editable={!isSubmitting}
              onChangeText={setPassword}
              placeholder="Contraseña"
              secureTextEntry
              style={styles.input}
              value={password}
            />

            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

            <Pressable
              accessibilityRole="button" accessibilityState={{ disabled: isSubmitting || !email || !password, busy: isSubmitting }}
              disabled={isSubmitting || !email || !password}
              onPress={handleSubmit}
              style={interaction => [
                styles.button,
                actionSurface(true, interaction, Boolean(isSubmitting || !email || !password)),
              ]}
            >
              {isSubmitting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={[styles.buttonText, (isSubmitting || !email || !password) && { color: colors.onDisabled }]}>Ingresar</Text>}
            </Pressable>
          </View>
        )}
        {Platform.OS === "web" ? (
          <View style={styles.runtimeInfo}>
            <Text selectable style={styles.runtimeInfoText}>Base local del runtime: {LOCAL_DATABASE_NAME}</Text>
            <Text selectable style={styles.runtimeInfoText}>Bundle de esta pagina: {getExecutingWebBundleName() ?? "no disponible"}</Text>
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

export function createLoginStyles(p: ThemeColors = colors) {
  return StyleSheet.create({
  label: { color: p.textSecondary, fontSize: 15, fontWeight: "700" },
  runtimeInfo: { marginTop: 16 },
  runtimeInfoText: { color: p.text, fontSize: 12, lineHeight: 18 },
  button: {
    alignItems: "center",
    backgroundColor: p.primary,
    borderRadius: 8,
    minHeight: 52,
    justifyContent: "center",
  },
  buttonPressed: {
    opacity: 0.78,
  },
  buttonText: {
    color: p.onPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  companyButton: {
    alignItems: "center",
    backgroundColor: p.surface,
    borderColor: p.controlBorder,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 52,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  companyButtonPreferred: {
    borderColor: p.controlBorder,
    borderWidth: 2,
  },
  companyButtonText: {
    color: p.onSecondary,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  error: {
    color: p.danger,
    lineHeight: 20,
  },
  form: {
    gap: 14,
    marginTop: 28,
  },
  input: {
    backgroundColor: p.surface,
    borderColor: p.controlBorder,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  panel: {
    width: "100%",
  },
  screen: {
    backgroundColor: p.canvas,
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  subtitle: {
    color: p.textSecondary,
    fontSize: 16,
    marginTop: 6,
  },
  title: {
    color: p.text,
    fontSize: 34,
    fontWeight: "800",
  },
});
}
const styles = createLoginStyles();
