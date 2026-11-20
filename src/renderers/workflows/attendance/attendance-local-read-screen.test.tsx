import React from "react";
import {renderToStaticMarkup}from"react-dom/server";
import{describe,expect,it,vi}from"vitest";
import{AttendanceLocalRecordContent}from"./AttendanceLocalRecordScreen";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import{readFileSync}from"node:fs";
vi.mock("react-native",async()=>import("react-native-web"));
vi.mock("../../../state/session",()=>({useSession:vi.fn()}));
vi.mock("../../use-experience-activity",()=>({useExperienceActivityReporter:vi.fn()}));
vi.mock("expo-router",()=>({useRouter:vi.fn()}));
describe("read-only Attendance content",()=>{
 it("shows original DATE, configured state/context labels, capture and sync without write controls",()=>{
  const detail={scope:{date:"2026-11-19"},presentation:{record:{recordId:"exact-local",person:{id:"subject",displayName:"Persona sintética"}},reference:"exact-local",referenceKind:"local",syncLabel:"Guardado local · pendiente",capture:{compact:"19:02",detail:"19-11-2026 19:02:17 · America/Santiago · UTC-03:00 · Captura del reloj del dispositivo"},timestamps:[],fields:[{key:"state",label:"Estado",fullWidth:false,values:[{text:"Opción configurada",status:"value"}]},{key:"context",label:"Contexto configurado",fullWidth:false,values:[{text:"Catálogo sintético",status:"value"}]}]}}as unknown as Parameters<typeof AttendanceLocalRecordContent>[0]["detail"];
  const html=renderToStaticMarkup(<AttendanceLocalRecordContent detail={detail}/>);for(const text of["2026-11-19","Opción configurada","Contexto configurado","Catálogo sintético","Hora de captura: 19:02","Guardado local · pendiente"])expect(html).toContain(text);for(const text of[">Editar<",">Registrar<",">Guardar<",">Reintentar<"])expect(html).not.toContain(text);
 });
 it("routes read-mode attention to the dedicated reader instead of mounting Attendance write handlers",()=>{
  const source=readFileSync("app/(app)/view/[appViewId].tsx","utf8");expect(source).toContain('attentionMode === "read"');expect(source).toContain("<AttendanceLocalRecordScreen");const reader=readFileSync("src/renderers/workflows/attendance/AttendanceLocalRecordScreen.tsx","utf8");for(const method of["saveStateUpdateLocally(","syncPendingRecords(","retryFailedStateUpdateOperations(","api."])expect(reader).not.toContain(method);expect(reader).toContain("useExperienceActivityReporter");
 });
});
