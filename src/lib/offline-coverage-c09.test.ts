import {attendancePreparationPeriod} from "./attendance-snapshot-cache";
import {homePreparationDay} from "./home-preparation-policy";
import {describe,it,expect,vi} from "vitest";
import {deriveOfflineAvailability,getAppViewOfflineReadiness,catalogLocalCoverage,recordsLocalCoverage} from "./app-view-definitions-cache";
import {loadPanelDatasetWithOfflineCache} from "./offline-panels";
import {loadReportWithOfflineCache} from "./offline-reports";
import {assertConsultationCompatibility} from "./consultation-revision-contract";
import {loadRecordWithOfflineCache,requireEditableRecord,saveRecordLocally,type CachedEntityRecord} from "./offline-records";
import {loadStateUpdateRelationPage,localRelationSelection} from "./state-update-relations";
import type{AppView,ReportAppView,ReportResponse,EntityField} from "./opco-api";
const view={id:"view",name:"Synthetic",type:"RECORDS",config:{entityTypeId:"source"}}as AppView;
const prepared={appViewId:view.id,appViewType:view.type,contractId:"c",ownerKey:"org:A",workflowKey:null,lastPreparedAt:"2026-11-24T00:00:00Z",status:"ready"as const,definition:{kind:"records"as const,appView:view,entityDefinition:{}}};
describe("C09 shared availability is scoped evidence, never action authorization",()=>{
 it.each(["PANEL","REPORT"])("does not certify an entire %s from metadata or one saved query",type=>{const input={appView:{...view,type}as AppView,definition:prepared};expect(deriveOfflineAvailability(input)).toBe("query-scoped");expect(getAppViewOfflineReadiness(input).offlineReady).toBe(false);});
 it.each([[true,0,"empty"],[true,105,"complete"],[false,105,"partial"],[false,0,"unprepared"]]as const)("distinguishes complete=%s,count=%s",(complete,count,status)=>{expect(catalogLocalCoverage(complete,count)).toBe(status);});
 it.each([["complete","ready"],["empty","dependencies-empty"],["partial","dependencies-partial"],["unprepared","dependencies-missing"],["unavailable","dependencies-unavailable"]]as const)("uses local catalog facts despite negotiation failure: %s",(coverage,status)=>{const catalogs=[{fieldId:"lot",entityTypeId:"source",name:"Required context",required:true,count:coverage==="empty"?0:1,coverage}];const input={appView:view,definition:prepared,recordsTelemetry:{lastFullRefreshCompletedAt:"old"},catalogs};expect(deriveOfflineAvailability(input)).toBe(status);expect(getAppViewOfflineReadiness(input).offlineReady).toBe(coverage==="complete");});
 it("a page's rows never certify a collection, while a successful empty full refresh does",()=>{expect(recordsLocalCoverage(true,null,10)).toBe("partial");expect(deriveOfflineAvailability({appView:view,definition:prepared,recordsCount:10})).toBe("data-partial");expect(recordsLocalCoverage(true,"full",0)).toBe("complete");});
});
describe("C09 exact report compatibility without requiring a new receipt",()=>{
 for(const mode of ["TABLE","MATRIX","CURRENT_STATUS","LATEST_BY_RELATION"]as const){
  it(`validates a legacy compatible ${mode} copy and rejects another configuration without writes`,async()=>{
   const config={entityTypeId:"source",presentationMode:mode,visibleFieldIds:["name"]};const appView={id:"r",name:"Report",slug:"report",icon:null,sortOrder:0,type:"REPORT",config}as unknown as ReportAppView;
   const report={appView:{id:"r"},config,from:"2026-11-01",to:"2026-11-30",records:[],fields:[]}as unknown as ReportResponse;
   const store={getReportSnapshot:vi.fn(async()=>({report,syncedAt:"old"})),upsertReportSnapshot:vi.fn()};const api={getReport:vi.fn()};const query=mode==="TABLE"||mode==="MATRIX"?{from:report.from,to:report.to}:{};
   const input={api,store,token:"synthetic",ownerKey:"org:A",contractId:"c",appViewId:"r",appView,query,knownOffline:true};expect((await loadReportWithOfflineCache(input)).report).toBe(report);
   await expect(loadReportWithOfflineCache({...input,appView:{...appView,config:{...config,visibleFieldIds:["other"]}}as unknown as ReportAppView})).rejects.toMatchObject({code:"CONSULTATION_CONFIGURATION_INCOMPATIBLE"});expect(api.getReport).not.toHaveBeenCalled();expect(store.upsertReportSnapshot).not.toHaveBeenCalled();
  });
 }
 it("does not confuse a compatible PANEL window with collection completeness",()=>{const appView={id:"p",type:"PANEL",configRevision:"v1",config:{schemaVersion:1,datasets:[]}}as unknown as AppView;const response={appView:{id:"p"},configRevision:"v1",datasets:[{id:"rows",pagination:{page:2,pageSize:25,total:105},rows:[]}]}as never;expect(()=>assertConsultationCompatibility({appView,resource:{kind:"panel",query:{datasetId:"rows",page:"2",pageSize:"25"}}},response)).not.toThrow();expect(()=>assertConsultationCompatibility({appView,resource:{kind:"panel",query:{page:"1",pageSize:"25"}}},response)).toThrow();});
});
const field={id:"relation",key:"related",name:"Related",type:"RELATION",required:true,config:{relationKind:"ONE",targetEntityTypeId:"catalog"}}as EntityField;
const row=(id:string,serverId:string|null=id)=>({id,localId:"local-"+id,serverId,displayName:"Label "+id,values:{},updatedAt:"old",remoteUpdatedAt:"version",syncStatus:serverId?"synced":"pending_create"}as CachedEntityRecord);
describe("C09 relation pages and exact selected identity",()=>{
 it("searches all 137 local records and loads all pages without a total cap",async()=>{const rows=Array.from({length:137},(_,i)=>row(String(i+1).padStart(3,"0")));const store={upsertRemoteRecords:vi.fn(),listCachedRecords:vi.fn(async(q:{page?:number;pageSize?:number;search?:string})=>{const page=q.page??1,pageSize=q.pageSize??25;const filtered=rows.filter(r=>!q.search||r.displayName.includes(q.search));return{fromCache:true,offline:true,records:filtered.slice((page-1)*pageSize,page*pageSize),pagination:{page,pageSize,total:filtered.length,totalPages:Math.ceil(filtered.length/pageSize)}};})};const api={getEntityRecords:vi.fn()};const base={api,store,field,token:"",ownerKey:"org:A",contractId:"c",online:false};let all:string[]=[],page=1,more=true;while(more){const out=await loadStateUpdateRelationPage({...base,page});all.push(...out.options.map(o=>o.id));more=out.hasMore;page++;}expect(all).toHaveLength(137);expect(new Set(all).size).toBe(137);expect((await loadStateUpdateRelationPage({...base,search:"137"})).options[0].id).toBe("137");expect(api.getEntityRecords).not.toHaveBeenCalled();});
 it("preserves RECORDS local-ID options while STATE_UPDATE continues requiring a server ID",async()=>{const store={upsertRemoteRecords:vi.fn(),listCachedRecords:vi.fn(async()=>({fromCache:true,offline:true,records:[row("new",null)],pagination:{page:1,pageSize:25,total:1,totalPages:1}}))};const input={api:{getEntityRecords:vi.fn()},store,field,token:"",ownerKey:"org:A",contractId:"c",online:false};expect((await loadStateUpdateRelationPage(input)).options).toEqual([]);expect((await loadStateUpdateRelationPage({...input,identity:"record"})).options).toEqual([{id:"local-new",displayName:"Label new"}]);});
 it("selection outside a page is resolved by exact identity, not by label equality",async()=>{const store={getCachedRecord:vi.fn(async()=>row("137"))};expect(await localRelationSelection(store,{ownerKey:"org:A",contractId:"c",field,ids:["137"],identity:"record"})).toEqual([{id:"137",displayName:"Label 137"}]);expect(store.getCachedRecord).toHaveBeenCalledWith({ownerKey:"org:A",contractId:"c",entityTypeId:"catalog",recordId:"137"});});
 it("does not publish or cache a response after its scope is retired",async()=>{let active=true;const api={getEntityRecords:vi.fn(async()=>{active=false;return{records:[],pagination:{page:1,pageSize:25,total:0,totalPages:1}}})};const store={upsertRemoteRecords:vi.fn(),listCachedRecords:vi.fn()};await expect(loadStateUpdateRelationPage({api,store,field,token:"synthetic",ownerKey:"org:A",contractId:"c",online:true,isCurrent:()=>active})).rejects.toThrow();expect(store.upsertRemoteRecords).not.toHaveBeenCalled();});
});
describe("C09 exact edit cannot turn into a creation",()=>{
 it("returns an absent offline row without networking and rejects it before form initialization",async()=>{const api={getEntityRecord:vi.fn()},store={getCachedRecord:vi.fn(async()=>null),upsertRemoteRecords:vi.fn()};const input={api,store,token:"",ownerKey:"org:A",contractId:"c",entityTypeId:"source",recordId:"missing",knownOffline:true};const result=await loadRecordWithOfflineCache(input);expect(result.record).toBeNull();expect(()=>requireEditableRecord(result.record,input)).toThrow("no está guardado");expect(api.getEntityRecord).not.toHaveBeenCalled();expect(store.upsertRemoteRecords).not.toHaveBeenCalled();});
 it("accepts either alias of only the exact pending row; never another row with the same label",()=>{const r=row("137");expect(requireEditableRecord(r,{ownerKey:"org:A",contractId:"c",entityTypeId:"source",recordId:r.localId})).toBe(r);expect(requireEditableRecord(r,{ownerKey:"org:A",contractId:"c",entityTypeId:"source",recordId:"137"})).toBe(r);expect(()=>requireEditableRecord({...r,localId:"other",serverId:"other"},{ownerKey:"org:A",contractId:"c",entityTypeId:"source",recordId:"137"})).toThrow("identidad");});
 it("keeps the existing mutation route and does not create when a target disappears",async()=>{const store={createLocalRecord:vi.fn(),updateLocalRecord:vi.fn(async()=>{throw Error("Exact row absent")})};await expect(saveRecordLocally({store,mode:"edit",recordId:"137",ownerKey:"org:A",contractId:"c",entityTypeId:"source",values:{name:"unchanged target identity"}})).rejects.toThrow("Exact row absent");expect(store.createLocalRecord).not.toHaveBeenCalled();});
});

const operational = {version:1 as const,timeZone:"America/Santiago",dayStart:"08:00",bands:[]};
it("Home and preparation use the same operational month before its opening boundary", () => {
 const now=new Date("2026-12-01T05:00:00Z"),view={id:"a",type:"WORKFLOW",config:{workflowKey:"attendance",operationalCalendar:operational}} as unknown as AppView;
 const period=attendancePreparationPeriod(now,operational);
 expect(period.date).toBe("2026-11-30");expect(period.dates).toHaveLength(30);
 expect(homePreparationDay(view,"2026-12-01",now)).toBe(period.date);
 expect(homePreparationDay(view,"2026-12-01",new Date("2026-12-01T11:00:00Z"))).toBe("2026-12-01");
});

it("reports keep cache provenance independent from known connectivity",async()=>{
 const report={appView:{id:"r"},config:{presentationMode:"TABLE"},from:"2026-11-01",to:"2026-11-30"} as unknown as ReportResponse;
 const store={getReportSnapshot:vi.fn(async()=>({report,syncedAt:"old"})),upsertReportSnapshot:vi.fn()};
 const input={api:{getReport:vi.fn(async()=>{throw new (await import("./opco-api")).OpcoNetworkError();})},store,token:"synthetic",ownerKey:"org:A",contractId:"c",appViewId:"r",query:{from:report.from,to:report.to}};
 const result=await loadReportWithOfflineCache(input);expect(result.fromCache).toBe(true);expect(result.offline).toBe(true);expect(store.upsertReportSnapshot).not.toHaveBeenCalled();
});

it("does not persist an online PANEL page attributed to another requested window",async()=>{
 const appView={id:"p",name:"Panel",slug:"p",icon:null,sortOrder:0,type:"PANEL",configRevision:"v1",config:{schemaVersion:1,datasets:[],filters:[],modules:[],metrics:[],layout:{columns:12,rowHeight:80}}} as unknown as import("./opco-api").PanelAppView;
 const panel={appView:{id:"p"},schemaVersion:1,configRevision:"v1",filters:[],modules:[],datasets:[{id:"rows",schema:{fields:[]},rows:[],pagination:{page:2,pageSize:25,total:30,hasMore:false}}]} as unknown as import("./opco-api").PanelResponse;
 const store={getPanelSnapshot:vi.fn(async()=>null),upsertPanelSnapshot:vi.fn()};
 await expect(loadPanelDatasetWithOfflineCache({api:{getPanel:vi.fn(async()=>panel)},appView,appViewId:"p",configRevision:"v1",ownerKey:"org:A",contractId:"c",token:"synthetic",query:{datasetId:"rows",page:1,pageSize:25},store})).rejects.toMatchObject({code:"CONSULTATION_CONFIGURATION_INCOMPATIBLE"});expect(store.upsertPanelSnapshot).not.toHaveBeenCalled();
});
