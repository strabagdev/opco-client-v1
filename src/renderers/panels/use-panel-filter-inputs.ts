import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { operationalCalendarKey, resolveOperationalDay } from "../../lib/operational-calendar";

import type { PanelFilterConfig } from "../../lib/opco-api";

/** Resolve a relative default to the concrete DATE used by the ordinary query/cache key. */
export function initialPanelFilterInputs(filters: PanelFilterConfig[], now = new Date()) {
  const values: Record<string, string> = {};
  for (const filter of filters) {
    const initial = filter.defaultValue;
    if(filter.valueType==="DATE" && initial?.type==="OPERATIONAL_TODAY") {
      try { if(initial.calendar && initial.calendarKey===operationalCalendarKey(initial.calendar))values[filter.id]=resolveOperationalDay(now,initial.calendar).date; } catch { /* no fallback zone/date */ }
      continue;
    }
    if (filter.valueType !== "DATE" || initial?.type !== "TODAY") continue;
    if (!/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(initial.timeZone)) continue;
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: initial.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(now);
      const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
      const year = part("year"), month = part("month"), day = part("day");
      if (year && month && day) values[filter.id] = `${year}-${month}-${day}`;
    } catch {
      // Malformed cached config/unsupported Intl must leave manual selection available,
      // never substitute the device zone or borrow another date's snapshot.
    }
  }
  return values;
}

export function usePanelFilterInputs({ scopeKey, filters, preservePrevious = false }: {
  scopeKey: string;
  filters: PanelFilterConfig[];
  preservePrevious?: boolean;
}) {
  const initial = useMemo(() => ({ scopeKey, values: initialPanelFilterInputs(filters) }), [filters, scopeKey]);
  const [selection, setSelection] = useState(() => ({...initial,manual:[] as string[]}));
  let current = selection;
  if (selection.scopeKey !== scopeKey) {
    // Adjust before committing a new scope; effects must never see the preceding
    // user's/date selection, and no post-render initialization should erase input.
    current = { scopeKey, values: preservePrevious ? { ...initial.values, ...Object.fromEntries(Object.entries(selection.values).filter(([id])=>selection.manual.includes(id)||!filters.some(f=>f.id===id&&f.defaultValue?.type==="OPERATIONAL_TODAY"))) } : initial.values, manual:preservePrevious?selection.manual:[] };
    setSelection(current);
  }
  const values = current.values;
  useEffect(()=>{
    if(!filters.some(f=>f.defaultValue?.type==="OPERATIONAL_TODAY"))return;
    let timer:ReturnType<typeof setTimeout>,disposed=false;
    const refresh=()=>{
      if(disposed)return;clearTimeout(timer);
      const now=new Date(),defaults=initialPanelFilterInputs(filters,now);
      setSelection(previous=>{
        if(previous.scopeKey!==scopeKey)return previous;
        const updates=filters.filter(f=>f.defaultValue?.type==="OPERATIONAL_TODAY"&&!previous.manual.includes(f.id)&&defaults[f.id]&&previous.values[f.id]!==defaults[f.id]);
        return updates.length ? {...previous,values:{...previous.values,...Object.fromEntries(updates.map(f=>[f.id,defaults[f.id]]))}} : previous;
      });
      const boundaries=filters.flatMap(f=>{const d=f.defaultValue;try{return d?.type==="OPERATIONAL_TODAY"&&d.calendar?[resolveOperationalDay(now,d.calendar).nextBoundary]:[];}catch{return[];}});
      if(boundaries.length)timer=setTimeout(refresh,Math.max(1,Math.min(...boundaries)-now.getTime()+1));
    };
    refresh();const resume=AppState.addEventListener("change",state=>{if(state==="active")refresh();});
    const visible=()=>{if(document.visibilityState==="visible")refresh();};
    if(typeof document!=="undefined")document.addEventListener("visibilitychange",visible);
    return()=>{disposed=true;clearTimeout(timer);resume.remove();if(typeof document!=="undefined")document.removeEventListener("visibilitychange",visible);};
  },[filters,scopeKey]);

  function onChange(id: string, value: string) {
    setSelection(current => current.scopeKey !== scopeKey ? current : ({
      scopeKey,
      values: { ...current.values, [id]: value },
      manual:[...new Set([...current.manual,id])],
    }));
  }
  const issue=filters.some(f=>{
    if(f.defaultValue?.type!=="OPERATIONAL_TODAY")return false;
    try{return !f.defaultValue.calendar||f.defaultValue.calendarKey!==operationalCalendarKey(f.defaultValue.calendar);}catch{return true;}
  })?"El calendario operativo vinculado no está preparado. La consulta guardada se conserva; conecta para comprobar su definición.":null;
  return { values, onChange, issue };
}
