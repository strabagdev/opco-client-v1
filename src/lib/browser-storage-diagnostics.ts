export type BrowserPersistenceStatus = "granted" | "not-granted" | "unavailable" | "unknown";
export type BrowserStorageDiagnostics = {
  persistence: BrowserPersistenceStatus;
  usage: number | null;
  quota: number | null;
  canRequest: boolean;
  queryFailed: boolean;
  estimateFailed: boolean;
  requestFailed: boolean;
};
type StorageAPI = {
  persisted?: () => Promise<unknown>;
  persist?: () => Promise<unknown>;
  estimate?: () => Promise<{ usage?: unknown; quota?: unknown }>;
};

export const UNKNOWN_BROWSER_STORAGE: BrowserStorageDiagnostics = {
  persistence: "unknown", usage: null, quota: null, canRequest: false,
  queryFailed: false, estimateFailed: false, requestFailed: false,
};

function browserStorage(): StorageAPI | null | undefined {
  try {
    return typeof window === "undefined" || typeof navigator === "undefined" ? undefined : navigator.storage;
  } catch {
    return null;
  }
}

function bytes(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}
const status = (value: unknown): BrowserPersistenceStatus => value === true ? "granted" : value === false ? "not-granted" : "unknown";

/** Browser metadata only: no SQLite, cache, permissions request or operational state writes. */
export async function readBrowserStorageDiagnostics(storage = browserStorage()): Promise<BrowserStorageDiagnostics> {
  const snapshot = { ...UNKNOWN_BROWSER_STORAGE };
  if (storage === undefined) return { ...snapshot, persistence: "unavailable" };
  if (storage === null) return { ...snapshot, queryFailed: true };
  try {
    snapshot.canRequest = typeof storage.persist === "function";
    snapshot.persistence = typeof storage.persisted === "function"
      ? status(await storage.persisted()) : snapshot.canRequest ? "unknown" : "unavailable";
  } catch {
    snapshot.queryFailed = true;
  }
  try {
    if (typeof storage.estimate === "function") {
      const estimate = await storage.estimate();
      snapshot.usage = bytes(estimate?.usage);
      snapshot.quota = bytes(estimate?.quota);
    }
  } catch {
    snapshot.estimateFailed = true;
  }
  return snapshot;
}

/** Call only from an explicit action; persist() runs before any await to retain that gesture. */
export async function requestBrowserStoragePersistence(storage = browserStorage()): Promise<BrowserStorageDiagnostics> {
  try {
    if (!storage || typeof storage.persist !== "function") return readBrowserStorageDiagnostics(storage);
    const requested = await storage.persist();
    const snapshot = await readBrowserStorageDiagnostics(storage);
    return typeof storage.persisted === "function" ? snapshot : { ...snapshot, persistence: status(requested) };
  } catch {
    return { ...await readBrowserStorageDiagnostics(storage), persistence: "unknown", requestFailed: true };
  }
}

export function formatEstimatedStorageBytes(value: number | null) {
  if (value === null) return "Sin información";
  const unit = value >= 1024 ** 3 ? "GiB" : value >= 1024 ** 2 ? "MiB" : value >= 1024 ? "KiB" : "B";
  const divisor = unit === "GiB" ? 1024 ** 3 : unit === "MiB" ? 1024 ** 2 : unit === "KiB" ? 1024 : 1;
  return `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(value / divisor)} ${unit}`;
}

export const BROWSER_PERSISTENCE_LABELS: Record<BrowserPersistenceStatus, string> = {
  granted: "Concedida", "not-granted": "No concedida", unavailable: "No disponible", unknown: "Desconocida",
};
