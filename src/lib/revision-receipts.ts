/** Diagnostic protocol only. No result of this module permits read omission. */
export class RevisionReceiptError extends Error {
  constructor(public readonly code:string) { super(code); }
}
export function revisionCanonical(value:unknown):string {
  return JSON.stringify(value,(_key,item)=>item&&typeof item==="object"&&!Array.isArray(item)
    ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
}
export async function revisionHash(value:unknown):Promise<string> {
  if(!globalThis.crypto?.subtle)throw new RevisionReceiptError("REVISION_HASH_UNAVAILABLE");
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(revisionCanonical(value)));
  return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,"0")).join("");
}
export type RevisionScope={ownerKey:string;userId:string;applicationId:string;organizationId:string;contractId:string;authorizationFingerprint:string};
export type RevisionManifest={version:1|2;representationVersion:1;mode:"shadow";reuseAllowed:false;epoch:string;readDefinitionsRevision:string;
  scope:Omit<RevisionScope,"ownerKey">;readBindingVector:{version:1;representationVersion:1;available:boolean;revision:string}};
export type ReadRevision={version:1;representationVersion:1;mode:"shadow";reuseAllowed:false;clientMaySkipReads:false;revision:string;
  manifestVectorRevision:string;epoch:string;authorizationFingerprint:string;selectionFingerprint:string;requestFingerprint:string;contentHash:string;
  snapshot:{isolation:"repeatable-read";at:string};coverageCertified:false};
export type RevisionResource={kind:"records"|"record"|"definition"|"views"|"attendance"|"state-update"|"panel"|"report";entityTypeId?:string;recordId?:string;appViewId?:string;query?:Record<string,string|string[]>};
export type RevisionDownload={resource:RevisionResource;data:unknown;normalized:unknown;readRevision:ReadRevision};
const hex=(x:unknown):x is string=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x);
export function validateRevisionManifest(value:unknown,version:1|2=1):RevisionManifest {
  const m=value as RevisionManifest;
  if(m?.version!==version||m.representationVersion!==1||m.mode!=="shadow"||m.reuseAllowed!==false||!m.epoch||!hex(m.readDefinitionsRevision)||
    m.readBindingVector?.version!==1||m.readBindingVector.representationVersion!==1||m.readBindingVector.available!==true||!hex(m.readBindingVector.revision)||
    !m.scope||![m.scope.userId,m.scope.applicationId,m.scope.organizationId,m.scope.contractId].every(x=>typeof x==="string"&&x.length>0)||!hex(m.scope.authorizationFingerprint))throw new RevisionReceiptError("REVISION_MANIFEST_INCOMPATIBLE");
  return m;
}
export async function validateRevisionDownload(value:unknown):Promise<{data:unknown;readRevision:ReadRevision}> {
  const envelope=value as {data:unknown;readRevision:ReadRevision},r=envelope?.readRevision;
  if(r?.version!==1||r.representationVersion!==1||r.mode!=="shadow"||r.reuseAllowed!==false||r.clientMaySkipReads!==false||r.coverageCertified!==false||!r.epoch||
    ![r.revision,r.manifestVectorRevision,r.authorizationFingerprint,r.selectionFingerprint,r.requestFingerprint,r.contentHash].every(hex)||
    r.snapshot?.isolation!=="repeatable-read"||!Number.isFinite(Date.parse(r.snapshot.at)))throw new RevisionReceiptError("READ_REVISION_INCOMPATIBLE");
  if(await revisionHash(envelope.data)!==r.contentHash)throw new RevisionReceiptError("READ_REVISION_CONTENT_MISMATCH");
  return {data:envelope.data,readRevision:r};
}
export function assertRevisionScope(scope:RevisionScope,m:RevisionManifest) {
  if(scope.ownerKey!==`${scope.organizationId}:${scope.userId}`||["userId","applicationId","organizationId","contractId","authorizationFingerprint"].some(key=>scope[key as keyof RevisionScope]!==m.scope[key as keyof typeof m.scope]))throw new RevisionReceiptError("REVISION_SCOPE_MISMATCH");
}
export function assertRevisionMatches(m:RevisionManifest,r:ReadRevision) {
  if(m.epoch!==r.epoch||m.scope.authorizationFingerprint!==r.authorizationFingerprint||m.readBindingVector.revision!==r.manifestVectorRevision)throw new RevisionReceiptError("REVISION_REMOTE_CHANGED");
}
export function revisionReadPath(contractId:string,resource:RevisionResource,expected?:string) {
  const e=encodeURIComponent,base=`/api/v1/contracts/${e(contractId)}`;
  let path:string;
  if(resource.kind==="views")path=base+"/views";
  else if(["records","record","definition"].includes(resource.kind)) {
    if(!resource.entityTypeId)throw new RevisionReceiptError("REVISION_RESOURCE_INVALID");
    path=base+`/entities/${e(resource.entityTypeId)}`+(resource.kind==="definition"?"":resource.kind==="records"?"/records":`/records/${e(resource.recordId??"")}`);
    if(resource.kind==="record"&&!resource.recordId)throw new RevisionReceiptError("REVISION_RESOURCE_INVALID");
  }else{
    if(!resource.appViewId)throw new RevisionReceiptError("REVISION_RESOURCE_INVALID");
    path=base+(["attendance","state-update"].includes(resource.kind)?`/views/${e(resource.appViewId)}/workflow/${resource.kind}`:`/${resource.kind==="panel"?"panels":"reports"}/${e(resource.appViewId)}`);
  }
  const query=new URLSearchParams();for(const[key,value]of Object.entries(resource.query??{})){if(["readRevisionVersion","expectedReadRevision"].includes(key))throw new RevisionReceiptError("REVISION_RESOURCE_INVALID");for(const item of Array.isArray(value)?value:[value])query.append(key,item);}
  query.set("readRevisionVersion","1");if(expected)query.set("expectedReadRevision",expected);
  return path+"?"+query.toString();
}

/** Verifies Core's selection binding against the actual URL, not only an echoed identifier. */
export async function assertRevisionRequestBinding(contractId:string,resource:RevisionResource,download:{data:unknown;readRevision:ReadRevision}) {
  const q=new URL(revisionReadPath(contractId,resource),"http://revision.invalid").searchParams;
  const entries=[...q.entries()].filter(([key])=>!["readRevisionVersion","expectedReadRevision"].includes(key)).sort(([a],[b])=>a<b?-1:a>b?1:0);
  const selection=entries.filter(([key])=>key!=="page"&&!(resource.kind==="state-update"&&key==="subjectRecordIds"));
  const descriptor={kind:resource.kind,contractId,...(resource.entityTypeId?{entityTypeId:resource.entityTypeId}:{}),...(resource.recordId?{recordId:resource.recordId}:{}),...(resource.appViewId?{appViewId:resource.appViewId}:{})};
  const data=download.data as {date?:unknown;from?:unknown;to?:unknown};
  const effectiveContext={date:typeof data?.date==="string"?data.date:null,from:typeof data?.from==="string"?data.from:null,to:typeof data?.to==="string"?data.to:null};
  const selectionFingerprint=await revisionHash({resource:descriptor,query:selection,effectiveContext});
  const requestFingerprint=await revisionHash({resource:descriptor,query:entries,effectiveContext});
  const revision=await revisionHash({manifestVectorRevision:download.readRevision.manifestVectorRevision,selectionFingerprint,representationVersion:1});
  if(download.readRevision.selectionFingerprint!==selectionFingerprint||download.readRevision.requestFingerprint!==requestFingerprint||download.readRevision.revision!==revision)throw new RevisionReceiptError("READ_REVISION_REQUEST_MISMATCH");
}

/** Compatibility normalizers must never turn a missing outcome into a proof of null. */
export function assertRevisionResponseShape(resource:RevisionResource,value:unknown){
 const data=value as Record<string,unknown>;
 if(!data||typeof data!=="object"||Array.isArray(data))throw new RevisionReceiptError("READ_REVISION_INCOMPATIBLE");
 const current=(value:unknown)=>value===null||!!value&&typeof value==="object"&&typeof (value as {recordId?:unknown}).recordId==="string"&&typeof (value as {updatedAt?:unknown}).updatedAt==="string";
 if(resource.kind==="state-update"){
  const subjects=data.subjects??data.items;if(!Array.isArray(subjects)||!Array.isArray(data.stateFields))throw new RevisionReceiptError("READ_REVISION_INCOMPATIBLE");
  for(const raw of subjects){const item=raw as {subject?:{id?:unknown};current?:unknown;reports?:{current?:unknown}[]};
   if(!item||typeof item.subject?.id!=="string"||(typeof resource.query?.subjectRecordId==="string"&&item.subject.id!==resource.query.subjectRecordId))throw new RevisionReceiptError("READ_REVISION_INCOMPATIBLE");
   if(item.reports){if(!Array.isArray(item.reports)||item.reports.length!==1||!Object.hasOwn(item.reports[0],"current")||!current(item.reports[0].current))throw new RevisionReceiptError("READ_REVISION_INCOMPATIBLE");}
   else if(!Object.hasOwn(item,"current")||!current(item.current))throw new RevisionReceiptError("READ_REVISION_INCOMPATIBLE");
  }
 }
 if(resource.kind==="attendance"){
  if(!Array.isArray(data.items)||!Array.isArray(data.latest))throw new RevisionReceiptError("READ_REVISION_INCOMPATIBLE");
  for(const raw of data.items){const item=raw as {person?:{id?:unknown};attendance?:unknown};if(!item||typeof item.person?.id!=="string"||!Object.hasOwn(item,"attendance")||!current(item.attendance)||(typeof resource.query?.personRecordId==="string"&&item.person.id!==resource.query.personRecordId))throw new RevisionReceiptError("READ_REVISION_INCOMPATIBLE");}
 }
}
