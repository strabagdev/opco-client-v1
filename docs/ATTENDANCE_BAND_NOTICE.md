# Attendance band notice lifecycle

The operational calendar still determines DATE from the definitive confirmation
instant. The configured SELECT options and default button remain manual and
independent of the clock. A band mismatch is informational and never changes the
chosen option or the write command.

The band notice belongs to that confirmation. It is cleared when another search,
context/person selection, date operation, edit, confirmation attempt, cancellation
or scope starts. It uses the existing experience activity/communications sector;
there is no additional banner, persisted notice or per-row message.

The finalizer passes its notice to the existing save handler as UI-only data,
outside the persisted entry and outbox payload. After the local commit the notice
states “Guardado en este dispositivo”. It can state “Guardado confirmado por
Opco” only when the existing resolution outcome confirms the server result.
The existing scope/revision guards prevent a late result from restoring the
notice after another draft starts. A rejected local save never receives a success
prefix. Record identity, DATE, capture, contexts, repetition and sync are unchanged.

Validation must include A and B separately at a controlled 06:10 clock, another
person, repetition cancellation, editing, a local save and real isolated Core ACK.
Handler tests alone do not certify the browser/OPFS integration. The separate
subject-presentation defect and C-09 are outside this patch.

## Authentication generation and save-action ownership

Each save captures the renderer's C-08 authentication generation, its scope and an
in-memory action identity in the existing save-in-flight ref. An obsolete callback
cannot start a new intent. Results/errors require both the existing draft/person
checks and the same generation/action. After the local commit, the cleared draft's
revision is captured; starting another operation prevents old feedback. The
existing local-day read and save-triggered refresh receive that same publication
guard and recheck it after awaits, including refresh cleanup.

A session/scope render retires the old UI slot and clears its transient form state;
it never edits or discards an outbox operation. Finally releases only the slot
owned by its action, and updates the saving indicator only in the same current
session/scope. A previous action cannot clear a newer action's indicator. Direct
write-attempt bookkeeping updates its captured attempt, never a newer map entry.

Valid business ACKs are still processed by the existing API/sync/store for the
original owner. The UI guard does not abort them, reinterpret them as errors,
requeue completed work, or change record identity, command or clientRequestId.
Session tests distinguish handler/transport simulation from isolated real
Core/authentication/PostgreSQL and Chromium/OPFS validation. C-01 fixture startup
EPERM handling remains a separate test/doc batch; its eight startup omissions do
not explain other historical timeouts. C-09 and subject presentation stay separate.
