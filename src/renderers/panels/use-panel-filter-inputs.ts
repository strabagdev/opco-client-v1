import { useMemo, useState } from "react";

import type { PanelFilterConfig } from "../../lib/opco-api";

/** Resolve a relative default to the concrete DATE used by the ordinary query/cache key. */
export function initialPanelFilterInputs(filters: PanelFilterConfig[], now = new Date()) {
  const values: Record<string, string> = {};
  for (const filter of filters) {
    const initial = filter.defaultValue;
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
  const [selection, setSelection] = useState(() => initial);
  let current = selection;
  if (selection.scopeKey !== scopeKey) {
    // Adjust before committing a new scope; effects must never see the preceding
    // user's/date selection, and no post-render initialization should erase input.
    current = { scopeKey, values: preservePrevious ? { ...initial.values, ...selection.values } : initial.values };
    setSelection(current);
  }
  const values = current.values;

  function onChange(id: string, value: string) {
    setSelection(current => current.scopeKey !== scopeKey ? current : ({
      scopeKey,
      values: { ...current.values, [id]: value },
    }));
  }
  return { values, onChange };
}
