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

import { config } from "@/lib/config";
import { useSession } from "@/state/session";

export default function LoginScreen() {
  const { signIn, status } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: "padding", default: undefined })}
      style={styles.screen}
    >
      <View style={styles.panel}>
        <Text style={styles.title}>Opco</Text>
        <Text style={styles.subtitle}>Cliente generico movil</Text>

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
            disabled={isSubmitting || !email || !password || !config.clientId}
            onPress={handleSubmit}
            style={({ pressed }) => [
              styles.button,
              (pressed || isSubmitting) && styles.buttonPressed,
            ]}
          >
            {isSubmitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>Ingresar</Text>}
          </Pressable>

          {!config.clientId ? (
            <Text style={styles.configWarning}>Configura EXPO_PUBLIC_OPCO_CLIENT_ID.</Text>
          ) : null}
        </View>
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
  configWarning: {
    color: "#9a3412",
    lineHeight: 20,
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
