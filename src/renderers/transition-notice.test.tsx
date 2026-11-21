import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { mergeExperienceNotices, useTransitionNotice } from "./use-transition-notice";
vi.mock("react-native",()=>({AppState:{addEventListener:()=>({remove(){}})}}));
function Probe({value}:{value:unknown}){return <div>{useTransitionNotice(value)}</div>;}
describe("single-sector notice presentation",()=>{
 it("keeps server markup empty until observing the client clock",()=>expect(renderToStaticMarkup(<Probe value={undefined}/>)).toBe("<div></div>"));
 it("does not duplicate identical text or alter existing text without config",()=>{expect(mergeExperienceNotices(undefined,null)).toBeUndefined();expect(mergeExperienceNotices("  Existente  ",null)).toBe("  Existente  ");expect(mergeExperienceNotices("Aviso","Aviso")).toBe("Aviso");expect(mergeExperienceNotices("Contexto.","Aviso")).toBe("Contexto. Aviso");});
});
