import {preparedPresentationAvailable} from "./subject-presentation-cache";
import {it,expect,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {SubjectIdentity} from "../components/subject-identity";
import {StateUpdateReadRows} from "../renderers/workflows/state-update/state-update-presentation";
import {presentationFingerprint,projectSubject,type SubjectPresentationDefinition} from "./subject-presentation";
import {subjectPresentationView} from "./subject-presentation-display";
const viewport=vi.hoisted(()=>({width:1440,height:900,scale:1,fontScale:1}));vi.mock("react-native",async()=>({...await import("react-native-web"),useWindowDimensions:()=>viewport}));
export const definition:SubjectPresentationDefinition={version:1,sourceEntityTypeId:"source",config:{version:1,titleFieldIds:["given","family"],secondaryFieldIds:["code","select","relation","multi"]},fields:[{id:"given",key:"given",name:"Nombre",type:"TEXT",multiple:false},{id:"family",key:"family",name:"Apellido",type:"TEXT",multiple:false},{id:"code",key:"code",name:"Código",type:"TEXT",multiple:false},{id:"select",key:"select",name:"Opción",type:"SELECT",multiple:false,options:[{value:"canonical",label:"Etiqueta legible"}]},{id:"relation",key:"relation",name:"Relaciones",type:"RELATION",multiple:true,targetEntityTypeId:"target",relationReadable:true},{id:"multi",key:"multi",name:"Varias",type:"MULTISELECT",multiple:true,options:[{value:"a",label:"Alfa"},{value:"b",label:"Beta"}]}],fingerprint:""};definition.fingerprint=presentationFingerprint(definition.sourceEntityTypeId,definition.config,definition.fields);
const subject={id:"person",displayName:"Legacy code",presentation:projectSubject(definition,"person",{given:"Nombre sintético",family:"Apellido sintético",code:"00012-K",select:"canonical",multi:["a","b"],relation:[{id:"remote-id-1",entityTypeId:"target",displayName:"Etiqueta uno"},{id:"remote-id-2",entityTypeId:"target",displayName:"Etiqueta dos"}]})};
it("composes ordered title, labels and multiple values without mutation or numeric conversion",()=>{
 const before=JSON.stringify(subject);const view=subjectPresentationView(subject,definition.config,definition);expect(view.title).toBe("Nombre sintético Apellido sintético");expect(view.complete).toBe(true);expect(view.secondary.map(f=>f.value)).toEqual(["00012-K","Etiqueta legible","Etiqueta uno, Etiqueta dos","Alfa, Beta"]);expect(JSON.stringify(subject)).toBe(before);
});
it("distinguishes empty/unprepared/inaccessible/unknown options; never substitutes technical IDs",()=>{
 const item={...subject,presentation:projectSubject(definition,"person",{given:null,family:"",select:"missing-option-id",relation:["raw-related-id"],multi:[]},["code"])};const view=subjectPresentationView(item,definition.config,definition);expect(view.title).toBe("Sin datos de presentación");expect(view.complete).toBe(false);expect(JSON.stringify(view)).not.toContain("missing-option-id");expect(JSON.stringify(view)).not.toContain("raw-related-id");expect(view.secondary.map(f=>f.value)).toContain("Dato no disponible");expect(view.issue).toBeTruthy();
 const unprepared=subjectPresentationView({...subject,presentation:projectSubject(definition,"person",{})},definition.config,definition);expect(unprepared.title).toContain("Dato no preparado");
});
it("legacy and old/incompatible metadata keep operations usable rather than blocking selection",()=>{
 expect(subjectPresentationView(subject,undefined)).toMatchObject({title:"Legacy code",issue:null});expect(subjectPresentationView(subject,definition.config)).toMatchObject({title:"Legacy code",complete:false});expect(subjectPresentationView(subject,definition.config,{...definition,fingerprint:"wrong"})).toMatchObject({title:"Legacy code",complete:false});
});
it.each([1440,1024,390])("real shared identity/STATE_UPDATE row rendering retains state/actions at %s",width=>{
 viewport.width=width;const action=vi.fn();const html=renderToStaticMarkup(<><SubjectIdentity subject={subject} config={definition.config} definition={definition}/><StateUpdateReadRows rows={[{key:subject.id,subject,name:subject.displayName,values:[{fieldId:"status",label:"Estado",value:"PRESENTE"}],compactText:"PRESENTE",onPress:action}]} presentationConfig={definition.config} presentationDefinition={definition}/></>);for(const s of ["Nombre sintético Apellido sintético","00012-K","Etiqueta legible","Etiqueta uno, Etiqueta dos","Alfa, Beta","PRESENTE"])expect(html).toContain(s);expect(html).not.toContain("remote-id-1");expect(action).not.toHaveBeenCalled();expect(html).toContain('role="button"');
});

it("checks all prepared source pages and never certifies missing metadata or incomplete values",async()=>{
 const raw={appView:{config:{subjectPresentation:definition.config}},subjectPresentation:definition};const scope={ownerKey:"owner",contractId:"contract",appViewId:"view",sourceEntityTypeId:"source"};const values={given:"Nombre",family:null,code:"001",select:"canonical",multi:["a"],relation:[]};const listCachedRecords=vi.fn(async(q:{page:number})=>({records:[{id:"record-"+q.page,serverId:"record-"+q.page,displayName:"Legacy",values}],pagination:{total:2,totalPages:2}}));
 expect(await preparedPresentationAvailable({listCachedRecords},scope,raw)).toBe(true);expect(listCachedRecords).toHaveBeenCalledTimes(2);expect(await preparedPresentationAvailable({listCachedRecords},scope,{appView:raw.appView})).toBe(false);
 const missing={listCachedRecords:async()=>({records:[{id:"one",displayName:"Legacy",values:{given:"Only one field"}}],pagination:{total:1,totalPages:1}})};expect(await preparedPresentationAvailable(missing,scope,raw)).toBe(false);
});
