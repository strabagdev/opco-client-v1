import { describe, expect, it } from "vitest";
import { inspectAttendanceLocalReadTrace, recordAttendanceLocalRead } from "./attendance-local-read-trace";
const scope={ownerKey:"trace-owner",contractId:"contract",appViewId:"view",targetEntityTypeId:"entity",date:"2026-11-19"};
describe("process-local Attendance read trace",()=>{
 it("records actual membership, publication and row counts without exposing other records or scope identities",()=>{
  recordAttendanceLocalRead(scope,"group/read",["selected","alias","other"],false,2);
  expect(inspectAttendanceLocalReadTrace(scope,"selected",null).at(-1)).toMatchObject({source:"group/read",count:2,published:false,selectedIncluded:true});
  expect(inspectAttendanceLocalReadTrace({...scope,ownerKey:"different"},"selected",null)).toEqual([]);
  expect(inspectAttendanceLocalReadTrace({...scope,date:"2026-11-18"},"selected",null)).toEqual([]);
  expect(JSON.stringify(inspectAttendanceLocalReadTrace(scope,"selected",null))).not.toContain('"other"');
 });
 it("bounds history and does not infer exclusion from truncated identity lists",()=>{
  for(let i=0;i<35;i++)recordAttendanceLocalRead(scope,"recent/"+i,[]);
  expect(inspectAttendanceLocalReadTrace(scope,"selected",null)).toHaveLength(30);
  recordAttendanceLocalRead(scope,"large-group",[...Array.from({length:2000},(_,n)=>"id"+n),"selected"]);
  expect(inspectAttendanceLocalReadTrace(scope,"selected",null).at(-1)).toMatchObject({count:2001,selectedIncluded:null,identityListTruncated:true});
 });
});

it("distinguishes an actual query for another subject without exporting its ID",()=>{
 recordAttendanceLocalRead({...scope,subjectRecordId:"person-other"},"person/local-read",["other-record"],true);
 const trace=inspectAttendanceLocalReadTrace(scope,"selected",null,"person-selected").at(-1);expect(trace).toMatchObject({subjectMatches:false,selectedIncluded:false});expect(JSON.stringify(trace)).not.toContain("person-other");
});
