import type { PreparedAppViewDefinition } from "./app-view-definitions-cache";
import type { WorkflowCodeSearchField } from "./opco-api";

export class CodeSearchCacheError extends Error {
  readonly code = "CODE_SEARCH_CACHE_UNAVAILABLE";
  constructor() { super("El campo de búsqueda del lector no está disponible en la copia de esta experiencia. Actualízala con conexión o usa la búsqueda manual global."); }
}

export function cachedWorkflowCodeSearchField(definition: PreparedAppViewDefinition | undefined, fieldId: string, sourceEntityTypeId: string): WorkflowCodeSearchField {
  if (!definition || (definition.kind !== "attendance" && definition.kind !== "state-update")) throw new CodeSearchCacheError();
  const view = definition.appView;
  if (view.type !== "WORKFLOW") throw new CodeSearchCacheError();
  const config = view.config;
  const configured = config.codeSearch as { fieldId?: string } | undefined;
  const field = definition.codeSearchField;
  if (config.sourceEntityTypeId !== sourceEntityTypeId || configured?.fieldId !== fieldId || !field || field.id !== fieldId || !field.key || !["TEXT", "TEXTAREA"].includes(field.type)) throw new CodeSearchCacheError();
  return field;
}

/** Existing trim/insensitive substring criterion, with no number or RUT normalization. */
export function codeSearchTextMatches(value: unknown, query: string) {
  if (value === null) return false;
  if (typeof value !== "string") throw new CodeSearchCacheError();
  return value.toLocaleLowerCase("es-CL").includes(query.trim().toLocaleLowerCase("es-CL"));
}
