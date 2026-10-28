import { useLayoutEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { createCodeReaderSession } from "../lib/code-reader";
import { createBrowserCodeDecoder } from "../lib/code-reader-browser";

export type CodeReaderProps = {
  disabled?: boolean;
  scopeKey: string;
  onRead(value: string): void;
};

/** Presentation and capture only. The caller owns field configuration and the search handler. */
export function CodeReader({ disabled = false, scopeKey, onRead }: CodeReaderProps) {
  const [openedScope, setOpenedScope] = useState<string | null>(null);
  const effectiveScope = JSON.stringify([scopeKey, disabled]);
  const open = openedScope === effectiveScope;
  if (openedScope !== null && openedScope !== effectiveScope) setOpenedScope(null);
  const [message, setMessage] = useState<string>();
  const [state, setState] = useState<"opening" | "reading" | "closed">("closed");
  const [focused, setFocused] = useState(false);
  const [cancelFocused, setCancelFocused] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const trigger = useRef<View>(null);
  const session = useRef<ReturnType<typeof createCodeReaderSession> | null>(null);
  const read = useRef(onRead);
  useLayoutEffect(() => { read.current = onRead; }, [onRead]);

  const close = () => { session.current?.stop(); session.current = null; setOpenedScope(null); (trigger.current as unknown as HTMLElement | null)?.focus?.(); };
  useLayoutEffect(() => {
    if (!open || disabled || Platform.OS !== "web") return;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let disposed = false;
    const reader = createCodeReaderSession({
      requestCamera: () => {
        if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) return Promise.reject(new Error("CAMERA_UNAVAILABLE"));
        return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } } });
      },
      async attach(stream) {
        if (!video.current) throw new Error("CAMERA_UNAVAILABLE");
        video.current.srcObject = stream as MediaStream;
        await video.current.play();
      },
      detach() { if (video.current) { video.current.pause(); video.current.srcObject = null; } },
      createDecoder: createBrowserCodeDecoder,
      capture() {
        const source = video.current;
        if (!source?.videoWidth || !source.videoHeight || !context) return null;
        const scale = Math.min(1, 1280 / source.videoWidth);
        canvas.width = Math.round(source.videoWidth * scale);
        canvas.height = Math.round(source.videoHeight * scale);
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        return context.getImageData(0, 0, canvas.width, canvas.height);
      },
      schedule: callback => setTimeout(callback, 180),
      cancelScheduled: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
      onState(next, reason) { if (!disposed) { setState(next); setMessage(reason); if (next === "closed") { setOpenedScope(null); (trigger.current as unknown as HTMLElement | null)?.focus?.(); } } },
      onRead(value) { if (!disposed) read.current(value); },
    });
    session.current = reader;
    // Permission is requested only in response to the explicit trigger state.
    void reader.start();
    const leave = () => { reader.stop(); if (!disposed) setOpenedScope(null); };
    const visibility = () => { if (document.visibilityState === "hidden") leave(); };
    window.addEventListener("pagehide", leave);
    window.addEventListener("popstate", leave);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true; reader.stop();
      canvas.width = canvas.height = 0;
      if (session.current === reader) session.current = null;
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("popstate", leave);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [open, disabled, scopeKey]);

  return <View style={styles.wrapper}>
    <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel="Leer código con la cámara"
      accessibilityState={{ disabled: disabled || Platform.OS !== "web" }} disabled={disabled || Platform.OS !== "web"}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onPress={() => { setMessage(undefined); setOpenedScope(effectiveScope); }}
      style={[styles.button, focused && styles.focus, (disabled || Platform.OS !== "web") && styles.disabled]}>
      <Text style={styles.buttonText}>Escanear código</Text>
    </Pressable>
    {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
    <Modal visible={open && !disabled} transparent animationType="none" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.heading}>Leer código</Text>
          <Text style={styles.text}>Enfoca un solo código. La lectura sólo completará la búsqueda; no seleccionará ni guardará un registro.</Text>
          {Platform.OS === "web" ? <video ref={video} aria-label="Vista de la cámara" playsInline muted autoPlay style={{ width: "100%", maxHeight: "45vh", background: "#18263A", objectFit: "contain" }} /> : null}
          <Text accessibilityLiveRegion="polite" style={styles.text}>{state === "opening" ? "Iniciando cámara y lector…" : "Buscando un código…"}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancelar lectura" onFocus={() => setCancelFocused(true)} onBlur={() => setCancelFocused(false)} onPress={close} style={[styles.button, cancelFocused && styles.focus]}><Text style={styles.buttonText}>Cancelar</Text></Pressable>
        </View>
      </View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  wrapper: { gap: 8, minWidth: 0, maxWidth: "100%", flexShrink: 1 }, button: { borderWidth: 1, borderColor: "#8795A8", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, minHeight: 44, alignSelf: "flex-start", justifyContent: "center", backgroundColor: "#FFFFFF" },
  buttonText: { color: "#315DA8", fontSize: 16, fontWeight: "600" }, focus: { outlineColor: "#315DA8", outlineWidth: 3, outlineOffset: 2 }, disabled: { opacity: 0.5 },
  backdrop: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20, backgroundColor: "rgba(24,38,58,0.5)" },
  dialog: { maxWidth: 560, width: "100%", gap: 14, padding: 20, borderRadius: 12, backgroundColor: "#FFFFFF" },
  heading: { fontSize: 20, fontWeight: "700", color: "#202B3A" }, text: { fontSize: 16, color: "#202B3A" }, message: { fontSize: 15, color: "#7A4200" },
});
