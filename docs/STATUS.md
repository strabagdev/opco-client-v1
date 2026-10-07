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
