import {type OperationalDayCommand} from "./operational-calendar";
import {captureTimeMetadata,type CaptureTimeCommand,type CaptureTimeRead} from "./capture-time";
import type { AttendanceWorkflowConfig } from "./opco-api";
export type AttendanceRepetitionPolicy = "ONE_PER_DAY" | "MULTIPLE_WITH_WARNING" | "MULTIPLE";
export type AttendanceRepetitionCommand = {
    operationalDay?: OperationalDayCommand;
    captureTime?: CaptureTimeCommand | CaptureTimeRead;
    eventOccurredAt?: string;
    repetitionPolicy?: AttendanceRepetitionPolicy;
    repetitionAcknowledged?: boolean;
    targetRecordId?: string;
};
export function attendanceRepetitionPolicy(config: Pick<AttendanceWorkflowConfig, "repetitionPolicy">) {
    const policy = config.repetitionPolicy ?? "ONE_PER_DAY";
    if (!["ONE_PER_DAY", "MULTIPLE_WITH_WARNING", "MULTIPLE"].includes(policy))
        throw Error("Política de repetición no compatible. Actualiza la experiencia.");
    return policy;
}
export function attendanceHistoryMode(config: Pick<AttendanceWorkflowConfig, "repetitionPolicy">): "append" | "update-current" { return attendanceRepetitionPolicy(config) === "ONE_PER_DAY" ? "update-current" : "append"; }
export function attendanceRepetitionMetadata(value: AttendanceRepetitionCommand): AttendanceRepetitionCommand {
    return {
        ...captureTimeMetadata(value),
        ...(value.operationalDay ? {operationalDay:value.operationalDay} : {}),
        ...(value.eventOccurredAt ? { eventOccurredAt: value.eventOccurredAt } : {}),
        ...(value.repetitionPolicy !== undefined ? { repetitionPolicy: value.repetitionPolicy } : {}),
        ...(value.repetitionAcknowledged ? { repetitionAcknowledged: true } : {}),
        ...(value.targetRecordId ? { targetRecordId: value.targetRecordId } : {}),
    };
}
/** Warning eligibility only. UI reports remote and local counts separately; uncertain ACKs cannot prove their union. */
export function attendanceDailyCount(local: {
    syncStatus: string;
    serverRecordId?: string;
}[], remote?: number) {
    if (remote !== undefined && (!Number.isSafeInteger(remote) || remote < 0))
        throw Error("El servidor no confirmó el conteo diario.");
    return remote === undefined ? local.length : Math.max(local.length, remote);
}
export function attendanceReadScope(config: Pick<AttendanceWorkflowConfig, "repetitionPolicy">) {
    return attendanceHistoryMode(config) === "append" ? { historyMode: "append" as const, uniqueness: "subject-date" as const } : {};
}
