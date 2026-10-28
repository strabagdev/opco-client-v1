import { comparisonFingerprint, type WorkflowSearchField } from "./search-comparison";
import { describe, expect, it, vi } from "vitest";
import { createOpcoApi } from "./opco-api";

const field = { id: "identifier-id", key: "identifier", name: "Identificador", type: "TEXT" };
function payload(kind: string, confirmed = true) {
  return { appView: { id: "view", name: "Ficticia", slug: "fictional" }, date: "2026-10-27", sourceEntityType: { id: "source", name: "Origen" }, targetEntityType: { id: "target", name: "Destino" },
    items: [], subjects: [], latest: [], statuses: [], stateFields: [], extraFields: [], contextFields: [],
    workflow: { historyMode: "update-current", uniqueness: { mode: "subject-date" }, subjectFieldId: "subject", dateFieldId: "date" },
    ...(confirmed ? { codeSearchField: field, searchFieldId: field.id, searchComparison: comparisonFixture("field") } : {}), kind };
}
describe.each(["attendance", "state-update"])("%s reader query transport", kind => {
  it("sends the stable field and preserves textual zeros/punctuation, requiring confirmation of the executed branch", async () => {
    const requests: { url: URL; method: string }[] = [];
    const diagnostics: unknown[] = [];
    const api = createOpcoApi({ apiUrl: "https://synthetic.invalid", onRequestDiagnostics: diagnostic => { diagnostics.push(diagnostic); }, fetcher: async (input, options) => {
      requests.push({ url: new URL(String(input)), method: options?.method ?? "GET" });
      return Response.json({ ok: true, data: payload(kind) });
    } });
    const query = { date: "2026-10-27", search: " 00.123.450-K ", searchFieldId: field.id };
    const response = kind === "attendance" ? await api.getAttendanceWorkflow("synthetic", "contract", "view", query) : await api.getStateUpdateWorkflow("synthetic", "contract", "view", query);
    expect(response.codeSearchField).toEqual(field); expect(response.searchFieldId).toBe(field.id);
    expect(JSON.stringify(diagnostics)).not.toContain("00.123.450-K");
    expect(requests).toHaveLength(1); expect(requests[0].method).toBe("GET");
    expect(requests[0].url.searchParams.get("search")).toBe("00.123.450-K");
    expect(requests[0].url.searchParams.get("searchFieldId")).toBe(field.id);
  });
  it("does not mistake an older server's global response for the configured-field result", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, data: payload(kind, false) }));
    const api = createOpcoApi({ apiUrl: "https://synthetic.invalid", fetcher });
    const query = { date: "2026-10-27", search: "name", searchFieldId: field.id };
    await expect(kind === "attendance" ? api.getAttendanceWorkflow("synthetic", "contract", "view", query) : api.getStateUpdateWorkflow("synthetic", "contract", "view", query)).rejects.toMatchObject({ code: "CODE_SEARCH_NOT_CONFIRMED" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("keeps manual search global and compatible with cached/older definitions", async () => {
    let sent: URL | undefined;
    const api = createOpcoApi({ apiUrl: "https://synthetic.invalid", fetcher: async input => { sent = new URL(String(input)); return Response.json({ ok: true, data: {...payload(kind,false),searchComparison:comparisonFixture("global")} }); } });
    const query = { date: "2026-10-27", search: "Name" };
    await (kind === "attendance" ? api.getAttendanceWorkflow("synthetic", "contract", "view", query) : api.getStateUpdateWorkflow("synthetic", "contract", "view", query));
    expect(sent?.searchParams.has("searchFieldId")).toBe(false);
  });
});

function comparisonFixture(mode:"global"|"field") {
 const fields:WorkflowSearchField[]=[{id:field.id,key:field.key,type:field.type,primary:true,policy:null}];return {version:1,sourceEntityTypeId:"source",fields,fingerprint:comparisonFingerprint("source",fields),applied:{mode,...(mode==="field"?{fieldId:field.id}:{})}};
}
describe.each(["attendance","state-update"])("%s effective comparison compatibility",kind=>{
 const read=(api:ReturnType<typeof createOpcoApi>,fieldQuery=false)=>kind==="attendance"?api.getAttendanceWorkflow("synthetic","contract","view",{date:"2026-10-28",search:"query",...(fieldQuery?{searchFieldId:field.id}:{})}):api.getStateUpdateWorkflow("synthetic","contract","view",{date:"2026-10-28",search:"query",...(fieldQuery?{searchFieldId:field.id}:{})});
 it("refuses an older Core that echoes the field but cannot confirm rules, without another/global request",async()=>{
  let count=0;const data=payload(kind) as Record<string,unknown>;delete data.searchComparison;
  const api=createOpcoApi({apiUrl:"https://synthetic.invalid",fetcher:async()=>{count++;return Response.json({ok:true,data});}});
  await expect(read(api,true)).rejects.toMatchObject({code:"SEARCH_COMPARISON_NOT_CONFIRMED"});expect(count).toBe(1);
 });
 it("refuses old global responses and mismatched policies rather than silently changing criteria",async()=>{
  for(const searchComparison of [undefined,{...comparisonFixture("global"),fingerprint:"wrong"},{...comparisonFixture("global"),version:2},comparisonFixture("field")]){
   const api=createOpcoApi({apiUrl:"https://synthetic.invalid",fetcher:async()=>Response.json({ok:true,data:{...payload(kind),searchComparison}})});
   await expect(read(api)).rejects.toBeInstanceOf(Error);
  }
 });
});
