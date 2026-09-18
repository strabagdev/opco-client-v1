export type WriteFeedbackKind = "local-saved" | "server-confirmed";

export type WriteFeedbackSnapshot = {
  appViewId: string | null;
  appViewTitle: string | null;
  id: string | null;
  kind: WriteFeedbackKind | null;
  recordedAt: string | null;
  scopeKey: string | null;
};

const emptySnapshot: WriteFeedbackSnapshot = {
  appViewId: null,
  appViewTitle: null,
  id: null,
  kind: null,
  recordedAt: null,
  scopeKey: null,
};

let snapshot = emptySnapshot;
let sequence = 0;
const listeners = new Set<() => void>();

export function writeFeedbackScopeKey(ownerKey: string, contractId: string, appViewId: string) {
  return `${ownerKey}\u0000${contractId}\u0000${appViewId}`;
}

export function appViewIdFromPathname(pathname: string) {
  const match = pathname.match(/^\/view\/([^/]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function reportWriteFeedback({ appViewId, appViewTitle, contractId, kind, ownerKey }: {
  appViewId: string;
  appViewTitle: string;
  contractId: string;
  kind: WriteFeedbackKind;
  ownerKey: string;
}) {
  sequence += 1;
  setSnapshot({
    appViewId,
    appViewTitle,
    id: `write-feedback-${sequence}`,
    kind,
    recordedAt: new Date().toISOString(),
    scopeKey: writeFeedbackScopeKey(ownerKey, contractId, appViewId),
  });
}

export function clearWriteFeedback(id: string, scopeKey: string) {
  if (snapshot.id === id && snapshot.scopeKey === scopeKey) setSnapshot(emptySnapshot);
}

export function getWriteFeedbackSnapshot() {
  return snapshot;
}

export function subscribeWriteFeedback(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetWriteFeedbackForTests() {
  snapshot = emptySnapshot;
  sequence = 0;
  listeners.clear();
}

function setSnapshot(next: WriteFeedbackSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}
