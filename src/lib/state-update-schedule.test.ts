import { expect, it } from "vitest";
import { compositeConfirmationKey } from "./state-update-identity";
import { stateUpdateScheduleMetadata, stateUpdateScheduleRequest, stateUpdateSchedulesEqual } from "./state-update-schedule";

const reference={schemaVersion:1 as const,bindingId:"binding",revisionId:"revision",revisionDigest:"immutable-digest"};
const application={...reference,scheduleRecordId:"schedule",operationalDate:"2026-10-25",applied:{name:"Synthetic",startTime:"20:00",endTime:"08:00",endDayOffset:1,timeZone:"America/Santiago",nominalMinutes:720,durationPolicy:"civil-clock" as const}};
it("absence is not inferred as legacy and preserves the existing confirmation bytes",()=>{
 expect(stateUpdateScheduleMetadata({})).toEqual({});expect(stateUpdateScheduleRequest({})).toEqual({});
 expect(compositeConfirmationKey("scope","subject","base",[],{})).toBe('["scope","subject","base",[],{}]');
 expect(stateUpdateSchedulesEqual({}, {schedule:{kind:"legacy"}})).toBe(false);
});
it("confirmation binds the exact applied revision and snapshot without changing report identity",()=>{
 const a={schedule:reference,scheduleApplication:application};const b={schedule:{...reference,revisionId:"new"},scheduleApplication:{...application,revisionId:"new"}};
 expect(compositeConfirmationKey("scope","subject","base",[],{},a)).not.toBe(compositeConfirmationKey("scope","subject","base",[],{},b));
 expect(compositeConfirmationKey("scope","subject","other-base",[],{},a)).not.toBe(compositeConfirmationKey("scope","subject","base",[],{},a));
 expect(stateUpdateSchedulesEqual(a,{scheduleApplication:application})).toBe(true);
});
it("wire references the exact pinned application and does not send a trusted client snapshot",()=>{
 expect(stateUpdateScheduleRequest({scheduleApplication:application})).toEqual({schedule:reference});
 expect(stateUpdateScheduleMetadata({schedule:reference,scheduleApplication:application}).scheduleApplication).toBe(application);
});
it.each([{schedule:null},{schedule:{schemaVersion:2}},{scheduleApplication:{}},{schedule:{...reference,kind:"unknown"}},{schedule:reference,scheduleApplication:{...application,revisionId:"different"}}])("unknown, null, incomplete or mismatched metadata requires review: %j",value=>{
 expect(()=>stateUpdateScheduleMetadata(value)).toThrow("revisión explícita");
});

it("pins the selected revision for a new report, preserves existing/legacy applications and rejects absent preparation",async()=>{
 const {scheduleForStateUpdateEdit}=await import("./state-update-schedule");
 const policy={schemaVersion:1 as const,kind:"consumer" as const,bindingId:"binding",catalogEntityTypeId:"catalog",sourceFieldId:"shift",dateFieldId:"date",activeFrom:"2020-01-01",optionBindings:[{optionId:"A",scheduleRecordId:"schedule"}],requirement:"required-for-new-records" as const,operationalDatePolicy:"explicit-start-date" as const,durationPolicy:"civil-clock" as const};
 const application={schemaVersion:1 as const,bindingId:"binding",revisionId:"r1",revisionDigest:"digest",scheduleRecordId:"schedule",operationalDate:"2026-10-25",applied:{name:"Night",startTime:"20:00",endTime:"08:00",endDayOffset:1,timeZone:"America/Santiago",nominalMinutes:720,durationPolicy:"civil-clock" as const}};
 const response={schedulePolicy:policy,date:application.operationalDate,identityContext:{values:{shift:"A"}},scheduleResolution:{schemaVersion:1 as const,bindingId:"binding",sourceFieldId:"shift",dateFieldId:"date",operationalDate:application.operationalDate,optionId:"A",status:"resolved" as const,application}};
 expect(scheduleForStateUpdateEdit(response,null)).toEqual({scheduleApplication:application});
 expect(scheduleForStateUpdateEdit(response,{scheduleApplication:{kind:"legacy"}})).toEqual({scheduleApplication:{kind:"legacy"}});
 expect(()=>scheduleForStateUpdateEdit({...response,scheduleResolution:undefined},null)).toThrow();
 expect(()=>scheduleForStateUpdateEdit(response,{})).toThrow();
 expect(scheduleForStateUpdateEdit({},null)).toEqual({});
});
