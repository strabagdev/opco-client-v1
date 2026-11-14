import type { AppView, EntityDefinition, EntityRecord, EntityRecordsQuery, EntityRecordsResponse } from "./opco-api";
import type { RevisionDownload } from "./revision-receipts";
import { revisionCanonical, RevisionReceiptError } from "./revision-receipts";
import type { PreparationPart } from "./preparation-revision-contract";

export type RecordsCoveragePlan = { appView: AppView; entityTypeId: string; parts: PreparationPart[] };
export function recordsRevisionQuery(query: EntityRecordsQuery = {}) {
  const result: Record<string, string> = {};
  for (const key of ["page", "pageSize", "search", "fieldIdHasValue", "sort", "direction"] as const) {
    const value=query[key];
    if (key==="search" || key==="fieldIdHasValue") { if (typeof value==="string" && value.trim()) result[key]=value.trim(); }
    else if (key==="sort" || key==="direction") { if(value)result[key]=String(value); }
    else if(value!==undefined) result[key]=String(value);
  }
  return result;
}
export function assertRecordsPage(download: RevisionDownload) {
  const data = download.normalized as EntityRecordsResponse, query = download.resource.query ?? {}, p = data.pagination;
  if (!p || !Number.isInteger(p.total) || p.total < 0 || p.page !== Number(query.page ?? 1) ||
      p.pageSize !== Number(query.pageSize ?? 100) || p.pageSize < 1 ||
      p.totalPages !== Math.max(1, Math.ceil(p.total / p.pageSize)) ||
      data.records.length !== Math.min(p.pageSize, Math.max(0, p.total - (p.page - 1) * p.pageSize))) {
    throw new RevisionReceiptError("RECORDS_COVERAGE_INCOMPLETE");
  }
}
/** Canonical unfiltered collection only. Search/sort pages never certify the whole entity. */
export function recordsCoveragePlan(appView: AppView, downloads: RevisionDownload[]): RecordsCoveragePlan {
  const fail = () => { throw new RevisionReceiptError("RECORDS_COVERAGE_INCOMPLETE"); };
  if (appView.type !== "RECORDS") return fail();
  const entityTypeId = appView.config.entityTypeId;
  const views = downloads.filter(d => d.resource.kind === "views"), definitions = downloads.filter(d => d.resource.kind === "definition");
  const pages = downloads.filter(d => d.resource.kind === "records").sort((a,b) => Number(a.resource.query?.page) - Number(b.resource.query?.page));
  if (views.length !== 1 || definitions.length !== 1 || !pages.length || downloads.length !== 2 + pages.length ||
      definitions[0].resource.entityTypeId !== entityTypeId ||
      !((views[0].normalized as {views: AppView[]}).views ?? []).some(v => revisionCanonical(v) === revisionCanonical(appView))) return fail();
  const definition = (definitions[0].normalized as {entity: EntityDefinition}).entity;
  if (definition.id !== entityTypeId || !definition.active) return fail();
  const first = pages[0].normalized as EntityRecordsResponse, records: EntityRecord[] = [];
  for (const [index, d] of pages.entries()) {
    assertRecordsPage(d);
    const q = d.resource.query ?? {}, p = (d.normalized as EntityRecordsResponse).pagination;
    if (d.resource.entityTypeId !== entityTypeId || Object.keys(q).some(k => !["page", "pageSize"].includes(k)) ||
        p.page !== index + 1 || p.pageSize !== first.pagination.pageSize || p.total !== first.pagination.total ||
        d.readRevision.revision !== pages[0].readRevision.revision) return fail();
    records.push(...(d.normalized as EntityRecordsResponse).records);
  }
  if (pages.length !== first.pagination.totalPages || records.length !== first.pagination.total ||
      records.some(r => typeof r.id !== "string" || !r.id) || new Set(records.map(r => r.id)).size !== records.length) return fail();
  return { appView, entityTypeId, parts: [
    {resource: views[0].resource, artifact: {kind: "views"}, reads: [views[0].readRevision], expected: {json: (views[0].normalized as {views: AppView[]}).views}},
    {resource: definitions[0].resource, artifact: {kind: "definition", entityTypeId}, reads: [definitions[0].readRevision], expected: {json: definition}},
    {resource: {kind: "records", entityTypeId, query: {pageSize: String(first.pagination.pageSize)}}, artifact: {kind: "records", entityTypeId, total: records.length}, reads: pages.map(d => d.readRevision), expected: {records}},
  ] };
}
