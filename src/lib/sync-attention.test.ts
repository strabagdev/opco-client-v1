import { describe, expect, it } from "vitest";
import { buildSyncAttentionProblems, syncAttentionReason, type AttentionRow } from "./sync-attention";
import type { AppView } from "./opco-api";
const scope={ownerKey:"owner",contractId:"contract"};
const row:AttentionRow={owner_key:scope.ownerKey,contract_id:scope.contractId,entity_type_id:"target",local_id:"local",display_name:"Synthetic person",values_json:JSON.stringify({appViewId:"view",subjectRecordId:"subject",date:"2026-10-09"}),sync_status:"conflict",payload_json:null,operation:"STATE_UPDATE"};
const view={id:"view",name:"Attendance",type:"WORKFLOW",config:{workflowKey:"attendance",targetEntityTypeId:"target",dateFieldId:"date"}} as AppView;
describe("attention metadata and navigation",()=>{
 it("does not invent labels/date or a destination without compatible metadata",()=>{const p=buildSyncAttentionProblems([{...row,display_name:null,values_json:"invalid"}],[],scope)[0];expect(p).toMatchObject({experience:null,recordName:null,date:null,href:null});expect(syncAttentionReason(p)).not.toMatch(/otro usuario|duplic/i)});
 it("missing or invalid logical date cannot navigate Attendance to today's conflict",()=>{for(const date of [null,"2026-02-30","arbitrary"]){const p=buildSyncAttentionProblems([{...row,values_json:JSON.stringify({appViewId:"view",date})}],[view],scope)[0];expect(p.href).toBeNull()}});
 it("deduplicates only same scoped record; separate records remain separate",()=>{expect(buildSyncAttentionProblems([row,row,{...row,local_id:"another"}],[view],scope)).toHaveLength(2)});
 it("incompatible target definition cannot direct resolution into another entity",()=>{expect(buildSyncAttentionProblems([row],[{...view,config:{...view.config,targetEntityTypeId:"different"}} as AppView],scope)[0].href).toBeNull()});
 it("RECORDS conflict opens the existing conflict route for the precise record",()=>{const recordView={id:"records",type:"RECORDS",name:"Records",config:{entityTypeId:"target"}} as AppView;const p=buildSyncAttentionProblems([{...row,values_json:"{}",operation:"UPDATE"}],[recordView],scope)[0];expect(p.href).toEqual({pathname:"/view/[appViewId]/record/[recordId]/conflict",params:{appViewId:"records",recordId:"local"}})});
 it("known orphan operation remains visible but cannot pretend its local row can be resolved",()=>{const p=buildSyncAttentionProblems([{...row,values_json:null,payload_json:row.values_json}],[view],scope)[0];expect(p.state).toBe("conflict");expect(p.href).toBeNull()});

});
