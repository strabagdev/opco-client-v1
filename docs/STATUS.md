## Cierre Técnico current Por Fecha — LOTE DELIMITADO, SIN PUBLICAR — 2026-10-04

Cierre exclusivo de la corrección de subjects[].current; ambos repositorios siguen en main con HEAD
intacto (Core 6a4374a0d1032786577c054d3ad4dcf46034c71f; Client
d1ae50cdea72a80215de16ebfdce5142ccdd2063). Todos los pendientes previos conservados. Índices Git
vacíos antes/después; no staging, commit, push o deploy. V11 pausado. Error finalizing statement
productivo permanece abierto e independiente; no reabrir el hallazgo sin dateFieldId.

### Inventario Publicable Exacto

| Repo / archivo | Contenido exclusivo del lote |
| --- | --- |
| Core src/lib/state-update-workflow.ts | Diff completo: 3 hunks, +19/-1. GET pide selection=workflow-current; opción declarada; filtrado/orden para current visible. |
| Core src/lib/state-update-workflow.test.ts | Diff completo: +78 líneas, bloque state-update dated subject current selection con cinco regresiones. |
| Core docs/EXTERNAL_API.md | Diff completo: +7 líneas en GET workflow/state-update sobre current por campo de fecha y límites. |
| Core docs/STATE_UPDATE.md | Diff completo: sección Visible Workflow Current Selection, incluyendo validación y este cierre. |
| Client docs/STATUS.md | Sólo esta sección Cierre Técnico current Por Fecha y la sección Vigente Por Fecha — CORRECCIÓN CORE Y VALIDACIÓN LOCAL. |
| Client docs/OFFLINE_FIRST_AUDIT.md | Sólo sección Vigente Por Fecha — CORRECCIÓN CORE Y VALIDACIÓN LOCAL. |
| Client docs/STATE_UPDATE.md | Sólo sección Corrección de current visible por fecha — 2026-10-04. |

En Core los cuatro archivos forman todo el diff actual, sin otros pendientes. En Client los tres
archivos documentales mezclan investigaciones anteriores: **no incluir sus diffs completos** ni hacer
staging por archivo; el lote contiene únicamente las secciones indicadas. El resto del texto pendiente
se conserva fuera del lote. No hay cambio funcional Client en esta corrección.

Excluidos, preservados y sin ejecución en este cierre: src/lib/state-update-conflict-resolution.test.ts
(+43 líneas previas); src/lib/sqlite-projection-v10-open.experimental.test.ts (untracked);
tests/experiments/sqlite_projection_migration.py y tests/experiments/state_update_latest_contract.mjs
(untracked). También todas las otras secciones pendientes de STATUS/OFFLINE_FIRST_AUDIT/STATE_UPDATE:
V11/proyecciones/compatibilidad, diagnósticos e investigaciones previas, caso sin fecha y etapas
anteriores del incidente. No se eliminan ni se presentan como parte de esta entrega.

### Alcance Confirmado Y Checks

Único caller que solicita selection=workflow-current: GET workflow. Sólo con uniqueness=subject y
dateFieldId configurado reordena por ese DATE descendente/ID ascendente y excluye valores ausentes,
coherente con latest; current=null si ninguno fechado. POST no pasa la opción: escritura/unicidad/
conflicto conservan lookup previo. REPORT CURRENT también conserva default. Attendance sigue por
subject-date y workflows sin fecha mantienen selección previa. updatedAt sigue versión remota,
no criterio de vigente visible en el alcance corregido. No schema/migraciones/dependencias modificados.
La distinción entre selección visible y target de escritura es intencional y no se extiende en este cierre.

Implementación Core git blob 864f4cd0f41bd9171b6c525733a207159a7e6095 y regresiones blob
2ff9572ccc3e219f5ff75c8e77ec5474e7dc5b14 coinciden exactamente con la validación anterior.
Snapshot de contenido tracked antes/después de suite/build: ningún archivo alterado por esos checks.
Se reutilizan npx tsc --noEmit y npm run lint Core PASS, pruebas focalizadas 71/71 y evidencia local
online/primera apertura offline/reapertura OPFS. No se repitió navegador ni se crearon fixtures.
Client sólo recibe documentación en esta etapa: no suite, typecheck, lint o build repetidos.

Checks NUEVOS Core con DATABASE_URL de .env.local explícita y guard localhost/5432/
opco_development/opco_dev (sin imprimir valor ni conectar a producción):

- npm run test PASS: 111 archivos pasan, 2 omitidos (113); 1112 tests pasan, 16 omitidos (1128).
- Omitidos por opt-in existente: api-record-writes.postgres.test.ts (RECORD_PATCH_PG_INTEGRATION)
  y panels.postgres.test.ts (PANEL_PG_INTEGRATION_DATABASE_URL). No se habilitaron ni se crearon datos.
- npm run build PASS: Next 16.3.0 Turbopack, compilación, TypeScript y 20/20 páginas estáticas.
- git diff --check PASS en ambos repositorios; sin cambios generados tracked o staged.

Revisión del lote: sólo implementación, regresiones y documentación sanitizada; sin valores secretos,
passwords, tokens/JWT, claves privadas, DATABASE_URL literal, .env, bases, logs, exportaciones reales
ni artefactos. .next, next-env.d.ts y tsconfig.tsbuildinfo generados/ignorados quedan fuera del lote;
se conserva el estado local y no se elimina cache ajena. Los paths .env.local en documentación sólo
indican origen de configuración, no contenido. El parche acotado del lote se verificó aplicable a HEAD
sin tocar índice/worktree; no representa publicación ni inclusión de los demás pendientes.

Límites: suite completa con dos integraciones opt-in omitidas; build no es deploy. Evidencia browser
previa sintética sólo del procedimiento y fecha activa 04-10, no cobertura offline histórica completa,
mutaciones/conflictos offline, native ni reproducción/solución del incidente SQLite productivo.
Lote listo para publicación posterior exclusiva de esos contenidos; publicación no autorizada aquí.

## Vigente Por Fecha — CORRECCIÓN CORE Y VALIDACIÓN LOCAL — 2026-10-04

Corrige sólo subjects[].current visible del GET de STATE_UPDATE con uniqueness=subject y dateFieldId.
Core main/6a4374a0d1032786577c054d3ad4dcf46034c71f conserva un diff nuevo sin commit; Client
main/d1ae50cdea72a80215de16ebfdce5142ccdd2063 conserva todos los pendientes. V11 pausado,
caso independiente sin dateFieldId no reabierto. Error finalizing statement productivo sigue abierto.

Causa: findExistingStateUpdates ordenaba updatedAt DESC y tomaba primero por sujeto, aunque latest
usa fecha configurada DESC/id ASC. Consumers revisados: GET workflow, POST engine y proyección REPORT
STATE_UPDATE CURRENT. Corrección mínima en Core: GET pide selection=workflow-current; sólo cuando
uniqueness=subject y dateFieldId existe se filtra la fecha no nula y reordena los registros ya cargados
por fecha DESC/id ASC antes de agrupar por sujeto. Usa exclusivamente el campo configurado. Fechas
iguales y ausentes siguen el criterio existente de latest (empate por id; excluir ausentes; current=null
si ninguno fechado). Sin fallback a timestamps/revisión. Default lookup de POST/unicidad/conflictos,
REPORT y sujeto-fecha/Attendance conservados; updatedAt sigue siendo versión remota. No se afirma
que la selección del target de escritura cambió: la regresión prueba que sigue eligiendo su target previo.

Regresión real en state-update-workflow.test.ts: tres casos nuevos fallaron antes del cambio
(R99 en vez de R1, empate/ausente incorrecto, todos sin fecha con current no nulo); no-date pasó.
Run final focalizado Core: state-update-workflow, attendance-workflow y api-reports, 71/71 PASS.
Cinco regresiones cubren R1 Fecha 04-10 frente a R99 Fecha 03-10/modificación posterior, empate por id,
ausentes, no-date y target de conflicto conservado. npx tsc --noEmit y npm run lint Core PASS.
Client typecheck PASS, lint sin errores con dos warnings require() preexistentes en
records-sync.local-db-regression.test.ts. Diff-check ambos repos PASS. Sin suite completa ni build Core.
Export Client temporal necesario para navegador: Expo Web --clear, sin reemplazar dist existente;
entry-4dd0d77abe906953cfca390977c2112e.js verificado con API sólo localhost:19390;
SW opco-shell-27ea03bc89480400, 28 recursos, incluye worker/SQLite WASM.

Fixture autorizado Prisma/transacción en namespace local_current_20261004_9391: fuente Procedimientos,
target Versionado; WORKFLOW/state-update; subjectFieldId *_subject RELATION ONE a *_source;
dateFieldId *_date DATE Fecha; uniqueness subject; historyMode append; estados *_revision TEXT
Revisión required=false, *_status SELECT Estatus required=true y *_date DATE Fecha required=false;
extraFieldIds=[] y sin defaultOptionId inferido. Estatus sintético Validado sintético, valor
VALIDADO_SYNTHETIC/optionId *_option. Un procedimiento buscable Inspección de tolva sintética.
*_new R1 con Fecha 2026-10-04/updatedAt 08:00Z y *_old R99 con Fecha 2026-10-03/updatedAt 09:00Z
(el mismo 04-10). Tipos de Revisión/Estatus, opciones/default omitido, IDs, permisos y timestamps son
sintéticos, no acreditan datos exactos productivos. No escrituras UI ni prueba POST con ese fixture.

DATABASE_URL leída de Core .env.local y explícita en Prisma y proceso Core. Guard host/puerto/base/rol;
PostgreSQL confirmó opco_development/opco_dev, 127.0.0.1/32:5432. Core localhost:19390, Client
localhost:19391; sólo sesiones sintéticas. Online GET search=tolva HTTP 200 devuelve current=*_new/R1
Fecha 04-10 y latest ordenado [*_new, *_old], total=2/hasMore=false. No REPORT.

Chrome 154.0.8037.93 Windows headless/CDP 9391, **corrida válida en perfil nuevo exclusivo**
C:\Windows\Temp\opco-current-20261004-9393, sin Playwright ni perfil habitual.

| Paso | Evidencia acreditada | Límite |
| --- | --- | --- |
| Preparación sin visitar workflow | Inicio pasó de Preparando 0/1 a Listo; requests incluyen definición workflow, fuente y records antes de apertura | No se capturó runId/telemetría terminal interna; Listo por sí solo no acredita cobertura histórica completa. |
| OPFS antes de apertura | SW controlador, crossOriginIsolated=true, seis archivos expo-sqlite, DB 126976 bytes y cinco 4096 | Lectura de metadata de archivos, sin segunda conexión SQLite ni extracción DB. |
| Primera apertura offline y buscar tolva | CDP offline activo hasta resultado estable; navigator.onLine=false/probe Core=false; sujeto, R1 y Fecha 04-10; Sin conexión, sin Cargando | Active date 04-10; no todas las fechas/historial ni writes/conflicts offline. |
| Cierre completo | Browser.close y comprobación posterior cero procesos del perfil | No habitual/PWA instalada/native. |
| Reapertura offline mismo perfil | Core y servidor Client detenidos; emulación antes de Page.navigate desde about:blank; shell/session/workflow recuperados, tolva devuelve mismo sujeto/R1/Fecha; online=false | Red cortada por CDP, no wifi físico. API local imposible por servicios detenidos; intentos GET fallidos no son respuestas remotas. |
| Persistencia | Mismos seis nombres/tamaños OPFS tras cierre; mismo SW controlador y R1 | No demuestra todos los contenidos internos, outbox o cobertura completa. |

Sin excepciones Runtime en las dos etapas válidas; no error SQLite, spinner permanente ni defecto nuevo.
Se observaron dificultades **del arnés**, no contabilizadas como PASS: socket CDP inicial, selectores de
Pressable y expresión await corregidos; servidor temporal inicialmente omitió API en CSP y se reinició
con env correcta; una corrida preliminar soltó emulación antes de terminar debounce y reconectó.
Se descartó para acreditar búsqueda offline y se repitió desde perfil limpio 9393, manteniendo conexión
hasta resultado estable y Browser.close. No cambio funcional adicional por estos problemas del arnés.

Limpieza: fixture/usuario/token propios eliminados vía Prisma; cero org/users/records/views/tokens
confirmados. Ambos grupos de servicios propios detenidos, Chrome propio cerrado; se retiran sólo
perfiles 9391/9392/9393, helpers Windows propios y directorio temporal del ensayo. No base/perfil previo
ni pendientes existentes tocados. Documentos Core STATE_UPDATE/EXTERNAL_API y Client STATUS,
STATE_UPDATE/OFFLINE_FIRST_AUDIT actualizados. Sin esquema, migración, dependencias, producción,
commit, push o deploy. No se explica ni resuelve el incidente productivo de finalización SQLite.

# Current Status

## Cierre Final Del Lote De 25 Archivos 2026-10-03

**Listo para publicacion este lote especifico; la auditoria general permanece abierta.**
Revision final del diff acumulado en `main`: **25 paths pendientes, 22 modificados y tres nuevos**,
sin cambios staged. Alcance confirmado: preparacion y lectura offline STATE_UPDATE, cobertura target
completa/parcial/ausente, conflictos visibles y resolucion por identidad durable con restauracion/outbox
atomicas, proteccion ante respuestas de requests sustituidos, carga coherente Attendance y feedback por
intencion seleccionada en ambos renderers, con sus pruebas y documentacion. No se amplio implementacion.
Este cierre modifica exclusivamente STATUS; conserva los otros 24 archivos pendientes byte a byte.
Sin cambios Core/API/wire, esquema/migraciones, dependencias, configuracion ni datos productivos.

### Checks Finales Del Arbol Acumulado

- `npm test -- --maxWorkers=2`: PASS, **890/890 tests, 74/74 archivos**, maximo dos workers.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS, cero errores; dos warnings preexistentes `no-require-imports` en
  `src/sync/records-sync.local-db-regression.test.ts:182-183`, fuera del diff del lote.
- `npm run build`: PASS, export web con worker/WASM SQLite y service worker generado.
- `git diff --check`: PASS tras actualizar este cierre.

No hay checks fallidos ni bloqueos concretos de este lote. El build uso la configuracion local existente
sin modificarla; `dist` permanece ignorado y no se incluye. Inventario y revision de contenido sin secretos,
configuracion local, fixtures externos, bases, logs, exportaciones ni artefactos incluidos. Los valores
sinteticos embebidos en tests y SQLite `:memory:` son arneses de prueba, no datos reales ni archivos de DB.
Documentacion del lote: `CLIENT_ARCHITECTURE.md`, `STATE_UPDATE.md`, `OFFLINE_FIRST_AUDIT.md` y `STATUS.md`;
solo este ultimo se actualizo durante el cierre. Sin commit, push ni deploy.

### Evidencia Reutilizada Y Limites

No se abrio Chrome, no se uso Playwright y no se agregaron escenarios. No hubo cambio funcional ni fallo
que invalidara la evidencia vigente. Se conserva su procedencia detallada en las secciones siguientes:

- **CDP 9351: API sintetica local, OPFS/WASM real**, Metro con bundle nuevo. Acredita los recorridos del
  renderer generico, seleccion exacta append, rollback, latest/remote id en esos fixtures, confirmacion,
  nuevo conflicto y transporte fallido. No acredita Core/PostgreSQL ni diagnostica la anomalia `latest`
  observada con Core anteriormente.
- **CDP 9361: Core real local y PostgreSQL de desarrollo, OPFS/WASM real**, Metro con bundle nuevo.
  Acredita exclusivamente el handler durable Attendance `Usar mi cambio`: confirmacion seleccionada,
  transporte bloqueado, nueva version conflictiva y otra operacion exitosa mientras la seleccionada falla.
  No hubo respuestas API simuladas en ese recorrido ni datos productivos; se mantiene la limpieza y
  validacion de destino documentadas. No extiende garantias al modal de escritura online u otros saves.
- **Carreras cubiertas solo automaticamente:** nueva edicion durable durante red retenida y respuestas
  anteriores complete/conflict/retry/failure, con SQLite real en memoria; guards de scope/desmontaje y
  feedback del handler con colaboradores controlados. No se inyectaron esas carreras en Chrome.
- Ambos recorridos usaron Metro de desarrollo; **el export de este cierre no se probo en navegador**.
  No se acredita identidad byte a byte entre bundles historicos y export. Transporte bloqueado no es wifi
  fisico; cuota/fallo fisico OPFS, nativo, multi-tab y todas las combinaciones extra siguen sin acreditarse.

Permanecen abiertos y fuera del lote: causa productiva de `Error finalizing statement`, restriccion SQLite
entre AppViews, contenido retenido, resumen RECORDS contaminado, bloqueo OPFS, formato REPORT, anomalia
`latest` con Core y cobertura offline restante. No se incorporan ni se declaran corregidos esos hallazgos.
Este cierre reemplaza los conteos y checks historicos inferiores; la etapa Attendance posterior reemplaza
el antiguo limite sobre su handler durable `Usar mi cambio`, sin cerrar la auditoria general.

### Inventario Final Exacto (25 Paths)

- `app/(app)/index.tsx`
- `docs/CLIENT_ARCHITECTURE.md`
- `docs/OFFLINE_FIRST_AUDIT.md`
- `docs/STATE_UPDATE.md`
- `docs/STATUS.md`
- `src/components/read-loading-indicator.test.ts`
- `src/lib/app-view-definitions-cache.test.ts`
- `src/lib/app-view-definitions-cache.ts`
- `src/lib/app-view-prewarm.test.ts`
- `src/lib/app-view-prewarm.ts`
- `src/lib/attendance-offline.ts`
- `src/lib/attendance-snapshot-cache.test.ts`
- `src/lib/local-db.test.ts`
- `src/lib/local-db.ts`
- `src/lib/state-update-conflict-resolution.test.ts` (nuevo)
- `src/lib/state-update-offline.test.ts`
- `src/lib/state-update-offline.ts`
- `src/renderers/workflows/attendance/AttendanceWorkflow.tsx`
- `src/renderers/workflows/attendance/attendance-conflict-handlers.test.ts` (nuevo)
- `src/renderers/workflows/attendance/attendance-workflow-logic.test.ts`
- `src/renderers/workflows/attendance/attendance-workflow-logic.ts`
- `src/renderers/workflows/state-update/StateUpdateWorkflow.tsx`
- `src/renderers/workflows/state-update/state-update-conflict-handlers.test.ts` (nuevo)
- `src/renderers/workflows/state-update/state-update-workflow-logic.test.ts`
- `src/renderers/workflows/state-update/state-update-workflow-logic.ts`


## Attendance: Feedback De Usar Mi Cambio 2026-10-03

Correccion exclusiva del handler de conflicto durable de Attendance. Se preservaron los 24 archivos
pendientes de `main`; ahora hay **25 paths pendientes** por el nuevo test del handler. No se cambio el
motor sync, Core/API/wire, esquema/migraciones, dependencias, configuracion ni otros pendientes.

Causa: el handler guardaba con el metodo generico y anunciaba `server-confirmed` al terminar el ciclo
global, sin leer el resultado de la intencion elegida. Ahora reutiliza
`resolveStateUpdateConflictWithLocal`, `getStateUpdateResolutionOutcome` y `stateUpdateResolutionFeedback`
existentes. Valida localRecordId/conflictIdentity y owner+contrato+AppView+target+sujeto+fecha dentro de la
resolucion durable; la red se espera despues del commit. Solo un recibo del request seleccionado permite
confirmacion. Pendiente, nuevo conflicto, fallo y request sustituido permanecen distintos. El feedback
scoped sigue visible aunque otro conflicto/resumen global tenga prioridad. Scope/montaje y single-flight
impiden callbacks obsoletos; comenzar otra edicion limpia el feedback previo. La proteccion de valores/
outbox ante respuestas tardias se reutiliza del engine existente, sin modificarlo.

Evidencia automatizada: **83/83 tests en siete archivos afectados**, con maximo dos workers, incluidos
10 tests nuevos que ejecutan el handler real extraido por AST, sin copiar su implementacion.
Los **10/10 fallan contra la copia anterior**: otra operacion finalizada no confirma failed/pending/
conflict/superseded, transporte rechazado aun consulta el recibo, confirmacion seleccionada, offline,
edicion posterior durante sync retenido y salida de scope/desmontaje. Las regresiones compartidas de
SQLite real en memoria comprueban que una nueva edicion durable se guarda durante red retenida y que
completion/conflict/retry/failure anteriores no la consumen. El test del handler usa colaboradores
controlados; no acredita por si solo OPFS. Typecheck PASS; lint PASS, cero errores y dos warnings RECORDS
preexistentes en `records-sync.local-db-regression.test.ts:182-183`; `git diff --check` PASS final.
Sin suite completa, build/export, Playwright, commit, push ni deploy en esta etapa.

### Chrome/CDP, OPFS Y Core Reales

Chrome de Windows/CDP **9361**, perfil exclusivo `opco-attendance-feedback-9361`. Client servido desde
**Metro 19361**, iniciado despues de guardar el handler con `--clear --localhost`, cache vacia y bundle
nuevo de 2812 modulos; worker SQLite de 16 modulos. Proxy **localhost 19362** agrega COOP/COEP y sustituye
solo la URL de API virtual de `.env.local` por **Core real localhost 19360**, sin alterar handlers/SQL.
Se inspecciono `config.apiUrl` efectivo: `http://localhost:19360`. No se genero export ni se uso el `dist`
existente. No se simularon respuestas API. Core se sirvio mediante `next start --hostname 127.0.0.1
--port 19360`, artefacto `.next` local existente con BUILD_ID `TLmF-2kT2X3XkTwe9NkWO`.

DATABASE_URL se cargo **exclusivamente de operational-core/.env.local**, se valido hostname `127.0.0.1`,
puerto `5432`, database `opco_development` y usuario `opco_dev`, y se paso explicitamente al proceso Core
y a cada PrismaClient de fixture/lectura/limpieza. PostgreSQL confirmo `current_user=opco_dev`,
`current_database=opco_development`, `inet_server_addr=127.0.0.1`, puerto 5432. No se mostro la URL/secreto.
Fixture minimo aislado: organizacion/usuario/app externa/contrato propios, una AppView Attendance,
source con dos personas y target con relacion/fecha/SELECT PRESENTE-AUSENTE; sin observacion ni contexto.
Login y conflictos se obtuvieron de Core real. Los helpers sembraron la intencion mediante los metodos
reales del singleton, sin escribir outbox por SQL directo. OPFS/WASM real: `crossOriginIsolated=true`,
`storageState.status=ready`; se leyeron pasivamente valores, server_id y outbox del fixture.

| Recorrido afectado | Feedback observado | Resultado real seleccionado |
| --- | --- | --- |
| Overwrite aceptado | `Cambio confirmado por Opco.` | Persona 1, remoto `cmusn8eez0007vqn9dkysz2o9`: PostgreSQL AUSENTE y relacion correcta; misma fila OPFS synced, request confirmado y outbox ausente. |
| Transporte STATE_UPDATE bloqueado por CDP | `Cambio guardado; envio pendiente.` | OPFS pending_update/OpcoNetworkError y outbox conservada; PostgreSQL mantuvo PRESENTE/version anterior. Bloqueo retirado al terminar. |
| Version remota cambio despues de elegir conflicto | `Opco devolvio un nuevo conflicto. Revisa ambas versiones.` | Core devolvio CONFLICT real; fila/outbox continuaron conflictivas; no overwrite silencioso ni confirmacion. |
| Otra operacion exitosa y seleccionada rechazada | `El envio del cambio fallo. La intencion se conserva.` | Se desactivo temporalmente solo la opcion AUSENTE del fixture: Persona 1 quedo failed con su outbox y remoto PRESENTE sin cambio. Persona 2 quedo synced, sin su outbox y remoto PRESENTE `cmusnkmjz001mvqn9hgk1t6f2`. Se restauro la opcion. |

Limites: edicion posterior/respuesta tardia y salida de scope son regresiones controladas, no carreras
inyectadas en Chrome en esta etapa. Transporte bloqueado no representa wifi fisico ni cuota/fallo OPFS.
No se acreditan nativo, multi-tab, todas las combinaciones de campos extra ni otros caminos de guardado
Attendance. El recorrido solo valida este handler durable; no extiende garantias al modal de conflicto
de escritura online ni cambia su comportamiento. Los errores iniciales de formato del helper de POST se
corrigieron en el helper temporal antes de los escenarios; no son reparaciones del producto.

Limpieza: fixture/usuario propios y sus registros, relaciones, accesos, tokens/idempotencia/auditoria
eliminados; perfil exclusivo eliminado (Test-Path false); solo Core 19360, Metro 19361, proxy 19362 y
Chrome 9361 propios cerrados. Helpers y credenciales temporales retirados de /tmp. Sin configuracion,
secretos, bases, logs ni artefactos en el diff; `dist` permanece ignorado. Core worktree sin cambios.

Archivos de esta etapa: `src/renderers/workflows/attendance/AttendanceWorkflow.tsx`, nuevo
`src/renderers/workflows/attendance/attendance-conflict-handlers.test.ts`, `docs/STATE_UPDATE.md`,
`docs/STATUS.md` y `docs/OFFLINE_FIRST_AUDIT.md`.
**La auditoria general sigue abierta**: finalizacion productiva, restriccion entre AppViews, contenido
retenido, resumen RECORDS, bloqueo OPFS, formato REPORT y cobertura offline restante no se modifican.
Los conteos y el limite Attendance de las secciones inferiores corresponden a etapas historicas;
esta seccion reemplaza exclusivamente ese limite para Usar mi cambio del conflicto durable.


## Cierre Tecnico Acumulado Final 2026-10-03

Revision del diff completo en `main`: **24 archivos pendientes, 22 modificados y dos nuevos**, nada
staged. Este cierre solo actualiza STATUS y OFFLINE_FIRST_AUDIT; preserva toda la implementacion y pruebas
pendientes. Alcance confirmado: preparacion/lectura offline STATE_UPDATE, conflictos visibles online,
resolucion por identidad durable, restauracion/outbox atomicas, feedback por intencion del renderer
generico y carga coherente Attendance, con pruebas/documentacion. Sin cambios Core/API/wire, esquema,
migraciones, dependencias o configuracion. **La auditoria general permanece abierta.**

- Checks sobre el arbol acumulado: `npm test -- --maxWorkers=2` **880/880 tests, 73/73 archivos**;
  `npm run typecheck` PASS; `npm run lint` PASS, cero errores y dos warnings preexistentes
  `no-require-imports` en `src/sync/records-sync.local-db-regression.test.ts:182-183`;
  `npm run build` PASS (export web, worker/WASM SQLite y service worker);
  `git diff --check` PASS tras documentacion. Ninguna regresion nueva ni reparacion de implementacion.
- Consumidores del adapter: `app-view-prewarm.ts` usa `attendanceStateFields`, sin cambios;
  AttendanceWorkflow usa conversion de items/latest/statuses y, en las dos lecturas locales de conflictos,
  `stateUpdateConflictToAttendanceRecord`. La unica adicion del adapter es `conflictIdentity`; conserva
  ids/options, labels, observacion opcional, contexto y estados previos. Su accion `Usar Opco` transmite
  esa identidad y localRecordId al metodo compartido. Los tests Attendance/prewarm existentes pasan.
  Limite previo: `Usar mi cambio` de Attendance sigue usando save generico y feedback basado en el ciclo
  global; no recibe automaticamente la comprobacion por intencion ni los guards visuales de resolucion
  del renderer generico. No se declara corregido ni se amplia aqui ese camino.
- Proteccion comprobada en codigo y regresiones: seleccion validada por owner/contrato/AppView/target/
  sujeto/fecha/localRecordId/snapshot/request; respuestas antiguas complete/conflict/retry/failure no
  escriben sobre el request sucesor. Una edicion durable completa mientras el POST sigue retenido.
  Restauracion y outbox se confirman o revierten juntas mediante el coordinador existente. Los callbacks
  transaccionales contienen solo SQLite/calculo local; sync y GET se esperan despues del commit.
  Aislamiento logico no resuelve el indice `server_id` compartido entre AppViews ni contenido retenido.

Procedencia de la ultima evidencia Chrome (CDP 9351): **Metro de desarrollo**, no export. Se cerro el
Chrome anterior y se reinicio Metro con `EXPO_OFFLINE=1 EXPO_NO_DOTENV=1`, override de API local, `CI=1`
y `npx expo start --web --clear --localhost --port 19351`. El registro de ejecucion muestra cache vacia
y compilacion nueva de entry (2812 modulos) y worker (16). El guard de montaje se guardo a las 03:06:26;
la primera navegacion del Chrome nuevo a `http://localhost:19352/view/view` fue a las 03:06:53, antes de
los escenarios finales. El proxy localhost 19352 agregaba COOP/COEP y sustituia solamente la URL de API
del bundle por el fixture localhost 19350; no sustituia handlers ni SQL. Se inspecciono la URL de runtime.
El DOM mostro los mensajes nuevos de esta implementacion y OPFS verifico sus identidades/rollback;
esto acredita el codigo funcional actual. Despues solo se quitaron un setter duplicado y espacios SQL,
y se agregaron pruebas; no cambio comportamiento. No se retuvo un hash del bundle historico ni se afirma
identidad byte a byte con el export. El build de este cierre genero `dist` actualizado, pero **ese export
no fue el artefacto usado por Chrome**. No se repitieron escenarios de navegador ya acreditados.

`latest` posconflicto queda **verificado solo** para los fixtures de contrato del recorrido 9351:
`Usar Opco` mostro `remote-c` / `Estado remoto` manteniendo el otro append conflictivo;
`Usar mi cambio` mostro `remote-b` / `Cambio local`, confirmacion y outbox seleccionada ausente.
Nuevo conflicto y socket POST cerrado mostraron respectivamente conflicto conservado y envio pendiente,
sin confirmacion falsa. Se compararon DOM, filas OPFS y registro remoto del servidor sintetico; no es
validacion Core/PostgreSQL. La anomalia `latest` del fixture Core anterior sigue sin diagnostico.
Las carreras de nueva edicion/respuesta tardia son regresiones del engine/SQLite real en memoria, no
recorridos nuevos de Chrome; cuota/fallo fisico OPFS, nativo y multi-tab no estan acreditados.

Higiene: solo los 24 paths inventariados; sin secretos, configuracion local, fixtures externos, DB, logs
ni artefactos generados. Los datos sinteticos y el script SQLite en memoria de las regresiones son codigo
de prueba, no bases/exportaciones. `dist`, `.env`, `.env.local`, `.expo` y `node_modules` siguen ignorados.
El build usa la configuracion local existente, sin modificarla. El perfil CDP 9351 y fixtures/procesos de
ese recorrido ya se eliminaron en la etapa anterior; este cierre no inicia ni elimina otros servidores.
Sin produccion, commit, push ni deploy.

Permanecen abiertos: causa productiva de `Error finalizing statement`, restriccion SQLite entre AppViews,
contenido retenido, resumen RECORDS contaminado, bloqueo OPFS, formato REPORT y cobertura offline restante.
No hay bloqueo de checks de este cierre; esos pendientes y el limite Attendance arriba no se cierran.
Las secciones inferiores registran etapas historicas y sus conteos (21 archivos/850 tests o 269 focalizados);
el inventario y checks actuales son los de esta seccion.

### Inventario Final Exacto

- `app/(app)/index.tsx`
- `docs/CLIENT_ARCHITECTURE.md`
- `docs/OFFLINE_FIRST_AUDIT.md`
- `docs/STATE_UPDATE.md`
- `docs/STATUS.md`
- `src/components/read-loading-indicator.test.ts`
- `src/lib/app-view-definitions-cache.test.ts`
- `src/lib/app-view-definitions-cache.ts`
- `src/lib/app-view-prewarm.test.ts`
- `src/lib/app-view-prewarm.ts`
- `src/lib/attendance-offline.ts`
- `src/lib/attendance-snapshot-cache.test.ts`
- `src/lib/local-db.test.ts`
- `src/lib/local-db.ts`
- `src/lib/state-update-conflict-resolution.test.ts` (nuevo)
- `src/lib/state-update-offline.test.ts`
- `src/lib/state-update-offline.ts`
- `src/renderers/workflows/attendance/AttendanceWorkflow.tsx`
- `src/renderers/workflows/attendance/attendance-workflow-logic.test.ts`
- `src/renderers/workflows/attendance/attendance-workflow-logic.ts`
- `src/renderers/workflows/state-update/StateUpdateWorkflow.tsx`
- `src/renderers/workflows/state-update/state-update-conflict-handlers.test.ts` (nuevo)
- `src/renderers/workflows/state-update/state-update-workflow-logic.test.ts`
- `src/renderers/workflows/state-update/state-update-workflow-logic.ts`

## Resolucion Exacta Y Atomica De Conflictos STATE_UPDATE 2026-10-03

Etapa acotada a los tres limites demostrados de resolucion; **la auditoria general sigue abierta**.
Se conservaron los 21 archivos inicialmente pendientes de `main`, sin stage, commit, push ni deploy.
Esta etapa modifica 12 archivos; agrega el test de resolucion y toca `attendance-offline.ts` para
transportar la identidad seleccionada en el adapter que comparte `Usar Opco`.

- Causa confirmada antes de editar: `discardStateUpdateLocalChange` encontraba la fila mas reciente por
  sujeto, sin recibir el `localRecordId` seleccionado; eliminaba outbox y restauraba valores en statements
  independientes. El renderer anunciaba `server-confirmed` despues del sync global sin comprobar la
  intencion elegida. Las finalizaciones de STATE_UPDATE tampoco comprobaban si el request durable habia
  cambiado mientras llegaba la respuesta.
- Cuatro regresiones fallaron con la implementacion inicial: append equivocado, outbox perdida al fallar
  la restauracion, seleccion obsoleta aceptada y respuesta tardia consumiendo otra intencion. Las siete pruebas
  de los handlers reales tambien fallaron (7/7) contra la copia inicial: cuatro anunciaban confirmacion
  para pending/conflict/failed/superseded, una no consultaba recibo, otra omitia identidad seleccionada y
  otra publicaba feedback despues de abandonar el scope. Las pruebas posteriores demostraron duplicacion de la fila append al releer su remoto y perdida de la
  identidad de confirmacion al refrescar; otra regresion rechazo la confirmacion de un registro remoto
  diferente. No se corrigieron los demas pendientes de la auditoria.
- Ambas acciones validan `localRecordId`, owner, contrato, AppView, target, sujeto, fecha logica y una
  identidad de los valores/snapshot de conflicto y `clientRequestId` de outbox, dentro del coordinador
  compartido. `Usar Opco` restaura el snapshot/identidad remotos y elimina solo la operacion seleccionada
  en una transaccion. `Usar mi cambio` reescribe esa fila/outbox atomicamente con un request nuevo para el
  overwrite. La red ocurre despues del commit, nunca dentro de la transaccion.
- Confirmacion, nuevo conflicto, fallo y retry releen identidad durable dentro de sus transacciones:
  una respuesta anterior no consume ni reemplaza la nueva edicion. El resultado visible consulta la fila
  y outbox exactas despues del sync/refresh: resolucion local, envio pendiente, confirmacion remota,
  nuevo conflicto, fallo o seleccion sustituida. Otro conflicto y el resumen global no ocultan ese
  feedback. El montaje y scope vigentes impiden feedback de una resolucion visual obsoleta.
- Metadata interna agregada al JSON existente: `clientRequestId` de snapshot, `remoteRecordId` del
  conflicto y `expectedRecordId` de overwrite. No hay cambio de Core, wire/API, esquema/migraciones,
  dependencias ni configuracion. La relectura reutiliza un append confirmado solo si coinciden remoto,
  owner, contrato, target, AppView, sujeto y fecha; la marca de request se conserva solo para la misma
  version remota y estados/extras compatibles. Esto no resuelve el indice compartido entre AppViews.
- Automatizacion final: **269/269 pruebas, 10 archivos afectados**; 23 regresiones de SQLite/engine en
  `state-update-conflict-resolution.test.ts` y siete pruebas de los handlers reales del renderer. El nuevo arnes ejecuta SQL y
  rollback con SQLite real en memoria mediante `python3`, sin librerias/dependencias nuevas; atraviesa
  el singleton/coordinador de produccion, pero no representa Expo/OPFS. Incluye ambas acciones, dos append
  del mismo sujeto, rollback en ambos caminos, scope completo, red caida, nuevo conflicto, fallo, remoto
  incorrecto y respuesta tardia tras guardar una edicion real mientras la red sigue retenida.
- Chrome/CDP **9351**, perfil exclusivo temporal, Client/Metro **19351**, proxy localhost **19352**,
  API sintetica localhost **19350**, Expo SQLite OPFS/WASM real y `crossOriginIsolated=true`.
  Dos append del mismo sujeto sobrevivieron cierre/reapertura. `Usar Opco` sobre el mas antiguo dejo solo
  la otra outbox/conflicto, mostro la resolucion local junto al conflicto restante y mostro `remote-c` /
  `Estado remoto` en latest. Fallo inyectado tras DELETE y antes de restauracion: comparacion integral
  de `entity_records` y `pending_operations` antes/despues identica, rollback completo.
  `Usar mi cambio` uso la fila append elegida, envio un overwrite con version esperada/request nuevo,
  mostro `Cambio confirmado por Opco`, latest `Cambio local`, server id `remote-b` y outbox cero.
  Respuesta `CONFLICT` valida mantuvo la intencion, actualizo la version remota y mostro nuevo conflicto;
  cierre del socket del POST dejo `pending_update` / `OpcoNetworkError` y `Cambio guardado; envio pendiente`,
  sin confirmacion remota. Una respuesta sintetica CONFLICT mal formada durante preparacion del fixture
  quedo como fallo explicito con outbox conservada; el fixture se corrigio y se repitio el caso valido.
- Aislamiento del navegador: solo datos sinteticos en un perfil nuevo. La URL virtual de Metro tomaba
  `.env.local` pese al override CLI: se inspecciono y el proxy sirvio una copia temporal del bundle con
  la URL de API sustituida por el fixture; no se edito ese archivo ni configuracion. La primera tentativa
  de bootstrap al destino local previo no obtuvo contexto/datos; no se uso Core para crear o modificar
  fixtures. No hubo acceso a produccion. No se genero export, screenshot ni se uso Playwright.
- Limites: el recorrido usa una API local de contrato controlado, no valida Core/PostgreSQL ni movil,
  multi-tab, cuota o fallo fisico del almacenamiento. Las carreras de edicion/respuesta se verifican con
  regresiones controladas; no se inyectaron todas en Chrome. Conflictos historicos sin remoto retenido
  no adquieren retroactivamente su id: el guard adicional del remoto usa el id del snapshot nuevo o el
  server id existente cuando disponible. La navegacion completa reprodujo `ACCESS_HANDLE_BUSY` conocido;
  se cerro/reabrio solo el perfil de prueba sin reset, conservando OPFS. Ese limite sigue abierto.
- Checks de esta etapa: typecheck, lint (cero errores; los dos warnings RECORDS conocidos) y
  `git diff --check` pasan. Sin suite completa ni build/export. Se eliminaron unicamente los fixtures,
  perfil y procesos creados para esta prueba; los demas archivos pendientes permanecen intactos.

Archivos de esta etapa: `src/lib/local-db.ts`, `src/lib/local-db.test.ts`,
`src/lib/state-update-offline.ts`, `src/lib/state-update-conflict-resolution.test.ts`,
`src/lib/attendance-offline.ts`, `src/renderers/workflows/attendance/AttendanceWorkflow.tsx`,
`src/renderers/workflows/state-update/StateUpdateWorkflow.tsx`,
`src/renderers/workflows/state-update/state-update-workflow-logic.ts`,
`src/renderers/workflows/state-update/state-update-conflict-handlers.test.ts`,
`docs/STATUS.md`, `docs/STATE_UPDATE.md` y `docs/OFFLINE_FIRST_AUDIT.md`.


## Cierre Técnico Acumulado 2026-10-03

Cierre acotado de revisión y checks; **la auditoría general permanece abierta**.

- Revisión del diff completo: limitado a preparación/lectura offline STATE_UPDATE, proyección y resolución
  de conflictos durables, publicación coherente del día Attendance, sus pruebas y documentación. No se
  encontraron cambios ajenos. Los 21 archivos iniciales siguen pendientes en `main`; nada staged.
- Verificación acumulada: `npm test -- --maxWorkers=2`: **850/850 tests, 71/71 archivos**;
  `npm run typecheck`: **PASS**; `npm run lint`: **PASS**, cero errores y dos warnings conocidos
  `no-require-imports` en `records-sync.local-db-regression.test.ts:182-183`, fuera del diff;
  `npm run build`: **PASS**, export Web, worker/WASM SQLite y generación del service worker;
  `git diff --check`: **PASS**, después de actualizar la documentación.
- La primera suite dio 849 aprobados y un fallo textual en `read-loading-indicator.test.ts`: esperaba
  la comparación inline reemplazada por el guard `isStateUpdateVisualRequestCurrent`. Este cierre sólo
  actualizó esa expectativa y documentación; no amplió implementación. La segunda suite completa pasó.
- Persistencia compartida revisada en código y suite: cobertura target y conflictos usan owner, contrato,
  AppView, target y fecha lógica; escrituras locales reutilizan `entity_records`/`pending_operations` y el
  singleton/coordinador; limpieza por ausencia afecta sólo `synced` en snapshots completos. Intención
  pendiente no coincidente se conserva; la reconciliación exacta existente puede completar una intención
  ya confirmada remotamente. Fechas ISO anteriores se consultan por prefijo; definiciones sin nombres
  tienen fallback neutral; filas sin marcador son parciales y vacío sin marcador es ausente. Estos checks
  usan dobles SQLite/API y no acreditan todas las restricciones del motor OPFS real.
- Evidencia Chrome/OPFS reutilizada: STATE_UPDATE preparación CDP 9340, conflicto durable 9342 y
  Attendance 9343/9345, descritas abajo/en STATUS. No se repitió navegador ni se usó Playwright: el fallo
  nuevo fue de una expectativa textual y no mostró regresión del runtime. No se accedió a Core ni datos.
- Higiene: `dist`, `.env`, `.env.local`, `.expo` y `node_modules` permanecen ignorados; no hay configuración,
  secretos, DB, logs, exportaciones reales, fixtures externos ni artefactos en el diff. Los helpers/datos
  sintéticos dentro de tests son cobertura unitaria existente en estos 21 archivos, no fixtures de Core.
  El build usa la configuración local existente sin modificarla; su export no acredita una publicación.
- Sin cambios de Core, datos, esquema/migraciones, dependencias o configuración. Sin commit, push o deploy.

### Pendientes Y Límites

1. **Causa productiva de `Error finalizing statement`**: falta diagnóstico seguro del incidente original;
   la colisión sintética no identifica su causa.
2. **Restricción SQLite entre AppViews que comparten registros**: colisión `server_id` reproducida en
   OPFS, todavía sin corrección; el scope lógico no elimina el índice compartido.
3. **Contenido retenido al cambiar de AppView**: reproducción vigente; falta scope visual por AppView.
4. **`latest` después de resolver conflicto STATE_UPDATE**: la anomalia del fixture Core anterior sigue
   sin diagnostico. El recorrido CDP 9351 verifica latest exclusivamente para remote-b/remote-c con
   servidor sintetico y OPFS real; no acredita universalmente las respuestas Core.
5. **Resumen RECORDS contaminado**, **bloqueo OPFS** y **formato REPORT `[object Object]`**: reproducidos,
   pendientes de correcciones separadas.
6. **Cobertura offline de las demás experiencias**: RECORDS depende de full refresh; PANEL/REPORT de
   queries visitadas; Attendance de fecha/cobertura. No se declara garantía global, nativa ni multi-tab.

Limites historicos del cierre anterior, corregidos en la etapa de resolucion exacta/atomica descrita arriba:

- `Usar Opco` llama `discardStateUpdateLocalChange` por sujeto/scope; el helper selecciona la fila más
  reciente y no recibe el `localRecordId` mostrado. Con varios append del mismo sujeto no queda acreditado
  que descarte exactamente el conflicto elegido. Además borra outbox y restaura fila en statements
  separados: fallo entre ambos no está cubierto como resolución atómica.
- `handleUseLocalConflictChange` emite `Conflicto resuelto`/`server-confirmed` tras `syncPendingRecords()`
  global sin verificar el estado terminal de la fila elegida. Una corrida finalizada no prueba por sí sola
  que esa intención haya sido confirmada; falta cobertura de nuevo conflicto/fallo en ese paso.

Estos límites impiden declarar resolución universal de conflictos. El recorrido Chrome existente sólo
acredita el caso exitoso descrito; se conservan explícitamente las diferencias frente al alcance esperado.

### Inventario Exacto (21 Archivos Pendientes)

- `app/(app)/index.tsx`
- `docs/CLIENT_ARCHITECTURE.md`
- `docs/OFFLINE_FIRST_AUDIT.md`
- `docs/STATE_UPDATE.md`
- `docs/STATUS.md`
- `src/components/read-loading-indicator.test.ts`
- `src/lib/app-view-definitions-cache.test.ts`
- `src/lib/app-view-definitions-cache.ts`
- `src/lib/app-view-prewarm.test.ts`
- `src/lib/app-view-prewarm.ts`
- `src/lib/attendance-snapshot-cache.test.ts`
- `src/lib/local-db.test.ts`
- `src/lib/local-db.ts`
- `src/lib/state-update-offline.test.ts`
- `src/lib/state-update-offline.ts`
- `src/renderers/workflows/attendance/AttendanceWorkflow.tsx`
- `src/renderers/workflows/attendance/attendance-workflow-logic.test.ts`
- `src/renderers/workflows/attendance/attendance-workflow-logic.ts`
- `src/renderers/workflows/state-update/StateUpdateWorkflow.tsx`
- `src/renderers/workflows/state-update/state-update-workflow-logic.test.ts`
- `src/renderers/workflows/state-update/state-update-workflow-logic.ts`

## Attendance Initial Day Publication Fix 2026-10-03

- Demonstrated cause corrected: both initial-load branches hydrated Attendance data without publishing
  `loadedDate`, while the explicit retry path wrote `loadedDate` from `finally` even after a failed read.
  Since `hasCompatibleDay` requires exact date equality, a valid prepared day kept its total, latest rows
  and day-dependent interaction inaccessible.
- Attendance now publishes the snapshot data and logical date from the same completed read. A remote
  response is publishable after its cache/local overlay succeeds; an offline response is publishable only
  when the exact day hydration marker exists. Absence and read failure never accredit a day. Publication
  additionally requires the current request and full owner, contract, AppView, target-entity and date
  scope, so an inverse-order response cannot replace the selected day. Existing local overlays, conflicts
  and write controls remain on the shared STATE_UPDATE storage/runtime.
- Automated evidence: 57 focused tests pass across Attendance logic/component, snapshot cache and prewarm.
  The new regressions cover remote and prepared-local success, valid empty hydration, absent/failure, and
  stale request/date/user/contract/AppView/target scopes. Existing local-DB tests cover persistence and
  reopening of the scoped hydration marker. Typecheck passes; lint has zero errors and only the two known
  `no-require-imports` warnings outside this scope. Final `git diff --check` is recorded below after docs.
- Real browser evidence: Windows Chrome 153 used CDP ports 9343/9345, disposable profiles, the generated
  local Web shell, real Expo SQLite OPFS/WASM, Core local and the explicitly verified PostgreSQL target
  `opco_dev@127.0.0.1:5432/opco_development`. First online opening showed date `2026-10-03`, total `1` and
  the prepared row. In a fresh profile, prewarm reached `Listo`; CDP then kept `navigator.onLine=false`
  throughout the first Attendance visit, which showed `Sin conexión`, total `1`, the row/state and search
  control. Closing Chrome and reopening from `about:blank` with the network cut before navigation produced
  the same visible result under a controlling service worker with OPFS available. No screenshot was taken.
- Evidence limits remain explicit: inverse-order responses and read failure are controlled regressions,
  not injected browser failures. The separate STATE_UPDATE post-conflict `latest` browser limitation stays
  open; this stage does not alter generic STATE_UPDATE, RECORDS, REPORT, OPFS recovery or sync behavior.

## STATE_UPDATE Durable Conflict Visibility Fix 2026-10-02

- Demonstrated cause corrected: a successful online `GET workflow/state-update` replaced the renderer's
  response and remote summary before consulting the durable local conflict. SQLite correctly retained the
  `conflict` record, remote snapshot and outbox operation, but the generic STATE_UPDATE renderer lost its
  warning and resolution entry points until it was offline again.
- Online and offline reads now query conflicts with the complete existing scope (owner, contract, AppView,
  target entity and logical date), overlay the local requested version on the compatible remote response,
  and retain the remote version for comparison. Searches/subject loads filter only presentation inside that
  already-scoped set. A successful GET does not discard differing local intent or retry a conflict; existing exact-match
  snapshot reconciliation remains available.
- The generic renderer exposes the existing whole-intent choices `Usar mi cambio` and `Usar Opco`.
  Choosing local validates the exact conflicting row and reuses its `localRecordId` and outbox identity,
  including append workflows, while creating the required new semantic request id for overwrite. Choosing
  Opco resolves by subject within that scope; exact append-row selection remains limited as noted above. Both paths invalidate older visual reads before publishing
  their result, so a late callback cannot restore a conflict already resolved.
- Automated evidence: the focused run passed 179 tests across four files. Regressions cover remote/local
  projection without duplicate latest rows, no-conflict behavior, late-request invalidation, complete
  conflict query scope, reuse of an append conflict's record/outbox identity, persistence normalization and
  the unchanged sync-engine rule that conflicts are terminal until explicit action. Typecheck passed; lint
  completed with zero errors and the two pre-existing `no-require-imports` warnings in the RECORDS local-DB
  regression. Final `git diff --check` is recorded after this documentation update.
- Real browser evidence: Windows Chrome 153 used CDP port 9342, an exclusive disposable profile and real
  Expo SQLite OPFS/WASM against Client `localhost:3003`, Core `localhost:3000`, and the explicitly verified
  local PostgreSQL destination. A synthetic STATE_UPDATE was saved as `En espera` during a persistent CDP
  network cut while Core independently acquired `Operativo`. Reconnect produced a real conflict; the online
  GET then kept both versions and both actions visible. Full Chrome close/reopen preserved the conflict.
  A separate PANEL remained usable and did not show the renderer conflict. Explicit `Usar mi cambio` showed
  both versions in the confirmation modal, completed the overwrite, removed the warning, and left one remote
  target record; a later reload did not restore or resend the conflict. No screenshot was taken.
- Browser-evidence limit: the concurrent target inserted directly for this synthetic conflict was not
  returned in the fixture's `latest` list after resolution, although PostgreSQL confirmed the final
  `waiting` value, one target record and exactly the conflict probe plus explicit overwrite requests.
  This stage therefore does not claim a real-browser check of post-resolution latest rendering; the
  unchanged no-conflict response path and overlay de-duplication are covered automatically. The fixture
  artifact was not investigated further because that would expand beyond durable conflict visibility.
- Scope limits remain separate: Attendance's initial-day visibility, the RECORDS summary contamination,
  induced cross-AppView SQLite restriction, retained content between AppViews, REPORT formatting and the
  production `Error finalizing statement` incident are not changed or declared resolved here. The local
  export was generated only because OPFS validation required the current bundle; `dist` remains ignored.

## STATE_UPDATE Offline Preparation Fix 2026-10-02

- Demonstrated cause corrected: generic STATE_UPDATE prewarm fetched the initial `items/latest` response
  but discarded it, saved only source records/definition, and declared success. Offline reads then used
  source hydration as sufficient readiness, so a never-downloaded target snapshot appeared as a valid
  empty history. Date-scoped snapshots also compared stored ISO dates with a `YYYY-MM-DD` query by exact
  JSON string equality.
- Generic prewarm now persists the initial target snapshot before writing scoped coverage metadata. The
  metadata reuses `app_metadata`, keyed by fingerprinted owner plus contract, AppView, target entity and
  logical date; no migration was added. A first page is `complete` only when Core reports no following
  page. Any paginated first page is `partial`, and a snapshot/metadata persistence failure leaves the run
  failed instead of accrediting complete coverage. Existing mismatched pending local intent is still not
  overwritten by remote snapshots.
- STATE_UPDATE logical dates are canonicalized to `YYYY-MM-DD` for new local writes, snapshot identities
  and reads. Existing ISO-valued snapshots remain queryable with a prefix comparison and are normalized
  only when exposed as workflow dates; audit/version timestamps remain unchanged.
- Prepared definitions now retain source and target display names. Older definitions remain readable and
  use neutral `Registros` / `Actualizaciones` labels instead of exposing technical ids. Older snapshots
  with rows but no coverage marker are conservatively presented as partial; an unmarked empty cache is
  absent, not a confirmed empty result.
- UI semantics: complete + zero rows shows `Sin actualizaciones`; absent shows
  `Información no disponible sin conexión.`; partial coverage is explicit; a SQLite read failure remains
  an error and never falls through to the empty label. Home consumes the same target coverage marker, so
  source hydration alone no longer advertises generic STATE_UPDATE as offline-ready.
- Automated evidence: 194 focused tests passed across seven files. Coverage includes initial prewarm
  persistence, names, complete/partial metadata, failed snapshot persistence, owner/contract/AppView/date
  scoping, pending-intent preservation, ISO/date-only compatibility, prepared empty versus absent/legacy
  partial presentation, selection guards and loading integration. Typecheck and lint passed; final
  `git diff --check` passed.
- Technical close: the complete suite passed 842 tests across 71 files with at most two workers, the web
  build passed, and final `git diff --check` passed. Typecheck, lint and the Chrome/OPFS walkthrough were
  reused because their corresponding implementation remained unchanged. The build produced only ignored
  local `dist`; no secret, local configuration, fixture, database, log or generated artifact is tracked.
  Shared STATE_UPDATE storage continues to preserve pending local intent, and the full suite found no
  Attendance or other-renderer regression. No outbox/sync engine, SQLite schema, API, dependency or Core
  file changed.
- Real browser evidence: Windows Chrome 153 used CDP port 9340, an exclusive disposable profile and real
  Expo SQLite OPFS/WASM against Client `localhost:8081`, Core `localhost:3000`, and the explicitly verified
  local PostgreSQL destination. A synthetic dated STATE_UPDATE AppView with one subject/update completed
  prewarm. Its first visit occurred after CDP had switched offline and showed the human target name and
  prepared record, with no technical-id subtitle, absent/partial warning or read error. An online visit
  followed by offline reopen also showed the record. After fully restarting Chrome with the same profile,
  the STATE_UPDATE endpoint was blocked before Home loaded; switching offline and opening the AppView still
  showed the persisted record/name without error, proving the result came from retained OPFS rather than a
  second workflow refresh. No screenshot was taken.
- Scope limits remain explicit and separate: this does not diagnose or resolve the production `Error
  finalizing statement` incident; the induced SQLite restriction between AppViews remains pending; and
  incompatible content retained when changing AppView remains pending. A hard offline navigation directly from `about:blank`
  cannot load the development shell; restart persistence was therefore tested by loading the local shell
  while blocking STATE_UPDATE network reads, then switching offline before opening the experience.

## STATE_UPDATE Offline Coverage Diagnostic 2026-10-02

- Renderer confirmed from the exact labels `Últimas actualizaciones` and `Sin actualizaciones`:
  `WORKFLOW` with `config.workflowKey = state-update`, rendered by `StateUpdateWorkflow`. The title is
  `appView.name`; online the subtitle is `targetEntityType.name`, while the prepared offline definition
  stores only entity ids and reconstructs that subtitle with `targetEntityTypeId`. This explains the
  technical identifier reported under `Versionado Procedimientos` without inferring its type from its name.
- `10/10` means ten AppViews reached a terminal prewarm result. `completed` counts every AppView with
  `appViewCompletedAt`, including `success`, `skipped`, and `failed`; the run status is `completed` only
  when none has result `failed`, but `skipped` remains terminal. It does not mean ten experiences have all
  resources needed by their initial offline renderer.
- Coverage by renderer is intentionally different. RECORDS prewarms its definition only and remains
  demand-cached until a successful full records refresh. Attendance stores its definition, fully paginates
  source records, and attempts each current-month daily snapshot; individual day failures are swallowed, so
  the AppView run can succeed while Home readiness reports a partial month. Generic STATE_UPDATE stores its
  definition and fully paginates source records, but currently discards the initial workflow `items/latest`
  response and has no target-snapshot hydration marker. REPORT and PANEL query snapshots are exact-query,
  demand-cached resources and their prewarm branch is `skipped`; BOARD, DASHBOARD and unsupported workflows
  are also terminal `skipped` definitions rather than offline data preparation.
- Demonstrated prewarm gap: the generic STATE_UPDATE branch calls Core and receives its initial latest page,
  hydrates every source-record page, saves the prepared definition, then returns `success` without calling
  `upsertStateUpdateSnapshot`. Its readiness check requires only successful source hydration. Therefore an
  absent target snapshot is classified as ready and the renderer treats `sourceHydrated` as sufficient to
  return a response whose empty local target query renders `Sin actualizaciones`. There is no generic marker
  that can distinguish a valid remote zero, never downloaded target data, or a partial first page.
- Focused automated reproduction passed in `app-view-prewarm.test.ts`: a response with one real latest item
  finishes `completed 1/1`, `failed 0`, hydrates its source record, and leaves zero target snapshots/records.
  This is a controlled store/API characterization, not SQLite evidence.
- Real local browser reproduction used Windows Chrome 153 through CDP port 9339, an exclusive disposable
  profile, Expo Web through a temporary Windows TCP proxy at `localhost:3004`, Core local only, and the
  explicitly verified `.env.local` PostgreSQL target `opco_dev@127.0.0.1:5432/opco_development`. One
  synthetic STATE_UPDATE AppView, two synthetic source subjects and one synthetic target update were used.
  Prewarm ended `completed 3/3`, `failed 0`, in 486 ms. Before that AppView had ever been opened, persistent
  CDP offline mode showed its target entity id and `Sin actualizaciones`; searching still returned both
  subjects as `Sin estado`. This proves source coverage while target history remained absent.
- Visiting the same AppView online showed the human target name and the synthetic latest update, and saved
  one local `synced` workflow record. A later offline open still showed `Sin actualizaciones`. Safe local
  diagnostics exposed the second defect: the snapshot record date was
  `2026-10-02T00:00:00.000Z`, while STATE_UPDATE's offline scope is the canonical date-only
  `2026-10-02`; `listStateUpdateLatest` and subject lookup compare the JSON strings strictly. Thus even a
  visited date-scoped snapshot is not selected offline. No normal empty-state evidence can currently
  distinguish this mismatch from an actual remote zero.
- Separate finalization reproduction: an earlier comparison fixture temporarily assigned two synthetic
  AppViews to the same target record. The second online snapshot necessarily reused the same remote
  `server_id` under another AppView-specific local id, conflicting with the unique local server identity.
  The coordinator recorded `transaction:attendance-snapshot` as `error`, but Expo exposed only
  `Error finalizing statement`; the original SQLite code/context was lost. The previous AppView response
  remained visible under the new title because STATE_UPDATE response state is not scoped to `appView.id`,
  and opening telemetry classified that retained response as completed, so the header returned to `Listo`.
  This is real OPFS evidence for context loss and incompatible retained content, but it was induced by the
  duplicate fixture and does not prove that the reported production AppView has a duplicate target view.
- Minimum correction proposed for a later implementation stage: persist generic STATE_UPDATE's initial
  response during prewarm; normalize snapshot dates to canonical `YYYY-MM-DD`; store a scoped target
  hydration marker that distinguishes complete, partial and absent coverage using server pagination; and
  preserve source/target display names in the prepared definition. Readiness and offline empty UI should
  consume that marker without deleting prior valid snapshots. The cross-AppView retained response and
  preservation of the primary SQLite error should be regression-tested as a separate bounded correction.
- Data risk and missing incident evidence: these paths write only local definitions/cache snapshots and do
  not mutate outbox or Core records. The failed synthetic transaction rolled back and no pending intent was
  at risk. To correlate the user's incident, capture while visible: PWA preparation status/counts, the safe
  SQLite `Ultimas` line, STATE_UPDATE `Last visible UI error`, and the affected local-record date/AppView
  fingerprint. Also confirm whether another AppView shares the same target entity/records. Do not export
  OPFS, response bodies, tokens, credentials, names, or record values.

## Initial SQLite Finalization Diagnostic 2026-10-02

- Reported incident: Client showed `Error finalizing statement` in `Versionado Procedimientos` while
  search contained `tolva`, rows remained visible and the global header said `Listo`. This initial pass
  did not have the later exact labels; the renderer is now confirmed as STATE_UPDATE in the diagnostic
  above. Production and the user's SQLite/OPFS storage were not accessed.
- Confirmed path and context loss: REPORT calls Core, awaits `upsertReportSnapshot`, and on any error
  awaits `getReportSnapshot` before rethrowing. A failure in that fallback read replaces the original
  request/write error. PANEL has the same unguarded fallback pattern. Expo SQLite 57 shorthand methods
  prepare, execute/read and then await `finalizeAsync` in `finally`; on Web the worker emits only
  `Error finalizing statement` when `sqlite3_finalize` is not `SQLITE_OK`. A finalization rejection can
  therefore replace the preceding execute/constraint/I/O error before Client receives it. The shared
  coordinator records only operation name, duration and `error` status, not the underlying SQLite
  result or chained cause.
- Coordination: all normal Client reads, writes and transactions use the singleton coordinated
  connection. Search, snapshot persistence and offline preparation are queued, and a failed operation
  does not stop the queue. A search started while an earlier REPORT request remained pending completed
  independently in the controlled test; exact query keys and mounted/request guards prevent an older
  selection from becoming current. Concurrency alone did not reproduce a finalization failure.
- Focused evidence: a temporary Vitest diagnostic plus existing REPORT/coordinator tests passed 7
  selected tests across 3 files. With controlled API/store/statement doubles it reproduced (a) a
  finalize rejection replacing an execute rejection, (b) a prior same-query REPORT snapshot remaining
  available when refresh persistence fails, and (c) a `tolva` search finishing while an older request
  remains in flight. These are mocks, not SQLite/OPFS evidence. A follow-up attempt to import the real
  Expo `SQLiteDatabase` class in Vitest stopped before test collection because the Node harness does not
  transform React Native Flow; it neither confirms nor rejects the browser incident. The historical
  2026-09-23 OPFS reproduction proves this generic message previously hid a unique-index failure, but
  it does not identify the cause of this incident.
- Visible rows and header: the later STATE_UPDATE OPFS reproduction showed that response state can survive
  an AppView id change. Opening telemetry reports `completed` when that retained response exists even if
  the new read fails, which allows the header to return to `Listo`. This explains the combination locally,
  but the duplicate-target fixture induced that failure and does not identify the user's primary error.
- Data risk: the demonstrated paths are reads and cache/snapshot writes; no outbox mutation, remote
  write or destructive reconciliation is initiated by REPORT/PANEL search. Previously valid snapshots
  and visible in-memory rows remain usable. The unknown original SQLite failure could still mean that
  the newest read snapshot was not persisted; reset or cache deletion is not an appropriate diagnostic.
- Minimum incident evidence is now STATE_UPDATE-specific: copy the PWA preparation rows, safe coordinator
  `Ultimas` line, `Last visible UI error`, and affected local-record date/AppView fingerprint while the
  error is present. Retain only browser-console stack frames and Network method, route template, status and
  request id; do not copy response bodies, query values, tokens or database files.

## PANEL KPI Compact Presentation 2026-09-30

- Cause and geometry: KPI modules had a 240 px visual minimum, while the module shell added 6 px outer padding, 12 px content padding and a second bordered KPI card with 16 px padding and its own 120 px minimum. The repeated calculated-at line consumed another row. Because PANEL derives one shared effective row unit before applying persisted `x/y/w/h`, an `h=1` KPI raised that unit to 240 px and enlarged neighboring modules.
- Correction: the KPI visual floor is now 120 px. Only KPI content uses a compact 6 px inset, 4 px title gap and no nested card chrome; TABLE keeps its independent 300 px floor and bounded two-axis viewport. The module title stays at the top, and the value fills and centers in the remaining space. Calculated-at remains in the response/model for diagnostics and snapshot semantics but is no longer repeated in simple or composed KPI presentation. Offline `Offline`/`Datos guardados`, loading, terminal errors and retry remain visible; compact initial loading reuses the shared accessible progress indicator at 28 px.
- Long values: formatting still comes exclusively from the existing KPI formatter. Client does not truncate, abbreviate, round beyond that formatter, or change signs/units. Web derives a bounded `clamp(22px, glyph-ratio cqw, 38px)` from the actual module content width; native retains the equivalent 22-38 px bounded `onLayout` calculation. The numeric line remains single-line inside its own horizontal viewport. If 22 px still does not fit, only that viewport scrolls and the configured module width remains unchanged.
- Layout conversion: with the validated local config `rowHeight: 8`, an `h=1` KPI sets the shared effective unit to 120 px; therefore `h=1` rendered at 120 px and an `h=2` KPI in the same PANEL rendered at 240 px. A TABLE at `h=4` rendered at 480 px and began exactly after the KPI extent. Without an `h=1` KPI, each module still uses `max(its visual floor, h * effectiveRowHeight)`; persisted coordinates and the TABLE height correction are unchanged.
- Real local browser evidence: Windows Chrome 153 used CDP port 9338 and an exclusive profile, Client at `localhost:3003`, Core local through a temporary Windows loopback proxy, and the explicitly validated `.env.local` database `opco_dev at 127.0.0.1:5432/opco_development`. At 1280x900, four quarter-width KPI modules measured 308.2 px wide; `h=1` was 120 px, `h=2` was 240 px, short/percent/composed values used 38 px, the long negative decimal used 27.07 px, and the long integer used 24.53 px. The long two-line title measured 36 px. At 390x844, modules stacked at 355.2 px wide with the same 120/240 px heights, font sizes from 31.58 to 38 px, no module overlap and `body.scrollWidth === 390`. At an intermediate 222 px value viewport, the longest integer reached the 22 px floor and exposed local horizontal scrolling (`scrollWidth 242 px`) without page overflow. No KPI contained `Actualizado`; TABLE remained separated and usable. No screenshot was taken.
- Evidence scope: the existing local PANEL and its real six-row TABLE were used read-only. KPI height/format variants (short, negative decimal, percentage, long integer and composed percentage) were substituted only in the local response in memory through CDP and were never written to Core or SQLite. The 53 focused tests passed and cover compact/larger layout, mixed TABLE distribution, formatting bounds, title/value structure, full-value scroll fallback, loading/error/offline signals and removal of visible timestamps. Typecheck passed; lint completed with zero errors and only the two pre-existing `no-require-imports` warnings in the RECORDS local-DB regression; `git diff --check` passed.
- Technical close 2026-10-01: the complete suite passed 833 tests across 71 files with at most two workers; typecheck, lint and the web build passed; final `git diff --check` passed. The build generated only the ignored local `dist` output and did not publish it. The optional compact loading branch is used only by PANEL KPI initial loading; the original initial and refresh branches remain explicit for Home, RECORDS, workflows, PANEL TABLE and REPORT.

## Consistent Screen Read Indicators 2026-09-30

- Scope: Home, AppView route bootstrap, RECORDS, Attendance/STATE_UPDATE, PANEL and REPORT now use one compact indeterminate read indicator. `Cargando…` means no compatible content is available; `Actualizando…` keeps only content for the same owner/contract/experience/query visible. Empty and terminal error states do not animate. Offline snapshots keep their existing static provenance/unavailability copy and retries; the global header remains the only global summary.
- Query isolation: Home scopes cards by owner+contract and ignores a cache callback after the remote result settles. RECORDS includes owner, contract, entity and debounced search in its visible scope. Attendance scopes day content by date. STATE_UPDATE rejects a response for another date. PANEL retains a module snapshot only for the same normalized dataset query. REPORT retains a result only for the exact period/search query. Existing request sequence or mounted guards prevent late responses from replacing a newer selection.
- Architecture preserved: no request, cache strategy, timeout, retry policy, outbox/write synchronization, SQLite schema, API, dependency or configuration changed. RECORDS remains cache-first; PANEL/REPORT keep exact snapshot rules. Save and load-more spinners remain action-local and are not read indicators. Reduced motion renders a static progress segment; the progressbar has a polite accessible label and no invented percentage.

| Screen | Previous indicator | Current states | Evidence |
| --- | --- | --- | --- |
| Home/list | Generic spinners; no retained-content refresh distinction. | Initial `Cargando…`; cache-first `Actualizando…`; static local-copy notice; empty/error with retry. | Real Chrome/CDP desktop + 390 px; automated scope guards. |
| Route/definition | Centered spinner. | Initial `Cargando…`; existing terminal error/retry. | Automated integration/source coverage. |
| RECORDS | Spinner could coexist ambiguously with rows. | Initial load, compatible cache-first refresh, empty, retained-content error/retry and static offline copy. | Real Chrome/CDP with six local records; automated query guard. |
| Attendance | Separate day/search spinners. | One day/search read bar, date-compatible content, empty/error/retry and existing offline-day warning. | Automated request/date guards; no local Attendance AppView available for real capture. |
| STATE_UPDATE | Separate workflow/search spinners. | One workflow/search read bar, date-compatible response, empty/error/retry and existing offline warning. | Automated request/date guards; no local STATE_UPDATE AppView available for real capture. |
| PANEL | Module spinners replaced content; compatible failures did not keep the module visible. | Per-module initial/refresh bars, compatible TABLE/KPI retained on refresh/error, empty remains terminal. | Real Chrome/CDP showed KPI `Actualizando…` and TABLE `Cargando…`, then six rows; desktop + 390 px. |
| REPORT | Every request replaced the report with a spinner. | Exact-query initial/refresh distinction; compatible report survives refresh/error; changed period/search hides stale results; empty remains terminal. | Automated mounted/query guards; no local REPORT AppView available for real capture. |

- Real visual evidence used Chrome 153 for Windows through CDP port 9337 and the exclusive prior local validation profile, Core at `localhost:3000`, Client at `localhost:3003`, and the explicitly validated `.env.local` PostgreSQL destination `opco_dev@127.0.0.1:5432/opco_development`. Home refresh bars measured 1240x28 px at 1280x900 and 350x28 px at 390x844 while cached cards remained visible. RECORDS refresh measured 1225x28 px with six compatible rows visible. PANEL simultaneously showed a 240x28 px KPI refresh and a 1176x84 px TABLE initial state, then rendered its KPI and six rows at 390 px. Every measured page had `body.scrollWidth === innerWidth`; screenshots showed usable controls and no overlap.
- Automated evidence: the affected run passes 156 tests across 12 files and covers initial vs refresh, success, empty, error with/without compatible content, offline content/unavailability, accessibility/reduced motion, renderer adoption and stale-selection guards. Typecheck passes. Lint passes with only the two pre-existing `no-require-imports` warnings in `records-sync.local-db-regression.test.ts`.

## Offline Preparation Terminal Progress 2026-09-29

### Defect Reproduced And Corrected

- Demonstrated cause: a failed AppView normally became a terminal per-AppView result, but if the
  subsequent SQLite operation that preserved or marked that failure also threw,
  `prewarmOneAppView` rejected into the fail-fast worker pool. The global run published `failed`,
  released its owner+contract single-flight key, and rethrew while sibling workers were still alive.
  Those siblings could then publish `running` after the terminal state, and a later
  Home/session/reconnect trigger could begin a second global run. This explains both a retained
  `Preparando` state and apparent automatic restarts without attributing the issue to PANEL or to
  the request timeout.
- Correction: failure preservation is best-effort and cannot escape the AppView boundary; a
  defensive worker guard converts any other unexpected AppView exception into a completed failed
  result. The run waits for every worker, emits one terminal state, and global setup failure resolves
  after recording that terminal instead of creating an unhandled background rejection. Previous
  ready definitions remain untouched when failure marking cannot be written. Dedupe and all caches
  remain scoped by owner+contract; outbox, write synchronization, SQLite schema, timeouts and
  one-tab policy are unchanged.
- Correlation and header: each run now records a safe `runId` plus its real trigger (`home`, contract
  selection or lifecycle trigger), while diagnostics retain the per-AppView fingerprint, stage,
  duration and result. The sole global header displays a compact real `processed/total` progress
  bar; processed includes successes, skipped AppViews and failures, and does not claim offline
  availability. A failed terminal says `Preparación incompleta · N fallos`, keeps `N/total
  procesadas`, and uses a static warning icon with no spinner, animated bar or working pulse. Existing send errors, conflicts, write
  confirmations and other active operations retain their previous priority; Diagnóstico and normal
  later retry triggers remain available.
- Regression evidence: the focused prewarm test forces one definition failure plus a second failure
  while writing its local marker, leaves another AppView pending, verifies concurrent trigger dedupe,
  a single `2/2` failed terminal with no later `running`, preservation of the previous `ready`
  definition, and a later successful `2/2` retry with a different run id. Header tests cover active
  to completed, active to incomplete, persisted interruption and a later active retry. The focused
  run passed 62 tests; typecheck passed; lint passed with only the two pre-existing
  `no-require-imports` warnings.
- Technical close: the complete suite passed 825 tests across 69 files with at most two workers;
  typecheck and the web build passed; lint completed with zero errors and the same two pre-existing
  warnings; `git diff --check` passed. The generated `dist` remained an ignored local artifact and
  was not published.
- Real local evidence used Core at `localhost:3000`, Expo Web at `localhost:3003`, and only the
  explicit `.env.local` PostgreSQL destination `opco_dev@127.0.0.1:5432/opco_development`. Chrome
  153 for Windows used CDP port 9336 and the exclusive
  `C:\Temp\opco-cdp-offline-progress-20260929` profile. With network latency applied only in that
  profile, the real header showed `1/2 procesadas`: the progress region measured 220x16 px at
  1280x900 and at 390x844, with no page-level horizontal overflow or overlap. Blocking only the
  local RECORDS definition request produced static `Preparación incompleta · 1 fallo`, `2/2
  procesadas`, a static warning icon, opacity 1 and no CSS animation. PWA diagnostics correlated
  `trigger=home`, one run id, `failed`, 2/2 and one failed
  AppView. Removing the block and performing the existing later Home trigger produced a different
  run id and `completed`, 2/2, failed 0. These are browser/Core observations, distinct from the
  controlled API and store regression.

### Reported Panel Incident Not Confirmed

- The exact reported `Panel Protocolos - Piloto` is absent from local PostgreSQL (zero matching
  AppViews), so its assigned AppView ids, workflow configuration and incident diagnostic copy remain
  unavailable locally and production was not accessed. The equivalent local contract had one
  RECORDS AppView and one PANEL; PANEL completed as the existing unsupported/skipped prewarm
  definition and did not execute PANEL datasets. No local fixture or database row was created or
  modified.

### Visual Observation Limit

- The local browser observation without restarts lasted five seconds: during that interval the
  terminal label and request count remained unchanged. This short observation supports the visual
  state check only; it is not evidence of indefinite stability. The no-late-`running` and later-retry
  guarantees come from the controlled regression, not from the five-second browser window.

## PANEL TABLE Configured Height 2026-09-29

- Trace and cause: Core persists TABLE `layout.h` and PANEL `layout.rowHeight` unchanged. Client receives
  `rowHeight` in the assigned AppView config, while the PANEL execution API returns the same module coordinates.
  Client then derives one effective pixel row height before applying
  absolute desktop `top`/`height`. The TABLE-specific 300 px minimum was divided by each TABLE's own `h`,
  so a TABLE-only panel always resolved to `h * (300 / h) = 300 px`; `h=4`, `h=8`, and `h=12` therefore
  produced the same module height. No `maxHeight` caused the clipping: the module and content are flex
  containers, while the row body is the bounded vertical ScrollView around the existing horizontal one.
- Correction: the 300 px TABLE minimum is calibrated to the editor's default TABLE height of six layout
  units, giving a 50 px effective Client unit. A TABLE below six units still raises the shared unit enough
  to keep its own 300 px floor and prevent overlap; heights above six units use that 50 px unit unless some
  other module requires a larger shared unit. Saved `x/y/w/h`, Core's `rowHeight`, KPI rules, and both scroll
  directions remain unchanged. Thus `h=4` is floored at 300 px, `h=8` is 400 px, and `h=12` is 600 px.
- Regression coverage now asserts the TABLE-only `h=4/8/12` sequence, including container height and the
  resolved shared row height. Existing cases continue covering TABLE+KPI distribution, multiple TABLEs,
  narrow stacking, configured coordinates, search/pagination placement, and nested vertical/horizontal
  scrolling. The affected test passed 48/48, typecheck passed, and lint passed with zero errors and the two
  existing `no-require-imports` warnings in the RECORDS local-DB regression.
- Local HTTP evidence used only Core at `localhost:3000` with the explicit `.env.local` PostgreSQL destination
  `opco_dev@127.0.0.1:5432/opco_development`. The synthetic PANEL response was HTTP 200 with six rows, zero
  metrics, four persisted columns, and the requested module `h`; the assigned config retained `rowHeight: 8`,
  and the two-module API response returned TABLEs at `h=12,y=0` and `h=6,y=12`. No API or Core file changed.
- Windows Chrome 153 ran through CDP port 9335 with the exclusive
  `C:\\Temp\\opco-cdp-table-units-20260929` profile. At desktop width, measured module/body heights were
  `300/148 px` for `h=4`, `400/248 px` for `h=8`, and `600/448 px` for `h=12`; search and pagination remained
  outside the body and visible in the captured desktop viewport. With a second TABLE, the first ended and
  the second began at the same pixel boundary (`684 px`) without overlap. At `390x844`, modules stacked at
  the same boundary, the page scrolled vertically, and the table retained a 318 px horizontal viewport over
  635 px of content without page-level horizontal overflow.
- Only the disposable AppView `cmun3d6gy0001vqmugg7k3n62` and its access row were used; deletion was verified
  at zero remaining rows for both. Screenshots and CDP harnesses were temporary local artifacts and were not
  tracked. No production panel or record, migration, dependency, offline snapshot, commit, push, or deploy
  was involved.

## PANEL/TABLE Validation Closure 2026-09-29

- Accumulated Client scope was reviewed on `main`. The functional diff contains only the TABLE-specific
  300 px visual minimum and bounded nested vertical/horizontal scrolling needed for rows and controls to be
  usable without a KPI. Saved layout coordinates and KPI behavior remain intact; all other changes are PANEL
  regressions and documentation. The Core counterpart is limited to initial TABLE columns, repairable opening
  of `columns: []`, and its tests/docs.
- Procedure for an older TABLE with no columns is performed in Core: open the PANEL, open `Módulos`, choose
  `Editar módulo`, select at least one column under `Columnas y diseño`, press the module's `Guardar`, and then
  press `Guardar experiencia`. Reopen the PANEL to confirm the selection persisted before using it in Client.
- Final Client verification passed: `npm test -- --maxWorkers=2` ran 69 files and 822 tests, `npm run build`
  completed the Expo web export and local service-worker generation, and `git diff --check` passed. The build
  output remains local under ignored `dist/` and is not a production publication. Typecheck, lint, and the
  completed Windows Chrome/CDP desktop/narrow-screen verification are reused because Client implementation
  has not changed since those checks.
- The two repository diffs contain no secret, `.env`, local configuration, database, log, generated bundle,
  or other tracked artifact. No production data, migration, dependency, commit, push, deploy, or publication
  was performed. Earlier notes that call `columns: []` repair pending describe the intermediate stage and are
  superseded by the completed Core editor repair documented above.

## PANEL TABLE Standalone Height 2026-09-29

- Cause: PANEL layout used a generic 180 px minimum for every non-KPI module. A TABLE with the editor
  defaults (`layout.rowHeight: 8`, module `h: 6`) therefore received exactly 180 px; its title, search,
  header and pagination consumed the available height and the horizontal ScrollView clipped rows
  vertically. A KPI changed the global effective row height through its 240 px minimum, indirectly making
  the TABLE taller and creating the observed dependency.
- Correction: TABLE now has a type-specific 300 px minimum. The existing layout planner still preserves
  saved `x/y/w/h` coordinates and configured row height; it raises the shared effective row height only
  enough for each module to satisfy its own visual minimum. The table body is a bounded nested vertical
  ScrollView containing the existing horizontal ScrollView, while module title, search and pagination stay
  outside it. No global overflow rule was removed and KPI minimum behavior is unchanged.
- Regression coverage reproduces the old TABLE-only result (`rowHeight: 30`, height 180) and now expects
  `rowHeight: 50`, height 300. It also covers two TABLE modules without overlap, TABLE+KPI retaining the
  prior 120 px effective row height/distribution, mobile stacking without desktop positioning, and the
  bounded vertical/horizontal viewport structure. The affected test file passes 47 tests; typecheck passes;
  lint passes with zero errors and the two existing `no-require-imports` warnings in the RECORDS local-DB
  regression. `git diff --check` is recorded after this documentation update.
- Chrome 153 for Windows ran headless through CDP on port 9333 with the exclusive disposable
  `C:\\Temp\\opco-cdp-table-height-20260929` profile. Core used only the explicit `.env.local`
  `opco_dev@127.0.0.1:5432/opco_development` database and a process-only CORS allowance for Client at
  `localhost:3003`. Pixel captures, not DOM presence alone, confirmed: TABLE-only rows on pages 1 and 2;
  Estado filter and the empty state; search result `María González`; unchanged TABLE+KPI distribution;
  two 300 px TABLE modules meeting exactly without overlap; and a 390 px viewport with no page-level
  horizontal overflow. With six rows, the TABLE body had a 148 px client height and 295 px scroll height;
  scrolling made the final row fully visible while search and pagination remained fixed.
- Only two disposable local AppViews and their access rows were used for TABLE-only and multi-TABLE
  evidence; the existing TABLE+KPI AppView and entity records were read without modification. Legacy TABLE
  configs with `columns: []` remain the separate editor-hydration pending item and were not addressed here.
  No API, offline snapshot, schema, dependency, production, migration, commit, push, or deploy changed.

## Idempotent PATCH Client Technical Closure 2026-09-28

- The reviewed base is `a0d24a6dfc362004fad102bc586c564ef4471601` on `main`; all idempotent
  PATCH Client work remains uncommitted in this worktree. The final inventory is 11 modified files.
- The diff is limited to durable PATCH command recovery in the existing SQLite v10 payload, guarded
  remote reconciliation, affected API/sync tests, the stateful local-database regression, and
  architecture/audit/status documentation. There are no migrations, dependency, configuration,
  credential, local-environment, or generated-artifact changes in the publishable diff.
- Final checks passed with the API destination fixed to `http://localhost:3000`: typecheck, ESLint
  (zero errors and two existing `no-require-imports` warnings in the module-reload regression), 69 test
  files/817 tests with at most two workers, Web export/service-worker generation with SQLite WASM,
  and `git diff --check`. The generated `dist` remains ignored, local-only, and is not a production
  or commit artifact; its bundle contained localhost and not `https://web.opco.cl`.
- The previously approved three Chrome/CDP scenarios remain applicable because functional content did
  not change after them and were not repeated. Evidence remains local Web plus PostgreSQL: OPFS file
  persistence and replay behavior were observed, but raw `sentCommand` was not decoded from OPFS. The
  CREATE-to-UPDATE trace is still not one uninterrupted CDP trace, and the Access Handle/HMR observation
  remains a harness limitation rather than a completed multi-tab validation.
- Core implementing the optional idempotent PATCH pair must be published before this Client. Older
  operations without a durable command retain conservative conflict handling and gain no retroactive
  idempotency. No browser, production, commit, push, deploy, migration, or data write ran in this closure.

## RECORDS Remote Read Replay Guard 2026-09-28

- Cause demonstrated: after Core had accepted an idempotent PATCH whose response was lost, a detail/list
  read reached the shared `upsertRemoteRecords()`. The newer remote version was treated as an external
  conflict even though the UPDATE outbox still held the exact unresolved `sentCommand`; conflict status
  then excluded the operation from replay.
- Correction in the current worktree: the scoped remote upsert and sent-command check run in one SQLite
  transaction. While a valid unresolved `sentCommand` exists, reads preserve local values, its immutable
  values/key/`expectedUpdatedAt`, and `pending_update`. Commands without that descriptor retain the old
  conservative version-conflict behavior; Core-confirmed conflicts and definitive failures remain blocked.
- Stateful SQLite-harness evidence covers repeated remote reads, module restart, exact replay with one
  effective mutation, B preserved while A is recovered, later B synchronization with a distinct key, a real
  later remote-version conflict, legacy UPDATE, and refresh to a newer remote value after A resolves. The
  complete regression file passed 16 tests; the final combined affected run passed 5 files and 176 tests.
  Typecheck and `git diff --check` passed; lint passed with zero errors and two pre-existing
  `no-require-imports` warnings in the source-inspection regression.
- Real validation after the correction used Chrome 153 through CDP with exclusive disposable profiles, the
  actual Expo SQLite Web worker and six OPFS files. The database file persisted across full Chrome restarts
  and grew from 126976 to 131072/135168 bytes. The local export contained SQLite WASM and pointed to the
  process-only same-origin proxy at `localhost:3000`, which forwarded only `/api/v1` to Core local on
  port 3001; PostgreSQL was explicitly `opco_dev@127.0.0.1:5432/opco_development`.
- Lost A (`CDP_SENTCOMMAND_S1_20260928_1700`) was applied once, its HTTP 200 was discarded at
  response stage, and subsequent detail GETs kept A visible/pending without conflict. After restart, Client
  resent the exact key, `expectedUpdatedAt`, and values. PostgreSQL had one `RECORD_UPDATED`, one
  completed PATCH key, and final A; no third PATCH occurred and the final restart had no pending/conflict.
- B during uncertainty (`CDP_SENTCOMMAND_S2_FINAL2_20260928`) survived an offline close/restart.
  The trace was GET, exact replay A, GET preflight, PATCH B with a different key and A's confirmed version,
  then final GET. PostgreSQL ended at B with two mutations, two audits, two completed PATCH keys, and Client
  had no pending/conflict.
- Real later change (`CDP_SENTCOMMAND_S3_FINAL_20260928`) replayed A exactly, then B performed
  remote reads/preflight and became a visible conflict with zero PATCH B attempts. Client retained B while
  PostgreSQL retained the external value; Core recorded A plus the external mutation and only A's keyed PATCH.
- CDP observed behavior, requests, UI and OPFS file persistence, but did not decode `sentCommand` directly
  from OPFS. Preparatory full-document navigation reproduced the known Access Handle/HMR-style limitation;
  valid traces used one SPA instance and proxy gating before restart. Only the indispensable local Web export
  ran; no suite, migration, production, commit, push, or deploy action was performed. SQLite remains v10.

## RECORDS Lost PATCH Response Browser Blocker (Historical) 2026-09-28

- Real Client + Core validation stopped in scenario 1 after demonstrating a product defect. Chrome 153
  used CDP with an exclusive profile; Client was served at `http://localhost:3000`, Core at local port
  3001 through a process-only localhost proxy, and Core used the explicitly validated
  `opco_dev@127.0.0.1:5432/opco_development` database. The runtime loaded the Expo SQLite Web worker and
  its OPFS database file grew while the isolated profile was active.
- Synthetic record `CDP_PATCH_LOST_S1_20260928` started at Cargo=`Base`. Client sent A=`Taller-S1` with
  `clientRequestId=local_c9f8dfbd-433b-4aa1-9acb-be77bf45e5ed` and
  `expectedUpdatedAt=2026-09-28T18:38:05.672Z`. CDP observed the PATCH response-stage HTTP 200 and then
  aborted delivery, so this was a discarded response after Core, not a held response later released.
- PostgreSQL contained Cargo=`Taller-S1`, one `RECORD_UPDATED` audit event (`Base` -> `Taller-S1`), and
  one completed PATCH idempotency row for that exact key. Client retained the local value, but the
  mounted detail persisted `REMOTE_VERSION_CHANGED`/`conflict`; after a full Chrome restart with the
  same profile it still showed Cargo=`Taller-S1`, `Conflicto`, and global `Requiere atencion`.
- Cause: the detail load performs a remote GET after the failed delivery. `upsertRemoteRecords()` treats
  any version change on `pending_update` as an external conflict without checking whether the outbox has
  a recoverable `sentCommand`. `listPendingOperations()` then excludes the resulting `conflict` record,
  so startup cannot replay the completed idempotent command. The outbox descriptor was not extracted
  from the raw OPFS database; its runtime persistence is therefore not claimed independently here.
- Scenarios B-during-uncertainty and real other-user change were not run after this blocker. Two unused
  synthetic bases, `CDP_PATCH_LOST_S2_20260928` and `CDP_PATCH_LOST_S3_20260928`, were also created in
  local PostgreSQL. After evidence capture, all three synthetic records plus their four audits and four
  idempotency rows were removed; zero matching records remain. No functional code, schema, migration, dependency,
  configuration, production data, commit, push, or deploy changed; no suite or build was run.

## RECORDS Idempotent PATCH Integration 2026-09-28

- Client now derives PATCH `clientRequestId` from each UPDATE `intentId` and sends it with the durable
  `expectedUpdatedAt`. The exact command is persisted atomically as `sentCommand` inside the existing
  `pending_operations.payload_json`; SQLite remains schema v10.
- A later B keeps its own visible values/intent in the same row while unresolved A remains immutable in
  `sentCommand`. Recovery resends A directly without GET, consumes Core replay, advances B's remote base,
  then gives B a different key and the normal preflight. No value-equality inference or fallback to an
  unprotected PATCH was added.
- Network/5xx failures retain the exact command and perform one PATCH per sync invocation. Known success,
  conflict, or definitive failure removes only the matching descriptor. A result for superseded A leaves
  B `pending_update`; Core `REMOTE_VERSION_CHANGED` remains a visible durable conflict.
- Compatibility coverage keeps CREATE->UPDATE behavior and handles old UPDATE rows without `intentId` or
  `sentCommand`: they use existing `client_request_id` only for a new protected attempt after preflight.
  A version advanced by a possibly accepted legacy PATCH remains a conflict; no retroactive idempotency is
  claimed. Internal `intentId` is absent from the API body.
- Focused automated evidence uses controlled API behavior plus the stateful SQLite-shaped harness, not a
  real Core, network, browser, or Expo OPFS/WASM runtime. It covers accepted A with lost response and one
  effect, B during uncertainty, module restart, different A/B keys, real remote conflict, repeated network
  failures, legacy rows, and CREATE->UPDATE. Browser validation was intentionally not run in this stage.
- Validation on the final functional content: five affected test files passed with 192 tests and
  `npm run typecheck`, `npm run lint`, and `git diff --check` passed. No
  schema, migration, dependency, configuration, Core, production, commit, push, deploy, full suite, or
  build action was performed.

## RECORDS Lost UPDATE Response Characterization 2026-09-28

- Historical characterization before the idempotent PATCH integration showed that an accepted PATCH
  with a lost response became indistinguishable from another user's edit: the next GET saw a changed
  version, Client preserved local intent, skipped a second PATCH, and reported conflict.
- The integration above supersedes that runtime behavior for commands carrying durable `sentCommand`:
  Client now replays the exact keyed PATCH before evaluating the old base. The real remote-change control
  remains and still produces `REMOTE_VERSION_CHANGED`. Values are never compared to infer authorship.
- Legacy rows without a durable sent command retain conservative behavior and receive no retroactive
  idempotency claim. The original evidence used controlled API behavior and a SQLite-shaped harness, not
  Core, browser, OPFS/WASM, production, or real data.

## RECORDS A-to-B Technical Closure 2026-09-28

- Final automated checks on `main` at `487c970c7238a50d84446481a3ff101092222728` passed: typecheck, lint, 69 test files with 811 tests at two workers, Web build/export with Expo SQLite WASM and service-worker generation, and `git diff --check`.
- The final diff is limited to the SQLite v10 RECORDS intent-preservation correction, scoped `local_id`/`server_id` resolution, mounted-detail refresh after direct sync, and their tests/documentation. There are no schema-version, migration, API/Core, dependency, or configuration changes, and no credentials or generated artifacts are included.
- Automated evidence uses the real persistence and sync functions with controlled APIs and a stateful SQLite-shaped harness. It is distinct from the earlier Chrome/CDP evidence with Expo SQLite OPFS/WASM summarized below; no browser scenario was repeated for this closure.
- The UPDATE A-to-B browser scenario has an uninterrupted retained-response trace and passed without reload after the mounted-detail correction. The CREATE-to-UPDATE final-delivery evidence remains limited: Core/PostgreSQL proved one final remote record with `Bodega`, but the CDP harness did not retain one uninterrupted trace of that final transition, so it is not treated as a complete browser verification.
- During an earlier development/HMR setup, Expo Web emitted a transient `Database not found - nativeDatabaseId[0]` message and remounted. The subsequent clean controlled scenario passed, but the HMR observation was not independently reproduced or investigated and is not considered verified by this closure.

## RECORDS Mounted Conflict Refresh 2026-09-28

- The stale conflict was a mounted-view refresh defect, not a durable conflict left after A completed. While A was in flight, the detail GET observed remote A against B's older base and correctly persisted a transient `conflict`; superseded completion of A then transactionally cleared the conflict fields and restored B as `pending_update`.
- Direct/manual `syncPendingRecords()` completion now publishes the existing RECORDS refresh key for the current session scope, and `RecordDetailScreen` consumes that key. A real conflict remains visible because reload reads the still-persisted `conflict`; only the already-cleared transient conflict disappears.
- Focused evidence passed: the stateful SQLite regression observes persisted conflict B/A before confirmation and pending B with null conflict fields afterward; mounted-detail refresh coverage plus lifecycle, reconnect, and RECORDS sync tests passed (4 files, 53 tests). Typecheck, lint, and `git diff --check` passed.
- Chrome/CDP with an exclusive profile and real Expo SQLite OPFS/WASM reproduced the transient banner. Releasing A's retained HTTP 200 kept the same mounted URL and changed the detail to `Bodega` + `Pendiente` with no conflict, without reload. Six OPFS files remained and the Expo SQLite worker bundle was loaded.
- The independent stale-conflict item is resolved. No schema, migration, API/Core, dependency, configuration, production, or real-data change was made.

## RECORDS Pending CREATE Edit 2026-09-28

- Cause: the detail and edit routes retain `local_id`, but `loadRecordWithOfflineCache()` previously sent that identifier to Core before resolving the scoped SQLite row. Once CREATE assigned `server_id` and the row became synced, Core returned 404 for the local identifier and the fallback deliberately rejected a synced cache row.
- Minimal correction: individual RECORDS loading first resolves by `owner_key + contract_id + entity_type_id + (local_id or server_id)`. A row without `server_id` opens directly from local storage; a row that already has `server_id` refreshes from Core using that remote identity while the original local route remains valid. No schema, API, Core, dependency, or configuration changed.
- Focused automated evidence passed: `offline-records.test.ts`, the stateful SQLite A-to-B regression, and RECORDS sync tests (3 files, 65 tests). The new coverage rejects a Core request using a pending local id and verifies that the same local-id route resolves through `server_id` after CREATE confirmation. Typecheck and lint passed.
- Browser evidence with Chrome/CDP and Expo SQLite OPFS/WASM: Core processed CREATE A=`Taller` while its response was retained; `/record/local_.../edit` opened successfully instead of showing `Registro no encontrado`; saving B=`Bodega` succeeded locally. After release, Core still had exactly one synthetic remote record with A while Client showed durable B pending, and B remained after a full Chrome restart with the same exclusive profile. The runtime loaded the Expo SQLite Web worker.
- Browser completion evidence: Core logged the final PATCH 200 and PostgreSQL contained exactly one matching synthetic record with Cargo=`Bodega`. The CDP harness did not preserve one uninterrupted trace of that final delivery: an aborted Fetch interception contaminated the first disposable profile, and the final clean attempt timed out waiting for a local-id URL after the route had already advanced to `server_id`. The database result proves completion and uniqueness, but the exact final response-release transition remains a harness limitation. No additional product change was made; the separate stale-conflict presentation issue was subsequently resolved and validated as documented above.

## RECORDS A-to-B Browser Validation 2026-09-28

- Environment evidence: Chrome 153 for Windows ran headless through CDP with a dedicated disposable profile, while Expo started with automatic browser opening disabled. Core was guarded against `opco_dev@127.0.0.1:5432/opco_development`; Client used `http://localhost:3000` and the verified private `client-review@operational-core.local` credentials. No habitual browser profile or production destination was used.
- SQLite Web evidence: the runtime loaded the Expo SQLite worker, created six files under the `expo-sqlite` OPFS directory including a 131072-byte database file, and later grew that file to 135168 bytes. After a real page reload while B's PATCH was intercepted before Core, the same OPFS files remained and the detail rendered durable local value `Bodega` with status `Pendiente`.
- UPDATE A-to-B passed for durable data. CDP retained A's HTTP 200 response after Core had applied `Taller`; B was then saved as `Bodega`. B stayed visible and durable, survived reload while its PATCH was held before Core, and synchronized after release. Core ended with exactly one matching remote record and `Bodega`.
- UPDATE presentation observation: before A's retained response was released, detail's remote read saw A and displayed a conflict for local B. Completing A corrected SQLite to pending, but the mounted detail kept the stale conflict label until reload. No B data or outbox intent was lost; this presentation-only issue is resolved by the mounted conflict refresh validation above.
- The original CREATE-to-UPDATE browser blocker is resolved by the scoped local-first identity lookup documented above. The prior run retained CREATE A after Core created one `Taller` record and reproduced `Registro no encontrado` at `/record/local_.../edit`; the current run opened that same route shape and saved B locally. No v11, schema, migration, or Core change was needed.
- Compatibility and automated evidence remain valid: legacy operations without `intentId` fall back to `client_request_id`; API bodies exclude `intentId`; the final complete suite passed with 69 files and 811 tests at two workers, and Web export/service-worker generation passed with Expo SQLite WASM included.

## RECORDS Consecutive Edit Preservation 2026-09-26

- SQLite v10 RECORDS outbox payloads now carry a local intent identity. Completion, retry, definitive failure, and conflict handling only mutate the intent they actually sent, so a later edit remains locally visible and durable.
- When CREATE is confirmed after a later local edit, the existing outbox intent is converted transactionally to UPDATE with the confirmed server id and remote version. UPDATE confirmation refreshes that same remote base without replacing the later local values; the next preflight still detects genuine remote changes as conflicts.
- Focused coverage uses the real local persistence and RECORDS sync functions with a controlled API and a stateful SQLite-shaped harness. It covers A-to-B preservation and resend, module reload, remote conflict, network failure, late A failure/conflict, and CREATE-to-UPDATE without duplicate creation. It does not exercise Expo Web's real OPFS/WASM SQLite engine or production data.

## Recovered Client Improvements 2026-09-24

- The validated candidate restores four independent changes on base
  `84c6d21a2692b3d26cd3072e01aa0d7303520686`: KPI module titles without a duplicate metric label,
  RECORDS read/send error wording, the unified header with scoped offline-preparation status, and
  per-run entity-definition request deduplication.
- The complete pre-consolidation tree, including the incomplete SQLite v11/outbox experiment and its
  tests, is preserved at
  `/home/dannysilver/dev2026/backups/opco-client/2026-09-24-pre-consolidation-v11-full-84c6d21`.
- At that recovered candidate SHA, consecutive RECORDS edits during synchronization remained unresolved
  and no v10 reconstruction or v11 migration was active. The current v10 correction is documented above.
- The 13 recovered implementation/test files are byte-identical to the validated candidate at
  `/home/dannysilver/dev2026/backups/opco-client/2026-09-24-four-patches-validation-84c6d21`.
  The persistence and sync files remain identical to base `84c6d21a2692b3d26cd3072e01aa0d7303520686`,
  and SQLite remains at schema v10. The matching candidate passed typecheck, lint, 799 tests, and
  the production Web build.
- Local visual review confirmed the RECORDS experience, the PANEL table, and a KPI that shows only
  its module title with value `1`. Failed and interrupted offline-preparation transitions were not
  manually verified and remain an explicit visual follow-up.

## PANEL Related Fields Release 2026-09-22

- Client moved by fast-forward from `8805de170aff78ae191e71e6f94a970c67fc3f89` to functional SHA `fff8aaf9125d8f30a16906feb11606a796d7d1d9` after Core `90dd4b909a7a0d83553cf518ec7488d121d00a1b` was active and ready. Railway reported `success` for that exact Client SHA. The public HTML serves `entry-81e6d5a243671168fa2d1a0581e6d736.js`, matching the validated local Web export; the bundle contains `relatedFields` and `related:` markers.
- Client resolves filter metadata through the selected direct source relation and cached target definition, and formats MANY target values in one TABLE row. Existing PANEL configs remain compatible. Typecheck, lint, full Vitest (790 passed), and Web build passed. No production AppView, entity, record, environment, or storage change was made for this release.
- Compatible rollback: revert Client to the prior SHA above, then Core to `8882cd4d9eabcc7d47c9aeb02c2c53583d2f8c1b` with forward commits/redeploys. If related fields are configured later, remove them while new Core is active before its rollback. The local screenshot confirms related Categoria selection only; production columns, filters, and offline behavior remain manually unverified.

## PANEL Release 2026-09-22

- Client moved by fast-forward from `d6142589656d5282be0c6f62f36019d0da5aafe0` to
  `4e401a017f82dee46d50b17b1c6a34070d55538c`, after Core
  `a8e08724d62792e29397ca2d0356070167290abe` was active and ready. Railway reported
  `success` for the Client service on that exact commit. The public site serves
  `entry-609278ef5c01c25ef0698d10c18f7ca2.js`, matching the validated local web export;
  that bundle contains typed-filter and `moduleResults` markers.
- The same Client tree passed typecheck, lint, full Vitest (789 passed), web export, and service
  worker generation. No AppViews, records, local storage, or environment configuration changed.
- Compatible rollback order: revert Client code to the prior SHA above, then Core to
  `aae812b97907f5b8e8b9754dcfa16b892404d0ab` if needed, using forward commits/redeploys
  rather than force push. Older Client shows composed KPI as unavailable (`-`), not recalculated.
- Manual verification of Core save feedback, Client filter controls, offline selections, and KPI
  presentation is still pending; no manual validation is claimed.

## PANEL Metric Composition 2026-09-21

- Client renders Core's `moduleResults` for composed KPI modules; it formats the received value
  and reason without recalculating A/B. Existing KPI and TABLE modules retain their paths.
- Results come from one matching PANEL response or snapshot. Filter query keys and request sequence
  guards prevent showing a prior selection during a new load or accepting a late response.
- Publish Core first, Client second, and only then configure composed KPI modules. An older Client
  displays a composed KPI as unavailable (`-`); it does not calculate A/B. Existing KPI and TABLE
  modules remain compatible.
- Validation: typecheck, lint, full suite (788 tests), and web export with service-worker generation
  passed. Manual review remains for the editor flow, offline selection changes, and responsive
  presentation; no manual validation is claimed here.

## PANEL Filters And Grouping Review 2026-09-21

- PANEL sends normalized filter values to Core and keys offline snapshots by filter values,
  dataset, pagination/search, scope, and config revision. Clearing a text input removes its
  filter key from subsequent queries.
- Client now reads bound entity definitions through the existing definition cache and renders typed
  filter controls. Required selections block only bound dataset requests; independent datasets
  continue. Options send internal values, relations send record ids, and empty optional controls
  are absent from requests and snapshot keys. This does not change metric conditions or KPI
  composition calculations. Typecheck, lint, full suite (789 tests), and web build passed; manual
  checks of controls and offline behavior remain pending.
- Dynamic metric breakdown by a dataset field is not yet a Client response or visualization type.

## Visibility Investigation 2026-09-21

- Case remains open: `showInClient` stays checked after saving, and the field is reportedly absent
  from full record detail. The earlier `showInClient=false` explanation does not cover this case.
- Full detail fetches the entity definition and record independently when opened. Network definitions
  replace the in-memory definition and are written to SQLite cache; cache is used when the request
  fails. RECORDS detail may use a locally pending or cached record value. Detail includes active
  fields only when their formatted record value is nonempty; it does not use `showInClient`, an
  AppView field selection, or a field-count limit.
- The unresolved case needs the field's presence/type/key in the definition and that key's presence
  and emptiness in the individual record response, then comparison with the displayed detail.
- In a clean worktree based on `origin/main`, generic RECORDS rendering was traced without touching
  local storage or production data. RECORDS Client summaries use `showInClient` when it is explicitly
  present, otherwise they fall back to `showInList`.
- Therefore `showInList=true` with `showInClient=false` is expected to show the field in the Web
  record list but hide it from compact Client record cards. Full Client record detail remains
  unfiltered by `showInClient`.
- The definition cache replaces cached definitions with the fresh API definition, including explicit
  `showInClient=false`, so the normal network reload path updates cached visibility without special
  invalidation code in Client.
- No name-based special case was found for Personas, Estatus, Estado, or internal record status.
  Dynamic status-like fields are rendered according to their field metadata and option definitions.

## Stabilization Closed

Selective stabilization was published to production at
`2833b7becb922d6c0476d8841958b81e3c6d5c0c`. The user confirmed that RECORDS loads and supports
search, and that Attendance shows the list and counter for the selected date. The local environment
remains separated; ENV-024, local destinations, development tooling, seeds, credentials, and guards
were not published.

The responsive header follow-up was published at
`351005db9ee8e3b7fb31011a12f3e986d58b5e24`.

The absence of an automated test against Expo Web's real OPFS/WASM engine remains a coverage
limitation, not an open incident.

## Header And Save Feedback Closed

- Visual review at 390 px with "Daniel Esteban Silva Cruz" demonstrated that placing the user and
  Diagnostics in the same compact actions zone allowed Diagnostics to overlap the brand. Compact now
  uses three explicit rows: brand/navigation with Diagnostics, avatar with the wrapping full name,
  and the centered status indicator. The user confirmed the correction at 390 px: brand and
  Diagnostics remain separate, the complete user name is visible, and status is centered.
- Widths 1024 and 1280 retain three equal flexible desktop zones, which centers status against the
  complete header. The status indicator remains informational and separate from the Diagnostics
  button. The user confirmed the desktop header at 1024 px.
- RECORDS reports local success only after its atomic SQLite record/outbox save resolves. Attendance
  and STATE_UPDATE do the same for offline saves and report remote success only after a successful
  write response.
- Write confirmation outranks concurrent read activity, while durable errors and conflicts retain
  priority. Feedback is scoped by user, contract, and AppView; expiration requires the matching
  monotonic presentation id, so an older timer cannot clear a newer result. Once cleared, the resolver
  presents the current connectivity, sync, pending-work, or read state.

No synchronization, outbox, configuration, or data behavior changed in this review. The requested
compact and 1024 px visual checks are complete.

Validation passed: complete suite (68 files and 784 tests), TypeScript, lint, `git diff --check`, and
web export plus service-worker generation. The habitual export first inherited a Metro cache entry
from another worktree; rebuilding with an empty bundler cache passed.

Offline/outbox behavior remains documented in [`STATE_UPDATE.md`](STATE_UPDATE.md); broader client
architecture and future scope remain in [`CLIENT_ARCHITECTURE.md`](CLIENT_ARCHITECTURE.md).

### 2026-10-07 — Cierre de identidad/current STATE_UPDATE v10 y adaptación uniqueness

Corrección local completada, sin publicar. El bloqueo de representación documentado el 06 quedó
resuelto: normalizeStateUpdateUniqueness admite cadenas históricas y el objeto {mode:...} de Core
para none/subject/subject-date, rechazando desconocidos con INVALID_STATE_UPDATE_UNIQUENESS.
API y caché get/list/write entregan la misma representación interna. Definiciones legacy válidas
se leen sin reescribir almacenamiento; inválidas producen definición/status error controlados.
Core no cambió. No se alteraron outbox, claves de intención/idempotencia, esquema ni índice UNIQUE.

Se activa el arreglo scoped para subject/append/dateFieldId: dos eventos remotos con igual sujeto
y Fecha permanecen separados; current y latest reutilizan el mismo evento y se conserva el
contenido completo de current. Se reutiliza el alias legacy del mismo evento sin reset de caché.
Current offline: fecha configurada DESC/ID remoto ASC, sin filtro por fecha de consulta para
historia synced, excluyendo fechas ausentes y manteniendo el overlay pendiente de consulta.
La ausencia de fecha autoritativa no se sustituye por la fecha consultada.

Cobertura: ambos productores pasan el total esperado en respuestas completas; contenido
insuficiente impide reconciliación y complete. La cobertura exige IDs únicos realmente
persistidos (no el número de referencias current/latest). Marcadores legacy sin prueba se
leen partial en el modo acotado. Pendientes/conflictos y rollback permanecen protegidos.

Regresiones red antes del cambio de boundary: 11 fallos por objeto no normalizado/configuración
inválida aceptada, con los nueve casos previos verdes. Tras el cambio,
src/lib/state-update-remote-snapshot.test.ts tiene 26 casos PASS, incluyendo raw API -> prewarm
-> SQLite cache -> hidratación, caché histórica, tres modos/string/object, rechazo de valores
desconocidos, contenido incompleto y conservación de extras completos del current.
Checks finales afectados: 13 archivos/369 pruebas PASS; typecheck PASS; lint de ocho archivos
afectados PASS; git diff --check PASS. Export web temporal + SW PASS; sin escribir dist.
Se ejecutaron API, cache, prewarm, SQLite/local-db, state-update/offline/conflictos/sync,
Attendance y lógica de workflows. No suite completa ni experimentos v11.

Fixture Core/PostgreSQL local (DATABASE_URL de .env.local explícita en ambos procesos, guard
localhost/opco_development): misma configuración acreditada, relación ONE Procedimiento,
uniqueness.mode=subject, append, Fecha DATE y Revisión TEXT opcionales, Estatus SELECT obligatorio
con opción/valor sintético explícito VALIDADO_SYNTHETIC. El default de producción sigue
desconocido; no se inventó. Un procedimiento TOLVA, eventos A/R1 y B/R99 con Fecha 2026-10-04,
IDs A<B, B modificado después, fecha consultada posterior. Usuario/organización/contrato/AppView
nuevos y sintéticos; no se escribió en producción.

Chrome con perfil exclusivo nuevo, API/Client localhost:19420/19421 y OPFS real:
- Online TOLVA mientras preparación de fondo estaba retenida: navigator.onLine=true,
  HTTP GET workflow 200, sujeto y current R1 visibles, dos filas/dos IDs remotos, sin error.
- Tras liberar preparación: complete/total=2/contentVerified=true; siguen dos eventos.
- Búsqueda offline tras el recorrido online: sujeto/current R1 y ambos eventos persistidos;
  sin duplicados, fechas propias conservadas, sin Error finalizing statement observado.
- Cierre completo: 0 procesos Chrome del perfil. Core y Client HTTP propios detenidos.
  Reapertura del mismo perfil con red emulada offline antes de cargar la ruta: SW activo,
  crossOriginIsolated=true, OPFS conserva dos IDs y current R1; sin error SQLite observado.

Esta secuencia reproduce el recorrido online aclarado por el usuario y la persistencia tras cierre;
no representa el almacenamiento productivo ni prueba por sí sola su sentencia SQLite primaria.
Preparación concurrente controlada de una AppView sintética, no el inventario productivo 10/11.
La versión histórica es anterior a la consulta; el empate además comprueba el ID ascendente.

Inventario de esta continuación: opco-api.ts y app-view-definitions-cache.ts (normalización),
local-db.ts (boundary cache y controles de contenido/fecha), state-update-offline.ts y productores
app-view-prewarm.ts/StateUpdateWorkflow.tsx (total esperado), regresión remota extendida y estos
tres documentos. local-db.test.ts conserva el matcher ajustado de la etapa anterior.
Todos los pendientes ajenos y las pruebas anteriores de snapshot-date/conflictos están intactos
por comparación SHA256; Core limpio en 6ed194af04717073fedb3087eb4ad836b234014a, Client main
en 76babead92d82239fcc9ac78f3e1e1d6b3df939d, index vacío.

Fixture eliminado: 0 objetos propios en nueve modelos comprobados. Perfil, credenciales,
build temporal y procesos propios retirados; no se borraron cachés habituales. Evidencia
sanitizada fuera de Git en backups/state-update-uniqueness-close/2026-10-07.
Sin commit/push/deploy, V11 pausado. Error finalizing statement productivo sigue abierto,
pendiente de correlación; problema independiente entre AppViews y caso sin fecha no retomados.


### 2026-10-07 — Lote STATE_UPDATE v10 listo para publicar: cierre técnico

El lote publicable se delimita contra Client main 76babead92d82239fcc9ac78f3e1e1d6b3df939d:
7 archivos de implementación/prueba existente, 2 regresiones nuevas y 3 documentos con sólo
las secciones de cierre de identidad/current/uniqueness y este cierre técnico. No se publican
las notas intermedias de diagnóstico ni los demás pendientes documentales.

Checks completos con máximo dos workers: árbol de trabajo 77 archivos/927 pruebas PASS;
HEAD + lote seleccionado aislado 76 archivos/923 pruebas PASS. Los cuatro casos de diferencia
son dos caracterizaciones V10 experimentales y dos diagnósticos entre AppViews, excluidos del
lote. No se modificaron ni retiraron esos pendientes. Typecheck PASS, lint completo PASS
con 0 errores y 2 advertencias preexistentes de require() en
src/sync/records-sync.local-db-regression.test.ts:182/183, build:web/export/SW PASS, diff-check PASS.
Build realizado en copia temporal, con endpoint localhost, sin copiar .env ni sobrescribir
el dist habitual. No se cambiaron dependencias, migraciones, esquema ni Core.

Revisión: definición cacheada objeto/string se normaliza sin reset/rewrite al leer; un modo
inválido da error controlado. Una fila legacy synced del mismo evento conserva su alias.
Un evento perdido por una versión anterior exige hidratación online exitosa para recuperarlo:
no puede reconstruirse a partir de una cobertura antigua. Los marcadores antiguos sin prueba
son partial, y total de contenido insuficiente impide complete/reconciliación destructiva.
Las identidades y serialización efectiva de intenciones/outbox/idempotencia siguen intactas;
las filas no synced y conflictos no se sobrescriben. Lookups/lectura/reconciliación filtran
owner/contrato/entidad/AppView y current además sujeto. Attendance/subject-date/sin fecha
retienen sus caminos anteriores; tests completos de los consumidores pasan. El UNIQUE v10
entre AppViews distintas permanece como limitación independiente, sin corrección en este lote.

Evidencia Chrome/OPFS reutilizada: SHA256 de todos los archivos funcionales finales coincide
con el contenido validado en backups/state-update-uniqueness-close/2026-10-07. Online con
preparación concurrente, offline y reapertura sin servicios conservan R1 y dos eventos.
No hay riesgo funcional nuevo que justifique repetir navegador o fixtures. Alcance: fixture
sintético completo de dos eventos/una AppView; no datos productivos, native, múltiples tabs
ni garantía de vigente global con snapshot parcial. Error finalizing statement productivo
permanece sin correlación concluyente de sentencia/causa primaria. V11 pausado.

Parches e inventario verificables: backups/state-update-technical-close/2026-10-07,
state-update-implementation.patch y state-update-documentation.patch; ambos aplican sobre
el HEAD indicado y reproducen exactamente los archivos seleccionados. Sin secretos, .env,
configuración local, bases SQLite/PostgreSQL, logs, builds ni experimentos en el lote.
Main, índice y pendientes excluidos se conservan. Sin commit/push/deploy.

Inventario exacto de archivos y hunks:

- src/lib/app-view-definitions-cache.ts: todos los 2 hunks actuales pertenecen al lote.
- src/lib/app-view-prewarm.ts: todos los 1 hunks actuales pertenecen al lote.
- src/lib/local-db.test.ts: todos los 1 hunks actuales pertenecen al lote.
- src/lib/local-db.ts: todos los 22 hunks actuales pertenecen al lote.
- src/lib/opco-api.ts: todos los 3 hunks actuales pertenecen al lote.
- src/lib/state-update-offline.ts: todos los 4 hunks actuales pertenecen al lote.
- src/renderers/workflows/state-update/StateUpdateWorkflow.tsx: todos los 3 hunks actuales pertenecen al lote.
- src/lib/state-update-snapshot-date.test.ts: archivo nuevo completo.
- src/lib/state-update-remote-snapshot.test.ts: archivo nuevo completo.
- docs/STATE_UPDATE.md: sólo desde «## Cierre v10: uniqueness normalizado, identidad remota y current offline — 2026-10-07» y el nuevo cierre técnico; el resto del diff se excluye.
- docs/STATUS.md: sólo desde «### 2026-10-07 — Cierre de identidad/current STATE_UPDATE v10 y adaptación uniqueness» y el nuevo cierre técnico; el resto del diff se excluye.
- docs/OFFLINE_FIRST_AUDIT.md: sólo desde «### 2026-10-07 — Cierre local v10: integración uniqueness/current/identidad aprobada en fixture» y el nuevo cierre técnico; el resto del diff se excluye.

Excluir íntegramente src/lib/state-update-conflict-resolution.test.ts (2 caracterizaciones
entre AppViews), src/lib/sqlite-projection-v10-open.experimental.test.ts y tests/experiments/*.
Los demás hunks documentales previos (V11, SQLite/productivo, caso sin dateFieldId y etapas
intermedias) quedan en el working tree; no se eliminan ni se preparan.


## 2026-10-07 — Consistencia Inicio/workflow y copia de cobertura STATE_UPDATE

Causa local demostrada: Inicio leía el mismo marcador diario sin dateFieldId,
historyMode ni uniqueness. Omitía la validación existente que degrada a partial los
marcadores antiguos sin contentVerified=true para subject/append/con fecha. Inicio y
workflow ahora construyen su scope con buildStateUpdateCoverageScope. El lector conserva
sus reglas; no se escribe ni promociona ningún marcador.

«Copiar State Update», en la pestaña STATE_UPDATE del diagnóstico compartido, conserva
el diagnóstico home_local_today para las AppViews con definición local. Además copia
visible_workflow para la AppView visible: fecha seleccionada y configuración efectivas
obtenidas del estado/response del workflow mediante el contexto de actividad existente.
El shell proporciona la AppView de la ruta visible. La copia toma ese contexto al pulsar;
la fecha del workflow nunca se infiere del reloj ni del marcador de Inicio. Al cambiar
fecha se actualiza el contexto en memoria; al abandonar/cambiar scope se descarta.

Cada sección incluye queriedDate (o all si no hay campo fecha), markerPresent (marcador
válido leído), status efectivo, contentVerified (null si falta), downloadedThroughPage,
pageSize, total y lastSuccessfulRefreshAt. Scope identificado por fingerprints existentes
de owner/contrato/AppView/entidades/campo fecha, más uniqueness/historyMode. No incorpora
valores de registros, nombres ni IDs crudos en las nuevas secciones. status se lee con
la validación existente: no equivale al status crudo almacenado de un marcador legacy.

homeDateSource=local_today y visibleDateSource=workflow_context; never_clock distinguen
los dos orígenes. visible_workflow exige coincidencia entre la ruta, la actividad y el
owner/contrato/AppView. Si faltan contexto o respuesta efectiva, o hay un scope anterior,
se informa availability=unavailable y visibleWarningExplanation=not_established;
expresamente el marcador de Inicio no explica el aviso visible. Si el scope es conocido
pero carece de marcador, se exporta su propia queriedDate con markerPresent=false y
status=absent, sin sustituirlo por otro día. Definiciones no cacheadas se distinguen de
marcadores ausentes. Attendance no publica este contexto ni entra en el colector de Inicio.

La prueba de latest no acredita todos los sujetos ni sus vigentes.
subjectsLastFullRefreshAt refleja únicamente la evidencia de hidratación previa de la
entidad fuente: subjectsAvailability=previous_full_refresh o unverified.
currentCompleteness=not_certified siempre, porque no existe un marcador que acredite
la totalidad de vigentes. No se infiere cobertura completa desde filas visibles.

Regresiones locales: wiring Inicio/workflow/helper, complete/partial y marcadores antiguos;
copia presente/ausente; distintas fechas de Inicio/selección con marcadores distintos;
texto del camino real del botón capturado en un destino clipboard de prueba; ausencia
de valores/PII y de escrituras al copiar; contexto ausente, fechas cambiadas, salida y
reportes tardíos; rechazo de owner/contrato/AppView/scope/type distintos; aislamiento de
Attendance y separación latest/sujetos/vigentes. SQLite real en memoria mediante harness
Python y singleton de producción. Las conexiones de componentes/botón se comprueban
estructuralmente; no se afirma una nueva prueba manual de navegador ni clipboard del SO.

La copia lee el marcador vigente al pulsar, no un marcador histórico congelado cuando
apareció el aviso. Preparación concurrente puede haberlo actualizado entre ambos instantes:
los metadatos exportados sirven para correlacionar, pero no prueban por sí solos la causa
del mensaje previo. Una definición o respuesta no disponible no se inventa ni se sustituye.

Validación final del lote aislado: 940 pruebas en 77 archivos con máximo dos workers
(17 regresiones propias); typecheck PASS; lint global PASS, 0 errores y las 2 advertencias
require preexistentes de records-sync.local-db-regression.test.ts:182/183; build web y
service worker PASS sin .env/.env.local; diff-check PASS. Árbol HEAD + 12 archivos/hunks
seleccionados, sin V11, diagnósticos independientes ni sus pruebas. Los bytes funcionales
coinciden con el workspace; las secciones documentales previas permanecen intactas.
Parche e inventario verificables conservados en
/home/dannysilver/dev2026/backups/state-update-coverage-close/2026-10-07/ fuera de /tmp.
No cambia preparación, paginación, descargas, persistencia, escrituras/outbox, conflictos,
sincronización, esquema, Core ni dependencias. El nuevo contexto sólo vive en memoria y
usa el ciclo de actividad existente. V11 pausado; sin producción, commit, push ni deploy.
La validación manual productiva tras 01b07b5 acredita lectura y persistencia tras reapertura
offline, no escrituras/sync ni cobertura completa. La causa del aviso productivo y la
causa primaria de Error finalizing statement siguen sin correlación concluyente.

## 2026-10-07 — Preparación de vigentes STATE_UPDATE, sin historial completo

Implementación local, sin commit/push/deploy: para `subject + append + dateFieldId`, prewarm recorre toda la lista origen preparada y consulta cada `subjectRecordId` con `pageSize=1`; persiste exclusivamente `subjects[].current` mediante el snapshot existente. Reutiliza el pool de cuatro por AppView. Un marcador SQLite v10 en `app_metadata`, separado de latest y con scope/configuración completos, sólo certifica current tras comprobar la fuente completa y la persistencia por sujeto; diferencia vigente, ausencia explícita, fallo y consulta no acreditada. El diagnóstico copia únicamente cantidades/metadatos del marcador.

Fixture local Core/PostgreSQL: 130 sujetos y 217 eventos. Primera apertura offline sin visita previa y cierre/reapertura de Chrome/OPFS con ambos servicios detenidos conservaron D0, V1, V115 y R1 (empate Fecha/ID); sujeto 129 sin versiones. Cache: 136 eventos distintos, 117 sujetos con evento, 13 sin versión. Current completo para 130; latest sigue parcial 20/217. El cierre corrigió el conteo anterior: 262 eventos de red CDP, pero una preparación `home` con 131 GET (uno global y 130 por sujeto), sin búsqueda online. El capturador no guardó el método HTTP; el doble conteo es compatible con los preflight CORS locales. El marcador de vigentes midió 4.968 ms en el entorno local, sin estimación productiva. No se alteraron triggers ni se descargó todo el historial.

Checks: 168 pruebas afectadas/8 archivos, máximo dos workers; typecheck, lint (0 errores, 2 warnings previos), export temporal web para CDP y diff-check aprobados. Fixture PostgreSQL propio eliminado, cero restantes. Contrato, inventario y límites en la nueva sección de `docs/STATE_UPDATE.md`; evidencia y parche incremental preservados fuera de /tmp en `backups/state-update-current-preparation/2026-10-07/`.

Ajuste DATE previo preservado por separado, igual que V11, diagnósticos y pendientes ajenos. Main y su HEAD siguen intactos; Core no se modificó. No se probó sincronización de escrituras productivas. La causa exacta del incidente productivo `Error finalizing statement` sigue sin correlación concluyente.

## 2026-10-07 — Cierre preparación de vigentes y DATE: BLOQUEADO

Candidato de 12 archivos/hunks delimitado, incluyendo DATE y excluyendo V11/pendientes independientes. Código funcional idéntico al ensayo Chrome/OPFS anterior; no se amplió implementación. Main/HEAD 9b8eff7fa291abef337afa38c53b05a273d0acc4 e índice intactos; Core sin cambios.

Se corrigió la interpretación de 262 eventos CDP: SQLite OPFS sintético conserva una preparación `home`; Core registra 137 GET del fixture, seis del benchmark y 131 de preparación (uno global + 130 por sujeto). El runner no repitió preparación online deliberadamente. El contador no guardó métodos/tipos; el doble conteo es compatible con preflight CORS entre los puertos locales, sin evidencia individual archivada de OPTIONS. Las repeticiones deliberadas de las regresiones unitarias son independientes. No se demostró duplicación automática ni se cambiaron disparadores. Los 4.968 ms de vigentes y 7.684 ms del run completo son mediciones locales, sin estimación productiva.

Checks del candidato aislado: **953 pruebas/78 archivos**, máximo dos workers, typecheck, lint (0 errores, 2 warnings previos), build web/SW y diff-check aprobados. Chrome/OPFS previo reutilizado sólo para fixture limpio, primera apertura y reapertura; no acredita compatibilidad de los nuevos escenarios de revisión.

**Bloqueo demostrado en revisión:** dos regresiones fuera del candidato fallan con SQLite real antes/después de reabrir: current remoto nulo conserva un vigente synced anterior visible; current remoto con fecha menor que un evento antiguo cacheado no gana offline. En ambos casos el marcador termina complete y contiene el resultado autoritativo correcto. El lector selecciona de todo el historial cacheado e ignora el resultado guardado por sujeto. Por tanto no se declara listo para publicar, aunque los checks generales pasen.

Propuesta mínima sin implementar: usar la autoridad persistida por sujeto para seleccionar el current remoto en su scope, preservando overlays pendientes/conflictos e historial. No borrar cachés, descargar todos los eventos ni cambiar esquema, criterio de Core o outbox. Detenido antes de ampliar la corrección. DATE permanece validado como ajuste visual separado.

Parche candidato/inventario verificables y evidencia del bloqueo en `backups/state-update-current-preparation-date-close/2026-10-07/`; `readyToPublish:false`. Detalle de archivos/hunks y causa en la última sección de STATE_UPDATE. Pendientes excluidos conservados byte a byte. V11 pausado y causa productiva exacta de Error finalizing statement todavía abierta. Sin producción, commit, push ni deploy.


## 2026-10-07 — Cierre final preparación/current offline/DATE: listo localmente

El bloqueo anterior queda resuelto dentro de los mismos doce archivos del lote. El lector honra la autoridad persistida y compatible por sujeto después del overlay pendiente/conflicto: evento exacto o null explícito. Fallo, ausencia o incompatibilidad mantienen el fallback conservador sin certificar complete. Valida referencias reales y fuente antes de acreditar cobertura; no reescribe marcadores ni elimina historial/outbox. Attendance, escrituras, esquema v10 y DATE preservados.

Las dos regresiones bloqueantes están integradas y pasan tras reabrir SQLite, junto con compatibilidad de marcadores, scope, referencias y pendientes/conflictos. Lote aislado: **966 pruebas/78 archivos**, máximo dos workers; typecheck, lint (0 errores, 2 warnings previos), build web/SW y diff-check PASS.

Chrome/OPFS con caché previa: Core local confirma V115 y null del sujeto 129; preparación home seguida de dos aperturas frías offline con cierre completo, servicios detenidos y mismo perfil intacto conserva ambos resultados. Los dos eventos obsoletos permanecen en historial: 138 filas, 130 resultados current verificados, 13 null; latest parcial 20/217. El primer intento de navegación dura encontró OPEN_FAILED / Invalid VFS state antes del lector; sin modificar código ni almacenamiento, cierre completo permitió validar las dos aperturas frías. Este impedimento de arranque queda separado y sin causa investigada.

Conteo corregido: **una preparación home, 131 GET** (global +130 por sujeto). Los 262 eventos anteriores no demostraban dos preparaciones y no archivaron métodos. La captura nueva sí distingue 131 GET/131 OPTIONS. Los 4.968 ms anteriores y 9.485 ms actuales son mediciones locales, sin estimación productiva. No se cambiaron disparadores.

Parche/inventario/hashes duraderos: backups/state-update-current-authority-close/2026-10-07/. Doce paths, excluidos V11 y pendientes independientes byte a byte. Fixture propio eliminado, procesos cerrados, perfiles conservados. Evidencia automatizada CDP, sin revisión manual nueva ni validación de escrituras productivas. Main/HEAD e índice preservados, Core sin cambios. Sin producción, commit/push/deploy. V11 pausado; causa exacta productiva Error finalizing statement sin correlación concluyente.

## 2026-10-09 — Attendance: diagnóstico de modificación offline, sin corrección

Recorrido local Core/PostgreSQL + Chrome/OPFS real: CAPACITACIÓN → PRESENTE online requiere confirmar overwrite con la versión del conflicto y pasa. Offline no muestra esa confirmación; conserva identidad/base/intención pero omite overwrite. Reconnect devuelve HTTP 200 CONFLICT / CURRENT_VALUE_DIFFERS con base exactamente igual a la versión remota, una intención y un intento. No se demostró pérdida de versión, confirmación aceptada o intervención de otro escritor. Contrato exige autorización explícita además de versión coincidente; propuesta mínima, no implementada, en docs/ATTENDANCE_OFFLINE_CONFLICT_DIAGNOSIS.md.

Sólo documentación y dos regresiones de handlers; 12 pruebas handlers, 18 sync y 3 overwrite Core PASS; typecheck/lint focalizado/diff-check PASS. Sin suite completa, build ni cambio funcional. Fixture propio eliminado y procesos cerrados; perfiles preservados. Pendientes ajenos intactos, V11 pausado; sin producción, commit/push/deploy. No se extrapola la rama local a producción sin su petición/respuesta.

## 2026-10-09 — Attendance: confirmación mínima del reemplazo offline

Cambio sólo en AttendanceWorkflow.tsx: modal existente antes de reemplazar offline un vigente remoto synced compatible; cancelar sin fila/outbox, aceptar con intención y base copiadas. La base explícita confirmada prevalece sobre la selección; guardias por scope/secuencia y selección offline protegen respuestas tardías. Persistencia atómica/sync existentes, sin cambios. No se autorizan operaciones antiguas ni conflictos por lectura; creación/mismo valor/pendientes conservan su recorrido.

Chrome/OPFS definitivo: CAPACITACIÓN online → aceptar PRESENTE offline → cerrar Chrome y detener ambos servicios → reabrir mismo perfil offline. Misma intención/autorización/base, cero intentos; al iniciar servicios/reconectar, UPDATED en la misma fila remota, una fila synced, cero pendientes. Control con lectura fresca y cambio remoto posterior: EXPECTED_UPDATED_AT_MISMATCH, intención/base conservadas y ambas versiones en conflicto; PostgreSQL conserva una sola fila con el valor remoto nuevo. Reapertura inicial con servicios vivos y control con selección vieja no se acreditan; detalles en ATTENDANCE_OFFLINE_CONFLICT_DIAGNOSIS.md.

49 pruebas focalizadas/4 archivos (incluidas 6 SQLite reales con reapertura/rollback/scopes y 15 handlers de caracterización/confirmación), máximo dos workers PASS. Dos regresiones fallan contra HEAD anterior y pasan corregidas. Typecheck/lint global/diff-check PASS, sólo dos warnings require previos. Export temporal final para CDP, sin suite completa/build global. Fixture propio eliminado, procesos cerrados, perfiles preservados. Core/API/esquema/dependencias y pendientes ajenos intactos; main/HEAD/índice sin publicación. V11 pausado; incidente productivo y auditoría general abiertos. Sin commit/push/deploy.


## 2026-10-10 — Cierre técnico de reemplazo Attendance: bloqueado

El candidato aislado comprende el renderer Attendance, sus dos archivos nuevos de regresiones y las secciones documentales de este reemplazo. No se modificó código funcional durante el cierre. Se añadieron tres regresiones de selección/persona y respuestas tardías. Suite completa aislada: 990 pruebas en 80 archivos, máximo dos workers; typecheck correcto, lint sin errores (dos advertencias preexistentes), build web correcto y diff-check correcto. El build emitió una advertencia no fatal de escritura del caché Metro temporal.

La revisión adicional detectó un bloqueo: después de confirmar offline un cambio remoto y reabrir SQLite, guardar otra vez el mismo valor pendiente pasa por saveStatus/saveEntry sin overwrite. La consolidación pierde overwrite=true y cambia la identidad idempotente, conservando fila y expectedUpdatedAt. Una regresión separada ejecuta los handlers reales y persistencia SQLite real con reapertura; falla al exigir que sobreviva la autorización de la misma intención. No forma parte de las 990 pruebas aprobadas. No se corrigió durante este cierre. El lote NO está listo para publicar. Falta preservar la autorización ya confirmada de una intención semánticamente idéntica, sin autorizar operaciones antiguas ni cambios diferentes.

Se reutiliza la evidencia previa Chrome/OPFS porque el renderer funcional es idéntico: Core local comprobó cancelación sin escritura, aceptación offline durable tras cierre/reapertura, sincronización en la misma fila sin duplicados y conflicto ante modificación remota posterior. Guards de persona/scope/respuestas tardías, rollback y operaciones antiguas se comprueban mediante pruebas automatizadas; el nuevo bloqueo sólo mediante handlers reales y SQLite, sin nuevo recorrido Chrome/Core. No acredita resolución del conflicto productivo ni cierre de la auditoría general. V11 continúa pausado.

Respaldo delimitado: /home/dannysilver/dev2026/backups/attendance-offline-replacement-close/2026-10-10/. Incluye parche candidato, inventario/hashes y regresión bloqueante separada. Pendientes ajenos conservados byte a byte. Sin cambios Core/API/esquema/dependencias/configuración, producción, commit, push o deploy.


## 2026-10-11 — Attendance: repetición de intención confirmada

Resuelto únicamente el bloqueo del cierre anterior. La regresión archivada se incorporó a src/lib/attendance-pending-authorization-review.test.ts y falló antes del cambio ejecutando saveStatus/saveEntry reales y SQLite con reapertura: overwrite desaparecía al consolidar un guardado ordinario; la comparación de identidad consideraba ese cambio una intención nueva.

Attendance lee la operación durable del registro dentro del usuario/contrato/entidad/AppView/persona/fecha. Compara todos los estados y extras con el normalizador de intenciones existente. Una intención confirmada idéntica vuelve a guardar con su base original; la persistencia comprueba nuevamente la equivalencia dentro de la transacción y retorna sin escribir fila/outbox. Conserva clientRequestId, overwrite, expectedUpdatedAt, intentos, errores y estado de envío. La opción interna preserveIdenticalConfirmedIntent se utiliza sólo en Attendance, update-current/subject-date, sin modificar contratos API ni otros workflows. No concede autorización a operaciones antiguas que carecen de ella.

Un cambio de estado o extras de un pendiente confirmado requiere nuevamente el modal existente, conservando la base de la intención anterior. Cancelar no escribe; aceptar crea una intención distinta explícitamente autorizada. Se mantienen guardias de scope/persona/secuencia/desmontaje y protección frente a respuestas tardías. No se refresca la base contra Core para evitar conflictos. El respaldo candidato de 2026-10-10 permanece intacto y describe el estado anterior bloqueado.

Evidencia automática: 180 pruebas afectadas / 6 archivos, máximo dos workers, PASS (50 handlers/persistencia/sync más 130 local-db/intenciones). La regresión integrada utiliza los handlers reales y SQLite en disco; verifica reapertura, comparación de extras, cancelación sin tocar ambas tablas, base e identidad, autorización explícita para contenido distinto, no reiniciar un envío en curso, operaciones antiguas y envío/conflicto posteriores. Typecheck PASS, lint sin errores con dos advertencias require preexistentes, diff-check PASS. Sin suite completa.

Evidencia Chrome/CDP automatizada, sin revisión manual: perfil exclusivo nuevo, SQLite OPFS real y Core/PostgreSQL exclusivamente locales; DATABASE_URL de .env.local validada como 127.0.0.1:5432/opco_development/opco_dev y pasada explícitamente. CAPACITACIÓN online → confirmar PRESENTE offline → cerrar Chrome y detener servicios → reabrir mismo perfil offline → volver a guardar PRESENTE: misma identidad/autorización/base, cero intentos. Cambiar a CAPACITACIÓN abre confirmación y cancelar conserva fila/outbox. Reiniciar servicios/reconectar devuelve UPDATED con la autorización/base originales, una sola fila remota con identidad inicial y cero pendientes. Control separado con consulta fresca: confirmar CAPACITACIÓN, cambiar después el remoto sintético y reconectar conserva CONFLICT, base/identidad local y ambas versiones. PostgreSQL confirma una sola fila remota.

Cambios de extras/cancelación, envío en curso y guardias de scope/respuestas tardías se acreditan por pruebas automatizadas, no por el recorrido Chrome nuevo. No se acreditan los intentos iniciales de login (CSP del servidor temporal sin API local), bloqueo de acceso exclusivo tras reintentos ni control que utilizaba selección antigua; se preservaron sus perfiles. No se amplió implementación a esos recorridos. Evidencia sanitizada: /tmp/opco-attendance-identical/evidence.json. Recursos PostgreSQL propios eliminados (cero restantes), procesos propios cerrados; perfiles sintéticos conservados, almacenamiento habitual intacto.

Archivos de esta corrección incremental: AttendanceWorkflow.tsx, local-db.ts, state-update-offline.ts, attendance-existing-offline-diagnosis.test.ts, nuevo attendance-pending-authorization-review.test.ts y estas secciones de ATTENDANCE_OFFLINE_CONFLICT_DIAGNOSIS.md/STATE_UPDATE.md/STATUS.md. El archivo attendance-offline-replacement.test.ts anterior sigue intacto. Pendientes excluidos preservados byte a byte. Main intacto, Core sin cambios. V11 pausado; conflicto productivo no autorizado/resuelto y auditoría general abierta. Sin producción, cambios de esquema/API/dependencias/configuración, commit, push o deploy.


## 2026-10-11 — Cierre técnico final Attendance

Candidato aislado desde main/HEAD 50937aff0d4abf27faf887dd2823e36c58039b4b: nueve archivos (tres de implementación, tres regresiones y tres documentos). Se incluye la confirmación offline y la conservación de intención idéntica tras reapertura; en STATE_UPDATE.md y STATUS.md sólo las secciones Attendance desde 2026-10-09. Se excluyen V11, OFFLINE_FIRST_AUDIT, caracterización independiente de conflictos, pruebas experimentales/diagnóstico de cobertura y los prefijos ajenos de los documentos compartidos. Todos conservados byte a byte, índice y HEAD intactos.

Suite completa aislada final: **998 pruebas / 81 archivos PASS**, máximo dos workers, 24,30 s. Typecheck PASS, lint cero errores y dos warnings require preexistentes, build web/SW PASS, diff-check PASS. Primera corrida conjunta con build: 977 PASS/21 timeouts en state-update-prewarm-current-investigation.test.ts y un EPIPE; reejecución focalizada 22/22 PASS y suite completa posterior 998/998 PASS, sin cambios de código/pruebas/timeouts/configuración entre corridas. La causa del fallo inicial no se demuestra; no se lo atribuye a Attendance ni se oculta ese límite.

Implementación idéntica byte a byte al export Chrome/OPFS del ensayo 2026-10-11 en los tres archivos funcionales; no se repitió navegador ni se crearon fixtures. Se reutiliza CDP automatizado con Core real/PostgreSQL local: cancelar sin escritura, aceptación durable, cierre completo con servicios detenidos, reapertura offline, guardado idéntico con identidad/autorización/base conservadas, cambio distinto y cancelación, reconexión UPDATED en misma fila sin duplicados/pendientes y control con lectura fresca/modificación remota posterior que conserva conflicto. Extras cambiados, envío en curso, rollback, scopes y respuestas tardías se acreditan con pruebas automatizadas, no con nueva revisión manual de navegador.

Diagnóstico productivo separado: una operación Attendance del 09-10-2026 en conflicto, retryCount=1; cero operaciones elegibles para autosync. Resumen global: dos conflictos; diferencia no explicada, sin prueba de duplicación. No se autoriza ni resuelve el conflicto productivo; no se investiga ese conteo en este cierre. Auditoría general abierta, V11 pausado.

Parche/inventario/hashes y evidencia sanitizada en /home/dannysilver/dev2026/backups/attendance-offline-replacement-close/2026-10-11/. Respaldo bloqueado anterior del 2026-10-10 intacto; este nuevo cierre lo sucede. El lote no contiene secretos, configuración local, logs, export/build, bases ni perfiles. Core/API/esquema/dependencias/configuración sin modificaciones. Sin producción, commit, push o deploy.

## 2026-10-11 — Requiere atención, alcance de presentación

La cabecera y el tab Problemas del diagnóstico existente presentan una proyección local por usuario/contrato que une fila y outbox vinculadas. El agregado anterior reproduce dos conflictos para una sola intención STATE_UPDATE; el diagnóstico productivo todavía carece de correlación suficiente para atribuirle exactamente esa causa. Se muestran metadatos cacheados disponibles, motivo comprensible y navegación al conflicto/fecha correctos sin enviar ni modificar intenciones; faltantes explícitos, sin búsquedas de etiquetas por red.

Lote: `_layout.tsx`, `app-diagnostics.ts` y su prueba, `local-db.ts`, nuevos `sync-attention.ts`/pruebas pura y SQLite, renderers Attendance/STATE_UPDATE y estas secciones en STATUS/STATE_UPDATE. 179 pruebas focalizadas/8 archivos, typecheck y lint correctos (dos warnings preexistentes); diff-check. CDP local escritorio/móvil con Core y OPFS acreditó acceso a handlers existentes y ausencia de cambios fila/outbox y de POST al navegar. No suite completa, publicación ni datos productivos. Evidencia de actualización tras resolver: regresión SQLite; sin resolución manual adicional. Un intento inicial bloqueado por exclusividad OPFS se mantiene como límite independiente. Pendientes excluidos preservados; V11 pausado.

## 2026-10-11 — Cierre técnico de Requiere atención

Candidato aislado desde main bc476384f96f1f5d3d905e3f60eb8dd2ba77e2ee: 12 archivos, con implementación, regresiones y únicamente las nuevas secciones Requiere atención de STATUS/STATE_UPDATE. Se excluyen byte a byte V11, OFFLINE_FIRST_AUDIT, caracterización independiente de conflictos, diagnóstico de cobertura, pruebas experimentales y todos los prefijos ajenos de documentos compartidos. Índice vacío; HEAD intacto. Inventario con rangos de hunks y hashes, parche y SHA256SUMS: /home/dannysilver/dev2026/backups/requires-attention-close/2026-10-11/.

Suite completa del candidato: **1007 pruebas / 83 archivos PASS**, máximo dos workers, 20,04 s. Typecheck PASS; lint cero errores, dos warnings require preexistentes; build web/service worker PASS; diff-check PASS. La primera corrida aislada pasó 1006 pruebas y falló una expectativa antigua que exigía un indicador no interactivo; se adaptó exclusivamente esa prueba al acceso mediante botón previsto en este lote, sin modificar implementación. Una invocación inicial en el árbol de trabajo fue interrumpida y no se acredita como validación del candidato.

La vinculación es owner_key + contract_id + entity_type_id + local_record_id/local_id; no usa persona ni fecha para deduplicar. Identidades locales distintas permanecen separadas aun con sujeto/fecha iguales (regresión pura). Los destinos conservan AppView/entidad y fecha lógica validada, con identidad local del conflicto; faltantes/incompatibilidades no inventan destino. Resolución y handlers existentes intactos. Navegar no escribe, reenvía ni autoriza; se reutiliza CDP Chrome/OPFS local escritorio y móvil porque todos los archivos funcionales permanecen idénticos al ensayo anterior. La actualización tras resolución sólo está acreditada mediante SQLite automatizado, no por acción manual en navegador; tampoco se acredita dispositivo móvil físico.

Mantener tres conclusiones separadas: doble conteo demostrado localmente, diferencia productiva todavía sin correlación concluyente y bloqueo exclusivo OPFS independiente. Sin nuevas pruebas de navegador, fixtures, cambios Core/API/esquema/dependencias/configuración, datos productivos ni publicación. Auditoría general abierta y V11 pausado.

## 2026-10-11 — Propuesta desktop, sin implementación

Revisión en main dfdeae0f7fdcdaddc823ab11eb307c5d98259ef1: breakpoint compartido de 900 px, gutter 20 px; cabecera con identidad/estado/acciones y menú de usuario, volver en experiencia; Inicio agrupado por Registros/Flujos/Análisis, con contexto y tarjetas. Las tarjetas wide usan flexBasis 260, flexGrow 1, maxWidth 360; el contenedor y contexto ocupan todo el ancho. No existe navegación lateral global con destinos adicionales: las experiencias ya son los destinos de Inicio, mientras Diagnóstico y sesión son acciones de cabecera.

Inspección visual local con Chrome/CDP en 1440×900, 1024×768 y 390×844, export existente y fixture sintético de seis experiencias (tres RECORDS y tres Attendance), un contrato y un usuario. El perfil cacheado anterior no permitió abrir Inicio por bloqueo exclusivo OPFS; se usó perfil nuevo y fixture temporal porque la caché existente no bastaba. API/Core/PostgreSQL sólo locales, guardia DATABASE_URL 127.0.0.1:5432/opco_development/opco_dev, destinos HTTPS bloqueados durante revisión. Capturas en /tmp/opco-desktop-review/; se inspeccionaron imágenes, no sólo texto DOM. Sin desbordamiento horizontal en esos tres tamaños. A 1440 el contexto ocupa 1400 px y cada tarjeta ~360, dejando ~300 px libres al final de cada grupo; a 1024 aparecen tres tarjetas de ~321 px y el título largo probado se parte en dos líneas. Móvil conserva una columna y scroll vertical; tres filas de cabecera para identidad/usuario/estado. El espacio inferior con seis experiencias no demuestra defecto: no se propone inflar tarjetas para llenar la altura.

Propuesta única para una implementación posterior: mismo shell Expo y componentes, sin sidebar. Desde 900 px, cabecera e Inicio alineados en contenedor centrado de máximo 1280 px incluyendo padding horizontal de 24 px; identidad/volver a la izquierda, estado en espacio central flexible, Diagnóstico/usuario a la derecha con ancho según contenido y nombres capaces de envolver sin tapar controles. Cabecera con padding vertical 12 px y controles de al menos 40–44 px; conservar títulos, acciones y handlers. Contexto permanece arriba en panel compacto de dos columnas, selección de contratos existente debajo con wrap, sin esconder datos ni convertirlo en navegación lateral. Grupos existentes más legibles (título 14 px, peso 700/800), separación entre grupos 20 px y retícula con gap 16 px: tres columnas iguales desde 1200, dos entre 900 y 1199, sin maxWidth individual que deje hueco al final; última fila conserva ancho de columna, no se estira para rellenar. A 1440: marco 1280, contenido 1232, tarjetas ~400; a 1024: contenido 976, tarjetas 480. Tarjetas mantienen icono, nombre, tipo y disponibilidad, padding 12 y mínimo 64 px, altura según texto y sin truncar advertencias. Por debajo de 900 preservar layout compacto actual: gutter 20, una columna, gap 10 y cabecera en sus tres filas; a 390, contenido 350 px. Aplicar el límite de ancho al contenido de Inicio, no imponerlo a tablas/renderers internos de experiencias.

Archivos/componentes previstos: src/lib/app-shell-layout.ts (tokens responsive), app/(app)/_layout.tsx (cabecera), app/(app)/index.tsx (HomeScreen/contexto/grupos/tarjetas), src/lib/app-diagnostics-layout.test.ts (regresiones de layout), src/lib/home-experiences.test.ts sólo si se necesita proteger agrupación/orden, y documentación STATUS. No modificar home-experiences.ts ni preparación/disponibilidad, session, API, SQLite, sync o renderers de workflow para esta propuesta. Mantener mecanismos Link/router y handlers existentes. No se añaden pantallas, destinos, iconos obligatorios, filtros ni dependencias.

Confirmación manual productiva aportada por el usuario: pulsar el estado superior abre Diagnóstico. La presentación y navegación de conflictos productivos siguen pendientes de verificación porque no había problemas visibles. Esto no valida resolución ni sincronización.

Límites: revisión del diseño actual, no validación de la propuesta implementada; datos sintéticos, sin prueba visual de múltiples contratos, grupo Análisis, nombres extremos, teclado/lector de pantalla ni dispositivo móvil físico. Se observó preparación en curso: no se acredita completitud, offline ni sincronización en esta revisión. Bloqueo OPFS sigue separado. Recursos sintéticos propios retirados; no se borra almacenamiento habitual. Sólo documentación modificada, pendientes ajenos preservados; sin suites/build nuevos ni commit/push/deploy. V11 pausado y auditoría general abierta.

## 2026-10-11 — Cabecera e Inicio responsive implementados localmente

En main dfdeae0f7fdcdaddc823ab11eb307c5d98259ef1, lote exclusivo de presentación: app/(app)/_layout.tsx (estilo de cabecera desktop), app/(app)/index.tsx (HomeScreen/retícula), src/lib/app-shell-layout.ts (tokens/cálculo), nuevo src/lib/app-shell-layout.test.ts y esta sección. Pendientes anteriores y propuesta documental preservados. Sin barra lateral ni nuevos destinos/componentes funcionales; mismos Link, keys, estados, handlers y efectos de datos.

Desde 900 px, cabecera e Inicio centrados con máximo 1280 incluyendo padding horizontal 24; Inicio usa dos columnas hasta 1199 y tres desde 1200, gap 16 y anchos iguales también en la última fila. Home mide su ancho útil mediante onLayout para contemplar scrollbar; la medición sólo modifica estado de presentación, no dependencias de carga/preparación. Cabecera desktop conserva sus tres áreas flexibles, padding vertical 12, estado/progreso centrales y Diagnóstico/usuario a la derecha; el nombre largo envuelve naturalmente sin ocultar acciones. Grupos desktop con gap 20 y título 14; alturas según contenido, sin truncar nombres ni avisos. Por debajo de 900 se mantienen gutter 20, una columna, gap 10, tipografía y cabecera compactas originales. El límite de ancho no está en shell.content/Stack ni en renderers: TABLE/PANEL/REPORT/workflows conservan su área y lógica; no se modificaron sus archivos.

Checks focalizados PASS: 64 pruebas / cinco archivos, máximo dos workers (layout responsive, diagnóstico/layout, agrupación Inicio, refresh de disponibilidad y feedback de cabecera), typecheck, lint (cero errores y dos warnings require preexistentes), git diff --check. No suite completa ni build de cierre; se generó únicamente export temporal para el ensayo visual local.

Evidencia real: Chrome/Chromium CDP, SQLite OPFS, Core/PostgreSQL locales con DATABASE_URL de .env.local validada como 127.0.0.1:5432/opco_development/opco_dev. Perfil exclusivo nuevo, fixture temporal de seis experiencias RECORDS/Attendance, nombre de usuario y títulos largos. Se inspeccionaron las capturas 1440×900, 1024×768, 390×844 y límites 899/900 y 1199/1200. Anchos observados sin scrollbar: 400, 480, 350, 859, 418, 567,5 y ~373,33 respectivamente; scrollbar también contemplado en las primeras capturas. Sin overflow horizontal ni superposición de áreas de cabecera. Progreso real 3/6 y avisos de disponibilidad capturados en los tres tamaños principales durante preparación; después se comprobó Requiere atención con conflicto exclusivamente sintético en los siete tamaños. No se cambiaron valores o avisos para simular disponibilidad en DOM.

Ensayo final de redimensionado: misma instancia montada del proveedor de sesión (fibra React/alternate), mismo singleton SQLite, filas/outbox idénticos, runId/prewarmStartedAt/trigger de preparación sin cambios y cero solicitudes API durante el recorrido de tamaños. Tab mostró :focus-visible y outline nativo; Enter abrió Diagnóstico desde el estado y una experiencia RECORDS desde la tarjeta. Input de la experiencia permaneció como el mismo nodo DOM al cambiar 1440/1024/390/1440, con cero solicitudes API por redimensionado; ancho observado de ese input ~1317 px en 1440, mayor que el contenido limitado de Inicio (1232). Volver a Inicio funcionó mediante la acción existente. Capturas/evidencia sanitizada del ensayo en /tmp/opco-responsive-implementation/, sin inclusión en el lote.

Límites: viewport móvil emulado, no dispositivo físico/lector de pantalla; sin revisión visual individual de TABLE/PANEL/REPORT, grupo Análisis o múltiples contratos. La protección de sus áreas se verifica por alcance del diff; el recorrido visual de experiencia se hizo con RECORDS. La navegación offline sintética no acredita nueva auditoría de persistencia/sync. Fallos iniciales del script de comprobación (serialización de referencias y posición previa de foco) no se acreditan como éxitos y se corrigieron sólo en el script temporal, sin cambiar handlers. Conflicto fixture generado con los mecanismos existentes sólo para presentar el estado, no se resolvió conflicto productivo. Se mantiene la confirmación manual productiva anterior: pulsar estado abre Diagnóstico; presentación/navegación de conflictos productivos todavía pendientes. Bloqueo OPFS independiente, V11 pausado y auditoría general abierta.

Fixture sintético propio retirado y procesos propios cerrados; perfiles de prueba conservados sin borrar almacenamiento habitual. Sin Core/API/SQLite/esquema/dependencias/configuración, datos productivos, commit/push/deploy.

## 2026-10-11 — Cierre técnico responsive de cabecera e Inicio

Candidato aislado desde main dfdeae0f7fdcdaddc823ab11eb307c5d98259ef1: cinco archivos, únicamente _layout.tsx, index.tsx, app-shell-layout.ts, nuevo app-shell-layout.test.ts y las secciones propias de propuesta/implementación/cierre responsive en STATUS. Los demás prefijos documentales, OFFLINE_FIRST_AUDIT, STATE_UPDATE, pruebas de caracterización/diagnóstico independientes y experimentos V11 quedan fuera y se preservan byte a byte. Índice vacío, HEAD intacto.

Suite completa aislada PASS: **1015 pruebas / 84 archivos**, máximo dos workers, 17,99 s. Typecheck PASS; lint cero errores y dos warnings require preexistentes; build web/service worker PASS, sin .env local y con API https://web.opco.cl para el export del candidato. git diff --check y comprobación estricta de whitespace del parche PASS. El parche reconstruye exactamente los cinco archivos cuyos hashes acredita el inventario. Sin suite/build repetidos tras añadir sólo esta sección documental.

Implementación funcional idéntica durante el cierre: se reutilizan capturas reales y ensayo CDP previo de redimensionado, sin nuevo navegador, fixture ni conexión Core/PostgreSQL. El contenido limitado a 1280 es Inicio; la cabecera desktop también se alinea a ese marco, pero shell.content/Stack y áreas de experiencias no reciben maxWidth. No hay cambios de handlers, keys de grupos/tarjetas, renderers, sesión ni efectos de carga; onLayout sólo mantiene la medida de presentación. Evidencia previa: misma sesión/SQLite, run de preparación intacto, filas/outbox idénticos y cero solicitudes al cambiar ancho; mismo input de experiencia y cero solicitudes dentro de ella, regreso a Inicio y teclado/foco disponibles.

Respaldo duradero: /home/dannysilver/dev2026/backups/responsive-home-header-close/2026-10-11/, con parche, inventario de archivos/hunks/hashes, SHA256SUMS y once capturas locales inspeccionadas que contienen exclusivamente etiquetas y datos sintéticos (sin credenciales ni datos personales reales). Las capturas se conservan por autorización explícita de este cierre; no se copian logs, bases, perfiles, credenciales ni otros diagnósticos/artefactos rechazados previamente. Las imágenes no forman parte del parche publicable.

Límites: esta etapa adapta cabecera e Inicio; TABLE/PANEL/REPORT/workflows todavía no recibieron un rediseño desktop. El recorrido visual interior fue RECORDS, no todos los renderers. Móvil es viewport emulado; sin dispositivo físico/lector de pantalla ni prueba visual de múltiples contratos/Análisis. La diferencia productiva de conflictos sin correlación y el bloqueo OPFS siguen independientes; auditoría general abierta. Sin ampliación de implementación, Core/datos/API/esquema/configuración/sincronización, commit/push/deploy. V11 pausado.


## 2026-10-12 — Shell desktop, Inicio y Asistencia implementados localmente

Alcance basado en la propuesta aprobada `design/proposals/desktop-home-attendance`, paleta azul.
Barra sólo Inicio/categorías presentes, Opco/organización/selector compacto con nombres completos;
experiencias en el cuerpo, categoría activa dentro de la experiencia y rutas existentes conservadas.
224 px de barra entre 900–1199, 264 desde 1200; móvil debajo de 900 mantiene bloque de contratos,
grupos y colores compactos anteriores. Inicio máximo 1280 exclusivo, dos/tres columnas y grupos
unitarios compartiendo fila. Header conserva sincronización/progreso/Diagnóstico/usuario/volver.
Otros renderers reciben el espacio restante, sin recolor ni rediseño internos.

Asistencia: búsqueda 560, formulario 640, controles 800; resultados/registros del día en filas
horizontales de ancho útil con nombre/estado alineados, separadores, hover/foco, sin tarjetas.
Formulario/acciones con alturas naturales y wrap. Un Stack y una experiencia, mismos handlers;
comparación AST confirma ocho handlers Attendance idénticos a HEAD. Ningún cambio en Session,
Core/API/persistencia/outbox/sincronización/esquema/dependencias/configuración. Catálogo lateral
proyectado de la caché autorizada por usuario/contrato y publicación de los datos ya cargados en
Inicio, sin nuevas solicitudes API. Las respuestas tardías de catálogo se protegen por scope y
generación. El selector usa el handler existente de contrato y regresa a Inicio.

Checks afectados: 110 pruebas / 13 archivos, máximo dos workers, typecheck PASS, lint PASS
(dos warnings previos de require en records-sync.local-db-regression.test.ts), diff-check PASS.
Sin suite completa. Export web local para Chrome/OPFS, artefactos y perfiles fuera del repositorio.
Perfil exclusivo, CDP directo, sin Playwright; capturas reales 1440×900, 1024×768 y 390×844,
límites 899/900 y 1199/1200 sin overflow global. Nombres largos, selector completo/Enter/Escape,
foco/hover, categorías, contrato activo y segundo contrato con catálogo aislado comprobados.
Cero API por seleccionar categoría y por resize con observación editada; siete anchos conservan
valor, y ensayo suplementario conserva la misma instancia coordinada SQLite. Atrás/adelante y
PANEL con tabla real PASS; RECORDS/REPORT conservan su presentación y área disponible.

Core/PostgreSQL únicamente locales: DATABASE_URL de .env.local validada como
127.0.0.1:5432/opco_development/opco_dev, pasada explícitamente al proceso. OPFS real con
crossOriginIsolated=true. Sólo API 127.0.0.1:19640 en las solicitudes del navegador. Fixture propio:
dos contratos, tres personas, campos/estados sintéticos. CAPACITACIÓN online → PRESENTE offline
con confirmación, cancelación sin nueva intención, aceptación con overwrite/base durable,
lectura offline y reconexión: misma fila remota, sin duplicados, cero pendientes/conflictos.
Las pruebas de reapertura y respuestas tardías son automáticas; no se equiparan al ensayo visual.

Límite independiente: STATE_UPDATE navega y conserva categoría/ancho, pero al compartir el destino
con Attendance en este fixture mostró Error finalizing statement y preparación incompleta.
No se certifica esa lectura, no se capturó la sentencia/causa SQLite primaria aquí y no se atribuye
al incidente productivo. Sin ampliar corrección de persistencia. Un perfil temporal restauró otra
pestaña propia y activó ACCESS_HANDLE_BUSY; se cerró sólo la extra y se usó Reintentar; un retry
posterior falló al abrir ese perfil, conservado sin reset. Perfil exclusivo nuevo completó el
ensayo final. Los problemas iniciales de URL local/CSP del export y calculatedFields del fixture
PANEL se corrigieron sólo en procesos/configuración sintética. Fallos de scripts DOM/fecha/SQL
no son acreditados como fallos funcionales de la aplicación.

Detalle, inventario y límites: docs/DESKTOP_INTERFACE.md y
`design/validation/desktop-implementation-2026-10-12/`, capturas reales y visor comparativo estático
contra el prototipo. Propuesta y documentación previa preservadas byte a byte, salvo esta adición.
Pendientes excluidos y Core se verifican al entregar. No validación con dispositivo físico, lector
de pantalla o usuarios nuevos. Otros renderers requieren su propio diseño desktop; cierre aislado
y suite completa pendientes. Sin commit/push/deploy; V11 pausado, auditoría/incidentes abiertos.

Control real adicional Attendance: tras una intención CAPACITACIÓN confirmada offline, un escritor
controlado de Core local modificó la misma fila a AUSENTE. Reconectar retuvo un conflicto y la
intención; ambas versiones/acciones visibles a 1440/1024. Diagnóstico → Problemas → Revisar conflicto
volvió a AppView/fecha/registro seleccionado correctos, fingerprint durable del outbox intacto
(identidad, payload y attempts). Sólo después se pulsó Usar Opco sobre el fixture: una fila vinculada,
cero conflictos y cero pendientes. No resolución automática ni actuación productiva. Selección del
contrato real con fondo #E8EFFA y texto #202B3A en bundle final comprobada.

Borde de enlaces directos: use-app-view.ts publica también el catálogo completo que ya recibe
(caché/remoto), sin nuevas peticiones, conservando su cancelación original. Tres regresiones del
hook con cargador real comprueban API única, fallback y no publicar respuestas tardías. El bundle
final se abrió directamente desde sesión/OPFS propios conservados, con Core apagado/API bloqueada;
Flujos activa y sin overflow. No es un nuevo ensayo online de Core. Una muestra inicial de resize
en ese arranque registró tres solicitudes sin aislar el trabajo pendiente; se conserva sin atribuir
causa. El ensayo Core previo conserva los mismos handlers/estilos de Attendance.

Control final de enlace directo/caché: después de ventana quieta de 2 s, se mantuvo el ancho fijo
10 s. Allí aparecieron las mismas tres solicitudes (/me, catálogo, Attendance), sin resize. La
secuencia posterior de siete tamaños produjo cero solicitudes y ningún overflow, conservando
Flujos activa y OPFS real. Se archivan las muestras anteriores, sin atribuirles causa ni cambiar
sesión/sincronización. Candidato final: 110 tests / 13 archivos PASS, typecheck/lint/diff-check PASS.

Limpieza: cero entidades del fixture propio restantes; Chrome/Client/Core propios detenidos,
ningún reset de caché/SQLite/outbox/perfil habitual. Galería estática de revisión únicamente:
http://127.0.0.1:19647/validation/desktop-implementation-2026-10-12/.
Inventario: 15 archivos de implementación/pruebas/documentación, más evidencia visual separada;
STATUS sólo se amplía al final. Fuente/prototipo y 225 pendientes excluidos verificados por hash.
No lote aislado/full suite ni publicación en esta etapa. V11 y auditoría permanecen como estaban.


### 2026-10-12 — Cierre técnico desktop, sin publicación

Lote aislado de 15 archivos: shell/Inicio/Attendance desktop, catálogo lateral de lectura,
paleta azul, cuatro regresiones, declaraciones de prueba y DESKTOP_INTERFACE/este apéndice.
STATUS anterior (232753 bytes), prototipo, V11, diagnósticos y documentación ajena excluidos.
Parche/inventario/SHA256 y comparación: `design/validation/desktop-technical-close-2026-10-12/`.

Suite completa con máximo dos workers: 1033 PASS / 88 archivos, 28,14 s. Primera ejecución:
1031 PASS, dos timeouts de 5000 ms en pruebas SQLite de null autoritativo y write EPIPE;
causa no demostrada. Repetición completa sin build/export concurrentes PASS, sin omitir pruebas,
cambiar timeouts ni configuración. Typecheck PASS; lint PASS (dos advertencias require existentes);
npm run build web + service worker PASS; diff/reconstrucción PASS. Artefactos sólo temporales.

Contraste real HEAD 7fc76dc y candidato: perfiles exclusivos y bases SQLite OPFS independientes;
Core idéntico y mismo fixture PostgreSQL local, restaurado secuencialmente sólo en sus eventos propios.
DATABASE_URL .env.local validada 127.0.0.1:5432/opco_development como opco_dev y pasada explícitamente.
Tres sujetos/dos contratos/ocho vistas; Attendance y STATE_UPDATE comparten entidades. En ambos:
CAPACITACIÓN online → PRESENTE confirmado offline → reconectar → Home → STATE_UPDATE.
Attendance acaba con una fila vinculada y cero pendientes; STATE_UPDATE muestra Error finalizing
statement en ambos. Error reproducido preexistente al lote, sin causa SQLite primaria ni correlación
productiva acreditada. No se certifica lectura STATE_UPDATE; ninguna corrección de persistencia.

Contenido funcional final idéntico: evidencia visual/móvil/resize anterior reutilizada. Comprobación
adicional del candidato aislado con Core: categorías, atrás/adelante, enlace directo RECORDS,
contrato correcto y aislamiento del catálogo. Otros renderers reciben espacio, no rediseño interno.
259 pendientes excluidos verificados por SHA256 y prefijo anterior STATUS intacto; Core limpio.
Lote listo para revisión de publicación, no publicado. Límites/desglose en DESKTOP_INTERFACE.
Fallo STATE_UPDATE y apertura OPFS previa siguen separados y abiertos; auditoría general abierta.
Sin producción, commit, push/deploy ni cambios API/esquema/config/dependencias. V11 pausado.

### 2026-10-12 — Integración local del runtime STATE_UPDATE compartido en SQLite v10

**Integrado y validado localmente; NO publicable.** Se mantiene el bloqueo de coexistencia con
Client publicado 49913c3e84aeaa0c15138508269b70b9c408caac. V11 pausado; ningún commit/push/deploy,
cambio de Core/API/esquema/dependencias ni acceso productivo.

- Identidad remota compartida y snapshots separados por AppView/configuración en app_metadata.
  Lectores, getCachedRecord scoped, resolución de relaciones, hidratación, confirmación y
  restauración están adaptados conjuntamente. No se ocupa una segunda fila física con el mismo
  server_id; el UNIQUE y SCHEMA_VERSION=10 permanecen intactos.
- Intenciones/recibos conservan su identidad durable y referencia lógica. Append, claves
  idempotentes, overwrite/base, pendientes/conflictos y RECORDS están protegidos. Envío y
  respuestas tardías comprueban que la intención seleccionada sigue siendo actual y pertenece
  al scope. Cancelaciones y acciones de Attendance conservan sus handlers existentes.
- La hidratación Attendance conserva todos los IDs de latest, incluso para igual persona/fecha,
  y respeta el current autoritativo; el resumen no lo sustituye por otro ID. La regresión real
  del adaptador anterior conservaba sólo uno de dos eventos; ahora conserva ambos tras reapertura.
- ACK no acredita contenido completo; autoridades/cobertura afectadas se invalidan. Una
  representación sparse no elimina contenido recibido de la misma versión; Attendance conserva
  Observación de current aunque latest la omita. No se inventan campos ni se amplían descargas.
- Regresión real contra HEAD 49913c3: hidratar el mismo evento en dos AppViews falla con SQLite
  UNIQUE (owner/contract/entity/server_id). El mismo caso pasa en el candidato, sin cambio de esquema.

Checks afectados: 275 pruebas en 19 archivos; 22 de preparación y 23 de resolución seleccionada
(320 en total), máximo dos workers; typecheck PASS, lint PASS con cuatro warnings (dos helpers que
quedaron sin uso y dos require preexistentes en pruebas RECORDS), git diff --check PASS. No suite
completa. Export aislado exclusivamente necesario para OPFS, sin build/publicación productiva.
Las dos caracterizaciones históricas que esperan la colisión UNIQUE y el archivo diagnóstico
independiente siguen intactos/excluidos; no se presenta su resultado como suite completa verde.
Se registran las ejecuciones anteriores con timeouts/EPIPE, sin causa atribuida ni resultados ocultos.

Core real: DATABASE_URL leída de .env.local, validada exclusivamente como
127.0.0.1:5432/opco_development/opco_dev y pasada explícitamente. Fixture propio: tres sujetos,
un evento remoto, dos vistas principales y una Attendance de control con fila física v10 anterior.
La Observación del fixture se corrigió a TEXTAREA, exigido por Core; no cambió el esquema.
Chrome/OPFS real con perfil exclusivo y export de fuentes funcionales idénticas al candidato:

- Attendance→STATE_UPDATE y orden inverso, sin colisión ni duplicar el evento remoto.
- PRESENTE confirmado offline, cierre/reapertura con identidad/autorización/base intactas;
  reconexión automática actualiza la misma fila Core, sin duplicados ni outbox seleccionada.
- Cambio remoto posterior produce conflicto real y conserva ambas versiones/intención. En el
  bundle final, “Usar Opco” por UI restaura sólo ese cambio y conserva byte a byte el conflicto
  de otra AppView, incluso ligado físicamente al mismo ID remoto.
- Preparación exitosa mediante mecanismo existente y comprobación autoritativa por sujeto:
  lectores Attendance/generic coinciden con Core. Último cierre completo y reapertura offline,
  con Core y servidor web detenidos: ambos lectores y pantallas visibles conservan datos,
  sin Error finalizing statement, schema 10 e integrity_check=ok.

Límites separados: un ensayo prolongado/reintentado dejó 28.391 lecturas en cola y ocho pantallas
Attendance retenidas; causa todavía no demostrada, sin corrección añadida. Tras interrumpirlo había
una definición generic kind=error y no se acreditó esa lectura; preparación exitosa posterior sí
recuperó una configuración válida. Chrome también restauró dos páginas y produjo ACCESS_HANDLE_BUSY;
se cerraron exclusivamente páginas propias y se comprobó reapertura de una sola página, sin borrar
la base. ACCESS_HANDLE_BUSY/Invalid VFS state no son barreras de seguridad ni solución de coexistencia.
Hubo ajustes del arnés (viewport, CSP local, campos de fixture, inputs ocultos retenidos por Expo y
espera del owner real) registrados en la evidencia; no son cambios funcionales del producto.

Un export de prueba se generó accidentalmente en dist ignorado del repositorio; quedó fuera del lote.
No se afirma conservación byte a byte de un dist previo no inventariado. Los pendientes inventariados
sí se verifican mediante hashes, incluidas secciones ajenas de documentación y experimentos V11.
Evidencia sanitizada, inventario y parche del delta propio:
`design/validation/state-update-v10-runtime-local-2026-10-12/`.

La causa productiva exacta de Error finalizing statement y la auditoría offline general siguen abiertas.
El segundo fixture verifica dos eventos por persona/fecha: Attendance mantiene B según Core,
STATE_UPDATE mantiene A según Fecha/ID; ambas AppViews conservan ambos eventos. La confirmación
offline de B y reapertura conservan autorización/base. La cobertura Attendance permanece parcial
si un resumen omite Observación; no se descarga contenido adicional ni se certifica esa ausencia.
La limpieza elimina únicamente fixtures, credenciales temporales, instrumentación y procesos propios;
no toca almacenamiento habitual ni conflictos productivos.

Cierre del límite de lectura (13-10): el SQL interno reutiliza normalizePreparedAppViewDefinition,
como el getter público. Una definición histórica uniqueness={mode:"subject-date"} conserva lectura
por AppView/fecha tras reapertura; valores desconocidos siguen como configuración inválida. Regresión
falla antes y pasa después. Control OPFS final con cache sintética histórica (sin Core/ACK): positivo,
fecha distinta ausente, snapshots sin cambios, unknown controlado e integrity=ok tras reapertura.
Los casos Core reales anteriores usan definiciones normalizadas; este último ajuste no cambia sus
valores/scope, y su evidencia se distingue de la simulación de cache histórica.

#### 2026-10-13 — Cierre técnico aislado del candidato v10 (NO PUBLICABLE)

Reconstrucción exacta desde runtime-v10-local.patch/inventory del respaldo del 12-10,
sobre HEAD 49913c3e84aeaa0c15138508269b70b9c408caac. No cambió código funcional ni pruebas
publicables en este cierre; sólo esta documentación y evidencia sanitizada nueva.

- Primera suite completa, máximo dos workers: 1016 PASS, 36 FAIL /1052, 89 archivos;
  15 fallos local-db.test.ts y 21 timeouts en prewarm-current, más un EPIPE del arnés.
  Se inició junto a typecheck/lint/build; no se atribuye causalidad a esa concurrencia.
- Repetición completa sin otros checks concurrentes: 1037 PASS, 15 FAIL /1052,
  88 archivos PASS/1 FAIL, sin timeouts ni EPIPE. Prewarm aislado: 22/22 PASS.
  local-db.test.ts en HEAD: 96/96 PASS; candidato: 81/96 PASS. Hay expectativas de
  SQL/filas físicas/reconciliación anteriores y mocks sin la nueva identidad/precondición.
  No se descartaron ni editaron esas pruebas. Queda bloqueado el cierre verde hasta
  revisar los 15 casos/adaptar su contrato sin debilitar garantías; no se los declara
  inocuos ni evidencia suficiente de un defecto funcional específico.
- Typecheck PASS; lint PASS con cuatro warnings; build web PASS; diff-check PASS.
  Nuevas: configuredSnapshotDateSql (local-db.ts:4470) y
  markStateUpdateSyncDiagnosticsReconciledFromSnapshot (:5872), sin uso.
  Preexistentes: no-require-imports en records-sync.local-db-regression.test.ts:182/183;
  lint del HEAD aislado confirma exactamente esas dos. No se limpian helpers en este cierre.

Cola: sonda exclusiva con funciones reales y SQLite Python, API sintética de 130 sujetos/217
eventos, dos preparaciones completas y una interrumpida: al retornar, active=null y
waitingTotal=0; durante dos esperas de 200 ms no se generaron nuevas operaciones. La
interrupción conserva current coverage parcial. Otra sonda, cuatro hidrataciones repetidas
de dos AppViews y 500 lecturas detrás de una operación retenida deliberadamente, drena a
cero y permanece sin actividad nueva 500 ms después. Son controles de cola/transitoriedad,
no reproducción de los ocho componentes retenidos en Chrome. La evidencia OPFS anterior
prepare-final registra preparación terminada/cola=0 y reaperturas posteriores también=0.
El ensayo de 28.391 lecturas se interrumpió: no hay seguimiento temporal que demuestre
su drenaje, bloqueo permanente o generación indefinida. Su disparador permanece sin
correlación; no se declara resuelto ni se añade una corrección.

Escenarios funcionales Core/Chrome anteriores reutilizados sólo por identidad SHA256
de las diez fuentes funcionales. No se repitió navegador. Snapshots en ambas AppViews,
reapertura, ACK real, Usar Opco y conservación de conflictos ajenos siguen acreditados
en los escenarios documentados; no implican compatibilidad con runtime antiguo.

Bloqueos separados: compatibilidad con Client 49913c3 sigue pendiente; cierre de suite
completa tiene 15 fallos; ensayo UI de crecimiento de cola sin explicación concluyente.
Incidente productivo Error finalizing statement sigue sin correlación exacta. V11 pausado.
Respaldo final verificable: design/validation/state-update-v10-technical-close-2026-10-13/.
Sin Core/API/esquema/dependencias/configuración/datos productivos, commit, push ni deploy.

#### 2026-10-13 — Resolución acotada de los 15 fallos local-db del candidato v10

Los 96 casos de local-db.test.ts quedan conservados y pasan; sus garantías se revisaron
contra HEAD 49913c3. Dos fallos revelaron regresión real: la hidratación ya no reparaba
una huérfana confirmada ni completaba/reconciliaba una intención update-current que
coincidía exactamente con current. Las comprobaciones nuevas con SQLite real fallan
2/2 sobre el candidato previo y pasan con la corrección. Se restituye sólo en el scope
owner/contract/entity/AppView/configuración/sujeto/fecha; current es autoritativo, no
se infiere confirmación desde latest. Coincidencia usa el comparador semántico existente.
Se exige identidad actual de fila/outbox/request, IDs remotos conocidos compatibles y
valores/extras exactos. Append/none, conflictos, otros scopes o contenido distinto se
preservan. No se añade overwrite ni se cambia versión base para evitar un conflicto.

Los restantes trece casos se adaptan sin eliminar pruebas: dos coordinador (resultado
con metadatos nuevos); dos limpieza (proyecciones/manifiestos, no borrar filas compartidas);
tres ACK (fila/outbox durables reales y lectura del recibo/estados); tres conflicto
(estado público, ambas versiones y rollback real de fila/outbox/metadatos); tres latest
(paginación/orden/fecha sobre datos reales, sin totales SQL inventados). Se verifica
reapertura e integridad. Cuatro regresiones adicionales protegen aislamiento/append,
ID remoto distinto, rollback de reconciliación/autorización y conflicto update-current.

configuredSnapshotDateSql retirado. El helper de telemetría vuelve a usarse para preservar
reconciled_success; no es código muerto. Retirado el mock de intención que ya no usa
ningún caso. Lint conserva sólo los dos require preexistentes de RECORDS.

Validación afectada: 118/118 (local-db 96, runtime 22); suite completa aislada, máximo
dos workers: 1056/1056 en 89 archivos. Typecheck/lint/build/diff-check PASS. El build
usa EXPO_ROUTER_APP_ROOT explícito por el node_modules enlazado del aislamiento; se
verifica que el bundle contiene las rutas/SQLite, no sólo un shell vacío. No cambia
configuración del repositorio. Evidencia y hashes del candidato final en
design/validation/state-update-v10-local-db-failures-close-2026-10-13/.

Chrome/OPFS repetido para el código modificado: recuperación de huérfana, confirmación
exacta tras timeout simulado, rollback de recibo y conflicto ajeno intacto. Datos/DTO
sintéticos por funciones reales; NO Core real/ACK/red/sincronización nuevos. Cierre
completo y reapertura offline con servidor detenido: persisten recibos y conflicto,
schema=10/integrity=ok. Chrome restauró dos páginas: una ready y otra ACCESS_HANDLE_BUSY;
se cerró sólo la fallida y se verificó la restaurada. No se borró almacenamiento.
La evidencia Core anterior es histórica: no se presenta como repetida ni como código
funcional idéntico. Cola de 28.391 y coexistencia antigua no se investigaron aquí.

Límite del arnés: primer export sin rutas descartado; intento export accidental en dist
ignorado del workspace, excluido del lote, sin afirmar su conservación byte a byte.
El ensayo before inicialmente lanzado en cwd equivocado se descartó; el before válido
es el candidato reconstruido anterior y falla 2/2. Hubo correcciones de fixtures de
prueba (propiedades públicas de conflicto/fecha de scope) y ws existente para Node20.
No son cambios funcionales ni se atribuyen a Core.

Cierre técnico verde; publicación aún BLOQUEADA por compatibilidad con runtimes anteriores.
Incidente productivo sin correlación exacta y auditoría offline general abiertos.
322 pendientes originales preservados por hashes; respaldos previos intactos.
Sin Core/producción/API/esquema/dependencias/migraciones, commit, push ni deploy; V11 pausado.

El último export limpio se hizo con caché Metro reconstruida: se comprobó ausencia de
__v10Fix15, presencia de rutas/SQLite y build npm completo. El primer build de cierre
había reutilizado contexto Metro del arnés y fue descartado; no se lo usa como build
final. Se retiró la instrumentación del dist ignorado mediante el export limpio,
sin afirmar que se restauró su contenido previo no inventariado.

#### 2026-10-13 — Corte controlado sin transferencia: un usuario, computador e iPhone

El usuario confirmó que es el único usuario, tiene un computador y una PWA iPhone y
renuncia voluntariamente a TODOS los cambios/conflictos/snapshots/pendientes locales de
ambos. NO renuncia a datos remotos de Core. Esto elimina el requisito de handoff/importación
antigua que bloqueaba el plan anterior, sólo para este corte conocido. No declara
compatibilidad general con runtimes antiguos ni soporte multi-tab.

Cambio mínimo: LOCAL_DATABASE_NAME=opco-client-v10-epoch2.db para apertura, recuperación
y reset confirmado. Schema/version10/índice/runtime integrado sin cambios. No abre,
copia, reconcilia, sincroniza o elimina opco-client.db. La base anterior queda abandonada
en disco; tampoco se borra ahora almacenamiento real de ningún dispositivo. Mantener
constante el nombre nuevo en builds compatibles. Cambio de generación requiere documento
nuevo/cierre completo, no Fast Refresh con una conexión anterior retenida.

Identificación de sólo lectura en Diagnóstico > PWA y en ingreso web antes de autenticarse:
Base local del runtime y Bundle de esta pagina. El nombre de entrada se lee del documento,
no del service worker; URL query/valores de registros no se muestran. Si no existe o es
ambiguo se declara no disponible. No hay peticiones, auth, nuevas conexiones o handlers
de negocio por esas etiquetas. Ingreso web muestra metadatos para verificar antes de
permitir API; login/selección de organización/acciones permanecen como estaban.

Core/PostgreSQL sólo local: DATABASE_URL de .env.local validada explícitamente como
127.0.0.1:5432/opco_development/opco_dev y pasada a procesos. Fixture propio con una persona
TOLVA, dos WORKFLOW (Attendance y STATE_UPDATE append/subject con Fecha) compartiendo
un evento CAPACITACIÓN; status/fecha/relation configurados, sin Observación opcional.
Prisma sólo para fixture, POST real para evento y sync; sin cambios/migraciones Core.
Diferencias respecto de producción: 1 sujeto/1 evento, datos sintéticos y defaultPRESENTE
conocido; producción no se infiere. Token nativo/Bearer del arnés, no login PWA real de iPhone.

Chrome/OPFS mismo perfil exclusivo:
- Old49913c3 usa ./opco-client.db, marcador y pendiente sintético abandonable.
- Tras cerrar TODOS los contextos, candidato usa ./opco-client-v10-epoch2.db; antes de
  preparación: filas=0,outbox=0,marcador anterior ausente. Prewarm existente desde Core
  prepara ambas vistas, ~3104 ms locales, sin visita previa a experiencias. Snapshot
  genérico conserva estado/versión semilla Core; identidad se verifica mediante serverId,
  no comparando alias local de current con ID remoto. Latest/cobertura mantienen políticas.
- Lectura offline, guardado confirmado mediante store real (autorización explícita del
  arnés, no nuevo clic UI), cierre/reapertura: PRESENTE, request/base/overwrite conservados.
- Control secuencial antiguo, carga explícita del bundle499 con SW bypass/API bloqueada:
  escribe sólo base antigua. Al reabrir candidato offline, fingerprint lógico de TODOS
  filas/outbox/metadatos de base nueva idéntico. Es control de aislamiento, NO rollback
  ni ruta normal de actualización.
- Reconexión con motor/API/Core reales: attempted1/completed1/failed0/conflicts0, misma
  fila remota, total1,sin outbox. Última reapertura offline conserva PRESENTE, integrity=ok,
  schema10,marcador legacy ausente. Ambas bases sólo sintéticas propias de prueba.
- Intento concurrente old/new produjo ACCESS_HANDLE_BUSY; no cuenta como protección.
  Corte manual exige un contexto a la vez y cierre completo. Invalid VFS state no se usa.
- Export limpio sin hook: a390×844, API bloqueada/Core detenido, etiquetas de identidad
  visibles antes de login, bundle real correcto, sin overflow. NO iPhone físico/Safari probado.

Errores de arnés conservados: seed leyó data.results en respuesta cruda single result;
el POST sí creó el evento y luego se leyó/renovó sólo auth, sin duplicar. Comparación
inicial de ID usó alias local y dio false; serverId y versión/estado Core se verificaron
después. Arranque de inspección redundante produjo EADDRINUSE, sin nuevos servicios.
No se presentan esos intentos como validaciones exitosas ni como defectos nuevos de Core.

Checks finales: 1059/1059 en89 archivos del candidato aislado,maxWorkers2; typecheck/lint/
build/diff-check PASS, dos warnings require RECORDS preexistentes. Parche anterior
22/81 preservado; nuevo candidato e incremento de corte guardados aparte con inventario/
hashes en design/validation/state-update-v10-controlled-cut-2026-10-13/.

Procedimiento futuro detallado en PROCEDURE.md: cerrar old en ambos; bloquear TODOS los
requests a APIweb.opco.cl mientras se permite descargar Client; comprobar labels/bundle
REAL en computador Y PWA instalada; sólo después liberar API, recargar/entrar y preparar
fresco desde Core. No basta shellCacheVersion/icono/Safari externo. Sin bloqueo API
verificado, no abrir una versión desconocida online: podría autosincronizar work viejo
antes de revisar su build. La barrera de red es una condición operativa aún no aplicada
ni acreditada en los dispositivos reales. No es un nuevo guard o motor de sincronización.

No publicación ni borrado real autorizado por esta etapa. No hay transferencia/puente/
reconciliación entre generaciones/V11. Rollback sólo build compatible con esta representación
y filename; nunca49913c3. Cola28.391, incidente productivo exacto y auditoría general abiertos.
Limpieza únicamente fixture/perfil/instrumentación/procesos propios, Core tracked intacto
y pendientes del repositorio preservados.

## 2026-10-13 — Attendance: aviso de cobertura y límite de fecha (LOCAL, SIN PUBLICAR)

### Reporte manual productivo, recibido del usuario

Sobre Client publicado cc29c95b1fdc97d69053907c67da406b1330b81e, el usuario reporta
PRESENTE visible junto a aviso de datos del día no disponibles y total «-». Confirmó
que guardó offline, cerró/reabrió y luego sincronizó correctamente con Core. Se registra
como prueba manual productiva de esa lectura/persistencia/escritura/sincronización reportada;
NO como certificación del snapshot completo del día, ni reproducción local del navegador real.
No se accedió a producción o a su almacenamiento para esta investigación.

### Evidencia local y corrección acotada

Regresión con funciones reales, SQLite de archivo y reapertura: un snapshot Attendance
completo acredita markAttendanceDaySnapshotHydrated. Una intención offline confirmada
se conserva al reabrir. El sincronizador recibe un UPDATED simulado y persiste el recibo
PRESENTE; persistStateUpdateReceipt invalida el marcador de día y autoridades, conservando
registro e identidad y consumiendo sólo su outbox. Tras otra reapertura hay datos legibles,
pero marcador ausente. Una respuesta completa posterior, persistida mediante
cacheAttendanceRemoteSnapshot, restaura el marcador. El ACK simulado prueba la rama local,
no una nueva sincronización con Core real. No se modifica ese comportamiento de persistencia:
una respuesta de escritura individual no acredita contenido completo del día.

Esto demuestra una explicación local de la combinación observada, NO demuestra que ése
fue el recorrido exacto del navegador productivo. No hay fallo demostrado de reconocimiento
ni pérdida del registro. Para distinguir en producción se necesita fecha efectiva, scope
owner/contrato/AppView/entidad (fingerprints), existencia/lastSuccessfulRefreshAt del marcador,
resultado y completitud del último refresh y secuencia temporal del ACK/refresh.

Defecto de presentación: el texto absoluto «Datos ... no disponibles» contradice la
existencia de registros locales. Attendance ahora distingue «Hay registros locales de
este dia, pero su cobertura completa aun no esta verificada. El total no esta disponible
sin conexion.» del caso sin registros. Conserva el aviso y «-», y nunca acredita cobertura
por un registro, búsqueda parcial o recibo. No amplía descargas ni modifica marcas.

Fechas: se limita la fecha efectiva de Attendance antes de usarla en lectores/handlers,
incluidas rutas y selección retenida. Fechas futuras/invalidas se llevan a hoy; hoy y
anteriores se conservan. Siguiente queda disabled/aria-disabled y su handler no cambia
fecha ni limpia el formulario al llegar a hoy. Se usa formatLocalDateInput y calendario
local existentes, sin ISO UTC. La derivación usa useMemo para conservar las garantías
del React Compiler; no se cambian handlers de guardado/confirmación/resolución. No se
borra ningún registro futuro, ni se modifican otros workflows o la preparación mensual.

### Validación y límites

78 pruebas focalizadas PASS / cinco archivos / máximo dos workers: lógica Attendance,
reemplazo offline/reapertura/ACK, revisión de autorizaciones, snapshots y runtime v10.
Typecheck PASS; lint PASS con dos warnings require RECORDS preexistentes; diff-check PASS.
Sin suite completa ni build de cierre. Export temporal indispensable para comprobación
visual; sin cambios de dependencias/configuración del repositorio.

Chrome local con perfil exclusivo, renderer real y sesión/datos/cobertura SIMULADOS:
1440x900, 1024x768 y 390x844; aviso parcial y persona PRESENTE con total «-», día completo
con total1 sin aviso, día ausente con aviso; ruta attentionDate=2099-01-01 usa hoy local,
Siguiente disabled sin lectura extra, Anterior y retorno hasta hoy funcionan. Sin overflow
horizontal. Capturas inspeccionadas: desktop y móvil. No es OPFS ni Core real ni Safari/iPhone
físico: persistencia/reapertura se acreditan sólo mediante SQLite automatizado en esta etapa.
Dominios productivos bloqueados durante el ensayo. Primeros intentos de arnés fallaron
por esperar título desktop móvil y seleccionar Anterior por role inexistente; corregidos
sólo en el arnés. Lint inicial detectó derivación no memoizada; corregida y checks repetidos.

Archivos propios: AttendanceWorkflow.tsx, attendance-workflow-logic.ts y su prueba,
attendance-offline-replacement.test.ts; sólo esta sección en STATE_UPDATE.md y STATUS.md.
Evidencia sintética en design/validation/attendance-day-coverage-and-date-2026-10-13/.
Pendientes anteriores byte a byte preservados; limpieza sólo de servidor/perfil/exports
propios. Core/API/esquema/outbox/sync intactos; sin commit/push/deploy. V11 pausado y
la auditoría general abierta.

## Attendance: recuperación del día después del ACK — 2026-10-14 (sin cierre técnico)

La prueba manual productiva reportada acredita guardado offline, cierre/reapertura y
sincronización posterior con Core. No acredita un snapshot completo del día. Esta etapa
corrige causas reproducidas localmente; no correlaciona por sí sola el navegador productivo.

El ACK invalida correctamente el marcador del día: el recibo no contiene todos los campos
configurados ni el snapshot completo. La recuperación existente se activa después de la
sincronización. Antes dependía además de refrescar definición y lista de personas: un fallo
en esa lectura impedía persistir una respuesta del día ya obtenida correctamente. Ahora
recupera el día sin esa dependencia, usando el mismo endpoint y persistencia existentes.

Se comprobó además que latest de Core omite Observación; el current de la consulta por
persona sí contiene el campo, incluido null. Cuando la respuesta global contiene todo el
día (límite existente de 10) pero falta ese contenido requerido, se consulta current por
cada persona representada, serialmente y como máximo diez veces. Sólo se certifica tras
persistir y verificar todo el contenido. Días mayores que el límite conservan cobertura
parcial: no se descargó todo el historial ni se certificó un ACK o una fila local.

En Chrome se reprodujo otra causa: una carga concurrente del mismo scope incrementaba
el identificador de presentación y cancelaba la hidratación, incluso después de recibir
current completo. La persistencia ahora valida usuario/contrato/AppView/entidad/fecha y
configuración semántica; la presentación conserva su guard contra respuestas antiguas.
Cambiar persona/búsqueda no descarta una recuperación válida del mismo día. Cambiar de
scope/configuración sí la descarta. El error primario se publica antes del fallback local,
que conserva los datos; no se sustituye por un total inventado ni se oculta el fallo.

Evidencia nueva: Core/PostgreSQL locales, DATABASE_URL explícita de .env.local validada
como opco_dev en 127.0.0.1:5432/opco_development, sesión web real, Chrome exclusivo y OPFS.
Fixture sintético: una persona, un registro por día, CAPACITACIÓN/PRESENTE; caso inicial
sin Observación y segundo con Observación opcional TEXTAREA. El primer caso parte del día
preparado. El segundo parte de cobertura no verificada y reproduce la omisión de contenido.
Cambio offline confirmado → cierre/reapertura con intención conservada → reconexión:
Core UPDATED, misma fila, total1, overwrite y base confirmada conservados. Después del GET
completo y current requerido, marcador verdadero; cierre completo y reapertura sin Core:
PRESENTE, total1, un evento, cero pendientes/conflictos/fallos, sin aviso de cobertura.
Las cuatro fuentes funcionales exportadas son idénticas a las del repositorio; bundle local
entry-20a9a944e060bea1b1324500908262b5.js. Capturas reales desktop y móvil conservadas.

El límite de fecha usa calendario local; reloj de medianoche y retorno del segundo plano
actualizan hoy. Pruebas de reloj y rutas/estado restaurado; en Chrome se simuló avance de
fecha mediante Date/visibilitychange: límite actualizado sin perder búsqueda ni generar
lecturas Attendance adicionales. Ruta futura vuelve a hoy y Siguiente queda deshabilitado.
No se borran registros futuros. No es una prueba física de paso de medianoche en iPhone.

127 pruebas focalizadas PASS (11 archivos, máximo dos workers), typecheck PASS, lint sin
errores y dos warnings require preexistentes en records-sync.local-db-regression.test.ts
182/183; diff-check PASS. No suite completa ni build de cierre: sólo export temporal
indispensable para OPFS. Pruebas incluyen fallo de recuperación, reapertura SQLite,
pendiente de otra AppView preservado, autorización/conflictos y contenido no verificable.

Separado: una regresión de once AppViews RECORDS, una fallida y diez exitosas, produce
11/11 procesadas y un fallo sin ninguna consulta Attendance. Procesadas incluye fallidas.
NO se identifica ni corrige el incidente productivo «Preparación incompleta · 1 fallo,
11/11 procesadas». Faltan runId/scopeKey/trigger, contadores, etapa/AppView/error del fallo
y respuesta primaria. lastAppView puede no ser la que falló; el resumen actual sólo
conserva error.name, sin causa HTTP. No se amplía telemetría en este lote.

Controles excluidos de éxito: reutilizar una base tras modificar remotamente su fixture
produjo CONFLICT real y lo conservó; no se presenta como sincronización completada.
ACCESS_HANDLE_BUSY en un intento de navegación repetida sigue separado; cierre completo
permitió el ensayo final sin reset. Errores iniciales del arnés (payload/field TEXT en vez
de TEXTAREA) fueron corregidos sólo en fixtures. No son defectos demostrados de Core.

Sin cambios de Core, esquema, outbox ni motor de sincronización, commit/push/deploy.
Pendientes ajenos preservados. Se detienen procesos propios; no se borran almacenamiento,
perfiles ni fixtures en esta etapa. V11 pausado; auditoría general e incidente productivo
sin correlación permanecen abiertos. Esto es evidencia funcional, no cierre publicable.

## Cierre técnico Attendance — recuperación ACK, cobertura y fecha — 2026-10-14

Candidato aislado desde HEAD cc29c95b1fdc97d69053907c67da406b1330b81e, main:
11 archivos propios; sólo las secciones Attendance 2026-10-13/14 en estos documentos.
Los 402 pendientes excluidos permanecen byte a byte, incluidos los experimentos y el
rediseño independiente de indicadores de carga. Índice vacío; sin commit/push/deploy.

Revisión: recuperaciones concurrentes del mismo scope pueden persistir aunque una búsqueda
reemplace su presentación. Respuestas de otro usuario/contrato/AppView/entidad/fecha o
configuración no activan esa recuperación. No se usa la secuencia visual para cancelar
contenido válido. Marcador sólo después de persistencia con contentVerified, incluida
Observación recibida en current; ACK/fila local/página parcial no certifican el día.
Consulta de Observación interrumpida no certifica; una invocación posterior recupera sin
bucle automático. Fallo de GET/persistencia conserva recibos y pendientes. La regresión
SQLite reabre después del ACK y del fallo y conserva una intención de otra AppView.
Confirmaciones, autorización, conflictos e identidad siguen usando el runtime existente.
No se cambiaron outbox, sincronización, SQLite, Core ni esquema.

Dos regresiones adicionales de concurrencia/interrupción PASS. Ningún cambio funcional
desde Chrome/OPFS: se reutiliza la evidencia de día preparado → cambio offline confirmado
→ cierre/reapertura → reconexión → UPDATED en misma fila → snapshot verificado → cierre y
reapertura offline, PRESENTE/total1, un evento y cero pendientes/conflictos. Caso adicional
con Observación opcional obtiene su current por persona antes de verificar. Capturas
reales desktop/móvil y reporte sanitizado incluidos como evidencia, no como código del lote.
Calendario local: hoy/anterior válidos, ruta futura acotada, Siguiente deshabilitado en hoy;
reloj de medianoche y segundo plano probados. La prueba de avance de día en navegador fue
simulada; no se acredita un iPhone físico ni paso real de medianoche.

Suite completa del candidato: 90 archivos, 1075 pruebas PASS con un worker (máximo dos),
70,41 segundos. Se conservan los resultados iniciales: con dos workers, primera ejecución
21 timeouts y un EPIPE; segunda, 14 timeouts y un EPIPE, ambos en el archivo preexistente
state-update-prewarm-current-investigation.test.ts. Sus 22 pruebas aisladas pasaron. No se
atribuye causa a esos fallos, no se aumentaron timeouts ni se omitieron/debilitaron pruebas.
Un lanzamiento inicial accidental desde el árbol de trabajo fue interrumpido y no cuenta
como validación del candidato.
Typecheck PASS; lint PASS, cero errores y dos warnings require preexistentes en
src/sync/records-sync.local-db-regression.test.ts:182/183. Build web PASS con API pública
https://web.opco.cl; export sólo en /tmp, sin solicitudes a producción. Bundle generado
entry-6ea725dc52333ccc2252cc07e52390ab.js y service worker 3b87b49380218079.
Diff-check PASS. No secretos, configuración local, exports, logs o bases en el parche.
El parche preliminar tenía un error de serialización de fin de línea: el parche final usa
Git, se reconstruye íntegramente y verifica hashes de cada archivo.

Inventario, parche, SHA256SUMS y evidencia en
 design/validation/attendance-day-recovery-close-2026-10-14/.
Lote cerrado técnicamente para revisión; no publicado ni autorizado para publicar.
«11/11 procesadas, 1 fallo» sigue independiente y sin causa productiva confirmada: este
lote NO lo corrige. Tampoco cierra la auditoría offline ni los problemas OPFS históricos.
V11 pausado. No se borró almacenamiento ni datos; sin cambios Core/esquema/configuración.

## Unificación visual de lecturas — 2026-10-14 (LOCAL, SIN PUBLICAR)

Base main publicada: 4169fc33b524d52cd3222d6157b0d03a74d1679c. Se reutilizan
experience-activity/use-experience-activity y resolveAppShellStatusIndicator. Antes,
ruta y renderers reportaban activeRuns pero además dibujaban barras de lectura; Inicio
no reportaba y RECORDS omitía la lectura inicial. Guardado/paginación estaban mezclados
con las lecturas en los workflows.

Ahora Inicio, bootstrap y RECORDS/Attendance/STATE_UPDATE/PANEL/REPORT publican readCount
y readMode en el canal existente. activeRuns mantiene el contexto general de actividad;
la cabecera distingue lectura de guardado y cargar más. Muestra Cargando/Actualizando y
el nombre de Inicio/experiencia. Sin datos compatibles, el cuerpo muestra Esperando datos
estático; durante una actualización conserva el contenido compatible con los guards ya
existentes. Detalle, crear/editar y problemas de RECORDS, junto con su bootstrap, también reportan
lectura en ese canal. Las opciones de relación/validación del formulario conservan sus
mensajes junto al campo y el guardado conserva su spinner. PANEL conserva estados estáticos por módulo y sus errores/reintentos cuando
unos módulos tienen datos y otros no. Botones de guardado y cargar más conservan sus
spinners, confirmaciones, feedback y handlers locales; no se centralizan las escrituras.

El reporter sigue el foco de navegación. Una identidad de reporter dentro del mismo
scope evita que el cleanup o respuesta del bootstrap saliente borre la actividad del
renderer entrante. Scopes incluyen usuario, contrato y AppView; Home usa su propio scope.
Attendance cuenta la recuperación ACK por scope/configuración; STATE_UPDATE cuenta las
lecturas en vuelo por scope y excluye appendLatest. Contadores exclusivamente visuales,
decrementados en finally; no cambian secuencias, consultas, cancelaciones, cachés,
cobertura, outbox ni sincronización. Una respuesta de otra ruta/scope no publica en la
cabecera actual. Actividades concurrentes conservan el indicador mientras haya lecturas
pertinentes; salir de la ruta retira su presentación sin cancelar su petición.

Errores/conflictos, offline, feedback de guardado y preparación incompleta conservan su
prioridad y acceso a Diagnóstico; el contexto de lectura se añade sin sustituirlos.
Preparación incompleta conserva su progreso existente. No se añade motor, polling,
reintentos ni solicitudes. El único pulso de lectura es el existente en cabecera, ahora
sin movimiento mientras la preferencia no esté resuelta o sea de movimiento reducido.
Una señal success mientras hay lecturas activas no borra un error anterior: sólo la
finalización exitosa lo retira. Este último ajuste se cubre con regresión y una revisión
visual dirigida que inyecta estados sintéticos en el canal real, sin peticiones. Las
otras capturas preceden ese ajuste y se reutilizan sólo para escenarios no afectados.
El estado central se anuncia con live region polite; el cuerpo no repite animaciones ni
anuncios de progreso. Referencia API consultada: Expo Router SDK57,
https://docs.expo.dev/versions/v57.0.0/sdk/router/ (useFocusEffect con callback estable).

259 pruebas focalizadas PASS en 17 archivos, máximo dos workers: actividad/feedback,
presentación estática, guards de contenido compatible, modelos de los cinco renderers,
Attendance/confirmación/conflictos/SQLite/reapertura y refresh. Typecheck PASS; lint sin
errores, con las dos advertencias require preexistentes en
src/sync/records-sync.local-db-regression.test.ts:182/183; diff-check PASS. No suite completa.
Export web temporal indispensable para navegador, no build de cierre ni export publicable.

Revisión visual REAL de componentes/pantallas en Chrome exclusivo: 1440x900 y 390x844.
Sesión, API, demoras, personas y caché fueron SIMULADOS en una copia temporal: no acredita
Core, OPFS, escritura/sincronización ni iPhone físico en esta etapa. Inicio con experiencias
visibles durante actualización; bootstrap y renderers sin datos con estado estático;
REPORT conserva tabla durante refresh; PANEL muestra datos de un módulo y error del otro.
Regreso a Inicio con lectura de otra ruta pendiente deja el estado de Inicio. Movimiento
reducido: opacidad central estable1; foco de teclado visible (outline solid3px). Resize
390/1024/1440 en REPORT no aumenta las llamadas del arnés. Sin overflow global en las
capturas finales. Detalle, crear, editar y problemas de RECORDS se revisaron también en
escritorio y móvil; para problemas se demoró sólo la caché sintética, pues esa pantalla
lee localmente. Un primer wait erróneo del arnés esperaba una API que no existe en ese
recorrido: se corrigió sin añadir peticiones al producto. Autenticación/arranque,
Diagnóstico y rutas genéricas legacy /entity no se rediseñan en este lote de AppViews. Contenido/estados y navegación son de los componentes reales; errores
PANEL/REPORT y demoras del arnés son escenarios sintéticos, no fallos productivos.

Los primeros fixtures omitían layout/transformation de PANEL y table.visibleFieldIds de
REPORT; se corrigieron sólo en el arnés y se repitieron sus capturas. También se corrigió
un selector del arnés. La revisión móvil se interrumpió al terminar el servidor temporal
(ERR_CONNECTION_REFUSED); se repuso el proceso propio y se completó la revisión. Ninguno
se atribuye al producto. Las capturas válidas y resultados sanitizados se conservan en
 design/validation/read-loading-unification-2026-10-14/.

25 archivos propios: siete rutas de app, componente read-loading-indicator y prueba,
experience-activity y prueba, app-shell-feedback y prueba, hook use-experience-activity,
cinco renderers principales, detalle/formulario/problemas RECORDS y prueba PANEL, y sólo
esta sección de STATE_UPDATE/STATUS. Los 402
pendientes excluidos se preservan byte a byte; se preservan las secciones ajenas de estos
documentos. Sin cambios Core/API/esquema/dependencias/configuración. Sin borrado de cachés,
fixtures anteriores o outbox, ni commit/push/deploy. Sólo se detienen procesos de revisión.
No atribuye ni resuelve «11/11 procesadas, 1 fallo»; incidente independiente. V11 pausado;
auditoría general abierta. Implementación local para revisión, sin cierre técnico completo.

## Cierre técnico — unificación de indicadores — 2026-10-14 (SIN PUBLICAR)

Base main 4169fc33b524d52cd3222d6157b0d03a74d1679c. Reconstrucción inicial exacta del
respaldo 25 archivos / 75 hunks, SHA256 comprobados. Ese respaldo se conserva intacto.
No cambió implementación: la suite descubrió una expectativa textual antigua en
state-update-coverage-consistency.test.ts, que buscaba la llamada anterior del reporter.
Se adaptó al mismo contexto pasado por useVisibleActivity con readCount/readMode y
reporterId; se añadió una comprobación equivalente contra el store real: contexto
conservado con dos/una lecturas, cierre del reporter saliente ignorado y finalización
sin perder el contexto para Copiar diagnóstico. No se eliminó ni debilitó la cobertura.
Por eso el lote final añade únicamente ese archivo de regresión (26 archivos).

Suite completa sobre candidato aislado: 90 archivos / 1082 pruebas PASS, un worker
(máximo dos), 70,98 segundos. Primera ejecución: 1058 PASS / 23 fallos; 22 timeouts y un
EPIPE en state-update-prewarm-current-investigation.test.ts, más la expectativa textual
indicada. La causa de los timeouts/EPIPE NO está demostrada; no se atribuye al diseño,
al build paralelo ni al producto. No se alteraron timeouts ni se omitieron pruebas.
Prueba de cobertura adaptada: 19 PASS. Typecheck PASS. Lint PASS, cero errores y dos
warnings require preexistentes en records-sync.local-db-regression.test.ts:182/183.
Build web PASS: entry-dcd9fe7b06c165c83fa0b45f9524bd05.js, shell 54854ee6d82b2b4a,
API https://web.opco.cl; dist sólo en /tmp, fuera del lote. El build precede únicamente
al ajuste de pruebas/documentación, que no altera su contenido funcional. Diff-check PASS.
Una comprobación auxiliar Node falló con EPERM al invocar Git; se completó leyendo
archivos de HEAD previamente verificados, sin atribuir causa al error del arnés.

Revisión de garantías: los contadores de lectura de Attendance/STATE_UPDATE decrecen
en finally, independientemente de la secuencia usada para presentar respuestas. Son
por scope; cierre/cambio de ruta limpia sólo al reporter propietario. La regresión
2→1→0 y los reports tardíos/scopes ajenos conservan actividad válida y cierran al final.
Un success anticipado no borra un error mientras haya actividad. Error/conflicto,
offline, guardado y preparación incompleta conservan prioridad, texto y acceso a
Diagnóstico mientras el contexto de lectura se añade. Cuerpo inicial estático; PANEL
retiene mensajes y resultados individuales. Guardado/cargar más mantienen spinners y
handlers junto a su acción. No se introducen timers, reintentos o polling de datos.
El pulso central se detiene al dejar working, reducir movimiento o desmontarse.

Comprobación AST adicional contra HEAD: llamadas API/caché, sus argumentos y listas de
dependencias de hooks de datos idénticos en los 19 archivos de implementación. Sin
cambios en API, consultas, persistencia, cobertura offline, outbox o sincronización;
no se tocaron sus módulos. Pruebas completas incluyen las garantías existentes de
Attendance, RECORDS, conflictos, intenciones, idempotencia y SQLite.

Revisión visual reutilizada: las 19 fuentes funcionales coinciden con las del lote
revisado. Capturas principales preceden al ajuste de conservación de error; su camino
afectado tiene captura dirigida posterior. Las rutas adicionales RECORDS se comprobaron
después de su integración. Son componentes reales Chrome desktop/móvil con sesión/API,
caché, demoras y reportes de actividad SINTÉTICOS. No se presentan como evidencia nueva
con Core/OPFS, sincronización productiva, iPhone físico o lector de pantalla. Se conserva
la distinción entre pruebas SQLite automatizadas y revisión visual del arnés.

Inventario final, parche, hashes, resultados de checks y referencia a capturas en
 design/validation/read-loading-unification-close-2026-10-14/.
Sólo las secciones propias de unificación/cierre se incluyen de STATE_UPDATE/STATUS;
secciones ajenas y 402 pendientes excluidos byte a byte preservados. No secretos,
configuración local, perfiles, bases, logs, capturas o exports en el parche publicable.
Las capturas siguen en el respaldo visual anterior, fuera del lote de código.
HEAD e índice intactos; sin Core/esquema/configuración/dependencias, commit/push/deploy.
Cierre técnico para revisión, sin autorización de publicación. «11/11 procesadas,
1 fallo» continúa independiente, abierto y sin causa confirmada. V11 pausado;
auditoría general abierta. Rutas legacy entity/autenticación/Diagnóstico fuera de este
rediseño; conservan sus estados originales según la delimitación de implementación.

## Preparación incompleta 11/11 · diagnóstico individual — 2026-10-15 (LOCAL, SIN PUBLICAR)

Base publicada 235ba5e6dcf7ae1ad806e7a93a330591ff61ae26. Alcance exclusivo del incidente
reportado a 2026-10-14T01:07:09Z: once AppViews procesadas, un fallo. La evidencia
histórica documentada no identifica AppView, fase ni causa primaria. El diagnóstico
original de esa hora no está disponible entre los archivos consultados; no se afirma
haberlo inspeccionado ni se atribuye el fallo a Attendance, red o SQLite.

Defecto diagnóstico demostrado: prewarm conserva un Map por AppView durante la ejecución,
pero buildOfflinePreparationDiagnostics reduce ese Map a contadores, lastAppView y top
lento sin identidad de experiencia. Un éxito posterior puede dejar lastAppView exitoso.
setOfflinePreparationDiagnostics persiste ese resumen en app_metadata, por owner
fingerprint; el consumidor de sesión verifica el scope de usuario/contrato existente.
Normalización al leer no puede reconstruir detalles que nunca se persistieron.
11/11 significa procesadas, incluidas fallidas; no once preparaciones exitosas.

Se conserva ahora failedAppViews para la ejecución actual: nombre de experiencia de
AppView (no nombres de registros/personas), fingerprint, tipo/workflow, fase, código
seguro, HTTP status cuando la excepción es OpcoApiError. runId/scope ya existentes
identifican la ejecución. Los éxitos posteriores no sustituyen sus fallos. Persistencia
JSON/lectura usan el mecanismo app_metadata existente, sin esquema nuevo. Una ejecución
posterior sustituye el diagnóstico de la anterior; no se introduce historial de runs.
El catch de una etapa conserva esa etapa fallida. No cambian consultas, concurrencia,
reintentos, snapshots, cobertura, intenciones ni sincronización de escrituras.

Categorías seguras: HTTP_ERROR con estado HTTP, NETWORK_ERROR por clase de excepción,
TypeError/Error/UNKNOWN. Mensajes reconocidos de UNIQUE o finalización se traducen a
SQLITE_CONSTRAINT_UNIQUE o STATEMENT_FINALIZATION_FAILED; este último NO demuestra una
restricción concreta. Nunca se copian mensajes libres, details, tokens, cuerpos, nombres
de columnas ni valores de registros. Errores genéricos siguen sin causa primaria detallada.

Acceso: pulsar el estado superior → Diagnóstico. En PWA → Preparacion offline se ven
fallos individuales y runId; en Sincronización → Copiar diagnóstico se copia el mismo
contexto persistido. Diagnósticos antiguos sin failedAppViews indican expresamente
«Detalle no conservado por esta versión; repetir la preparación para capturarlo».
No se interpreta una lista ausente como cero fallos. En el siguiente intento con este
código, guardar la copia antes de iniciar otra preparación permitirá identificar la
experiencia y la fase, y distinguir HTTP/categorías reconocidas. No hay publicación ni
captura nueva del dispositivo del usuario en esta etapa.

Evidencia AUTOMATIZADA: once experiencias sintéticas RECORDS, primera con HTTP 503 al
cargar definición y diez exitosas; 11/11, failed=1, lastAppView success, fallo individual
conservado tras serialización/normalización y presente en copia. Sin mensajes/payloads
privados. Reintento explícito posterior exitoso conserva definiciones listas y deja la
lista de fallos vacía. Regresiones de categorías seguras, marcador antiguo, ausencia de
run, run sin fallos y cableado a las secciones existentes. No evidencia Core/Chrome/OPFS
nueva ni reproducción de la causa histórica productiva. Las comprobaciones de UI son
unitarias/de cableado, no revisión visual de navegador.

Checks: 89 pruebas focalizadas PASS en cinco archivos; otras dos PASS de local-db.test.ts
filtradas por «offline preparation» (95 no seleccionadas). Typecheck PASS; lint PASS con dos warnings require preexistentes en
records-sync.local-db-regression.test.ts:182/183; diff-check PASS. No suite completa ni build. La primera prueba nueva usó erróneamente
.filter sobre el Map del fixture: corregida a [...values()]. La importación node:fs del
test falló typecheck por la configuración de tipos existente; se reutilizó la convención
require declarada de las pruebas del repositorio, sin dependencias. No fueron fallos
del producto.

Nueve archivos propios: app/(app)/_layout.tsx, app-view-prewarm.ts y su prueba,
sync-status-diagnostics.ts y su prueba, nuevos offline-preparation-diagnostic.ts y su
prueba, sólo esta sección de STATUS y STATE_UPDATE. Los 402 pendientes excluidos y las
secciones documentales ajenas se conservan. Sin Core/API/esquema, borrado, datos
productivos, commit/push/deploy. V11 pausado. Incidente productivo ABIERTO: diagnóstico
habilitado localmente; experiencia y causa históricas todavía no acreditadas.

## Cierre técnico — diagnóstico individual de preparación — 2026-10-15 (SIN PUBLICAR)

Candidato aislado desde main 235ba5e6dcf7ae1ad806e7a93a330591ff61ae26. Nueve archivos:
app/(app)/_layout.tsx; app-view-prewarm.ts y su prueba; sync-status-diagnostics.ts y su
prueba; nuevos offline-preparation-diagnostic.ts y su prueba; sólo las secciones propias
de diagnóstico/cierre de STATUS y STATE_UPDATE. No se amplió implementación en el cierre:
únicamente se añadió una regresión de varios fallos y separación entre runs.

Garantías: fallo seguido de éxito conserva su experiencia, fingerprint, fase y código.
Varios fallos se guardan separados (HTTP 403 en definition_load; fallo de escritura en
sqlite_write), asociados al runId del resumen. El siguiente run tiene otro ID, empieza
con failedAppViews=[] y no mezcla el anterior. El parser mantiene legibles los resúmenes
históricos sin la nueva lista; el detalle ausente se explica y no se presenta como cero
fallos. Pantalla y copia reutilizan offlinePreparationFailureRows y el mismo contexto de
preparación. No se modifica el motor, las peticiones, snapshots, cobertura, reintentos,
intenciones, conflictos ni sincronización de escrituras. Revisión del diff: sólo
instrumentación observacional, serialización/normalización y presentación; ningún módulo
de persistencia o sincronización editado. No cambia el esquema ni la base epoch2.

Suite completa AISLADA: 1091 pruebas / 91 archivos PASS, un worker (máximo dos), 58,51 s.
Typecheck PASS. Lint cero errores y dos warnings require preexistentes en
records-sync.local-db-regression.test.ts:182/183. Build web final PASS; bundle
entry-ba34ca42dffb1deb6fb4a81a89710821.js; shell e17c9c4b7cd6ac8b. Verificados cableado del
detalle en bundle, API https://web.opco.cl y opco-client-v10-epoch2.db; es un export local,
no despliegue ni acceso a Core. Diff-check PASS. No se omitieron pruebas ni cambiaron
sus timeouts. El build sólo precede al texto de este cierre, sin cambios funcionales.

Revisión visual REAL de las pantallas PWA/Sincronización del candidato en Chrome exclusivo
1440x900 y 390x844. Sesión, API, caché y errores controlados son SINTÉTICOS; se ejecutaron
prewarm y normalización reales. Se observó «11/11 procesadas · 1 fallo», luego dos fallos
con distintas experiencias/fases/códigos. Copiar diagnóstico mostró «Copiado»; se leyó el
clipboard real y coincidieron las filas y runId. No contenía los mensajes, payload,
columnas privadas ni token sintéticos usados como señuelos. Móvil sin overflow global;
el detalle histórico muestra el aviso de campos no conservados. Nuevo run exitoso sin
fallos anteriores. Cero excepciones de runtime en el recorrido final. Los flags de
conectividad/caché del arnés NO acreditan red, preparación con Core, SQLite/OPFS, ni el
incidente productivo. No se usó Playwright. Capturas/resultado/clipboard sintéticos en el
respaldo de cierre, fuera del parche publicable.

Límites y tropiezos del ensayo, sin atribución productiva: la conexión CDP inicial fue
bloqueada por el sandbox (EPERM); se completó con acceso local autorizado. Se corrigió
el selector del arnés para las pestañas role=tab. La primera lectura del clipboard no
tenía foco/permiso. Un stub de getSQLiteCoordinatorDiagnostics devolvía Promise, causando
«No se pudo copiar»; se sustituyó exclusivamente en la copia visual por el getter síncrono
real. Se descartaron exports que no incluían el cableado nuevo y se regeneraron con
--clear; el build final usa la variable existente EXPO_PUBLIC_OPCO_API_URL, tras corregir
el nombre equivocado usado en un primer comando. Se observaron reinicios de la sesión
sintética durante intentos preliminares; su causa no se demostró. Para el ensayo final
se usó un perfil nuevo con el export ya terminado; la copia visual deshabilita la llamada
de registro SW de su root layout para reducir interferencias de actualización, sin
cambiar archivos del candidato. Esto no demuestra la causa de los reinicios previos.
Ninguna captura preliminar ni build descartado se acredita como resultado final.

Cómo capturar el próximo fallo, DESPUÉS de una publicación autorizada y comprobar el
bundle nuevo ejecutado: 1) con conexión y el contrato correcto, abrir Inicio y esperar
la preparación automática; no hace falta un botón nuevo. 2) Si aparece preparación
incompleta, no iniciar otra preparación ni cambiar de contrato antes de copiar: el
marcador conserva sólo el último run. 3) Pulsar el estado superior → Diagnóstico → PWA;
en Preparacion offline revisar runId, Scope, contadores y cada Fallo. 4) Abrir la pestaña
Sincronización → «Copiar diagnóstico de sincronización» y conservar el texto, incluida
la sección «Preparación offline — fallos por experiencia». 5) Si dice «Detalle no
conservado», corresponde a un marcador histórico: registrar esa limitación y realizar
una nueva preparación online volviendo a abrir Inicio. 6) Guardar el texto antes de
reintentar. Error/UNKNOWN puede requerir reproducción dirigida adicional; no se infiere
una causa primaria ni un tipo de fallo a partir del contador o del último éxito.

Inventario exacto, parche, SHA256SUMS y evidencia sanitizada en
 design/validation/offline-preparation-diagnostics-close-2026-10-15/.
402 pendientes excluidos byte a byte intactos; documentación previa preservada. HEAD e
índice sin modificar. Sin Core, esquema, dependencias, configuración, datos productivos,
borrado, commit/push/deploy. Incidente de 2026-10-14T01:07:09Z sigue sin experiencia ni
causa histórica confirmadas. Cierre del diagnóstico, no resolución del fallo productivo.
V11 pausado; auditoría general abierta.


## STATE_UPDATE identidad compuesta — primera etapa local — 2026-10-18

Implementado únicamente subject-date-fields + update-current en Core/editor y Client. Roles SELECT
simples/obligatorios, definición compartida entre AppViews, reserva única transaccional, bloqueo de
escrituras genéricas/borrado para entidades nuevas que activan el modo. Sin adopción de entidades
pobladas, sin reinterpretar modos anteriores. Client selecciona fecha/contexto antes de buscar,
prepara sólo el contexto explícito, persiste scopes e intenciones exactos en SQLite v10/epoch2 y
reutiliza confirmación, outbox, conflictos, restauración e indicador central.

Pruebas focalizadas, máximo dos workers: Client 264/12 archivos (presupuesto CLI20s; ver limitación abajo); Core 200/5 archivos y repetición de
los nueve casos PostgreSQL sobre migración final limpia. Typecheck, lint y diff-check aprobados;
lint Client conserva dos advertencias require-imports de HEAD, Core cero. Sin suite completa ni build
Core; export local Client indispensable para Chrome/OPFS. Chrome real acredita preparación/búsqueda,
creación offline, edición confirmada, cierre/reapertura offline con autorización durable, ACK real sin
duplicados, conflicto por cambio remoto posterior, restauración y aislamiento al cambiar contexto.
El ajuste final de ausencia no verificada se repitió en el bundle final
entry-4fa1cfed7a91b8872d4bf9f7dba0fd41.js; no se acredita prueba productiva o revisión móvil.

Migración aditiva 20261018000100_state_update_composite_identity sólo en
127.0.0.1:5432/opco_development como opco_dev, URL de .env.local pasada explícitamente. Tras limpiar
fixtures se reaplicó exclusivamente la migración experimental propia: 23 aplicadas/cero fallidas,
checksum final correcto y las 22 entradas anteriores intactas. Sin migración SQLite ni cambio de base.
Serializador real del Client anterior 1b4bdaa contra HTTP local: 400 COMPOSITE_IDENTITY_REQUIRED;
no demuestra coexistencia completa de runtimes. Horarios/duración, eliminación Client, reglas de
horómetros, REPORT/PANEL y V11 permanecen fuera. Incidentes productivos históricos, OPFS y preparación
incompleta no se atribuyen ni se declaran resueltos por esta implementación.

Lote exacto: 14 archivos Client y 11 Core (implementación, regresiones y cuatro secciones documentales).
[Inventario y parches propios](../design/validation/state-update-composite-stage1-2026-10-18/inventory.json).
Se conservan las 402 exclusiones por hash y los pendientes adicionales de entrada; las secciones
ajenas de STATE_UPDATE/STATUS permanecen byte a byte como prefijo anterior. Ambos main/HEAD e índices
intactos. Se limpiaron sólo fixtures/procesos/perfil propios, conservando registros locales ajenos.
Sin commit, push, deploy ni acceso productivo; requiere cierre técnico posterior antes de publicar.


Última revisión: se cerraron fecha/sujeto como estados editables sólo para el modo nuevo en Core, y
la lectura directa scoped por ID en Client (fecha/contexto también en pendientes). Regresiones fallaron
antes y pasan después. El último lector se comprobó además en Chrome/OPFS tras reapertura, bundle
entry-aa67ade897355755cfe604791b321382.js, con snapshot sintético por funciones reales; no es una nueva
prueba de sincronización Core. Client 264 afectadas; Core 200 afectadas. Sin suite completa.


Transición de Fecha del modo compuesto comprobada antes/después en Core real con HTTP lento: no se
mantiene visible la fila del contexto anterior. Cambiar fecha limpia sólo estado visual e invalida
respuestas antiguas; seleccionar el mismo valor es noop. No cambia Attendance ni la outbox.

Límite de cierre: ejecución Client estándar5s con21 timeouts/EPIPE; repetición del archivo con14
timeouts. No se adjudica causa. Misma selección264 pruebas pasa con CLI --testTimeout=20000 y dos
workers, sin editar tests/configuración. Typecheck/lint/diff-check pasan (dos warnings de HEAD).
No acreditar PASS estándar ni publicación lista. La inestabilidad del presupuesto queda abierta,
separada del resultado funcional, V11 y los incidentes históricos. Se limpiaron siete organizaciones
propias en total más perfiles/procesos sintéticos; datos ajenos preservados.


Validación del bloqueo subject-date-fields — 2026-10-19: comparación aislada HEAD/candidato del archivo
con timeouts históricos: 22/22 y 22/22 con un worker y 5 s normales. La causa del primer timeout histórico
no se reprodujo; el stack EPIPE identifica el harness, no prueba su causa primaria. No se amplió timeout.
La primera suite completa reveló seis fallos por identity ausente en el contexto del harness de handlers;
se corrigió sólo esa prueba, conservando/reforzando aserciones. HEAD 7/7, candidato corregido 7/7.
Suite completa final Client 1104/1104, Core 1112 PASS/25 omitidas, un worker; typecheck/lint/build y
diff-check PASS en ambos. Dos warnings Client ya existentes en HEAD; Core cero. Build Core webpack en
archive fuera del sandbox con entorno local explícito, después de errores de captura TypeScript vacía
y AUTH_SECRET omitida, conservados en el informe. Nueve integraciones PostgreSQL previas reutilizadas,
no acreditadas como ejecutadas por la suite estándar. Sólo SELECT confirmó 23 migraciones/cero fallidas,
checksum aditivo y digest de las 22 previas intactos, sin reaplicar. Runtime funcional idéntico: se
reutiliza Chrome/OPFS con sus límites. Cápsula anterior preservada y lote actualizado de 15 Client/11 Core
con hashes y reconstrucción exacta. 402 exclusiones y pendientes adicionales intactos. Sin commit/push/
deploy, sin nuevos fixtures; V11 pausado. No se cierran auditoría general ni incidentes históricos.


Revisión de evidencia subject-date-fields — 2026-10-19: 25 omisiones Core identificadas nominalmente
(9 PANEL, 7 escrituras genéricas, 9 compuesto), por flags de integración ausentes. Nueve casos compuestos
PG previos reutilizados con runtime/SQL idénticos. Sólo dos ensayos nuevos indispensables: 2 PASS con
PostgreSQL local validado y un worker. Acreditan valor del ganador concurrente, rollback del guardado
completo después de auditoría real y ausencia de mutaciones por identidad incompleta; retry/replay
produce un único efecto. No cambio funcional, suite/build/navegador ni migración repetidos. Evidencia y
parche de ensayo separados en design/validation/state-update-composite-evidence-review-2026-10-19/.
Core+migración aditiva primero; Client después; activar modo sólo con ambos compatibles. Tras activación,
rollback limitado a builds compatibles en ambos, conservando slots/guardas/datos/intenciones. Sin down
migration/conversión inversa validada. Cápsula y pendientes originales intactos; sin publicación, V11 pausado.


Preparación publicación subject-date-fields — 2026-10-19, SIN COMMIT/PUSH/DEPLOY: inventario consolidado
Core11/Client15 con pruebas y documentación complementarias; runtime funcional idéntico. Checks previos
y 9+2 integraciones PG reutilizados; sólo lint/typecheck de pruebas nuevas. No suites/build/navegador.
Lectura origin/main coincide con HEAD/base en ambos. Railway destino Core/production/Postgres validado;
SELECT READ ONLY productivo confirmó22 aplicadas/0 fallidas/sin divergencias, única pendiente
20261018000100_state_update_composite_identity. Sin migración ni lectura/escritura de datos de aplicación.
BLOQUEO previo a migrar: PITR off,sin schedules,único backup listado con expiresAt21-09-2026; no respaldo
reciente/restauración probada acreditados. Mecanismos CLI/API y dump/restore18.6 identificados, no ejecutados.
Procedimiento Core+migración habitual -> SUCCESS/SHA/health/readiness -> Client -> bundle/sw.js/API/base
conservada. No activar modo ni crear configuración/entidad productiva; desplegar no cambia AppViews.
Rollback post-activación sólo builds compatibles de ambos. Cápsulas anteriores y 402 exclusiones intactas;
final en design/validation/state-update-composite-publication-prep-2026-10-19/. V11/auditoría general abiertos.

## STATE_UPDATE compuesto — preparación automática del contexto — 2026-10-20, LOCAL SIN PUBLICAR

Sobre main/fa3d625, sin cambios Core ni configuración productiva. Al completar fecha válida e identidad
configurada, prepara automáticamente con el coordinador/pool/preparador existentes. Cobertura completa
se reutiliza sólo cuando su lector sigue verificándola; no se añade TTL. Ausente/parcial: un intento por
scope/época online/señal de sync; fallo terminal, reintento manual o reconexión real, sin bucles de render.
Inicio sin cambios y sin descargar combinaciones no elegidas. Buscar/editar online no depende del botón.
El manual actualiza/reintenta. Respuestas canceladas quedan en su scope; A→B→A espera al escritor previo.
Al volver a un contexto intentado se relee el marcador local, sin nueva descarga. Offline sólo datos y
cobertura persistidos, distinguiendo current de latest; cabecera existente, sin otra animación de lectura.

149 pruebas focalizadas PASS/9 archivos/máximo2 workers, incluyendo SQLite real+reapertura y protección
exacta de intención autorizada ajena, Attendance/modos previos, fallos/reintento y respuestas tardías.
Typecheck PASS; lint0 errores/2 warnings require() previos ajenos; diff-check PASS. Sin suite completa.
Export local indispensable OPFS: bundle entry-f8dc3295b5f27c33eb171b16a4050a0c.js, API localhost20330,
SW9490e12fa2dc41b6. Chrome154/perfil exclusivo/CDP sin Playwright, Core publicado aislado y PostgreSQL
local validado desde .env.local (127.0.0.1:5432/opco_development/opco_dev), sin migraciones. Fixture nuevo
2 sujetos/2 contextos, uno sin reporte. Contexto incompleto no añade solicitudes; completo añade1GET
fuente+2GET current sin botón; búsquedas no duplican preparación. Ambos contextos completos y un evento
por combinación. Un defecto nuevo de presentación al regresar a contexto preparado fue corregido,
con regresión y recorrido repetido sobre el bundle final. No se presenta la corrida anterior como final.
Lectura offline correcta; reapertura tras cero procesos y servidores propios detenidos: mismo bundle,
contexto123.4 correcto, current completo2/2, un evento, cero API exitosas y cabecera sin animación terminal.
Captura inmediata del primer paso offline tenía actividad transitoria: la prueba terminal es la reapertura.

Reconexión, fallos/reintento y conservación de intenciones/conflictos: evidencia automatizada; navegador
sólo preparación/lectura/contextos/reapertura con datos sintéticos, no sync de escrituras ni producción.
Primer export con puerto local anterior descartado; endpoint verificado en el export final. Documentación
y alcance exacto en STATE_UPDATE. 402 exclusiones y demás pendientes ajenos preservados. Sin staging,
commit/push/deploy. V11/auditoría general y «11/11 procesadas, 1 fallo» siguen abiertos e independientes.

Limpieza acreditada: fixture propio retirado; IDs/versiones ajenas locales intactas, sin definición/slot
propio restante. Servidores y relay propios detenidos, Chrome cerrado y tres perfiles de ensayo borrados
tras resolver únicamente su eliminación local (sin ACLs ni perfiles habituales). Export/capturas fuera de Git.


### Cierre técnico aislado — preparación automática del contexto — 2026-10-20

LISTO PARA PUBLICACIÓN POSTERIOR; sin commit, push ni deploy. Base main/fa3d625efa5b1e564e2ddafb3cbadec02de0d1f6.
Candidato reconstruido aislado: 11 archivos / 24 hunks, tres archivos nuevos. Los nueve archivos de
implementación/pruebas conservan exactamente los SHA-256 del inventario de entrada en
/tmp/opco-context-auto-20261020/inventory.json. Ningún ajuste funcional durante este cierre.
El parche inicial contextualizaba los dos documentos sobre sus pendientes anteriores: el parche final
aplica a HEAD y añade sólo las secciones propias; NO incluye las secciones documentales ajenas.

Suite COMPLETA aislada PASS: 1125/1125 pruebas, 94/94 archivos, cero omitidas/fallidas, un worker,
timeouts estándar sin overrides ni aumentos; 61,024 s de proceso local. Typecheck PASS. Lint PASS:
0 errores y 2 advertencias preexistentes en src/sync/records-sync.local-db-regression.test.ts:182/183,
no-require-imports, mismo contenido que HEAD. Build web PASS (npm run build), sin leer .env, API
https://web.opco.cl explícita y caché temporal de Metro aislada. Bundle LOCAL del cierre:
entry-949b57fa62390b3cf96915e3ed4c905e.js, SW e2fcd4112d66f26b con referencia coincidente,
sin destinos API locales; SQLite v10/opco-client-v10-epoch2.db conservados. No es un despliegue.
Diff-check del candidato y del árbol principal PASS; revisión del parche sin secretos, .env,
configuración local, bases, capturas, exports ni logs publicables.

Inventario exacto: implementación en app-view-prewarm.ts, state-update-current-prewarm.ts,
StateUpdateWorkflow.tsx, state-update-workflow-logic.ts y use-context-preparation.ts (nuevo);
pruebas en state-update-context-preparation.test.ts (nuevo), state-update-composite.test.ts,
state-update-workflow-logic.test.ts y use-context-preparation.test.ts (nuevo); únicamente las secciones
propias de docs/STATE_UPDATE.md y docs/STATUS.md. Rutas completas, hunks y hashes en el inventario.
Respaldo durable fuera de /tmp: /home/dannysilver/dev2026/backups/state-update-context-auto-close/2026-10-20/inventory.json,
context-auto-preparation.patch y SHA256SUMS; incluye procedimiento de reconstrucción, resultados
sanitizados y procedencia de la evidencia. Reconstrucción independiente por parche/hashes requerida
y verificada en el informe del respaldo. No usar hashes de los documentos completos del árbol sucio
como hashes del candidato: el inventario final distingue ambas representaciones.

Revisión: coordinador/pool/marcadores existentes, scopes completos, un intento por contexto/época
online/señal de sync, reutilización sólo tras verificar cobertura persistida, fallo terminal y reintento
explícito. Contexto incompleto no dispara preparación; petición inicial de definición reutilizada.
Búsquedas no duplican preparación. Respuestas canceladas no acreditan otro contexto; A/B/A espera
al escritor cancelado. Sin otro motor, TTL, descarga cartesiana ni cambios de Inicio. Cobertura current
separada de latest parcial; sólo persistencia verificada de todos los sujetos acredita complete,
incluido null confirmado. Guardado/autorización/outbox/sync y Attendance sin cambios funcionales.
No se incorporan horarios, nuevos selectores de fecha ni menús desplegables.

Se reutiliza la corrida Chrome/OPFS final con Core/PostgreSQL locales y bundle f8dc3295b5f27c33eb171b16a4050a0c:
preparación automática, búsqueda sin duplicación, cambio de contexto, lectura offline y reapertura
completa con servidores detenidos. Igualdad funcional verificada por SHA-256; las diferencias del
bundle del cierre provienen de construir para API pública y del entorno de export, sin visita productiva.
Sin nuevo navegador en este cierre. Reintentos, reconexión, respuestas tardías y pendientes/conflictos:
evidencia automatizada, no nueva prueba de escritura/sync en navegador ni en producción/móvil.
Captura offline inicial transitoria no acredita indicador terminal; sí lo acredita la reapertura final.
402 exclusiones verificadas byte a byte; demás pendientes y prefijos documentales ajenos, índice y HEAD
conservados. Core intacto. Fixtures/perfiles/procesos del ensayo anterior ya limpiados; aquí no se crean.
V11 pausado; auditoría general e incidente histórico «11/11 procesadas, 1 fallo» siguen abiertos.


## Selectores compartidos de fecha y opciones — implementación local — 2026-10-21

Lote UI sobre ba3dd784: calendarios DATE y períodos REPORT reutilizando temporal-input; CompactSelect
simple/múltiple para RECORDS, contextos/estados STATE_UPDATE, contextos Attendance y filtros PANEL.
Relaciones conservan opciones cargadas y handlers; los límites por renderer constan en el cierre.
No se descargan catálogos completos.
Inicio usa los contratos de sesión existentes en un desplegable compacto; sidebar sin cambios.
Sin defaults nuevos, cambios de IDs/valores, handlers de guardado, consultas ni lógica de preparación.
DATE lógico incluido ISO histórico sin desplazamiento UTC; DATETIME conserva su composición previa.
Sólo Attendance limita a hoy y conserva guardas de ruta/estado/reanudación/cambio de día.

206 pruebas / 15 archivos afectados PASS con un worker y timeouts estándar; typecheck, lint afectado
y diff-check PASS. Lint general: cero errores, dos advertencias previas en records-sync.local-db-regression.test.ts,
archivo intacto. Sin suite completa ni build de cierre; export temporal exclusivamente para revisión UI.
Navegador local exclusivo: renderers reales con sesión/API/store sintéticos, tres viewports
1440×900/1024×768/390×844; calendarios, selección múltiple, teclado/foco, sin recortes/overflow,
resize con valores sin solicitudes y contexto compuesto que habilita búsqueda/preparación.
Confirmaciones/conflictos: pruebas automatizadas de handlers/SQLite; no nueva escritura Core ni OPFS.
No se acredita Safari/iPhone físico, binarios nativos ni Inicio autenticado completo. PANEL valida
filtros: el fixture no entrega el dataset del módulo de resultados. Matriz y límites en STATE_UPDATE.

Respaldo duradero: `/home/dannysilver/dev2026/backups/client-form-controls/2026-10-21/`, con inventario,
parche UI/documental aislado, hashes y evidencia sintética. Prefijos documentales previos, trabajo y
regresiones de horarios, 402 exclusiones y demás pendientes preservados. Sin Core, esquema, migración,
namespace, producción, commit, push ni deploy. V11 pausado; incidentes y auditoría general abiertos.


## Cierre técnico — client-form-controls — 2026-10-21

**LISTO TÉCNICAMENTE PARA PUBLICACIÓN ACOTADA; NO PUBLICADO.** Reconstrucción inicial exacta del
respaldo client-form-controls/2026-10-21 sobre ba3dd784: 15 archivos / 44 hunks, con SHA-256 verificados.
La revisión no cambia implementación ni pruebas: los 13 archivos funcionales/de pruebas conservan
sus hashes. Sólo se precisan los límites documentales y se añade este cierre y su sección canónica.

Candidato aislado: suite completa **1137/1137 pruebas, 96 archivos, cero fallos/cero omitidas**, un
worker, timeout estándar 5 s sin overrides. Duración total 64,69 s; prueba más larga 3189 ms. Typecheck,
lint y build web PASS; diff-check de candidato y árbol principal PASS. Lint: cero errores y dos warnings
no-require-imports, líneas182/183 de records-sync.local-db-regression.test.ts, idéntico a HEAD.
El build es el Client completo, no el arnés sintético; API configurada explícitamente https://web.opco.cl,
sin cargar .env ni visitar producción. Dist/service worker generados sólo en el clon temporal, fuera
del lote. El primer build terminó pero la inspección detectó API vacía en su bundle; ese artefacto
se rechazó. Se repitió sólo el build con TMPDIR/caché temporal exclusivos (sin borrar cachés previas):
entry-90d61a13f7b667a42469cce32e6c2b15.js contiene la API pública y epoch2; index/sw coinciden
(sw c4821a3900c41698). Causa de la API vacía inicial NO DETERMINADA, sin atribuirla al lote ni dar
por corregidas las herramientas. Sin fallos de pruebas, timeouts ni EPIPE en esta corrida; no se
explican los incidentes históricos. Checks reutilizables tras cambios exclusivamente documentales.

Inventario confirmado: CompactSelect simple/múltiple y temporal-input compartidos, aplicación a
formulario RECORDS, estados/contextos/extras STATE_UPDATE, fecha/contextos Attendance, filtros PANEL,
mes/rango REPORT y contrato de Inicio. Se conservan calendario local/guardas de Attendance, DATE
lógico e ISO histórico sin conversión, composición DATETIME, IDs/valores y handlers. No cambian API,
consultas, paginación, snapshots, outbox, autorizaciones, conflictos, preparación ni sincronización.

**No es cobertura universal de relaciones ni de todos los escenarios:** RECORDS consulta página1
hasta100 opciones y filtra localmente (RecordFormScreen no conecta onRelationSearch); PANEL conserva
búsqueda remota por texto, página1 hasta100 y filtros escalares. Sus selecciones múltiples no tienen
recorrido capturable acreditado. Extras RELATION de STATE_UPDATE no reciben catálogo/opciones desde
su caller; quedan sin selector editable, como en HEAD. Estas limitaciones son anteriores, verificadas
contra HEAD, y no se amplían en este cierre. Boolean de formularios y acciones de guardado Attendance
siguen como botones; BOARD/DASHBOARD conservan UI de no soportado. Matriz ampliada en STATE_UPDATE.

Se reutilizan las 26 capturas y ensayos previos al comprobar los hashes de ocho archivos web. Sin
nuevo navegador: renderers reales en 1440/1024/390 con respuestas/sesión/store sintéticos. No Safari
físico/iPhone/PWA, binarios nativos ni recorrido Core/OPFS/sincronización acreditados. Inicio completo
no visitado; PANEL sólo filtros sin dataset de resultados; editar RECORDS reutiliza controles, sin
nuevo ensayo visual de guardado. Estos límites no se convierten en validaciones por pasar el build.

Regresiones experimentales de horarios expresamente FUERA del candidato: archivo de ensayo
state-update-schedule-previous-runtime.test.ts, respaldo schedule-runtime-compatibility/2026-10-21.
Resultado previo 5 PASS de caracterización y 2 RED de conservación (alta/actualización); no rerun,
no skip ni eliminación para lograr PASS. Hash6af3a7899e24934b22eab14b6c1bea43eca38c3690c519c088db7e48fe8ed1d6
conservado. Ningún horario integrado/activado, ni revisión de compatibilidad/migraciones/namespace.

Respaldo final independiente, conservando intacto el respaldo fuente:
`/home/dannysilver/dev2026/backups/client-form-controls-close/2026-10-21/`.
Inventario/parche final/hashes, checks sanitizados, reconstrucción exacta y referencias de evidencia.
15 archivos / 44 hunks: 11 implementación, 2 pruebas, 2 secciones documentales. 402 exclusiones,
demás pendientes, prefijos documentales ajenos/horarios, HEAD e índice preservados byte a byte.
Sin Core, datos productivos, migraciones, commit, push ni deploy. V11 pausado; auditoría abierta.


## Contexto compuesto activo: actualización automática real — 2026-10-23

**LISTO PARA PUBLICACIÓN ACOTADA; NO PUBLICADO.** Base main
`f1ab73b3b49c5339ec7707f074afe38880bc62b2`. Cobertura `complete` ya no omite la consulta remota al
entrar/cambiar contexto, reconectar o recibir la señal existente posterior a sync. Se conserva el
coordinador, pool, guardas de sesión/sync, scopes y preparador existentes. Generaciones agrupan
señales concurrentes y conservan una actualización posterior cuando llega invalidación durante la
lectura. Renders/búsquedas no disparan preparación; fallos no generan ciclos. Sin polling ni producto
cartesiano. Inicio, Attendance y modos anteriores no cambian su política.

El marcador anterior no se sustituye por el avance incompleto de una actualización fallida; se
revalida la copia sobreviviente sin restaurar un marcador sobre una invalidación de ACK. El resultado
del intento se comprueba por separado. Cobertura conservada no significa frescura. Sin botón
permanente de actualización: Reintentar sólo ante fallo/parcial online. Cabecera para actividad;
offline usa lo persistido, explica límites y detiene la actividad de preparación. Pendientes,
conflictos, autorización, identidad, claves idempotentes y guardado existentes intactos.

Validación focalizada de implementación: **232/232 pruebas, 16 archivos, cero fallos/cero omitidas**, un worker y
timeouts estándar. Cinco aserciones RED antes de implementar, ahora PASS. Typecheck PASS; lint PASS
con cero errores y dos warnings preexistentes no-require-imports en records-sync.local-db-regression.test.ts
182/183 (archivo intacto). Diff-check PASS. No suite completa ni build de cierre; export local exclusivo
para OPFS, API local explícita y epoch2 comprobados. Detalle de comandos/hashes en checks.json.

Evidencia real Core/PostgreSQL local + Chrome/OPFS: contexto incompleto sin descarga; completar
prepara automáticamente (1 GET fuente + 2 GET current, pageSize1); búsquedas repetidas sin nueva
preparación. Cobertura complete → desconectar → modificar reporte sintético por Core → reconectar
sin botones: cambio remoto persistido, nuevamente 1+2 GET y sin bucle. Fallo controlado de lectura
con copia previa: datos/cobertura conservados, estado terminal y Reintentar; posterior intento único
exitoso. Cierre completo/reapertura con Core y servidor Client detenidos: búsqueda TOLVA muestra
el cambio desde OPFS, cobertura 2/2, un evento distinto, cero pendientes, cero respuestas API exitosas
ni animación indefinida. Sólo fixtures sintéticos propios; no almacenamiento/datos productivos.
Una corrida intermedia terminó con 211 PASS/21 timeouts estándar concentrados en
state-update-prewarm-current-investigation.test.ts; el primer fallo fue bounds requests, 5149 ms.
Archivo intacto: 22/22 PASS al ejecutarlo solo en candidato y HEAD, con un worker/5 s. Causa no
determinada; sin elevar timeouts, omitir casos ni atribuirlo a este cambio. Todas las corridas
(incluida la fallida y su comprobación posterior) quedan registradas en checks.json.
La coordinación ACK/sync y protección de pendientes/conflictos se acreditan mediante regresiones,
no como un nuevo envío real desde navegador. Sin Safari físico. Infraestructura y advertencias del
ensayo (Turbopack/symlink, CSP local, patrón CDP inicial y caché temporal Metro) precisadas en STATE_UPDATE;
no explican los timeouts/EPIPE históricos. Bundle local entry-25fd9f67396a9d24ef2fb0e4456bb9d2.js.

Lote: cuatro archivos de implementación (use-context-preparation, StateUpdateWorkflow,
app-view-prewarm, state-update-current-prewarm), tres pruebas (use-context-preparation,
state-update-context-preparation, state-update-composite) y sólo estas secciones de STATE_UPDATE/STATUS.
Inventario/parche/hashes reproducibles fuera de Git:
`/home/dannysilver/dev2026/backups/state-update-context-refresh/2026-10-23/`.
402 exclusiones y todos los demás pendientes/prefijos documentales/horarios verificados byte a byte;
Core intacto, fixture propio retirado y servicios/perfiles sintéticos cerrados/limpiados. Sin cambios de
esquema/namespace, migraciones, producción, commit, push o deploy. No se integran horarios ni sus
regresiones RED. Incidente «11/11 procesadas, 1 fallo», problemas SQLite/OPFS y auditoría general
permanecen abiertos; V11 pausado.

### Cierre técnico aislado — actualización automática — 2026-10-23

**LISTO PARA PUBLICACIÓN ACOTADA; NO PUBLICADO.** Candidato reconstruido sobre
`f1ab73b3b49c5339ec7707f074afe38880bc62b2` desde el respaldo de implementación: 9 archivos/16 hunks,
SHA-256 y bytes exactos verificados. Los siete archivos de implementación/pruebas permanecen idénticos;
este cierre modifica únicamente las dos secciones documentales propias, conservando sus prefijos ajenos.

Revisión del recorrido: generaciones consumidas al iniciar agrupan renders/señales equivalentes;
una invalidación recibida durante la lectura deja demanda para el siguiente intento. Completar o
fallar una lectura no emite otra invalidación. La señal post-sync existente sólo se consume tras las
guardas de sesión/readiness/sync; no se modifica el sincronizador. Cancelación/controlador y clave
completa aíslan usuario, contrato, AppView, entidades, definición, fecha y combinación. Un fallo
conserva y revalida la copia anterior, sin restaurar un marcador invalidado ni declararla fresca.
Las regresiones cubren agrupación, actualización posterior, fallos terminales/reintento, cambio de
scope/respuestas tardías y conservación durable de pendientes, conflictos, autorización e idempotencia.
Se mantiene el preparador y su pool; sin polling, nuevos disparadores periódicos ni otras experiencias.

Checks del candidato aislado, sin incorporar pendientes experimentales:

- Suite completa: **1152/1152 pruebas, 96 archivos, cero fallos/cero omitidas**, una corrida con un
  worker y timeouts estándar (test 5000 ms, hook 10000 ms), sin nuevos overrides. Duración66,02 s;
  prueba más larga4381 ms. El archivo de los 21 timeouts previos pasó completo. No reaparecieron
  esos timeouts ni EPIPE. Se conserva la corrida histórica211 PASS/21 timeouts, sus casos/duraciones
  y contraste aislado22/22 en candidato y HEAD: causa **no determinada**, no explicada por este PASS.
- `npm run typecheck` PASS. `npm run lint` PASS: cero errores, dos warnings preexistentes
  no-require-imports en records-sync.local-db-regression.test.ts182/183, idéntico a HEAD.
- `npm run build` web PASS, con API pública explícita, sin cargar `.env` y con caché TMPDIR temporal
  propia. Sin warnings/errores de build en esta corrida. No modifica dependencias ni configuración.
- Artefacto: `entry-2bf6c73c75e7565fc9c1e29990a8676a.js`, SHA-256
  `279ecd164608a9c65a4e4dc41723c87cf509bff32562be154b4bb8d77f1c701f`;
  `sw.js` cache `opco-shell-d0048dd572e2d951`, referencia coincidente con index.
  Módulo config compilado ejecutado aisladamente en VM: API efectiva `https://web.opco.cl`, no vacía;
  fuente de createOpcoApi conserva ese default. Cero destinos API locales en el bundle.
  SQLite10 y `opco-client-v10-epoch2.db` comprobados; UI de actualización presente y botón permanente
  ausente. Es inspección del artefacto local, sin ejecutar la app ni hacer solicitudes productivas.
- `git diff --check` y diff-check del índice del clon PASS. Parche final reconstruido de nuevo;
  hashes de cada archivo y ausencia de secretos, `.env`, bases, capturas, dist o logs en el lote verificados.

Se reutiliza íntegra la evidencia Core/PostgreSQL local + Chrome/OPFS por identidad funcional:
selección completa, cambio remoto mientras offline, actualización al reconectar sin botón, fallo
controlado/reintento y cierre/reapertura offline del mismo perfil con ambos servidores detenidos.
ACK, concurrencia y conservación de intenciones siguen acreditados mediante automatización, sin
convertirlos en nuevo recorrido de escritura Chrome. Sin nuevo navegador ni Safari físico; sin
estabilidad general, nuevas garantías de multi-tab ni correlación con incidentes productivos.

Respaldo final independiente:
`/home/dannysilver/dev2026/backups/state-update-context-refresh-close/2026-10-23/`.
Inventario9 archivos/16 hunks, parche, checks, SHA256SUMS, reconstrucción y evidencia heredada con hashes.
El respaldo fuente permanece intacto. 402 exclusiones, horarios/RED y demás pendientes conservados
byte a byte; main/HEAD e índice habituales sin cambios. Core, esquema, namespace y datos productivos
intactos; sin commit/push/deploy. V11 pausado, auditoría general e incidente «11/11 procesadas,1 fallo»
abiertos. El cierre no identifica ni resuelve las causas históricas SQLite/OPFS o timeouts/EPIPE.
