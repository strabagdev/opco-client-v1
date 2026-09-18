import { useSyncExternalStore } from "react";

import { getWriteFeedbackSnapshot, subscribeWriteFeedback } from "@/lib/write-feedback";

export function useWriteFeedbackSnapshot() {
  return useSyncExternalStore(subscribeWriteFeedback, getWriteFeedbackSnapshot, getWriteFeedbackSnapshot);
}
