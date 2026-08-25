export type LocalDatabaseUnavailableCause =
  | "OPEN_FAILED"
  | "MIGRATION_FAILED"
  | "STORAGE_UNAVAILABLE"
  | "CORRUPTION_SUSPECTED"
  | "UNKNOWN";

export type LocalDatabaseStorageState =
  | { status: "initializing"; errorCode: null; retryable: false; destructiveRecoveryAvailable: false }
  | { status: "ready"; errorCode: null; retryable: false; destructiveRecoveryAvailable: false }
  | {
      status: "unavailable";
      cause: LocalDatabaseUnavailableCause;
      errorCode: "SQLITE_UNAVAILABLE";
      retryable: true;
      destructiveRecoveryAvailable: true;
    };

export type LocalDatabaseRecoverySummary = {
  canCount: boolean;
  conflictCount: number;
  failedCount: number;
  pendingCreateCount: number;
  pendingUpdateCount: number;
  totalAtRiskCount: number;
};

export class LocalDatabaseUnavailableError extends Error {
  code = "SQLITE_UNAVAILABLE" as const;
  destructiveRecoveryAvailable = true;
  retryable = true;

  constructor(
    public readonly causeCode: LocalDatabaseUnavailableCause,
    public readonly originalError?: unknown,
  ) {
    super("SQLite local storage is unavailable.");
    this.name = "LocalDatabaseUnavailableError";
  }
}

export function isLocalDatabaseUnavailableError(error: unknown): error is LocalDatabaseUnavailableError {
  return error instanceof LocalDatabaseUnavailableError;
}

export function formatLocalStorageResetWarning(summary: LocalDatabaseRecoverySummary) {
  if (!summary.canCount) {
    return "No pudimos contar los cambios locales porque el almacenamiento no esta disponible. Si restableces los datos locales, se perderan los datos guardados en este dispositivo.";
  }

  return `Hay ${summary.totalAtRiskCount} cambios locales que aun no se han sincronizado. Si restableces los datos locales, se perderan.`;
}
