import { describe, expect, it, vi } from "vitest";
import { createOpcoApi, OpcoApiError, type PanelAppView, type PanelResponse } from "./opco-api";
import { PANEL_ACCEPT, PanelCompatibilityError, assertLocalPanelDefinition, assertPanelResponseCompatibility, panelReadRepresentation } from "./panel-compatibility";
import { loadPanelDatasetWithOfflineCache } from "./offline-panels";
const basic=()=>({appView:{id:"p",name:"Synthetic",slug:"synthetic"},schemaVersion:1,configRevision:"r1",calculatedAt:"2026-11-18T00:00:00Z",filters:[],modules:[],metrics:[],datasets:[{id:"daily",schema:{fields:[]},rows:[],pagination:{page:1,pageSize:25,total:0,hasMore:false}}]})as PanelResponse;
const view=()=>({id:"p",type:"PANEL",configRevision:"r1",name:"Synthetic",icon:null,slug:"synthetic",sortOrder:0,config:{schemaVersion:1,filters:[],datasets:[],modules:[]}})as PanelAppView;
function grouped(){const p=basic();p.datasets[0].grouping={relationFieldId:"person",totalRecords:0,groups:[]};p.datasets[0].pagination.unit="GROUP";return p;}
const ack=(required=["groups-v1"],definitionRevision="r1")=>({version:1 as const,status:"compatible" as const,required,accepted:[...required],definitionRevision});
describe("PANEL representation compatibility",()=>{
 it("advertises only on PANEL/catalog/negotiation reads with a safelisted Accept and no new CORS header",async()=>{
  expect(new TextEncoder().encode(PANEL_ACCEPT).length).toBeLessThanOrEqual(128);expect(PANEL_ACCEPT).not.toMatch(/["():<>?@\[\]{}\\]/);
  const requests:{url:string;accept:unknown}[]=[];const api=createOpcoApi({fetcher:async(url,init)=>{requests.push({url:String(url),accept:(init?.headers as Record<string,string>).Accept});return String(url).includes("/offline/manifest") ? Response.json({ok:false,error:{code:"OFFLINE_MANIFEST_UNAVAILABLE",message:"Synthetic unavailable"}},{status:503}) : Response.json({ok:true,data:String(url).includes("/panels/")?basic():{views:[]}});}});
  await api.getAppViews("t","c");await api.getPanel("t","c","p");await api.getMe("t");await expect(api.getOfflineRevisionManifest("t","c")).rejects.toMatchObject({status:503});
  expect(requests.map(r=>r.accept)).toEqual([PANEL_ACCEPT,PANEL_ACCEPT,"application/json",PANEL_ACCEPT]);
 });
 it("accepts previous Core's compatible legacy response but rejects new feature data without confirmation",async()=>{
  const api=createOpcoApi({fetcher:async()=>Response.json({ok:true,data:basic()})});await expect(api.getPanel("t","c","p")).resolves.toEqual(basic());
  const incompatible=createOpcoApi({fetcher:async()=>Response.json({ok:true,data:grouped()})});await expect(incompatible.getPanel("t","c","p")).rejects.toBeInstanceOf(PanelCompatibilityError);
 });
 it("accepts known pre-guard snapshots offline without falsely accrediting their freshness",()=>{
  expect(()=>assertPanelResponseCompatibility(grouped(),"cache")).not.toThrow();expect(()=>assertPanelResponseCompatibility(grouped(),"online")).toThrow("no confirmó");
 });
 it("requires a matching complete acknowledgement and rejects unknown/version/revision/missing feature claims",()=>{
  const p=grouped();p.panelCompatibility=ack();expect(()=>assertPanelResponseCompatibility(p,"online")).not.toThrow();
  for(const change of [{version:2},{definitionRevision:"other"},{accepted:[]},{required:["future-v9"],accepted:["future-v9"]},{required:[],accepted:[]}]){const copy=structuredClone(p);copy.panelCompatibility={...ack(),...change}as never;expect(()=>assertPanelResponseCompatibility(copy,"cache")).toThrow(PanelCompatibilityError);}
 });
 it("does not mistake a cached legacy projection for an actual supported definition",()=>{
  const v=view();v.panelCompatibility={...ack(),status:"update-required",accepted:[]};expect(()=>assertLocalPanelDefinition(v)).toThrow("Conéctate");
  v.panelCompatibility={...ack(["future-v9"]),status:"update-required",accepted:[]};expect(()=>assertLocalPanelDefinition(v)).toThrow("actualizar");
 });
 it("preserves a compatible cached consultation when Core rejects a new definition, without treating 426 as a network failure",async()=>{
  const cached={panel:basic(),syncedAt:"2026-11-18T00:00:00Z"};const snapshot=JSON.stringify(cached);
  const store={getPanelSnapshot:vi.fn(async()=>cached),upsertPanelSnapshot:vi.fn()};
  const api=createOpcoApi({fetcher:async()=>Response.json({ok:false,error:{code:"PANEL_CLIENT_UPDATE_REQUIRED",message:"Actualiza Opco Client. Datos conservados."}},{status:426})});
  const input={api,appView:view(),appViewId:"p",contractId:"c",ownerKey:"o",token:"t",query:{datasetId:"daily",page:1,pageSize:25},store};
  await expect(loadPanelDatasetWithOfflineCache(input)).rejects.toMatchObject({code:"PANEL_CLIENT_UPDATE_REQUIRED",status:426});expect(store.upsertPanelSnapshot).not.toHaveBeenCalled();expect(store.getPanelSnapshot).not.toHaveBeenCalled();
  const offline=await loadPanelDatasetWithOfflineCache({...input,knownOffline:true});expect(offline.panel).toEqual(cached.panel);expect(offline.offline).toBe(true);expect(JSON.stringify(cached)).toBe(snapshot);expect(store.upsertPanelSnapshot).not.toHaveBeenCalled();
 });
 it("validates a confirmed response before any cache write even when the API adapter is injected",async()=>{
  const store={getPanelSnapshot:vi.fn(),upsertPanelSnapshot:vi.fn()};const api={getPanel:vi.fn(async()=>grouped())};
  await expect(loadPanelDatasetWithOfflineCache({api,appView:view(),appViewId:"p",contractId:"c",ownerKey:"o",token:"t",query:{datasetId:"daily",page:1,pageSize:25},store})).rejects.toBeInstanceOf(PanelCompatibilityError);expect(store.upsertPanelSnapshot).not.toHaveBeenCalled();
 });
 it("keeps structured HTTP rejection messages without requiring any new interpretation of the error code",async()=>{
  const api=createOpcoApi({fetcher:async()=>Response.json({ok:false,error:{code:"PANEL_CLIENT_UPDATE_REQUIRED",message:"Esta experiencia requiere actualizar Opco Client."}},{status:426})});
  const error=await api.getPanel("t","c","p").catch(e=>e);expect(error).toBeInstanceOf(OpcoApiError);expect(error.message).toBe("Esta experiencia requiere actualizar Opco Client.");
 });
 it("adds representation binding only when negotiated metadata is present",()=>{
  expect(panelReadRepresentation({views:[view()]})).toBeUndefined();const v=view();v.panelCompatibility=ack();expect(panelReadRepresentation({views:[v]})).toEqual([{id:"p",panelCompatibility:ack()}]);
 });
});
