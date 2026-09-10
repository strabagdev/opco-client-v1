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

import { useSession } from "@/state/session";

export default function LoginScreen() {
  const {
    completeSignInSelection,
    pendingLoginSelection,
    signIn,
    status,
  } = useSession();
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
                disabled={Boolean(selectedOrganization)}
                key={option.selectionId}
                onPress={() => {
                  void handleSelection(option.selectionId);
                }}
                style={({ pressed }) => [
                  styles.companyButton,
                  (pressed || selectedOrganization === option.selectionId) && styles.buttonPressed,
                  pendingLoginSelection.preferredSelectionId === option.selectionId && styles.companyButtonPreferred,
                ]}
              >
                <Text style={styles.companyButtonText}>{option.organization.name}</Text>
              </Pressable>
            ))}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        ) : (
          <View style={styles.form}>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              editable={!isSubmitting}
              inputMode="email"
              onChangeText={setEmail}
              placeholder="Email"
              style={styles.input}
              value={email}
            />
            <TextInput
              autoCapitalize="none"
              editable={!isSubmitting}
              onChangeText={setPassword}
              placeholder="Password"
              secureTextEntry
              style={styles.input}
              value={password}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              disabled={isSubmitting || !email || !password}
              onPress={handleSubmit}
              style={({ pressed }) => [
                styles.button,
                (pressed || isSubmitting) && styles.buttonPressed,
              ]}
            >
              {isSubmitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>Ingresar</Text>}
            </Pressable>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: "#135d66",
    borderRadius: 8,
    minHeight: 52,
    justifyContent: "center",
  },
  buttonPressed: {
    opacity: 0.78,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  companyButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#9fb8b8",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 52,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  companyButtonPreferred: {
    borderColor: "#135d66",
    borderWidth: 2,
  },
  companyButtonText: {
    color: "#0f3036",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  error: {
    color: "#b42318",
    lineHeight: 20,
  },
  form: {
    gap: 14,
    marginTop: 28,
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#c8d2d5",
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
    backgroundColor: "#eef4f4",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  subtitle: {
    color: "#466068",
    fontSize: 16,
    marginTop: 6,
  },
  title: {
    color: "#0f3036",
    fontSize: 34,
    fontWeight: "800",
  },
});
