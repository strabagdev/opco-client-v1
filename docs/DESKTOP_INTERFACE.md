# Desktop shell, Home and Attendance

Implemented locally on main, 2026-10-12. Not committed or deployed. Reference:
`design/proposals/desktop-home-attendance/README.md`, categories-only sidebar and final blue palette.
The static proposal and its previous evidence are preserved unchanged. This document describes the
implementation; the prototype remains an archived proposal, not executable business logic.

## Scope and layout

- Below 900: existing compact/mobile presentation, colors, contract block and stacked groups.
  A desktop category URL does not filter the mobile Home. No mobile drawer or palette switch.
- 900–1199: 224 px sidebar; from 1200: 264 px. Opco, organization, compact active contract,
  Home and only the categories actually present in the assigned catalog. No expanded experiences.
- Home and category pages reuse `/` with `category=records|workflows|analytics`. Existing experience
  links, ordering, card metadata, availability notices and permissions remain authoritative.
  The opened/nested experience keeps its category active via its existing AppView route ID.
- Desktop Home retains the exclusive 1280 px maximum, 24 px padding, two/three columns and 16 px
  card gaps. Groups with a single experience can share a row; titles and notices wrap naturally.
  The large contract block is hidden only when valid desktop context exists. Missing context and
  no-contract notices are retained. Other renderers have the full remaining shell area.
- Header retains back, synchronization/progress, Diagnostics and user. The identity moves to the
  sidebar on desktop. Long text wraps within flexible zones; actions remain visible.
- Contract selector reads the current authorized session contracts, shows the name in two lines,
  exposes the full accessible name, and lists complete names when opened. Keyboard activation and
  Escape return to the selector. Selection calls the existing session handler and returns to Home.
  It does not replace contract isolation, cache/preparation or pending-intent protections.
- Attendance controls group date/navigation/summary and configured context. Search max 560 px;
  form max 640 px; controls max 800 px. Result/day rows use the full available width, minimum 56 px,
  aligned name/state columns, subtle separators, no individual cards. Only existing data is shown.
  Conflict rows preserve both local/remote values and resolution actions, with wrap. Form actions
  have natural width and wrap; no new statuses, columns, filters or business actions.

## State and navigation protection

One fixed Stack and one instance of each active workflow. Resize changes style sets/test IDs and
presentation only, never route keys or session/database/preparation dependencies. Attendance handlers
for person selection, save, confirmation/cancel, local/remote resolution, date and context selection
were compared by TypeScript AST text to HEAD and are identical (eight handlers).

The presentation catalog is a read-only projection of the existing owner/contract navigation cache;
Home and the existing experience loader publish their already loaded assigned views. The sidebar makes no API requests. Async cache
reads have a scope, cancellation/sequence and publication generation guard, so a late read cannot
substitute another user's/contract's or the freshly published catalog. Categories do not fetch data.
Home retains its original API load/prewarm/availability effects and the contract/session machinery
is unchanged. A contract switch can perform its existing loads; this is not a resize or sidebar load.

`Link asChild` receives flattened styles, matching the existing card convention. An initial browser
run exposed the DOM indexed-style error from arrays; the implementation was corrected and a real
sidebar SSR regression verifies this boundary. No additional dependencies were installed.
Router API references were checked against [Expo SDK 57 Router](https://docs.expo.dev/versions/v57.0.0/sdk/router/).

## Scoped palette

`src/lib/desktop-presentation.ts` contains the final tokens and nonmutating paint mapping of the
existing styles. It is applied only to desktop shell/Home/Attendance, not globally to other renderers
or mobile. Background #F4F6F8; surfaces #FFFFFF; sidebar #18263A; primary #315DA8;
selection #E8EFFA; text #202B3A; auxiliary #536174; decorative borders #DCE2EA;
control edges #7B879A. Sidebar text #E5EAF2, organization #B7C6DC, hover #22334D,
active #263F64 with #90B8FF stripe, focus #A8C7FF; light focus #315DA8.
The active selector remains light; the sidebar active-paint rule targets category links only.
Semantic success/warning/error colors and their messages/icons remain unchanged.
No palette control was added to the product.

Defined contrast pairs: main/foundation 13.20:1; auxiliary/foundation 5.82:1;
white/primary 6.44:1; control edge/white 3.64:1; control edge/foundation 3.36:1;
sidebar text/background 12.62:1; organization/background 8.80:1; dark focus/background
8.92:1. #DCE2EA is a separator, not the sole boundary of editable controls. This is a scoped
contrast check, not a complete accessibility audit.

## Validation and limits

110 affected tests / 13 files, maximum two workers: desktop navigation/assigned catalog and scopes,
contract selection, grid, paint immutability/semantics, Link SSR, Home availability and existing
Attendance handler/outbox/reopen/late-response/replacement/conflict regressions. Typecheck PASS;
lint PASS with two pre-existing `require()` warnings in `records-sync.local-db-regression.test.ts`;
diff-check PASS. No full suite. A web export was necessary for the real browser/OPFS validation;
bundles, profiles, private credentials and process output stay outside the repository.

Browser evidence is in `design/validation/desktop-implementation-2026-10-12/`:
actual captures and a static comparison viewer beside the approved prototype. Direct Chrome CDP,
exclusive profiles, no Playwright or habitual profile. Viewports 1440×900, 1024×768, 390×844;
limits 899/900, 1199/1200. No global horizontal overflow in recorded scenarios. Full contract names,
keyboard focus/activation/Escape, category active in Attendance, back/forward, and second-contract
catalog isolation were checked. Categories produced zero API requests. Resize preserved edited
observation at all seven widths and produced zero API requests. A supplementary check also preserved
the exact coordinated SQLite object. No claim of physical-device or screen-reader validation.

Final route hardening: `use-app-view.ts` publishes the full catalog it already receives on cached
and remote responses, so direct/nested links do not depend on Home or a subsequent cache write.
Its original request/cache/error flow is unchanged; publication is guarded by its existing cleanup
and uses a stable context callback. Three focused hook tests run the real navigation loader and
verify one API request, cached fallback, and no publication after cancellation. The final bundle
was also opened directly from the conserved real OPFS/session with Core stopped and its API
blocked. This is a cached-direct validation, not a new online Core walkthrough. Attendance's
handlers/presentation and prior Core write evidence are unchanged by this read-only projection.
An initial direct-route resize sample observed three requests before startup was separated; that
sample is kept explicitly unisolated, without attributing its cause. A second sample after a
2-second quiet window also saw three attempts. The final control then held the viewport fixed
for 10 seconds: the same /me, assigned views and Attendance attempts occurred without resize.
The subsequent seven-width sequence produced zero API requests and no overflow, with the direct
route/category and real OPFS retained. This distinguishes observed background activity from the
resize interval, without changing or concluding the cause of session/recovery behavior.

Core was started only locally with DATABASE_URL parsed from `.env.local`, guarded as
127.0.0.1:5432/opco_development, opco_dev, and passed explicitly to the process. Browser API requests
went only to http://127.0.0.1:19640. SQLite was real Expo Web OPFS with cross-origin isolation.
Fixture: synthetic organization/user, two contracts, three persons, configured PRESENTE default,
CAPACITACIÓN/AUSENTE/additional synthetic control status, optional TEXTAREA observation, no configured
context fields. Seven assigned views in the first contract and one in the second: RECORDS, Attendance,
STATE_UPDATE, PANEL and REPORT. These labels/roles/statuses/icons are synthetic, not production data;
null icons exercise the existing generic fallback. Dates/fields/catalog differ from the prototype.

Real Core/OPFS walkthrough: online CAPACITACIÓN, offline PRESENTE with confirmation, cancellation
without a new intention, acceptance with overwrite/base version persisted, offline PRESENTE read,
then reconnect. One remote row, zero duplicates, zero pending operations and zero conflicts after
successful reconnect. No production conflict was touched. Automated reopen and late-response
regressions are separate from the resize/browser run.

Additional real conflict control: after an offline-confirmed CAPACITACIÓN intention, a controlled
local Core API writer changed the same remote row to AUSENTE. Reconnect retained one conflict and
its authorized pending intention. Both values/actions were visible at 1440/1024. The existing
Diagnostics → Problemas → Revisar conflicto path returned to the correct Attendance AppView,
selected date and highlighted record. The outbox identity/payload/attempts fingerprint was identical
before/after navigation. Only then, explicitly clicking Usar Opco resolved the synthetic conflict:
one remote-linked row, no conflicts or pending operations. No automatic overwrite or resolution.
The contract-choice blue selection was also checked in the final real bundle (#E8EFFA/#202B3A).

RECORDS, PANEL (real table) and REPORT were opened in the shell without redesigning their internals
or imposing form width caps. STATE_UPDATE navigation/category/full area worked, but its fixture
sharing Attendance's target entity showed `Error finalizing statement` and preparation incomplete.
Its successful read is NOT certified. Primary SQLite statement/cause was not captured here; no
production attribution or persistence fix is made. Cross-AppView identity and the general offline
review remain separate pending work. The warning was retained in screenshots, not hidden.

Initial validation infrastructure limits: a Metro export reused an earlier local API URL and the
static server initially lacked that destination in its existing CSP environment. They were corrected
only in temporary processes/export settings. A restored extra Chrome page caused ACCESS_HANDLE_BUSY;
only that own page was closed and Reintentar used. A later retry failed to open that temporary
profile; its storage was preserved, and a fresh exclusive profile completed the final run. This
neither establishes the productive OPFS cause nor changes recovery. PANEL's first fixture lacked the
required `calculatedFields: []`; only its synthetic configuration was completed. Supplemental scripts
were adapted to visible Stack controls and actual React Native Web DOM/roles; those script errors
were not counted as product validations.

Other renderers still need their own desktop design/review. Broader accessibility, physical mobile/zoom, catalog extremes and adoption testing remain pending.
The isolated technical close is recorded below. V11 paused;
audit and productive SQLite incidents remain open. No Core/API/storage/schema/config/dependency change,
no commit, push or deploy.

## Delivery inventory

Implementation/presentation: `app/(app)/_layout.tsx`, `app/(app)/index.tsx`,
`src/components/desktop-navigation.tsx`, `src/lib/app-shell-layout.ts`,
`src/lib/desktop-navigation.ts`, `src/lib/desktop-presentation.ts`,
`src/renderers/use-app-view.ts`,
`src/renderers/workflows/attendance/AttendanceWorkflow.tsx`.
New tests: `src/components/desktop-navigation.test.tsx`,
`src/lib/desktop-navigation.test.ts`, `src/lib/desktop-presentation.test.ts`,
`src/renderers/use-app-view-navigation.test.ts`; test-only existing-package declarations:
`src/test/web-rendering.d.ts`. Documentation: this file and only appended desktop sections of STATUS.
Exact paths/hashes and separate visual evidence are in the validation inventory; previous STATUS,
prototype, experiments, audit/state-update documentation and excluded test changes remain intact.

Only the own synthetic database fixture was removed (zero remaining own entities checked), and
Chrome/Client/Core validation processes stopped. Existing storage, outbox and habitual profiles
were never cleared; temporary exclusive profiles are preserved. Only the read-only screenshot
comparison server remains for review. No bundle/dist, credentials, local configuration or process
output is included in the source inventory. The initial implementation evidence is retained; the technical close below supersedes its
previous pending-close status. Publication remains a separate, unauthorized stage.


## Technical close — 2026-10-12

**Source candidate ready for publication review; not staged, committed, pushed or deployed.**
The exact lot is 15 files: eight implementation files, four regression files, one test declaration,
and two documents. STATUS includes only the desktop suffix after the preserved 232,753-byte prefix.
All prior audit/STATE_UPDATE documentation, independent tests, V11 experiments and the frozen
prototype are excluded. Inventory, source patch, hashes and comparative evidence are stored in
`design/validation/desktop-technical-close-2026-10-12/`; evidence/builds are not part of the source patch.

An isolated HEAD archive (`7fc76dc6a580b61759a46b261da9ccd070fe703c`) plus only those changes was
validated. No excluded untracked tests or earlier STATUS sections were copied into that candidate.
Full suite `npm test -- --maxWorkers=2`: **1033 PASS / 88 files**, no skipped new tests, 28.14 s.
The initial run passed 1031 but had two 5000 ms timeouts in the authoritative-null pending/conflict
SQLite regressions and a `write EPIPE`. Those failures are retained; their cause is not established.
The unchanged full suite was repeated without concurrent build/export and passed. No timeout,
test selection or configuration was changed. Typecheck PASS; lint PASS with the two existing
require warnings at `records-sync.local-db-regression.test.ts:182,183`; `npm run build` PASS,
including Expo Web export and service-worker generation. Builds used a local API destination only
for browser validation; no bundle/dist or configuration is included in the lot. Source diff and
reconstruction checks PASS.

### HEAD versus desktop: STATE_UPDATE

Two independent exclusive Chrome profiles and SQLite OPFS databases were used, with identical
local Core code, configured AppViews, subjects and permissions. PostgreSQL was exclusively the
validated `.env.local` destination `127.0.0.1:5432/opco_development`, user `opco_dev`, passed
explicitly to Core/fixture processes. PostgreSQL was shared sequentially: only the own target
records/relations/audit were restored to the same empty initial fixture between the runs. There
were no separate PostgreSQL database clones or schema changes. Existing local data was untouched.

Fixture: three synthetic subjects, two contracts, eight assigned views. Attendance and the generic
STATE_UPDATE AppView share source/target entities; the generic configuration has explicit DATE,
subject relation, uniqueness `{mode:"subject"}` and append history. The same logical date was
2026-10-12; the new runs did not add the optional observation text used in earlier visual captures.
Both ran Home/preparation → Attendance CAPACITACIÓN online → PRESENTE confirmed offline → reconnect
→ Home → Versionado Procedimientos. Each offline step had one remote-linked pending_update and
one outbox operation; reconnect left one synced remote-linked row and zero pending operations.

**Both HEAD and the desktop candidate displayed `Error finalizing statement` in STATE_UPDATE.**
Both were cross-origin isolated with real OPFS and had no global horizontal overflow. The candidate
retained its 264 px sidebar. This demonstrates that this reproduced error predates the desktop
lot; no desktop persistence correction is justified. Successful STATE_UPDATE reading is NOT
certified. The primary SQLite statement/cause was not emitted in the captured console evidence.
Cross-AppView identity remains a hypothesis, not a demonstrated cause; no productive incident
correlation is claimed. Screenshots and sanitized phase/request metadata are retained separately.

### Presentation and navigation evidence

Functional source hashes are unchanged from the previous final implementation inventory. Reuse
its real 1440×900, 1024×768, 390×844 and 899/900/1199/1200 evidence: final blue palette, horizontal
Attendance rows, bounded search/form, long names, offline confirmation/conflict actions, visible
focus, no global overflow and edited observation retained across resize with zero resize requests.
RECORDS, PANEL and REPORT access/remaining shell space is retained evidence; their interiors were
not redesigned. STATE_UPDATE area/category navigation is proven, its read remains limited above.
The previous direct cached run's three requests during a fixed-width control remain unassigned;
its following resize run had zero. Do not attribute those requests to resize or declare recovery fixed.

The final isolated candidate was also checked with Core online: category filtering/active category,
browser back/forward, direct RECORDS link with Registros active, and second-contract selection
returned the correct assigned Home catalog without old Attendance cards. These were navigation
checks, not conflict authorization or business writes. Earlier keyboard/contract-focus evidence
is reused. No physical-device, screen-reader, systematic zoom or user-adoption claim is added.
Other renderers still require a separate desktop design stage.

At delivery, main/HEAD and the empty index are unchanged, 259 excluded existing files match their
pre-close SHA256, and STATUS's excluded prefix is unchanged. Only own fixture/process cleanup is
performed; habitual caches, snapshots and outbox are never reset. Prior temporary-profile opening
failures/ACCESS_HANDLE_BUSY remain independent and undiagnosed; both comparison profiles opened
OPFS successfully, which does not close that general problem. Core is intact. V11 stays paused,
productive SQLite correlation and the general audit remain open.

## STATE_UPDATE desktop — implementación local para revisión, 2026-10-24

Extensión del renderer genérico sobre HEAD `dfa8779932f2d2df34c78b008c80e9bf9261df0b`.
Sin publicar. Reutiliza el breakpoint 900, el espacio restante del shell y los tokens azules
existentes; no altera Attendance ni otros renderers. No hay condiciones por entidad, nombres de
campos, opciones o caso de uso. Los límites y la paleta de secciones anteriores siguen vigentes;
esta sección añade específicamente STATE_UPDATE al alcance desktop.

- Contexto compuesto: una sola superficie, máximo 1000 px, padding 16 y separación 16. Fecha con
  base 210 px; campos configurados con base 200 y máximo 280, etiquetas completas y wrap según
  espacio real. Sin tarjetas individuales. Por debajo de 900 vuelve a la distribución apilada.
- Buscador: ancho disponible, máximo 560 px. Resultados y últimas actualizaciones usan filas con
  separadores; nombre de 170–280 px según ancho y columnas identificadas por **fieldId**. Conservan
  los formateadores actuales y los valores históricos que ya exponía latest. Etiquetas visibles,
  metadatos ajustables/en varias líneas; TEXT/TEXTAREA ocupan el ancho de detalle. No se inventan
  columnas de negocio ni se convierte latest informativo en una acción.
- Editor: máximo 900 px; dos columnas sólo desde 900 de viewport **y** con al menos 640 px dentro
  del formulario, descontando sus paddings. TEXT/TEXTAREA a fila completa. Acciones de ancho natural
  con wrap. Se conservan RecordFieldInput, DateFieldInput, CompactSelect y StateFieldInput, sus
  valores, obligatoriedad y callbacks. Conflictos/mensajes permanecen fuera de la grilla; el detalle
  de confirmación puede desplazarse dentro del modal, limitado al 90% de la altura disponible.
- Móvil conserva colores, resumen compacto, filas apiladas y botones táctiles. El contexto pierde
  las tarjetas redundantes y recibe etiqueta visible de fecha. Desktop usa los tokens existentes:
  #F4F6F8/#FFFFFF, #315DA8, #E8EFFA, #202B3A, auxiliar #536174, borde #DCE2EA y control #7B879A;
  estados semánticos no recoloreados. Foco visible azul de 3 px en controles y filas accionables;
  se añadieron nombres accesibles a los inputs/toggle de estado que no los exponían.

### Protección y evidencia nueva

`state-update-presentation.tsx` contiene sólo proyección visual y medidas locales de layout. No hay
árboles funcionales alternativos por tamaño, nuevas keys de experiencia, efectos de carga ni estado
paralelo del formulario. Revisión TypeScript AST contra HEAD: **13 funciones operacionales y 18 hooks
con sus dependencias idénticos**, incluidos preparación/actualización automática, búsqueda, guardado,
confirmaciones, conflictos y cargar más. Lectores, cachés, SQLite, outbox, sincronización, API, scopes
y contratos no cambian. `STATE_UPDATE.md` no requiere cambio: no se modifica su contrato/runtime.

Chrome for Testing 153.0.8010.12 local, perfil exclusivo, CDP directo sin Playwright. Se ejecutaron
**el shell y renderer reales** en export temporal, con sesión/API/almacén en memoria sintéticos;
la franja de validación lo identifica en todas las capturas. No es una maqueta ni evidencia de
Core, PostgreSQL, OPFS o sincronización reales. No se accedió a producción ni se guardaron reportes.
Los archivos funcionales de la copia temporal se comprobaron idénticos a los del lote.

Comparativas antes/después: 1440×900, 1024×768 y 390×844, resultados y formulario. Veinte combinaciones
adicionales de viewport/escenario: contexto de dos/cinco campos, títulos extensos, vacío, error,
pendiente, conflicto, modos none/subject/subject-date/subject-date-fields y append/update-current.
Campos SELECT/DECIMAL/TEXT/TEXTAREA/BOOLEAN/DATE/TIME/DATETIME/MULTISELECT en los escenarios registrados.
Sin overflow horizontal global ni excepciones JavaScript registradas. No es cobertura universal de
cada combinación de tipos; no se ensayó una relación paginada ni un catálogo productivo.

Resize con borrador numérico y observación, contexto y búsqueda seleccionados: 1199, 1200, 1024,
899, 900, 390 y 1440. Se conservaron nodos DOM, valores e intención sin guardar. Tras estabilizar el
escenario, **21 invocaciones del adaptador antes y después**, cero invocaciones de escritura;
esto mide llamadas sintéticas, no tráfico HTTP de Core. La presentación no reinició la preparación.
Se comprobó Tab/foco/Enter sobre resultado; desplegables nativos y calendario abiertos en los tres
tamaños, selección nativa por teclado a 390 con DATE `2026-10-25` y
optionId `one`; MULTISELECT abierto a 1440/390, Escape y devolución de foco. El popup nativo requirió
métricas de pantalla coherentes con el viewport en el harness; no se cambió el control del producto.
Confirmación real de conflicto abierta y cancelada, cero escrituras. Pendiente visible en la cabecera,
error con reintento y valores remotos/locales completos. No se confirmó un reemplazo ni se sincronizó.
El calendario muestra el locale en-US del Chrome de prueba: su valor lógico sigue siendo YYYY-MM-DD.
A 390, el popup SELECT nativo recorta una etiqueta muy larga; contraste directo con HEAD reproduce
el mismo límite (capturas before-select-390/after-select-390). El calendario y el modal MULTISELECT
se muestran dentro del viewport. No se modificó el control compartido ni se afirma ausencia de
recorte de todas sus opciones. Sin Safari/iPhone físico, lector de pantalla o auditoría accesible
completa. Diagnóstico conserva sus handlers, pero su ruta de entrada no se recorrió en este harness; cargar más se protege por AST y
regresiones existentes, no por nueva paginación de navegador.

**152/152 pruebas focalizadas, 12 archivos, un worker y timeouts estándar**: proyección de campos
(incluidos 0/false e históricos), controles, búsqueda/selección, conflictos, autorización offline de
Attendance, preparación/refresh compuesto, feedback y modos existentes. Typecheck PASS; lint PASS
con las dos advertencias preexistentes no-require-imports en
`records-sync.local-db-regression.test.ts:182/183`; diff-check PASS. No suite completa ni build de
cierre; sólo exports temporales necesarios para la revisión visual. Un alias no resuelto en el nuevo
test se corrigió usando imports relativos; las 152 pruebas finales incluyen ese archivo. Los errores
iniciales del harness (metadata de sesión/activación de controles) y un export desde cwd incorrecto
se corrigieron/descartaron, sin atribuirles defectos del producto ni usarlos como evidencia válida.

Respaldo durable, inventario, parche, hashes, revisión y comparativas:
`/home/dannysilver/dev2026/backups/state-update-desktop/2026-10-24/`.
Capturas/exports/perfiles no forman parte del diff publicable. El lote consta de la implementación,
helper, prueba y **sólo esta sección** más la sección propia de STATUS; el resto del texto pendiente
permanece excluido. Sin cierre técnico completo ni autorización de publicación. V11 sigue pausado;
incidentes históricos de preparación, timeouts/EPIPE, SQLite/OPFS y auditoría general siguen abiertos.
