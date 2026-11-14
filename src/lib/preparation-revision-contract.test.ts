import {describe,it,expect} from "vitest";
import {isPreparationCoverage,type PreparationCoverage} from "./preparation-revision-contract";
const metadata:PreparationCoverage={version:1,kind:"metadata-only",complete:true,scope:"ordinary-preparation",businessDataIncluded:false,arbitraryQueries:false,relationCatalogs:false,latest:"not-included",dates:[]};
describe("bounded preparation coverage contract",()=>{
  it("names metadata-only coverage without claiming records, catalogs or arbitrary queries",()=>{expect(isPreparationCoverage(metadata)).toBe(true);});
  it.each([{version:0},{complete:false},{scope:"all-data"},{businessDataIncluded:true},{arbitraryQueries:true},{relationCatalogs:true},{latest:undefined},{dates:["2026-11-11"]}])("rejects incompatible or inflated metadata %j",change=>{expect(isPreparationCoverage({...metadata,...change})).toBe(false);});
  it("requires every date of the exact Attendance month",()=>{
    const month={...metadata,kind:"attendance-month",businessDataIncluded:true,sourceEntityTypeId:"source",subjectCount:0,latest:"complete-snapshot",dates:Array.from({length:30},(_,i)=>"2026-11-"+String(i+1).padStart(2,"0"))};
    expect(isPreparationCoverage(month)).toBe(true);
    for(const dates of[month.dates.slice(0,-1),[...month.dates.slice(0,-1),"2026-12-01"],[...month.dates.slice(1),month.dates[0]],Array(30).fill("2026-11-01")])expect(isPreparationCoverage({...month,dates})).toBe(false);
  });
  it("distinguishes current plus bounded latest from a complete snapshot",()=>{
    const current={...metadata,kind:"state-update-current",businessDataIncluded:true,sourceEntityTypeId:"source",subjectCount:2,latest:"bounded-first-page",dates:["2026-11-11"]};
    expect(isPreparationCoverage(current)).toBe(true);expect(isPreparationCoverage({...current,latest:"complete-snapshot"})).toBe(false);expect(isPreparationCoverage({...current,subjectCount:-1})).toBe(false);
    expect(isPreparationCoverage({...current,kind:"state-update-snapshot",latest:"complete-snapshot"})).toBe(true);
    expect(isPreparationCoverage({...current,dates:["2026-11-31"]})).toBe(false);
  });
});
