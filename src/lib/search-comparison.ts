import data from "./search-comparison-data.json";

export type SearchComparison = { version: 1; ignoreCase: boolean; ignoreCharacters: string[]; ignoreWhitespace: boolean; match: "exact" | "contains" };
export type WorkflowSearchField = { id: string; key: string; type: string; primary: boolean; policy: SearchComparison | null; options?: { value: string; label: string }[] };
export type WorkflowSearchComparison = { version: 1; sourceEntityTypeId: string; fields: WorkflowSearchField[]; fingerprint: string; applied: { mode: "definition" | "global" | "field" | "record"; fieldId?: string } };
export class SearchComparisonError extends Error {
  constructor(message = "La configuración de comparación de búsqueda no es compatible.", readonly code = "INVALID_SEARCH_COMPARISON") { super(message); }
}
const scalar = (value: unknown): value is string => typeof value === "string" && Array.from(value).length === 1 && value.codePointAt(0)! !== 0 && !(value.codePointAt(0)! >= 0xd800 && value.codePointAt(0)! <= 0xdfff);
export function parseSearchComparison(value: unknown): SearchComparison | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SearchComparisonError();
  const p = value as Record<string, unknown>;
  if (Object.keys(p).sort().join() !== "ignoreCase,ignoreCharacters,ignoreWhitespace,match,version" || p.version !== 1 || typeof p.ignoreCase !== "boolean" || typeof p.ignoreWhitespace !== "boolean" || !["exact", "contains"].includes(String(p.match)) || !Array.isArray(p.ignoreCharacters) || p.ignoreCharacters.length > 32 || !p.ignoreCharacters.every(scalar)) throw new SearchComparisonError();
  return { version: 1, ignoreCase: p.ignoreCase, ignoreCharacters: [...new Set(p.ignoreCharacters as string[])].sort(), ignoreWhitespace: p.ignoreWhitespace, match: p.match as SearchComparison["match"] };
}
export function fieldSearchComparison(config: unknown) { return parseSearchComparison(config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>).searchComparison : undefined); }
const foldTargets=Array.from(data.foldTarget);
const fold = new Map(Array.from(data.foldSource).map((c, index) => [c, foldTargets[index]]));
export function simpleSearchFold(value: string) { return Array.from(value).map(c => fold.get(c) ?? c).join(""); }
export function ignoredSearchCharacters(policy: SearchComparison) { return [...new Set(Array.from((policy.ignoreCase ? simpleSearchFold(policy.ignoreCharacters.join("")) : policy.ignoreCharacters.join("")) + (policy.ignoreWhitespace ? data.whitespace : "")))].join(""); }
export function normalizeSearchComparison(value: string, policy: SearchComparison) {
  if(Array.from(value).some(c=>c.codePointAt(0)===0||(c.codePointAt(0)!>=0xd800&&c.codePointAt(0)!<=0xdfff)))throw new SearchComparisonError("El texto contiene caracteres no admitidos.","INVALID_SEARCH_TEXT");
  const ignored = new Set(Array.from(ignoredSearchCharacters(policy)));
  return Array.from(policy.ignoreCase ? simpleSearchFold(value) : value).filter(c => !ignored.has(c)).join("");
}
export function searchComparisonMatches(value: unknown, query: string, policy: SearchComparison) {
  const search = normalizeSearchComparison(query.trim(), policy);
  if (!search) return false;
  if (value === null) return false;
  if (typeof value !== "string") throw new SearchComparisonError("El campo consultado no está disponible en la copia local.", "SEARCH_COMPARISON_CACHE_UNAVAILABLE");
  const normalized = normalizeSearchComparison(value, policy);
  return policy.match === "exact" ? normalized === search : normalized.includes(search);
}
export function comparisonFingerprint(sourceEntityTypeId: string, fields: WorkflowSearchField[]) {
  // Canonical metadata key, not a security token or a hash of record values. No collision-based matching.
  return JSON.stringify({ version: 1, sourceEntityTypeId, fields });
}
export function verifyWorkflowSearchComparison(value: unknown, sourceEntityTypeId?: string): WorkflowSearchComparison {
  if (!value || typeof value !== "object") throw new SearchComparisonError("Opco no confirmó la política de búsqueda ejecutada.", "SEARCH_COMPARISON_NOT_CONFIRMED");
  const p = value as WorkflowSearchComparison;
  if (p.version !== 1 || typeof p.sourceEntityTypeId !== "string" || (sourceEntityTypeId && p.sourceEntityTypeId !== sourceEntityTypeId) || !Array.isArray(p.fields) || !p.applied || !["definition","global","field","record"].includes(p.applied.mode)) throw new SearchComparisonError();
  const ids = new Set<string>();
  const fields = p.fields.map(f => {
    if (!f || typeof f.id !== "string" || !f.id || ids.has(f.id) || typeof f.key !== "string" || !f.key || typeof f.type !== "string" || typeof f.primary !== "boolean" || !Object.prototype.hasOwnProperty.call(f,"policy")) throw new SearchComparisonError();
    ids.add(f.id);
    const policy = f.policy === null ? null : parseSearchComparison(f.policy);
    if (policy && !["TEXT","TEXTAREA"].includes(f.type)) throw new SearchComparisonError();
    if (f.options && (!Array.isArray(f.options) || !f.options.every(o => typeof o.value === "string" && typeof o.label === "string"))) throw new SearchComparisonError();
    return { id: f.id, key: f.key, type: f.type, primary: f.primary, policy, ...(f.options ? { options: f.options } : {}) };
  }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  if (comparisonFingerprint(p.sourceEntityTypeId, fields) !== p.fingerprint) throw new SearchComparisonError("La política de búsqueda recibida no coincide con su revisión.","SEARCH_COMPARISON_NOT_CONFIRMED");
  return { ...p, fields };
}
export function workflowRecordMatches(record: { displayName: string; values: Record<string, unknown> }, query: string, envelope: WorkflowSearchComparison, fieldId?: string) {
  const fields = envelope.fields;
  const selected = fieldId ? fields.find(f=>f.id===fieldId) : undefined;
  if (fieldId && !selected) throw new SearchComparisonError("El campo no está preparado.","SEARCH_COMPARISON_CACHE_UNAVAILABLE");
  const configured = fields.some(f=>f.policy);
  if (selected?.policy) {
    if (!normalizeSearchComparison(query.trim(), selected.policy)) throw new SearchComparisonError("El texto de búsqueda queda vacío después de aplicar la comparación.","EMPTY_NORMALIZED_SEARCH");
    return searchComparisonMatches(record.values[selected.key], query, selected.policy);
  }
  const q=query.trim().toLocaleLowerCase("es-CL");
  if (selected) {
    const value=record.values[selected.key]; if(value===null)return false;
    if(typeof value!=="string")throw new SearchComparisonError("El campo no está preparado.","SEARCH_COMPARISON_CACHE_UNAVAILABLE");
    return value.toLocaleLowerCase("es-CL").includes(q);
  }
  if (!q) return true;
  if (!configured) return record.displayName.toLocaleLowerCase("es-CL").includes(q) || JSON.stringify(record.values).toLocaleLowerCase("es-CL").includes(q);
  const displayMatches=!fields.some(f=>f.primary&&f.policy) && record.displayName.toLocaleLowerCase("es-CL").includes(q);
  // Evaluate all predicates before returning. Missing configured content cannot become a false complete result.
  const matches=fields.map(f=>{
    const value=record.values[f.key];
    if(f.policy)return searchComparisonMatches(value,query,f.policy);
    if(value===null||value===undefined)return false;
    if(f.type==="SELECT")return (f.options??[]).some(o=>o.value===value&&(o.label.toLocaleLowerCase("es-CL").includes(q)||o.value.toLocaleLowerCase("es-CL").includes(q)));
    if(f.type==="RELATION")return (Array.isArray(value)?value:[value]).some(v=>!!v&&typeof v==="object"&&"displayName" in v&&typeof v.displayName==="string"&&v.displayName.toLocaleLowerCase("es-CL").includes(q));
    return typeof value==="string"&&value.toLocaleLowerCase("es-CL").includes(q);
  });
  return displayMatches || matches.some(Boolean);
}
