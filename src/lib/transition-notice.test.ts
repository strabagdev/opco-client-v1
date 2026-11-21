import { describe, expect, it } from "vitest";
import { activeTransitionNotice, parseTransitionNotice } from "./transition-notice";
const n={version:1,text:" Transición de ejemplo ",startsAt:"2027-01-03T05:00:00.000Z",endsAt:"2027-01-05T05:00:00.000Z"};
describe("transition notice metadata",()=>{
 it.each([["2027-01-03T04:59:59.999Z",null],[n.startsAt,"Transición de ejemplo"],["2027-01-05T04:59:59.999Z","Transición de ejemplo"],[n.endsAt,null]])("observes [start,end) at %s",(time,text)=>expect(activeTransitionNotice(n,Date.parse(time!))).toBe(text));
 it.each([null,{}, {...n,version:2},{...n,text:" "},{...n,text:"x".repeat(1001)},{...n,endsAt:n.startsAt},{...n,startsAt:"2027-02-30T05:00:00.000Z"},{...n,startsAt:"2027-01-03T02:00:00-03:00"},{...n,other:true}])("rejects invalid metadata without breaking cached reads: %j",v=>{expect(()=>parseTransitionNotice(v)).toThrow();expect(activeTransitionNotice(v)).toBeNull();});
 it("keeps the existing behavior without config and normalizes only the text",()=>{expect(parseTransitionNotice(undefined)).toBeUndefined();expect(activeTransitionNotice(undefined)).toBeNull();expect(parseTransitionNotice(n)).toEqual({...n,text:n.text.trim()});});
});
