import {it,expect} from "vitest";
import {captureWorkflowWriteCommand,copyWriteCommand,pinnedWorkflowWriteMetadata} from "./workflow-write-contract";
const command={version:1 as const,configurationFingerprint:"a".repeat(64),capabilities:["relation-context-v1"] as ["relation-context-v1"]};
it("requires actual supported command capabilities, not a bundle label or request hint",()=>{
 expect(()=>captureWorkflowWriteCommand({version:1,configurationFingerprint:command.configurationFingerprint,requiredCapabilities:["relation-context-v1"],authorized:false,acceptNewCommands:true})).toThrow();
 expect(()=>captureWorkflowWriteCommand({version:1,configurationFingerprint:command.configurationFingerprint,requiredCapabilities:["relation-context-v1"],authorized:true,acceptNewCommands:false})).toThrow("pausadas");
 expect(()=>copyWriteCommand({...command,bundle:"new"})).toThrow();expect(()=>copyWriteCommand({...command,capabilities:[]})).toThrow();expect(()=>copyWriteCommand({...command,version:2})).toThrow();
});
it("copies the semantic capability and retains it when an edit omits the metadata",()=>{
 const copy=copyWriteCommand(command);copy.capabilities[0]="relation-context-v1";expect(copy).not.toBe(command);expect(copy.capabilities).not.toBe(command.capabilities);
 expect(pinnedWorkflowWriteMetadata({}, {writeCommand:command}, true)).toEqual({writeCommand:command});
});
