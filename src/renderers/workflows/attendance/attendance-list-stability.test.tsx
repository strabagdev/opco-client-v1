// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { readFileSync } from "node:fs";
import React from "react";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { distinctAttendancePresentations, groupAttendancePresentations } from "./attendance-record-presentation";

// The deterministic hook cells follow the existing use-app-view renewal fixture.
// Real mounts, focus and expansion are measured separately in Chromium/OPFS.
function mount() {
  const path="src/renderers/workflows/attendance/attendance-record-list.tsx",src=ts.createSourceFile(path,readFileSync(path,"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const node=src.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="AttendanceRecordList")!;
  const cells:any[]=[];let cursor=0,dirty=true,effects:(()=>void)[]=[],value:any,gate:Promise<unknown>=Promise.resolve();
  const same=(a:any[],b:any[])=>a?.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const useState=(initial:any)=>{const n=cursor++;cells[n]??={value:typeof initial==="function"?initial():initial};return[cells[n].value,(next:any)=>{cells[n].value=typeof next==="function"?next(cells[n].value):next;dirty=true}];};
  const useRef=(initial:any)=>{const n=cursor++;return cells[n]??=( {current:initial} )};
  const useEffect=(fn:()=>any,deps:any[])=>{const n=cursor++;if(!cells[n]||!same(cells[n].deps,deps)){const previous=cells[n];cells[n]={deps,cleanup:previous?.cleanup};effects.push(()=>{cells[n].cleanup?.();cells[n].cleanup=fn()})}};
  const Group=()=>null,Row=()=>null;
  const props:any={records:[record("one")],fields:[],statuses:[],scope:{ownerKey:"owner",contractId:"contract",appViewId:"view",targetEntityTypeId:"events",date:"2026-11-26"},store:{getCachedRecord:vi.fn(),getAttendanceDailyRecords:vi.fn()},grouped:true,isCurrent:()=>true};
  const dep={React,useState,useRef,useEffect,View:"View",Text:"Text",s:{},AttendanceRecordGroup:Group,AttendanceRecordRow:Row,recordAttendanceLocalRead:vi.fn(),distinctAttendancePresentations,groupAttendancePresentations,
    readAttendancePresentedSubjects:vi.fn(async(_s:any,_q:any,subjects:any[])=>{await gate;return subjects}),loadAttendanceRecordPresentation:vi.fn(async(_s:any,_q:any,r:any)=>({record:r,reference:r.recordId,referenceKind:"local",serverId:r.serverId,fields:[],timestamps:[]}))};
  const fn=new Function(...Object.keys(dep),ts.transpileModule(node.getText(src).replace(/^export /,"" )+";return AttendanceRecordList;",{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText)(...Object.values(dep));
  function render(){dirty=false;cursor=0;effects=[];value=fn(props);effects.forEach(f=>f())}
  const visit=(v:any):any[]=>v&&typeof v==="object"&&"props"in v?[v,...React.Children.toArray(v.props.children).flatMap(visit)]:[];
  render();return{props,dep,update(patch:any){Object.assign(props,patch);render()},hold(){let release!:()=>void;gate=new Promise<void>(r=>release=r);return release},groups(){if(dirty)render();return visit(value).filter(v=>v.type===Group)},loader(){if(dirty)render();return visit(value).some(v=>v.props.children==="Leyendo registros…")},async settle(){for(let n=0;n<60;n++){await Promise.resolve();if(dirty)render()}},unmount(){cells.forEach(c=>c.cleanup?.())}};
}
const record=(id:string,status="A")=>({recordId:id,person:{id:"person",displayName:"Synthetic"},statusLabel:status,statusOptionId:status,updatedAt:"version"});

describe("compatible Attendance list presentation",()=>{
 it("retains the same group during a pending background presentation instead of returning a loader",async()=>{
  const h=mount();expect(h.loader()).toBe(true);await h.settle();const key=h.groups()[0].key,release=h.hold();h.update({records:[record("one","B")]});
  expect(h.loader()).toBe(false);expect(h.groups()).toHaveLength(1);expect(h.groups()[0].key).toBe(key);
  release();await h.settle();expect(h.groups()[0].props.group.rows[0].record.statusLabel).toBe("B");h.unmount();
 });
 it("removes an actually absent row without retaining it as a visual placeholder",async()=>{
  const h=mount();h.update({records:[record("one"),{...record("two"),person:{id:"other",displayName:"Other"}}]});await h.settle();const release=h.hold();h.update({records:[record("one","B")]});expect(h.groups().map(g=>g.props.group.subject.id)).toEqual(["person"]);release();await h.settle();h.unmount();
 });
 it.each(["ownerKey","contractId","appViewId","date"])("retires retained rows immediately when %s changes",async field=>{
  const h=mount();await h.settle();const release=h.hold();h.update({scope:{...h.props.scope,[field]:"different"}});expect(h.groups()).toHaveLength(0);expect(h.loader()).toBe(true);release();await h.settle();h.unmount();
 });
 it("does not retain rows or accept a delayed result from a retired authentication generation",async()=>{
  const h=mount();let generation=1;h.update({isCurrent:()=>generation===1});await h.settle();const release=h.hold();h.update({records:[record("one","B")]});generation++;h.update({isCurrent:()=>generation===2});expect(h.groups()).toHaveLength(0);release();await h.settle();expect(h.groups()).toHaveLength(1);h.unmount();
 });
 it("retires incompatible field/definition presentations instead of displaying them through refresh",async()=>{
  const h=mount();await h.settle();const release=h.hold();h.update({fields:[{id:"changed",name:"Other definition",type:"TEXT"}]});expect(h.groups()).toHaveLength(0);release();await h.settle();h.unmount();
 });
});

it("keeps the day list instance hidden during an explicit edit so its group expansion can survive the return",()=>{
 const path="src/renderers/workflows/attendance/AttendanceWorkflow.tsx",src=ts.createSourceFile(path,readFileSync(path,"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expr:ts.ConditionalExpression|undefined;
 function visit(n:ts.Node){if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(src)==="LatestAttendanceList"){let p:ts.Node|undefined=n.parent;while(p&&!ts.isConditionalExpression(p))p=p.parent;if(p&&ts.isConditionalExpression(p))expr=p;}ts.forEachChild(n,visit)}visit(src);if(!expr)throw Error("Missing actual day-list conditional");
 const Latest=()=>null,dep={React,View:"View",LatestAttendanceList:Latest,normalizedSearch:"",selectedItem:{person:{id:"selected"}},hasCompatibleDay:true,latest:[],contextFields:[],statuses:[],definitionCache:{},daySnapshotHydrated:true,totalRegistered:0,readRecordGroup:vi.fn(),appView:{id:"view",config:{sourceEntityTypeId:"people",targetEntityTypeId:"events"}},presentationDefinition:undefined,setError:vi.fn(),isPresentationReadCurrent:()=>true,ownerKey:"owner",selectedContractId:"contract",date:"2026-11-26",calendar:undefined,editRepeatedRecord:vi.fn()};
 const value=new Function(...Object.keys(dep),ts.transpileModule('return '+expr.getText(src),{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText)(...Object.values(dep));
 expect(value).not.toBeNull();expect(value.props.style).toEqual({display:"none"});expect(React.Children.toArray(value.props.children).some((v:any)=>v.type===Latest)).toBe(true);
});
