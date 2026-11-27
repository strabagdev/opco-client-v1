// @ts-expect-error Node types intentionally absent from the Expo config.
import {readFileSync}from"node:fs";
import ts from"typescript";
import{revisionCanonical}from"../../lib/revision-receipts";
import{it,expect,vi}from"vitest";
import{loadRecordWithOfflineCache,requireEditableRecord}from"../../lib/offline-records";
import{OpcoNetworkError}from"../../lib/opco-api";
function actual(c:Record<string,unknown>){const file="src/renderers/records/RecordFormScreen.tsx",s=ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let node:ts.FunctionDeclaration|undefined;function visit(n:ts.Node){if(ts.isFunctionDeclaration(n)&&n.name?.text==="loadForm")node=n;ts.forEachChild(n,visit)}visit(s);if(!node)throw Error("Missing loader");return new Function(...Object.keys(c),ts.transpileModule(node.getText(s)+";return loadForm;",{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(c))as()=>Promise<void>;}
function fixture(record:unknown=null):Record<string,any>{const setters=Object.fromEntries(["setError","setIsLoading","setIsSubmitting","setFieldErrors","setDefinition","setRecord","setInitialValues","setValues","setLoadedFormScope"].map(k=>[k,vi.fn()]));return{...setters,definition:null,loadedFormScope:null,loadedFormRef:{current:{scope:null,definition:null}},revisionCanonical,api:{getEntityRecord:vi.fn(async()=>{throw new OpcoNetworkError()})},definitionCache:{getCachedRecord:vi.fn(async()=>record),upsertRemoteRecords:vi.fn()},connectivityStatus:"offline",connectivityAtLoadRef:{current:"offline"},token:"synthetic",ownerKey:"org:A",selectedContractId:"contract",entityTypeId:"source",mode:"edit",recordId:"record",isMounted:true,current:()=>true,requestedFormScope:"scoped",getEntityDefinitionWithCache:vi.fn(async()=>({definition:{id:"source",fields:[]}})),loadRecordWithOfflineCache,requireEditableRecord,buildInitialFormValues:vi.fn((_d,values)=>values??{empty:""})};}
it("does not initialize an absent exact edit as an empty form",async()=>{const c=fixture();await actual(c)();expect(c.setDefinition).not.toHaveBeenCalled();expect(c.setValues).not.toHaveBeenCalled();expect(c.buildInitialFormValues).not.toHaveBeenCalled();expect(c.setError).toHaveBeenCalledWith(expect.stringContaining("no está guardado"));});
it("preserves the exact pending row and does not send or create anything",async()=>{const row={id:"record",localId:"record",serverId:null,values:{name:"Saved pending",relation:"option-137"},syncStatus:"pending_create",clientRequestId:"preserved"},c=fixture(row),before=JSON.stringify(row);await actual(c)();expect(c.setRecord).toHaveBeenCalledWith(row);expect(c.setValues).toHaveBeenCalledWith(row.values);expect(JSON.stringify(row)).toBe(before);expect(c.api.getEntityRecord).not.toHaveBeenCalled();expect(c.definitionCache.upsertRemoteRecords).not.toHaveBeenCalled();});
it("retires an old load before publishing into another scope",async()=>{const c=fixture({localId:"record",serverId:null,values:{}});c.current=()=>false;c.isMounted=false;await actual(c)();expect(c.setDefinition).not.toHaveBeenCalled();expect(c.setValues).not.toHaveBeenCalled();});


it.each(["edit", "create"])("keeps a resolved %s draft through equivalent metadata revalidation",async mode=>{
 const row={localId:"record",serverId:"remote",values:{name:"Saved"},syncStatus:"synced",updatedAt:"2026-11-26T00:00:00Z"},c=fixture(row);
 c.mode=mode;c.definition={id:"source",fields:[]};c.loadedFormScope=c.requestedFormScope;c.loadedFormRef.current={scope:c.requestedFormScope,definition:c.definition};
 await actual(c)();expect(c.getEntityDefinitionWithCache).toHaveBeenCalledOnce();expect(c.setValues).not.toHaveBeenCalled();expect(c.setInitialValues).not.toHaveBeenCalled();expect(c.setRecord).not.toHaveBeenCalled();expect(c.definitionCache.getCachedRecord).not.toHaveBeenCalled();expect(c.setIsSubmitting).not.toHaveBeenCalled();
});
it("does not retain a draft under a genuinely changed entity definition",async()=>{
 const row={id:"record",localId:"record",serverId:null,values:{name:"Saved"},syncStatus:"pending_create"},c=fixture(row);c.definition={id:"source",fields:[{id:"old"}]};c.loadedFormScope=c.requestedFormScope;c.loadedFormRef.current={scope:c.requestedFormScope,definition:c.definition};
 await actual(c)();expect(c.setValues).toHaveBeenCalledWith(row.values);expect(c.setRecord).toHaveBeenCalledWith(row);
});
