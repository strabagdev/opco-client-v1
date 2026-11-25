import type { AppView, PanelQuery, ReportQuery, PanelResponse, ReportResponse } from "./opco-api";
import type { ReceiptArtifact } from "./revision-receipt-storage";
import type { ReadRevision, RevisionResource, RevisionScope, RevisionDownload } from "./revision-receipts";
import { revisionCanonical, RevisionReceiptError } from "./revision-receipts";

export type ConsultationRequest={appView:AppView;resource:RevisionResource;snapshotDatasetId?:string};
export type ConsultationPlan=ConsultationRequest&{artifact:Extract<ReceiptArtifact,{kind:"panel"|"report"}>;read:ReadRevision;assignmentRead:ReadRevision;response:PanelResponse|ReportResponse};
export function consultationQuery(kind:"panel"|"report",q:PanelQuery&ReportQuery) {
 const r:Record<string,string>={};
 if(kind==="report"){if(q.from)r.from=q.from;if(q.to)r.to=q.to;}
 else {if(q.datasetId?.trim())r.datasetId=q.datasetId.trim();for(const k of["page","pageSize"]as const)if(q[k]!==undefined)r[k]=String(q[k]);if(q.filters&&Object.keys(q.filters).length)r.filters=JSON.stringify(q.filters);}
 if(q.search?.trim())r.search=q.search.trim();return r;
}
export function consultationIdentity(request:ConsultationRequest,scope:Pick<RevisionScope,"ownerKey"|"contractId">,frame=false) {
 const query={...request.resource.query};if(frame)delete query.page;
 if(typeof query.filters==="string")query.filters=revisionCanonical(JSON.parse(query.filters));
 return {scope,definition:request.appView,resource:{...request.resource,query},snapshotDatasetId:request.snapshotDatasetId??null};
}
/** Identity/configuration/selection only: a readable cached window is not a complete collection receipt. */
export function assertConsultationCompatibility(request:ConsultationRequest,data:PanelResponse|ReportResponse) {
 const fail=()=>{throw new RevisionReceiptError("CONSULTATION_CONFIGURATION_INCOMPATIBLE");};
 if(data.appView.id!==request.appView.id)return fail();
 const q=request.resource.query??{};
 if(request.resource.kind==="report"){
  const r=data as ReportResponse;
  if(request.appView.type!=="REPORT"||revisionCanonical(r.config)!==revisionCanonical(request.appView.config))return fail();
  const mode=request.appView.config.presentationMode;
  if(["TABLE","MATRIX"].includes(mode)&&(r.from!==(q.from??null)||r.to!==(q.to??null)))return fail();
 }else{
  const p=data as PanelResponse;
  if(request.appView.type!=="PANEL"||p.configRevision!==request.appView.configRevision)return fail();
  if(q.datasetId&&!p.datasets.some(d=>d.id===q.datasetId))return fail();
  if(p.datasets.some(d=>d.pagination.page!==Number(q.page??1)||q.pageSize!==undefined&&d.pagination.pageSize!==Math.min(Number(q.pageSize),100)))return fail();
 }
}
export function assertConsultationResponse(request:ConsultationRequest,data:PanelResponse|ReportResponse) {
 assertConsultationCompatibility(request,data);
 const fail=()=>{throw new RevisionReceiptError("CONSULTATION_COVERAGE_INCOMPLETE");};
 if(data.appView.id!==request.appView.id)return fail();
 if(request.resource.kind==="panel"){
  const p=data as PanelResponse;if(request.appView.type!=="PANEL"||p.configRevision!==request.appView.configRevision||p.datasets.length!==1)return fail();
  const d=p.datasets[0],q=request.resource.query??{},page=Number(q.page??1),size=Math.min(Number(q.pageSize??d.pagination.pageSize),100),n=d.pagination;
  if(q.datasetId&&q.datasetId!==d.id||n.page!==page||n.pageSize!==size||!Number.isInteger(n.total)||n.total<0||n.hasMore!==(page*size<n.total)||new Set(d.rows.map(r=>r.id)).size!==d.rows.length)return fail();
  const configured=request.appView.config.datasets?.find(dataset=>dataset.id===d.id)?.groupBy;
  if(configured){
   const g=d.grouping,expected=Math.min(size,Math.max(0,n.total-(page-1)*size));
   if(!g||n.unit!=="GROUP"||g.relationFieldId!==configured.relationFieldId||g.primaryFieldId!==configured.primaryFieldId||g.secondaryFieldId!==configured.secondaryFieldId||!Number.isInteger(g.totalRecords)||g.totalRecords<n.total||g.groups.length!==expected||new Set(g.groups.map(group=>group.key)).size!==g.groups.length)return fail();
   const ids=g.groups.flatMap(group=>group.recordIds);
   if(ids.length!==d.rows.length||new Set(ids).size!==ids.length||d.rows.some(row=>!ids.includes(row.id))||d.rows.length>g.totalRecords||page===1&&!n.hasMore&&d.rows.length!==g.totalRecords)return fail();
   for(const group of g.groups){
    if(!Number.isInteger(group.count)||group.count<1||group.count!==group.recordIds.length||group.key!==(group.relationRecordId?`relation:${group.relationRecordId}`:`unrelated:${group.recordIds[0]}`))return fail();
    for(const id of group.recordIds){const value=d.rows.find(row=>row.id===id)?.values[g.relationFieldId];const target=value&&typeof value==="object"&&!Array.isArray(value)&&"id"in value?value.id:null;if(target!==group.relationRecordId)return fail();}
   }
  }else if(d.grouping||n.unit||d.rows.length!==Math.min(size,Math.max(0,n.total-(page-1)*size)))return fail();
 }else{
  const r=data as ReportResponse,q=request.resource.query??{};
  if(request.appView.type!=="REPORT"||!["TABLE","MATRIX"].includes(r.config.presentationMode)||r.config.presentationMode!==request.appView.config.presentationMode||revisionCanonical(r.config)!==revisionCanonical(request.appView.config)||!q.from||!q.to||r.from!==q.from||r.to!==q.to||new Set(r.records.map(r=>r.id)).size!==r.records.length)return fail();
 }
}
export function consultationPlan(request:ConsultationRequest,scope:RevisionScope,download:RevisionDownload,assignmentRead:ReadRevision):ConsultationPlan {
 const response=download.normalized as PanelResponse|ReportResponse;assertConsultationResponse(request,response);const q=request.resource.query??{};
 const artifact:ConsultationPlan["artifact"]=request.resource.kind==="panel"?{kind:"panel",scope:{ownerKey:scope.ownerKey,contractId:scope.contractId,appViewId:request.appView.id,datasetId:request.snapshotDatasetId??String(q.datasetId??"__panel_discovery__"),configRevision:(response as PanelResponse).configRevision,filters:typeof q.filters==="string"?JSON.parse(q.filters):{},page:Number(q.page??1),pageSize:Number(q.pageSize??(response as PanelResponse).datasets[0].pagination.pageSize),search:typeof q.search==="string"?q.search:undefined}}:{kind:"report",scope:{ownerKey:scope.ownerKey,contractId:scope.contractId,appViewId:request.appView.id,from:String(q.from),to:String(q.to),search:typeof q.search==="string"?q.search:undefined}};
 return{...request,artifact,read:download.readRevision,assignmentRead,response};
}
