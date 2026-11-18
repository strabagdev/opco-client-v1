import{it,expect}from'vitest';
import{consultationQuery,consultationIdentity,assertConsultationResponse,type ConsultationRequest}from'./consultation-revision-contract';
import type{PanelAppView,PanelResponse}from'./opco-api';
const view={id:'p',type:'PANEL',configRevision:'r1',config:{schemaVersion:1,datasets:[]}}as unknown as PanelAppView;
function request(q:Record<string,string>={page:'1',pageSize:'10'}):ConsultationRequest{return{appView:view,resource:{kind:'panel',appViewId:'p',query:q}};}
function panel(total=21,page=1):PanelResponse{return{appView:{id:'p',name:'Synthetic',slug:'synthetic'},schemaVersion:1,configRevision:'r1',calculatedAt:'2026-11-12T00:00:00Z',filters:[],modules:[],datasets:[{id:'rows',schema:{fields:[]},pagination:{page,pageSize:10,total,hasMore:page*10<total},rows:Array.from({length:Math.min(10,Math.max(0,total-(page-1)*10))},(_,i)=>({id:String(i),values:{}}))}]};}
it('preserves actual API query serialization, including filters by stable ID',()=>{expect(consultationQuery('panel',{datasetId:' rows ',filters:{ref:'stable-id',empty:''},search:' text ',page:2,pageSize:10})).toEqual({datasetId:'rows',filters:'{"ref":"stable-id","empty":""}',search:'text',page:'2',pageSize:'10'});expect(consultationQuery('panel',{filters:{},search:' '})).toEqual({});expect(consultationQuery('report',{from:'2026-11-01',to:'2026-11-30'})).toEqual({from:'2026-11-01',to:'2026-11-30'});});
it.each(['datasetId','filters','search','pageSize'])('keeps %s separate even in continuation frames',key=>{const s={ownerKey:'o',contractId:'c'},a=request(),b=request({...a.resource.query,[key]:key==='filters'?'{"id":"other"}':'different'}as Record<string,string>);expect(consultationIdentity(a,s,true)).not.toEqual(consultationIdentity(b,s,true));});
it('groups only pages of the same criteria and definition',()=>{const s={ownerKey:'o',contractId:'c'},a=request(),b=request({page:'2',pageSize:'10'});expect(consultationIdentity(a,s,true)).toEqual(consultationIdentity(b,s,true));expect(consultationIdentity(a,s)).not.toEqual(consultationIdentity(b,s));expect(consultationIdentity({...a,appView:{...view,configRevision:'r2'}},s,true)).not.toEqual(consultationIdentity(a,s,true));});
it.each([0,1,10,21])('validates exact %s total without claiming all pages were visited',total=>{expect(()=>assertConsultationResponse(request(),panel(total))).not.toThrow();});
it.each(['short','duplicate','revision','total','selector'])('rejects incompatible %s',kind=>{const r=request(),p=panel();if(kind==='short')p.datasets[0].rows.pop();if(kind==='duplicate')p.datasets[0].rows[1].id='0';if(kind==='revision')p.configRevision='r2';if(kind==='total')p.datasets[0].pagination.total=-1;if(kind==='selector')r.resource.query!.datasetId='other';expect(()=>assertConsultationResponse(r,p)).toThrow();});

it('accepts the existing Core size cap while keeping the requested query distinct',()=>{const p=panel(31);p.datasets[0].pagination.pageSize=100;p.datasets[0].pagination.hasMore=false;p.datasets[0].rows=Array.from({length:31},(_,i)=>({id:String(i),values:{}}));expect(()=>assertConsultationResponse(request({page:'1',pageSize:'150'}),p)).not.toThrow();});

function groupedConsultation() {
 const config={relationFieldId:'person'};
 const r=request({datasetId:'rows',page:'1',pageSize:'1'});
 r.appView={...view,config:{...view.config,datasets:[{id:'rows',source:{type:'ENTITY',entityTypeId:'events'},groupBy:config,transformation:{type:'RECORDS',fieldIds:['person']}}]}};
 const p=panel(1);p.datasets[0]={...p.datasets[0],pagination:{page:1,pageSize:1,total:1,hasMore:false,unit:'GROUP'},
  rows:['event1','event2'].map(id=>({id,values:{person:{id:'person1',displayName:'Same label'}}})),
  grouping:{...config,totalRecords:2,groups:[{key:'relation:person1',relationRecordId:'person1',displayName:'Same label',count:2,recordIds:['event1','event2']}]}};
 return{r,p};
}
it('accredits a complete GROUP window with more rows than pageSize without treating it as one record',()=>{const{r,p}=groupedConsultation();expect(()=>assertConsultationResponse(r,p)).not.toThrow();});
it.each(['missing-row','double-member','wrong-person','count','unconfigured','wrong-unit','wrong-label-binding'])('rejects incompatible group evidence: %s',kind=>{const{r,p}=groupedConsultation(),d=p.datasets[0];if(kind==='missing-row')d.rows.pop();if(kind==='double-member')d.grouping!.groups[0].recordIds=['event1','event1'];if(kind==='wrong-person')d.rows[0].values.person={id:'other',displayName:'Same label'};if(kind==='count')d.grouping!.groups[0].count=1;if(kind==='unconfigured')r.appView=view;if(kind==='wrong-unit')delete d.pagination.unit;if(kind==='wrong-label-binding')d.grouping!.primaryFieldId='unconfigured';expect(()=>assertConsultationResponse(r,p)).toThrow();});
