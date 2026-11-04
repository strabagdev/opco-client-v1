export type WorkflowWriteCommand = { version: 1; configurationFingerprint: string; capabilities: ["relation-context-v1"] };
export type WorkflowWriteContract = { version: 1; configurationFingerprint: string; requiredCapabilities: ["relation-context-v1"]; authorized: boolean; acceptNewCommands: boolean };
export type WorkflowWriteMetadata = { writeCommand?: WorkflowWriteCommand };
export class WorkflowWriteReviewError extends Error {
  constructor(public code = "WORKFLOW_COMMAND_INCOMPATIBLE") { super("La capacidad o el contexto de esta intención requiere revisión explícita. Se conservan los datos, autorización, versión base y clave de envío."); this.name = "WorkflowWriteReviewError"; }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function copyWriteCommand(value: unknown): WorkflowWriteCommand {
  if (!object(value) || value.version !== 1 || typeof value.configurationFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.configurationFingerprint) ||
      !Array.isArray(value.capabilities) || value.capabilities.length !== 1 || value.capabilities[0] !== "relation-context-v1" || Object.keys(value).some(k => !["version","configurationFingerprint","capabilities"].includes(k))) throw new WorkflowWriteReviewError();
  return { version: 1, configurationFingerprint: value.configurationFingerprint, capabilities: ["relation-context-v1"] };
}
export function workflowWriteMetadata(value: unknown): WorkflowWriteMetadata {
  if (!object(value) || value.writeCommand === undefined) return {};
  return { writeCommand: copyWriteCommand(value.writeCommand) };
}
export function captureWorkflowWriteCommand(contract: WorkflowWriteContract | null | undefined, required = false): WorkflowWriteMetadata {
  if (contract === undefined && required) throw new WorkflowWriteReviewError();
  if (contract == null) return {};
  if (contract.version !== 1 || contract.requiredCapabilities?.length !== 1 || contract.requiredCapabilities[0] !== "relation-context-v1" || !contract.authorized) throw new WorkflowWriteReviewError();
  if (!contract.acceptNewCommands) throw new Error("Las capturas de este destino están pausadas. Puedes conservar y consultar tus datos locales.");
  return { writeCommand: copyWriteCommand({version:1,configurationFingerprint:contract.configurationFingerprint,capabilities:["relation-context-v1"]}) };
}
export function pinnedWorkflowWriteMetadata(requested: unknown, existing: unknown, hasPending: boolean): WorkflowWriteMetadata {
  const next = workflowWriteMetadata(requested), pinned = workflowWriteMetadata(existing);
  if (hasPending && JSON.stringify(next.writeCommand ?? null) !== JSON.stringify(pinned.writeCommand ?? null) && next.writeCommand) throw new WorkflowWriteReviewError();
  return hasPending ? pinned : next;
}
