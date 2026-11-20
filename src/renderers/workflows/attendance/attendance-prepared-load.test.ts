// @ts-expect-error Node types intentionally absent from the Expo app configuration.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, it, expect, vi } from "vitest";
import { OpcoApiError, OpcoNetworkError } from "../../../lib/opco-api";
import { attendanceContextFieldsFromPreparedDefinition, attendanceContextValidationErrors, isAttendanceRequestCurrent } from "./attendance-workflow-logic";
import { attendanceStatusesFromStateFields } from "../../../lib/attendance-offline";
const path = process.env.ATTENDANCE_CONTEXT_SOURCE ?? `${process.cwd()}/src/renderers/workflows/attendance/AttendanceWorkflow.tsx`;
const source = ts.createSourceFile(path, readFileSync(path,"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function actualLoad(context: Record<string,unknown>) {
 context={calendar:undefined,...context};
 let load:ts.FunctionDeclaration|undefined;
 const visit=(node:ts.Node)=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==='load')load=node;ts.forEachChild(node,visit);};visit(source);
 if(!load)throw Error('Missing actual Attendance load effect');
 return new Function(...Object.keys(context),ts.transpileModule(load.getText(source)+';return load;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(context)) as()=>Promise<void>;
}
const relation={id:'reference',key:'reference',name:'Referencia configurable',type:'RELATION' as const,required:true,active:true,multiple:false,config:{relation:{relationKind:'ONE',targetEntityTypeId:'catalog'}}};
function fixture(){
 const chronology:string[]=[];
 const definition={kind:'state-update',appView:{id:'view'},extraFields:[relation],stateFields:[{fieldId:'state',label:'Estado',type:'SELECT',required:true,options:[{optionId:'a',label:'A'}]}],captureTime:{version:1,fieldId:'capture',timeZone:'America/Santiago'}};
 const c={chronology,definition,token:'synthetic',ownerKey:'owner',selectedContractId:'contract',status:'offline',connectivityStatus:'online',isContractBootstrapPending:false,isMounted:true,date:'2026-11-18',writePolicyConfigured:false,writeContractRequiredRef:{current:false},requestSequenceRef:{current:0},appView:{id:'view',config:{sourceEntityTypeId:'source',statusFieldId:'state',defaultCheckInOptionId:'a',contextFieldIds:['reference']}},OpcoNetworkError,OpcoApiError,isAttendanceRequestCurrent,hasSuccessfulHydration:()=>true,attendanceContextFieldsFromPreparedDefinition,attendanceStatusesFromStateFields,
  definitionCache:{getAppViewDefinition:vi.fn(async()=>({status:'ready',definition})),getEntityDefinition:vi.fn(async()=>({definition:{}})),getSyncTelemetry:vi.fn(async()=>({lastFullRefreshCompletedAt:'2026-11-18T00:00:00Z'})),saveStateUpdateLocally:vi.fn()},
  beginLoadingRequest:()=>++c.requestSequenceRef.current,finishLoadingRequest:vi.fn(),setError:vi.fn(),setRefreshError:vi.fn(),setSuccessMessage:vi.fn(),setItems:vi.fn(),setIsLoading:vi.fn(),setPresentationDefinition:vi.fn(),setWriteContract:vi.fn(),setCaptureContract:vi.fn(),setOperationalContract:vi.fn(),setStatuses:vi.fn(),setContextFields:vi.fn((fields:unknown[])=>{chronology.push('contexts:'+fields.length);}),cacheAttendanceOnlineResponse:vi.fn(),refreshLocalDayState:vi.fn(async()=>{chronology.push('local-records');}),clearVisibleError:vi.fn(),recordVisibleError:vi.fn(),
  api:{getAttendanceWorkflow:vi.fn(async()=>{chronology.push('remote');throw new OpcoNetworkError('Core inaccesible');})},applyAttendanceResponse:vi.fn(),
 };
 return c;
}
describe('actual Attendance metadata load effect, independent of navigator connectivity',()=>{
 it('hydrates the persisted required relation before a remote transport failure, without persisting or choosing a value',async()=>{const c=fixture();await actualLoad(c)();expect(c.setContextFields).toHaveBeenCalledWith([expect.objectContaining({id:'reference',required:true,type:'RELATION'})]);expect(c.chronology.indexOf('contexts:1')).toBeLessThan(c.chronology.indexOf('remote'));expect(c.setCaptureContract).toHaveBeenCalledWith(c.definition.captureTime);expect(c.setRefreshError).toHaveBeenCalledWith(expect.stringContaining('guardados'));expect(c.definitionCache.saveStateUpdateLocally).not.toHaveBeenCalled();});
 it('hydrates the same context without any request when genuinely offline',async()=>{const c={...fixture(),connectivityStatus:'offline'};await actualLoad(c)();expect(c.setContextFields).toHaveBeenCalledWith([expect.objectContaining({id:'reference'})]);expect(c.api.getAttendanceWorkflow).not.toHaveBeenCalled();expect(c.setError).toHaveBeenCalledWith(null);});
 it('keeps missing local context explicit, not a permission to search or create',async()=>{const c={...fixture(),connectivityStatus:'offline'};c.definition.extraFields=[];await actualLoad(c)();expect(c.setContextFields).toHaveBeenCalledWith([]);expect(c.setError).toHaveBeenCalledWith(expect.stringContaining('campos de contexto'));expect(c.definitionCache.saveStateUpdateLocally).not.toHaveBeenCalled();});
 it('explains missing local context when the browser reports online but Core is unavailable',async()=>{const c=fixture();c.definition.extraFields=[];await actualLoad(c)();expect(c.setError).toHaveBeenCalledWith(expect.stringContaining('campos de contexto'));expect(c.definitionCache.saveStateUpdateLocally).not.toHaveBeenCalled();});
 it('does not publish an obsolete scope after its cache read',async()=>{const c=fixture();c.definitionCache.getEntityDefinition.mockImplementation(async()=>{c.requestSequenceRef.current++;return{definition:{}};});await actualLoad(c)();expect(c.setContextFields).not.toHaveBeenCalled();expect(c.api.getAttendanceWorkflow).not.toHaveBeenCalled();});
 it.each(['offline','online'])('does not certify a failed local day read while %s',async connectivityStatus=>{const c={...fixture(),connectivityStatus};c.refreshLocalDayState.mockRejectedValue(new Error('No se pudo leer el día guardado; pendientes conservados.'));await actualLoad(c)();expect(c.setError).toHaveBeenLastCalledWith('No se pudo leer el día guardado; pendientes conservados.');expect(c.definitionCache.saveStateUpdateLocally).not.toHaveBeenCalled();});
 it('does not turn an explicit server permission rejection into offline authorization',async()=>{const c=fixture();c.api.getAttendanceWorkflow.mockRejectedValue(new OpcoApiError('Sin acceso','APP_VIEW_FORBIDDEN',403));await actualLoad(c)();expect(c.setContextFields).toHaveBeenLastCalledWith([]);expect(c.setWriteContract).toHaveBeenLastCalledWith(undefined);expect(c.setCaptureContract).toHaveBeenLastCalledWith(undefined);expect(c.setError).toHaveBeenCalledWith('Sin acceso');expect(c.definitionCache.saveStateUpdateLocally).not.toHaveBeenCalled();});
});
it('does not authorize confirmation when configured context metadata is missing',()=>{let node:ts.FunctionDeclaration|undefined;const visit=(n:ts.Node)=>{if(ts.isFunctionDeclaration(n)&&n.name?.text==='attendanceContextValidationErrors')node=n;ts.forEachChild(n,visit);};visit(source);if(!node)throw Error();const validate=new Function('validateAttendanceContextValues','contextRelations','appView',ts.transpileModule(node.getText(source)+';return attendanceContextValidationErrors;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(attendanceContextValidationErrors,{catalogs:{}},{config:{contextFieldIds:['missing-context']}});expect(validate([],{})).toEqual([{fieldId:'missing-context',message:expect.stringContaining('incompleta')}]);});
describe('required relation never picks a substitute when a local catalog is absent',()=>{
 it('preserves the selected ID and blocks confirmation when its option is not stored',()=>{const values={reference:'original-id'};expect(attendanceContextValidationErrors([relation as never],values,{reference:{options:[],offline:true,error:'No hay opciones guardadas'}})).toEqual([{fieldId:'reference',message:'No hay opciones guardadas'}]);expect(values.reference).toBe('original-id');});
 it('does not choose the first cached option and preserves required validation',()=>{const values={reference:null};expect(attendanceContextValidationErrors([relation as never],values,{reference:{options:[{id:'available'}],offline:true}})).toEqual([{fieldId:'reference',message:'Referencia configurable es obligatorio.'}]);expect(values.reference).toBeNull();});
 it('accepts an explicitly selected persisted option, keeps SELECT semantics and waits during loading',()=>{expect(attendanceContextValidationErrors([relation as never],{reference:'chosen'},{reference:{options:[{id:'chosen'}],offline:true}})).toEqual([]);expect(attendanceContextValidationErrors([relation as never],{reference:'chosen'},{reference:{options:[],loading:true}})[0].message).toContain('Espera');});
});

it('still reads already persisted records when offline context metadata is incomplete, without allowing a write',async()=>{
 const c={...fixture(),connectivityStatus:'offline'};c.definition.extraFields=[];
 await actualLoad(c)();
 expect(c.refreshLocalDayState).toHaveBeenCalledTimes(1);
 expect(c.setError).toHaveBeenLastCalledWith(expect.stringContaining('campos de contexto'));
 expect(c.definitionCache.saveStateUpdateLocally).not.toHaveBeenCalled();
});
it('keeps the record read independent from a failed metadata read',async()=>{
 const c={...fixture(),connectivityStatus:'offline'};
 c.definitionCache.getAppViewDefinition.mockRejectedValue(new OpcoNetworkError('Metadata unavailable'));
 await actualLoad(c)();expect(c.refreshLocalDayState).toHaveBeenCalledTimes(1);
 expect(c.setError).toHaveBeenCalledWith('Metadata unavailable');expect(c.api.getAttendanceWorkflow).not.toHaveBeenCalled();
 expect(c.definitionCache.saveStateUpdateLocally).not.toHaveBeenCalled();
});

it('reports a read failure in the existing communication notice even when pending readiness suppresses inline feedback',async()=>{
 const {resolveStateUpdateOperationFeedback}=await import('../state-update/state-update-operation-feedback');
 const message='La definición guardada no incluye todos los campos de contexto.';
 const feedback=resolveStateUpdateOperationFeedback({connectivityStatus:'online',pendingCount:1,visibleError:message,lastActivity:{type:'ready_check',result:'ready_failed'}});
 expect(feedback.message).not.toBe(message);
 let notice:ts.Expression|undefined;
 const visit=(n:ts.Node)=>{if(ts.isCallExpression(n)&&n.expression.getText(source)==='useExperienceActivityReporter'){
  const report=n.arguments[1];if(report&&ts.isObjectLiteralExpression(report)){const field=report.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(source)==='notice');if(field&&ts.isPropertyAssignment(field))notice=field.initializer;}
 }ts.forEachChild(n,visit);};visit(source);if(!notice)throw Error('Missing actual communication notice');
 const evaluate=new Function('temporalNotice','visibleError','refreshError','connectivityStatus','daySnapshotHydrated','latest','attendanceOfflineDayNotice',`return ${notice.getText(source)};`);
 const read=(temporalNotice:string|null,visibleError:string|null)=>evaluate(temporalNotice,visibleError,null,'online',true,[],()=>null);
 expect(read(null,message)).toBe(message);expect(read('Aviso temporal',message)).toContain(message);expect(read(null,null)).toBeNull();
});

it('uses the same communication sector for a failed refresh or uncertified offline coverage',()=>{
 let notice:ts.Expression|undefined;
 const visit=(n:ts.Node)=>{if(ts.isCallExpression(n)&&n.expression.getText(source)==='useExperienceActivityReporter'){
  const report=n.arguments[1];if(report&&ts.isObjectLiteralExpression(report)){const field=report.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(source)==='notice');if(field&&ts.isPropertyAssignment(field))notice=field.initializer;}
 }ts.forEachChild(n,visit);};visit(source);if(!notice)throw Error('Missing actual communication notice');
 const read=new Function('temporalNotice','visibleError','refreshError','connectivityStatus','daySnapshotHydrated','latest','attendanceOfflineDayNotice',`return ${notice.getText(source)};`);
 const coverage=vi.fn(()=> 'Sólo registros disponibles; cobertura no acreditada.');
 expect(read(null,null,'No se pudo actualizar; copia guardada.','offline',true,[],coverage)).toBe('No se pudo actualizar; copia guardada.');
 expect(read(null,null,null,'offline',false,[],coverage)).toBe('Sólo registros disponibles; cobertura no acreditada.');
 expect(read(null,'Motivo preciso','Otro aviso','offline',false,[],coverage)).toBe('Motivo preciso');
 expect(read(null,null,null,'online',false,[],coverage)).toBeNull();
});
