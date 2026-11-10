// @ts-expect-error Node types are intentionally absent from Expo config.
import { readFileSync } from "node:fs";
import React, { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Platform, ScrollView, Text, View } from "react-native";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { EntityField, ReportResponse } from "../../lib/opco-api";
import { buildReportMatrixModel } from "./report-renderer-logic";
vi.mock("react-native", async () => import("react-native-web"));
const field = (id:string,key:string,type:EntityField["type"]):EntityField => ({id,key,type,name:key,active:true,searchable:false,required:false,multiple:false,config:{},options:[],order:0});
const report:ReportResponse = {
  appView:{id:"matrix",name:"Matriz configurada",slug:"matrix"},entity:{id:"entity",name:"Entidad",slug:"entity"},from:"2026-11-01",to:"2026-11-30",
  config:{entityTypeId:"entity",dateFieldId:"date",presentationMode:"MATRIX",matrix:{rowFieldId:"subject",columnFieldId:"category",valueFieldId:"value",summaryFieldId:"summary"}},
  fields:[field("subject","subject","RELATION"),field("date","date","DATE"),{...field("category","category","SELECT"),options:[{id:"o1",value:"c1",label:"Encabezado extenso configurado",active:true,order:0}]},field("value","value","DECIMAL"),{...field("summary","summary","SELECT"),options:[{id:"s1",value:"a",label:"Clase A",active:true,order:0}]}],
  records:[0,0,5].map((value,i)=>({id:"record-"+i,displayName:"Sin cambios",updatedAt:"2026-11-08T00:00:00Z",values:{subject:{id:"subject-1",displayName:"Nombre completo ".repeat(12)},date:"2026-11-08",category:"c1",value,summary:"a"}})),
};
function freeze<T>(x:T):T {if(x&&typeof x==="object"){Object.freeze(x);Object.values(x).forEach(freeze)}return x}
const sourcePath=(globalThis as unknown as {process?:{env:Record<string,string|undefined>}}).process?.env.OPCO_MATRIX_SOURCE_FILE??"src/renderers/reports/ReportRenderer.tsx";
const sf=ts.createSourceFile(sourcePath,readFileSync(sourcePath,"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const code=sf.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="ReportMatrix")!.getText(sf);
const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
const deps={React,useState,Platform,ScrollView,Text,View,styles:{},matrixStyles:{}};
const Matrix=new Function(...Object.keys(deps),js+";return ReportMatrix;")(...Object.values(deps));
describe("MATRIX presentation without consolidation changes",()=>{
  it("preserves Set deduplication, zero, original ordering and frequency summary exactly",()=>{
    const input=freeze(structuredClone(report)),model=freeze(buildReportMatrixModel(input)!);const original=JSON.stringify([input,model]);
    expect(model.rows[0].values).toEqual({c1:"0, 5"});expect(model.rows[0].summary).toBe("Clase A: 3");
    const html=renderToStaticMarkup(<Matrix matrix={model}/>);expect(html).toContain("0, 5");expect(html).toContain("Clase A: 3");expect(html).not.toContain("Total general");expect(JSON.stringify([input,model])).toBe(original);
  });
  it("renders complete long headers and row labels without cards or new query actions",()=>{
    const model=buildReportMatrixModel(report)!;const html=renderToStaticMarkup(<Matrix matrix={model}/>);
    expect(html).toContain(model.rows[0].label);expect(html).toContain(model.columns[0].label);expect(html).not.toContain("Buscar registros");expect(html).not.toContain("Siguiente");
  });
  it("regression: makes the matrix viewport keyboard-focusable and named while keeping pinned axes",()=>{
    const html=renderToStaticMarkup(<Matrix matrix={buildReportMatrixModel(report)!}/>);
    expect(html).toContain('aria-label="Matriz del reporte"');expect(html).toContain('tabindex="0"');expect(html).toContain("position:sticky");expect(html).toContain("max-height:min(68vh, 720px)");
  });
  it("does not introduce a summary when the configuration omits it",()=>{
    const input=structuredClone(report);if(input.config.presentationMode==="MATRIX")delete input.config.matrix.summaryFieldId;
    const model=buildReportMatrixModel(input)!;expect(model.rows[0].summary).toBeNull();expect(renderToStaticMarkup(<Matrix matrix={model}/>)).not.toContain("Resumen");
  });
  it("preserves the full monthly calendar, placeholders and numerical strings",()=>{
    const input=structuredClone(report);if(input.config.presentationMode==="MATRIX"){input.config.matrix.columnFieldId="date";input.config.timeFilter={mode:"MONTH",allowChange:true,defaultPeriod:"CURRENT_MONTH"}}
    const model=freeze(buildReportMatrixModel(input)!);const original=JSON.stringify(model);const html=renderToStaticMarkup(<Matrix matrix={model}/>);
    expect(model.columns).toHaveLength(30);expect(model.columns[0]).toEqual({key:"2026-11-01",label:"01"});expect(model.rows[0].values["2026-11-08"]).toBe("0, 5");expect(html).toContain("30");expect(html).toContain("0, 5");expect(JSON.stringify(model)).toBe(original);
  });
  it("keeps every row and category in model order",()=>{
    const model=buildReportMatrixModel(report)!;model.columns.push({key:"empty",label:"Columna vacía"});model.rows.push({id:"last",label:"Última fila",summary:"Clase A: 0",values:{c1:"0.5"}});
    const before=JSON.stringify(model),html=renderToStaticMarkup(<Matrix matrix={freeze(model)}/>);expect(html.indexOf(model.rows[0].label)).toBeLessThan(html.indexOf("Última fila"));expect(html).toContain("Columna vacía");expect(html).toContain("0.5");expect(html).toContain("Clase A: 0");expect(JSON.stringify(model)).toBe(before);
  });
});
