import { LocalDatabaseStorageState } from "@/lib/local-db-recovery";
import { AttendanceResponse } from "@/lib/opco-api";

type DiagnosticsSessionStatus = "loading" | "anonymous" | "authenticated" | "offline";

export type StateUpdateDiagnosticsRouteState =
  | {
      message: "Cargando sesion...";
      ready: false;
      reason: "session";
    }
  | {
      message: "Abriendo datos locales...";
      ready: false;
      reason: "sqlite";
    }
  | {
      message: "Esperando contexto local...";
      ready: false;
      reason: "owner";
    }
  | {
      message: "Esperando contrato seleccionado...";
      ready: false;
      reason: "contract";
    }
  | {
      message: "Diagnostico listo";
      ownerKey: string;
      ready: true;
      selectedContractId: string;
    };

export function getStateUpdateDiagnosticsRouteState({
  localDatabaseStorageState,
  ownerKey,
  selectedContractId,
  status,
}: {
  localDatabaseStorageState: LocalDatabaseStorageState;
  ownerKey: string | null;
  selectedContractId: string | null;
  status: DiagnosticsSessionStatus;
}): StateUpdateDiagnosticsRouteState {
  if (status === "loading" || status === "anonymous") {
    return {
      message: "Cargando sesion...",
      ready: false,
      reason: "session",
    };
  }

  if (localDatabaseStorageState.status !== "ready") {
    return {
      message: "Abriendo datos locales...",
      ready: false,
      reason: "sqlite",
    };
  }

  if (!ownerKey) {
    return {
      message: "Esperando contexto local...",
      ready: false,
      reason: "owner",
    };
  }

  if (!selectedContractId) {
    return {
      message: "Esperando contrato seleccionado...",
      ready: false,
      reason: "contract",
    };
  }

  return {
    message: "Diagnostico listo",
    ownerKey,
    ready: true,
    selectedContractId,
  };
}

export type AttendanceGetDiagnostics = {
  appViewFingerprint: string;
  case: "SUMMARY_AND_LATEST_MATCH_EXPECTED" | "SUMMARY_AND_LATEST_BELOW_EXPECTED" | "SUMMARY_EXCEEDS_LATEST" | "LATEST_EXCEEDS_SUMMARY" | "UNCLASSIFIED";
  date: string;
  expectedTotal: number | null;
  itemsCount: number;
  latest: {
    attendanceRecordFingerprint: string;
    hasPerson: boolean;
    personFingerprint: string;
    statusLabel: string | null;
    statusOptionFingerprint: string;
    updatedAt: string | null;
  }[];
  latestCount: number;
  summaryTotalRegistered: number;
};

export function summarizeAttendanceGetResponse({
  appViewId,
  expectedTotal = null,
  response,
}: {
  appViewId: string;
  expectedTotal?: number | null;
  response: AttendanceResponse;
}): AttendanceGetDiagnostics {
  const summaryTotalRegistered = response.summary.totalRegistered;
  const latestCount = response.latest.length;

  return {
    appViewFingerprint: fingerprintDiagnosticValue(appViewId),
    case: classifyAttendanceGetCounts({ expectedTotal, latestCount, summaryTotalRegistered }),
    date: response.date,
    expectedTotal,
    itemsCount: response.items.length,
    latest: response.latest.map((item) => ({
      attendanceRecordFingerprint: fingerprintDiagnosticValue(item.attendanceRecordId),
      hasPerson: Boolean(item.person),
      personFingerprint: fingerprintDiagnosticValue(item.person?.id ?? null),
      statusLabel: item.statusLabel,
      statusOptionFingerprint: fingerprintDiagnosticValue(item.statusOptionId),
      updatedAt: item.updatedAt ?? null,
    })),
    latestCount,
    summaryTotalRegistered,
  };
}

function classifyAttendanceGetCounts({
  expectedTotal,
  latestCount,
  summaryTotalRegistered,
}: {
  expectedTotal: number | null;
  latestCount: number;
  summaryTotalRegistered: number;
}): AttendanceGetDiagnostics["case"] {
  if (summaryTotalRegistered < latestCount) {
    return "LATEST_EXCEEDS_SUMMARY";
  }

  if (summaryTotalRegistered > latestCount) {
    return "SUMMARY_EXCEEDS_LATEST";
  }

  if (expectedTotal !== null && summaryTotalRegistered === expectedTotal && latestCount === expectedTotal) {
    return "SUMMARY_AND_LATEST_MATCH_EXPECTED";
  }

  if (expectedTotal !== null && summaryTotalRegistered < expectedTotal && latestCount < expectedTotal) {
    return "SUMMARY_AND_LATEST_BELOW_EXPECTED";
  }

  return "UNCLASSIFIED";
}

function fingerprintDiagnosticValue(value: string | null | undefined) {
  if (!value) {
    return "none";
  }

  if (value.length <= 10) {
    return `${value.slice(0, 2)}...${value.slice(-2)}`;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
