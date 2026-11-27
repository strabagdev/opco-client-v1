import {coherentCachedPanelViews} from "./panel-definition";
import {describe,expect,it,vi} from "vitest";
import {isAnalysisExperience,ANALYSIS_OFFLINE_NOTICE} from "./consultation-purpose";
import {getAppViewOfflineReadiness,deriveOfflineAvailability} from "./app-view-definitions-cache";
import {prewarmAssignedAppViews} from "./app-view-prewarm";
import type {AppView} from "./opco-api";
const view=(type:string,purpose?:string)=>({id:type+purpose,name:"Synthetic",type,config:{purpose,entityTypeId:"shared",...(type==="REPORT"?{presentationMode:"TABLE"}:{})},slug:"synthetic",icon:null,sortOrder:0})as AppView;
it("classifies TABLE/MATRIX reports by their consultation function and PANEL only by explicit configuration",()=>{
 expect(isAnalysisExperience(view("PANEL","ANALYSIS"))).toBe(true);expect(isAnalysisExperience(view("PANEL","OPERATIONAL"))).toBe(false);expect(isAnalysisExperience(view("PANEL"))).toBe(false);
 for(const presentationMode of ["TABLE","MATRIX"]){expect(isAnalysisExperience({...view("REPORT"),config:{presentationMode}}as never)).toBe(true);}
 for(const presentationMode of ["CURRENT_STATUS","LATEST_BY_RELATION"]){expect(isAnalysisExperience({...view("REPORT"),config:{presentationMode}}as never)).toBe(false);}
 expect(isAnalysisExperience(view("RECORDS","ANALYSIS"))).toBe(false);expect(ANALYSIS_OFFLINE_NOTICE).toBe("Análisis disponible sólo con conexión a internet");
});
it.each(["PANEL","REPORT"])("never credits an analytical %s as offline even with an old ready definition",type=>{
 const appView=view(type,"ANALYSIS"),definition={status:"ready",definition:{kind:"unsupported",appView}}as never;
 expect(getAppViewOfflineReadiness({appView,definition})).toMatchObject({offlineReady:false,dataReady:false,reason:"online-only"});expect(deriveOfflineAvailability({appView,definition})).toBe("online-only");expect(deriveOfflineAvailability({appView,definition,catalogReadFailed:true,catalogs:[{fieldId:"shared",name:"Shared operational dependency",required:true,coverage:"partial",count:1}]}as never)).toBe("online-only");
});
it("excludes analysis and its exclusive work from progress while keeping assignments and operational shared data",async()=>{
 const views=[view("RECORDS"),view("REPORT","ANALYSIS"),view("PANEL","ANALYSIS"),view("PANEL","OPERATIONAL")];
 const records:any[]=[];let stored:any;const definition={entity:{id:"shared",name:"Synthetic",fields:[]}};
 const api={getEntityDefinition:vi.fn(async()=>definition),getReport:vi.fn(),getPanel:vi.fn()};
 const store={upsertAppViews:vi.fn(async(_o:any,_c:any,rows:any)=>{stored={views:rows,syncedAt:"now"}}),getAppViews:vi.fn(async()=>stored),reconcileAppViewDefinitions:vi.fn(),upsertEntityDefinition:vi.fn(),upsertAppViewDefinition:vi.fn(),getAppViewDefinition:vi.fn(),setOfflinePreparationDiagnostics:vi.fn(async(_o:any,d:any)=>{records.push(d)}),setOfflinePreparationRunReceipt:vi.fn()};
 await prewarmAssignedAppViews({api:api as never,store:store as never,ownerKey:"owner",contractId:"contract",token:"synthetic",appViews:views,homeListWrite:Promise.resolve({status:"persisted",count:4,syncedAt:"now",requestId:"home-views-1-1",scope:{ownerKey:"owner",contractId:"contract",appViewIds:views.map(v=>v.id)},errorCode:null})as never});
 expect(records.at(-1)).toMatchObject({status:"completed",appViews:{total:2,completed:2,failed:0}});expect(api.getEntityDefinition).toHaveBeenCalledTimes(1);expect(api.getEntityDefinition).toHaveBeenCalledWith("synthetic","contract","shared");expect(api.getReport).not.toHaveBeenCalled();expect(api.getPanel).not.toHaveBeenCalled();expect(store.reconcileAppViewDefinitions).toHaveBeenCalledWith("owner","contract",views.map(v=>v.id));expect(store.upsertAppViewDefinition.mock.calls.map(([v]:any)=>v.appViewId).sort()).toEqual(["PANELOPERATIONAL","RECORDSundefined"]);
});

it("does not replace the assigned analysis policy with an older operational cached definition",async()=>{
 const analysis=view("PANEL","ANALYSIS"),cached={...analysis,config:{...analysis.config,purpose:"OPERATIONAL"}};
 const cache={getCoherentPanelDefinition:vi.fn(async()=>cached)};const rows=[analysis];expect(await coherentCachedPanelViews(cache as never,{ownerKey:"owner",contractId:"contract"},rows,analysis.id)).toBe(rows);expect(cache.getCoherentPanelDefinition).not.toHaveBeenCalled();
});
