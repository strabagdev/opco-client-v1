import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { activeTransitionNotice, parseTransitionNotice } from "../lib/transition-notice";

/** Uses the existing definition cache, not a separate persisted active flag. */
export function useTransitionNotice(value: unknown) {
  let parsed;
  try { parsed = parseTransitionNotice(value); } catch { /* Invalid old cache: no message. */ }
  const { text, startsAt, endsAt } = parsed ?? {};
  const key = JSON.stringify([text, startsAt, endsAt]);
  const [observed, setObserved] = useState<{key:string;now:number|null}>({key,now:null});
  useEffect(() => {
    if (!text || !startsAt || !endsAt) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      if (disposed) return;
      clearTimeout(timer);
      const now = Date.now();
      setObserved({ key, now });
      const boundary = [Date.parse(startsAt), Date.parse(endsAt)].find(time => time > now);
      if (boundary !== undefined) timer = setTimeout(refresh, Math.min(boundary - now, 2_147_483_647));
    };
    refresh();
    const subscription = AppState.addEventListener("change", state => { if (state === "active") refresh(); });
    const visibility = () => { if (document.visibilityState === "visible") refresh(); };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", visibility);
    if (typeof window !== "undefined") window.addEventListener("focus", refresh);
    return () => {
      disposed = true;
      clearTimeout(timer);
      subscription.remove();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visibility);
      if (typeof window !== "undefined") window.removeEventListener("focus", refresh);
    };
  }, [key, text, startsAt, endsAt]);
  return observed.key === key && observed.now !== null ? activeTransitionNotice(parsed, observed.now) : null;
}
export function mergeExperienceNotices(existing: string | null | undefined, configured: string | null) {
  if (!configured) return existing;
  return !existing || existing.trim() === configured ? configured : `${existing} ${configured}`;
}
