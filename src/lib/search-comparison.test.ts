import { expect,it } from "vitest";
import fixtures from "./search-comparison-fixtures.json";
import { parseSearchComparison,normalizeSearchComparison,searchComparisonMatches,comparisonFingerprint,verifyWorkflowSearchComparison,workflowRecordMatches,type WorkflowSearchField } from "./search-comparison";
const policy=parseSearchComparison(fixtures.policy)!;
it.each(fixtures.queries)("applies the versioned predicate to the shared PostgreSQL fixture: %s",query=>{
 const actual=fixtures.rows.filter(([,value])=>searchComparisonMatches(value,query,policy)).map(([id])=>id);
 const expected=fixtures.rows.filter(([,value])=>normalizeSearchComparison(value,policy)===normalizeSearchComparison(query.trim(),policy)&&!!normalizeSearchComparison(query.trim(),policy)).map(([id])=>id);
 expect(actual).toEqual(expected);
});
it("keeps canonical rules strict and verifies the effective-policy envelope",()=>{
 expect(parseSearchComparison(undefined)).toBeNull();expect(()=>parseSearchComparison({...policy,version:2})).toThrow();expect(()=>parseSearchComparison({...policy,ignoreCharacters:["ab"]})).toThrow();expect(()=>parseSearchComparison({...policy,ignoreCharacters:["\u0000"]})).toThrow();
 const fields:WorkflowSearchField[]=[{id:"id",key:"code",type:"TEXT",primary:true,policy}];
 const metadata={version:1,sourceEntityTypeId:"source",fields,fingerprint:comparisonFingerprint("source",fields),applied:{mode:"global"}};
 expect(verifyWorkflowSearchComparison(metadata).fields[0].policy).toEqual({...policy,ignoreCharacters:["-","."]});
 expect(()=>verifyWorkflowSearchComparison({...metadata,fingerprint:"foreign"})).toThrow();
 expect(()=>workflowRecordMatches({displayName:"00.123-K",values:{code:"00.123-K"}},"---",verifyWorkflowSearchComparison({...metadata,applied:{mode:"field",fieldId:"id"}}),"id")).toThrow(/vacío/);
});
