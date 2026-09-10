export type DiagnosticRowValue = string | number | boolean | null;
export type DiagnosticRowsData = [string, DiagnosticRowValue][];
export type DiagnosticCopySection = {
  empty?: string;
  rows: DiagnosticRowsData;
  title: string;
};
export type StateUpdateDiagnosticsCopyState = "idle" | "success" | "error";

export function formatStateUpdateDiagnosticsCopyText(sections: DiagnosticCopySection[]) {
  return sections
    .map((section) => {
      const body = section.rows.length
        ? section.rows.map(([label, value]) => `${label}: ${formatDiagnosticCopyValue(value)}`).join("\n")
        : section.empty ?? "Sin contenido.";

      return `[${section.title}]\n${body}`;
    })
    .join("\n\n");
}

export function getStateUpdateDiagnosticsCopyButtonText(state: StateUpdateDiagnosticsCopyState) {
  if (state === "success") {
    return "Copiado";
  }

  if (state === "error") {
    return "No se pudo copiar";
  }

  return "Copiar State Update";
}

export function canRetryStateUpdateDiagnosticsCopy(state: StateUpdateDiagnosticsCopyState) {
  return state === "error";
}

function formatDiagnosticCopyValue(value: DiagnosticRowValue) {
  if (typeof value !== "string") {
    return String(value);
  }

  const trimmed = value.trim();

  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return value;
  }

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return value;
  }
}
