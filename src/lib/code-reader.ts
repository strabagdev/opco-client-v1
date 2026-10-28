/** Decoding and interpretation are deliberately separate. No record lookup or writes here. */
export type DirectCodeResult = { ok: true; value: string } | { ok: false; reason: string };

export function extractDirectCodeIdentifier(text: string): DirectCodeResult {
  const value = text.trim();
  if (!value || value.length > 256 || /[\p{Cc}\p{Cf}]/u.test(text)
    || /^[a-z][a-z\d+.-]*:/i.test(value) || /^(?:www\.|\/\/)/i.test(value)
    || !/^[\p{L}\p{M}\p{N} ._'’()-]+$/u.test(value)) {
    return { ok: false, reason: "Este código no contiene un identificador de texto directo compatible. Usa la búsqueda manual." };
  }
  // No number conversion, RUT folding, payload extraction or URL interpretation.
  return { ok: true, value };
}

export type CodeFrame = { data: Uint8ClampedArray; width: number; height: number };
export type FrameDecoder = { decode(frame: CodeFrame): Promise<string[]>; close(): void };
type CameraStream = { getTracks(): { stop(): void }[] };
export type CodeReaderPorts = {
  requestCamera(): Promise<CameraStream>;
  attach(stream: CameraStream): Promise<void>;
  detach(): void;
  createDecoder(signal: AbortSignal): Promise<FrameDecoder>;
  capture(): CodeFrame | null;
  onRead(value: string): void;
  onState(state: "opening" | "reading" | "closed", message?: string): void;
  schedule(callback: () => void): unknown;
  cancelScheduled(handle: unknown): void;
};

export function cameraFailureMessage(error: unknown) {
  const name = error && typeof error === "object" && "name" in error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "No se autorizó la cámara. Puedes seguir con la búsqueda manual.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No se encontró una cámara disponible. Usa la búsqueda manual.";
  if (name === "NotReadableError") return "No se pudo usar la cámara. Comprueba si otra aplicación la está utilizando.";
  return "No se pudo iniciar el lector o sus recursos no están disponibles sin conexión. Usa la búsqueda manual.";
}

/** A session owns its stream, decoder and at most one scheduled/in-flight frame. */
export function createCodeReaderSession(ports: CodeReaderPorts) {
  let generation = 0;
  let active = false;
  let stream: CameraStream | undefined;
  let decoder: FrameDecoder | undefined;
  let initialization: AbortController | undefined;
  let scheduled: unknown;
  const stop = () => {
    active = false;
    generation += 1;
    if (scheduled !== undefined) ports.cancelScheduled(scheduled);
    scheduled = undefined;
    initialization?.abort();
    initialization = undefined;
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
    decoder?.close();
    decoder = undefined;
    ports.detach();
  };
  const finish = (message?: string) => { stop(); ports.onState("closed", message); };
  const start = async () => {
    if (active) return;
    active = true;
    const attempt = ++generation;
    const current = () => active && attempt === generation;
    initialization = new AbortController();
    ports.onState("opening");
    try {
      const nextStream = await ports.requestCamera();
      if (!current()) { nextStream.getTracks().forEach(track => track.stop()); return; }
      stream = nextStream;
      await ports.attach(nextStream);
      if (!current()) return;
      const nextDecoder = await ports.createDecoder(initialization!.signal);
      if (!current()) { nextDecoder.close(); return; }
      decoder = nextDecoder;
      ports.onState("reading");
      const read = async () => {
        scheduled = undefined;
        if (!current()) return;
        try {
          const frame = ports.capture();
          const values = frame ? [...new Set(await nextDecoder.decode(frame))] : [];
          if (!current()) return;
          if (values.length === 1) {
            const identifier = extractDirectCodeIdentifier(values[0]);
            finish(identifier.ok ? undefined : identifier.reason);
            if (identifier.ok) ports.onRead(identifier.value);
            return;
          }
          if (values.length > 1) ports.onState("reading", "Hay varios códigos. Enfoca sólo el que quieres buscar.");
          scheduled = ports.schedule(() => { void read(); });
        } catch (error) { if (current()) finish(cameraFailureMessage(error)); }
      };
      void read();
    } catch (error) { if (current()) finish(cameraFailureMessage(error)); }
  };
  return { start, stop };
}
