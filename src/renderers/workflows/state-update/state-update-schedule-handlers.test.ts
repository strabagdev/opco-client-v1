// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { stateUpdateScheduleMetadata, stateUpdateSchedulesEqual, scheduleForStateUpdateEdit } from "../../../lib/state-update-schedule";
import { compositeConfirmationKey } from "../../../lib/state-update-identity";

const source = ts.createSourceFile("StateUpdateWorkflow.tsx", readFileSync(`${process.cwd()}/src/renderers/workflows/state-update/StateUpdateWorkflow.tsx`, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function confirmHandler(context: Record<string, unknown>, name = "confirmConflict") {
  let declaration: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node; ts.forEachChild(node, visit); };
  visit(source);
  if (!declaration) throw Error("Actual confirmation handler missing");
  const code = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), `${code}; return ${name};`)(...Object.values(context)) as () => Promise<void>;
}
const schedule = { schemaVersion: 1 as const, bindingId: "binding", revisionId: "r1", revisionDigest: "digest" };
function fixture(metadata = {}) {
  return {
    conflict: { existing: { updatedAt: "base" }, confirmationKey: compositeConfirmationKey("scope", "subject", "base", [], {}, metadata) },
    compositeMode: true, selectedItem: { subject: { id: "subject" }, current: { updatedAt: "base", stateValues: [], ...metadata } },
    response: { stateFields: [], extraFields: [] }, resolutionScope: "scope", stateValues: {}, extraValues: {},
    compositeConfirmationKey, buildEffectiveStateSnapshot: () => ({ stateValues: [] }), buildStateUpdateExtraSubmit: () => ({}),
    setConflict: vi.fn(), setError: vi.fn(), saveSelected: vi.fn(), handleUseLocalConflictChange: vi.fn(),
  };
}
it("actual confirmation without schedule retains the existing authorization call and version", async () => {
  const context = fixture(); await confirmHandler(context)();
  expect(context.saveSelected).toHaveBeenCalledExactlyOnceWith(true, "base");
  expect(context.setError).not.toHaveBeenCalled();
});
it("actual confirmation accepts the same pinned revision only", async () => {
  const context = fixture({ schedule }); await confirmHandler(context)();
  expect(context.saveSelected).toHaveBeenCalledExactlyOnceWith(true, "base");
});
it("a revision change invalidates the shown confirmation without authorizing another command", async () => {
  const context = fixture({ schedule });
  Object.assign(context.selectedItem.current, { schedule: { ...schedule, revisionId: "r2" } });
  await confirmHandler(context)();
  expect(context.saveSelected).not.toHaveBeenCalled();
  expect(context.setConflict).toHaveBeenCalledExactlyOnceWith(null);
  expect(context.setError).toHaveBeenCalledOnce();
});

it("editing an unsent scheduled create uses its durable null base rather than the cache timestamp", async () => {
  const context = {
    response: { stateFields: [], extraFields: [], historyMode: "update-current", uniqueness: "subject-date-fields", targetEntityType: { id: "target" } },
    selectedItem: { subject: { id: "subject", displayName: "Synthetic" }, current: { recordId: "local", updatedAt: "local-cache-time", localExpectedUpdatedAt: null, stateValues: [], schedule } },
    selectedContractId: "contract", ownerKey: "owner", appView: { id: "view", name: "Synthetic" }, isSaving: false, contextReady: true,
    stateValues: {}, extraValues: {}, extraReadIssues: {}, compositeMode: true, isOnline: false, hasDate: true, date: "2026-10-25", identity: undefined,
    resolutionScope: "scope", resolutionScopeRef: { current: "scope" }, resolutionMountedRef: { current: true },
    scheduleForStateUpdateEdit, stateUpdateScheduleMetadata, buildEffectiveStateSnapshot: () => ({ stateValues: [], hasChanges: true }), validateFormFields: () => ({}), stateUpdateExtraMetadataErrors: () => ({}), buildStateUpdateExtraSubmit: () => ({}), compositeConfirmationKey,
    definitionCache: { getCachedRecord: vi.fn(async () => ({ serverId: null })), saveStateUpdateLocally: vi.fn(async () => ({ localRecordId: "local", subject: { id: "subject" } })) },
    setIsSaving: vi.fn(), setError: vi.fn(), setExtraErrors: vi.fn(), setRefreshError: vi.fn(), setSuccessMessage: vi.fn(), setResolutionFeedback: vi.fn(), setConflict: vi.fn(),
    reportWriteFeedback: vi.fn(), insertSavedLatestItem: vi.fn(), clearVisibleError: vi.fn(), clearEditor: vi.fn(), refreshRecordsSyncSummary: vi.fn(), recordVisibleError: vi.fn(),
  };
  await confirmHandler(context, "saveSelected")();
  expect(context.recordVisibleError).not.toHaveBeenCalled();
  expect(context.definitionCache.saveStateUpdateLocally).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({expectedUpdatedAt:null, schedule}));
});

it("schedule review reads the failed row's durable command without querying the eligible autosync list",async()=>{
 const application={...schedule,scheduleRecordId:"catalog-row",operationalDate:"2026-10-25",applied:{name:"Original",startTime:"20:00",endTime:"08:00",endDayOffset:1,timeZone:"America/Santiago",nominalMinutes:720,durationPolicy:"civil-clock" as const}};
 const next={...application,revisionId:"r2",revisionDigest:"digest2"};
 const context={ownerKey:"owner",selectedContractId:"contract",appView:{id:"view"},date:"2026-10-25",identity:undefined,resolutionScope:"scope",resolutionScopeRef:{current:"scope"},resolutionMountedRef:{current:true},
  selectedItem:{subject:{id:"subject"},current:{recordId:"local",scheduleApplication:application}},visibleResponse:{schedulePolicy:{bindingId:"binding"},targetEntityType:{id:"target"},dateFieldId:"date"},
  definitionCache:{reviewStateUpdateSchedule:vi.fn(),getCachedRecord:vi.fn(async()=>({localId:"local",syncStatus:"failed",syncErrorCode:"SCHEDULE_REVISION_CHANGED",values:{clientRequestId:"durable-id"}})),listPendingStateUpdateOperations:vi.fn(()=>{throw Error("Not eligible; must not be queried");})},
  stateUpdateScheduleMetadata,stateUpdateSchedulesEqual,scheduleForStateUpdateEdit:()=>({scheduleApplication:next}),setScheduleReview:vi.fn(),setError:vi.fn()};
 await confirmHandler(context,"openScheduleReview")();expect(context.setError).not.toHaveBeenCalled();expect(context.definitionCache.listPendingStateUpdateOperations).not.toHaveBeenCalled();expect(context.definitionCache.reviewStateUpdateSchedule).not.toHaveBeenCalled();expect(context.setScheduleReview).toHaveBeenCalledWith(expect.objectContaining({clientRequestId:"durable-id",previousApplication:application,application:next}));
});
it("a late explicit review completion releases its activity without publishing into a different scope",async()=>{
 const context={scheduleReview:{ownerKey:"owner",contractId:"contract",appViewId:"view",date:"2026-10-25",identity:undefined},isSaving:false,ownerKey:"owner",selectedContractId:"contract",appView:{id:"view"},date:"2026-10-25",identityKey:"",compositeIdentityKey:()=>"",resolutionScope:"scope",resolutionScopeRef:{current:"scope"},resolutionMountedRef:{current:true},resolutionInFlightRef:{current:false},
  definitionCache:{reviewStateUpdateSchedule:vi.fn(async()=>{context.resolutionScopeRef.current="other";})},setIsSaving:vi.fn(),setScheduleReview:vi.fn(),clearEditor:vi.fn(),refreshRecordsSyncSummary:vi.fn(),isOnline:true,syncPendingRecords:vi.fn(),loadWorkflow:vi.fn(),setError:vi.fn()};
 await confirmHandler(context,"confirmScheduleReview")();expect(context.definitionCache.reviewStateUpdateSchedule).toHaveBeenCalledOnce();expect(context.clearEditor).not.toHaveBeenCalled();expect(context.loadWorkflow).not.toHaveBeenCalled();expect(context.setIsSaving).toHaveBeenLastCalledWith(false);expect(context.resolutionInFlightRef.current).toBe(false);
});
