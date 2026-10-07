# Auditoria Offline-First

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


Fecha de corte original: 2026-09-22. Este documento contrasta la arquitectura documentada con el
codigo actual. La verificacion de resiliencia RECORDS del 2026-09-23 conserva evidencia historica de un arbol
experimental respaldado. La matriz de cierre 2026-09-28 distingue ese antecedente de la correccion
publicada en `a0d24a6dfc362004fad102bc586c564ef4471601` y de propuestas aun no implementadas.

Fuentes canonicas leidas:

- Client: `AGENTS.md`, `docs/CLIENT_ARCHITECTURE.md`, `docs/STATE_UPDATE.md` y `docs/STATUS.md`.
- Core: `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/STATE_UPDATE.md`, `docs/EXTERNAL_API.md`,
  `docs/HARDENING.md`, `docs/OPERATIONS.md`, `docs/DEVELOPMENT.md` y `docs/STATUS.md`.
- Implementacion y pruebas citadas en cada seccion.

## Clasificacion De Evidencia

- **Existente**: comportamiento implementado y alineado con la documentacion canonica.
- **Limitacion documentada**: frontera conocida; no implica defecto.
- **Defecto demostrado**: comportamiento reproducido o contradiccion directa entre telemetria y
  trabajo ejecutado.
- **No verificado aqui**: falta evidencia real en esta auditoria; no significa ausente ni roto.
- **Pregunta pendiente**: requiere requisito o prueba adicional antes de calificarlo como brecha.

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

Inventario completo: `STATUS.md`, seccion Inventario Final Exacto.

## Resolucion De Conflictos STATE_UPDATE 2026-10-03

Correccion exclusiva de identidad exacta, atomicidad y resultado verificable. **La auditoria general sigue
abierta.** La evidencia y el inventario de 12 archivos estan en `STATUS.md`; el contrato local esta en
`STATE_UPDATE.md`. Se conservaron los 21 archivos inicialmente pendientes de `main`.

| Limite demostrado | Correccion | Evidencia focalizada |
| --- | --- | --- |
| `Usar Opco` elegia la ultima fila del sujeto y borraba outbox fuera de una restauracion atomica. | Seleccion por `localRecordId` + snapshot/request durable y scope completo; validacion, DELETE exacto y restauracion en una transaccion del coordinador compartido. | Regresiones iniciales fallaban; SQLite real en memoria y OPFS real conservaron todos los valores/outbox ante fallo inyectado. Dos append del mismo sujeto: resolver el mas antiguo dejo el otro conflicto/outbox intactos. |
| Una seleccion o respuesta anterior podia actuar sobre una intencion sustituida. | Ambas acciones revalidan la seleccion dentro de la transaccion. Completion/conflict/retry/failure verifican el request durable antes de escribir. Ninguna transaccion espera la red. | Guardado real de otra edicion durante respuesta retenida completa antes de liberar red; la respuesta vieja no consume ni sobrescribe su outbox/valores. Scope equivocado y seleccion sustituida fallan explicitamente. |
| Finalizar sync global producia feedback de confirmacion sin comprobar la fila elegida. | Lectura conjunta de fila/outbox seleccionadas; marca del request confirmado, remoto/version y outbox ausente; feedback separado local/pending/confirmed/conflict/failed/superseded. | Chrome mostro resolucion local con otro conflicto presente, confirmacion de `remote-b` y latest correcto, nuevo CONFLICT conservado y POST con socket cerrado como envio pendiente. Respuesta mal formada se mostro como fallo con outbox conservada. |
| Releer el resultado append intentaba duplicar el remoto y un refresh perdia la marca de confirmacion. | Reusar exclusivamente la fila ya vinculada al remoto en el mismo scope; conservar marca solo si remoto/version/estados/extras coinciden. | Dos regresiones SQLite fallaron antes del ajuste; Chrome mostro el estado y registro remoto correctos despues de ambas acciones. Un resultado para otro remoto se rechaza sin consumir outbox. |

Siete regresiones adicionales ejecutan los handlers reales del renderer con colaboradores controlados:
7/7 fallaron contra la copia inicial, incluyendo la falsa confirmacion de pending/conflict/failed/superseded,
la omision de identidad seleccionada y el feedback tardio fuera del scope. No son una copia del handler
ni una prueba de DOM; Chrome aporta la evidencia de presentacion.

Checks finales: **269/269 tests en 10 archivos afectados**, typecheck PASS, lint sin errores y con los dos
warnings RECORDS preexistentes, `git diff --check` PASS. Sin suite completa, build/export, Playwright,
commit, push ni deploy. No se cambio Core, wire/API, esquema/migraciones, dependencias ni configuracion.
Solo metadata interna en los JSON existentes; sin nueva cola ni sincronizador.

Chrome/CDP 9351 uso un perfil exclusivo, API sintetica localhost 19350, Metro 19351 y proxy localhost 19352
con COOP/COEP; `crossOriginIsolated=true`, singleton ready y OPFS/WASM real. La copia de bundle servida por
el proxy apuntaba al fixture porque el entorno virtual de Metro conservaba la URL de `.env.local` pese al
override CLI. No se edito configuracion ni se uso Core para crear o modificar fixtures; la tentativa
inicial de bootstrap al destino local anterior no obtuvo contexto/datos. Sin acceso a produccion.
Datos, perfil y procesos temporales se limpiaron exclusivamente al terminar.

Limites vigentes: el fixture de contrato no acredita Core/PostgreSQL, movil ni todas las carreras de UI;
la prueba de respuesta tardia con edicion concurrente es una regresion controlada del engine. El fallo
fisico/cuota OPFS no se simulo. Conflictos antiguos sin id remoto retenido no reconstruyen ese dato;
la verificacion adicional usa el snapshot nuevo o server id disponible. La navegacion completa reprodujo
`ACCESS_HANDLE_BUSY`: cerrar/reabrir el perfil sin reset conservo las intenciones. No se corrigieron el
indice entre AppViews, contenido retenido entre AppViews, resumen RECORDS, REPORT, recovery OPFS ni la
causa productiva de `Error finalizing statement`. La anomalia del fixture Core anterior en `latest`
permanece sin diagnostico; esta etapa aporta evidencia nueva de presentacion con fixtures de contrato.

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
4. **`latest` después de resolver conflicto STATE_UPDATE**: el fixture Core anterior no devolvio el target
   concurrente y sigue sin diagnostico. La evidencia visible nueva verifica exclusivamente remote-b/remote-c
   con API sintetica y OPFS real (CDP 9351); no se generaliza a todas las respuestas Core.
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

## Auditoria De Robustez Funcional 2026-10-02

Esta seccion es el estado vigente de la garantia offline y reemplaza, para conclusiones actuales, las
caracterizaciones historicas inferiores. La prioridad fue acceso a datos, intencion durable, continuidad
de otras experiencias y recuperacion; `Listo` se evaluo solo como una señal secundaria.

### Evidencia Real Y Limites

- Chrome 153 de Windows uso CDP `9341`, un perfil exclusivo desechable y el export Web local. El service
  worker `opco-shell-f58a605d49b79c37` quedo controlador y reporto shell completo. SQLite fue Expo
  OPFS/WASM real; no se inspecciono ni reinicializo el almacenamiento habitual.
- Core uso solo PostgreSQL local, con `DATABASE_URL` cargada desde `operational-core/.env.local`, validada
  como `opco_dev@127.0.0.1:5432/opco_development` y pasada explicitamente. Se agrego
  `http://localhost:3003` a CORS solo en el proceso local.
- Se crearon fixtures sinteticos aislados para STATE_UPDATE, Attendance y REPORT. RECORDS y PANEL locales
  se usaron sin modificarlos. La preparacion termino `completed`, `5/5`, `failed 0`, mientras Inicio
  seguia marcando PANEL y REPORT como `Requiere conexion`.
- Para la primera apertura offline, CDP mantuvo una unica sesion con red bloqueada y un `fetch` directo a
  Core termino `blocked`. Para el reinicio offline, Core y el servidor estatico se detuvieron antes de
  cerrar Chrome; el mismo perfil reabrio Inicio y las experiencias desde service worker + OPFS.
- La etapa original reutilizó 842 tests; el cierre acumulado superior ejecutó 850 tests, typecheck, lint
  y build sobre el árbol actual. La evidencia de respuesta perdida/idempotencia y Chrome se reutiliza
  con sus límites, sin presentarla como un recorrido nuevo.

### Matriz De Capacidades

| Superficie | Recursos y cobertura acreditable | Lectura/escritura offline | Acreditacion e invalidacion | Observado | Estado |
| --- | --- | --- | --- | --- | --- |
| Inicio | Shell SW, sesion recuperable, contrato seleccionado y lista AppViews scoped por owner+contrato. No acredita datos de cada renderer. | Abre la navegacion cacheada; no escribe negocio. | Shell y navegacion se invalidan por version/cache; AppViews por owner, contrato y asignaciones. `processed N/N` solo acredita resultados terminales. | Reabrio sin ambos servidores. `5/5` coexistio con RECORDS sin datos iniciales y PANEL/REPORT sin snapshot. | Shell durable: **PASS**. Garantia global de datos: **parcial por diseño**. |
| RECORDS | Definicion y entidad; datos solo tras full refresh completo. Una busqueda/pagina parcial no acredita coleccion. Relaciones usan nombres incluidos en los records cacheados. | Lista/busqueda/pagina local; CREATE/UPDATE atomicos con outbox. | `lastFullRefreshCompletedAt`, owner+contrato+entidad. Cambio de scope no reutiliza records; una definicion nueva no convierte una carga parcial en completa. | Primera apertura offline sin visita fallo de forma terminal. Tras visita, reinicio offline mostro seis records y controles. Evidencia previa cubre A/B, respuesta perdida e idempotencia. | **PASS condicionado a full refresh previo**. |
| STATE_UPDATE | Definicion, nombres, entidad source completa y snapshot target por owner+contrato+AppView+entidad+fecha; cobertura `complete/partial/absent`. | Primera apertura, busqueda y cambio local con outbox compartida. | `complete` se escribe despues del snapshot; paginacion parcial y fallo no acreditan completo. Cambio de fecha/AppView/configuracion usa otro scope. | Primera apertura offline mostro el snapshot. Un conflicto real sobrevivio reinicio, reconexion y GET remoto; ambas versiones/acciones siguieron visibles hasta resolucion explicita, sin reenvio automatico. | Datos y recuperacion de conflicto: **PASS**. |
| Attendance | Definicion, source completo y dias completos del mes actual. Cada dia solo se acredita si `latest` cubre `summary.totalRegistered`; dias incompletos dejan mes parcial. | Busqueda y STATE_UPDATE compartido; escritura depende de que el dia visible sea compatible. | Owner+contrato+AppView+target+fecha; la publicacion exige ademas request y scope visibles vigentes. Fallo o ausencia no acreditan el dia. | Chrome/OPFS real: primera apertura online y primera apertura offline sin visita mostraron total/fila/estado; cierre y reapertura con red cortada conservaron el resultado. | **PASS para dia preparado**; cobertura sigue siendo por fecha. |
| PANEL | Snapshot exacto por owner+contrato+AppView+revision+dataset+filtros+busqueda+pagina+pageSize. Prewarm global no ejecuta datasets. | Solo lectura; filtros/paginacion funcionan dentro de snapshots exactos ya visitados. | Cambio de revision o query impide reutilizar contenido incompatible. Persistencia fallida no genera snapshot. | Sin visita mostro error terminal; tras visita y reinicio offline mostro KPI, seis filas y paginacion. | **PASS por query visitada**; no hay cobertura global. |
| REPORT | Snapshot exacto por owner+contrato+AppView+periodo/busqueda. Prewarm global no ejecuta reportes. | Solo lectura; cada periodo/query requiere snapshot compatible. | Cambio de query o AppView no reutiliza otra respuesta; fallo de persistencia deja el recurso ausente. | Sin visita mostro error terminal; tras visita y reinicio offline mostro una fila. Un estado SELECT de proyeccion STATE_UPDATE aparecio como `[object Object]` online y offline. | Persistencia: **PASS por query**. Presentacion: **DEFECTO P2**. |

`Listo` actualmente comprueba solo sesion online sin actividad, pendientes o errores conocidos en sus
entradas globales. No comprueba que cada AppView tenga recursos de apertura, que un snapshot exacto exista
ni que una intencion conflictiva tenga una accion visible. Por eso no debe interpretarse como garantia
offline, aunque el texto sea coherente con su contrato actual.

### Defectos Priorizados

1. **CORREGIDO - conflicto STATE_UPDATE durable oculto online.** El defecto demostrado era de proyeccion:
   el GET remoto reemplazaba resumen/contenido visible sin fusionar el conflicto que seguia correctamente
   en SQLite. El renderer consulta ahora el scope completo, superpone la intencion local y conserva la
   version remota y las acciones explicitas. Chrome/OPFS real verifico reconexion, cierre/reapertura,
   aislamiento de otra AppView y resolucion local con un solo registro remoto. GET/refresh no resuelve ni
   reenvia conflictos; callbacks de lecturas invalidadas no pueden restaurarlos.
2. **CORREGIDO - Attendance no acreditaba el dia en la carga inicial.** El efecto inicial online/offline
   hidrataba statuses, latest, resumen y `daySnapshotHydrated`, pero no publicaba `loadedDate`; el retry,
   en cambio, lo publicaba desde `finally` incluso tras fallo. Datos y fecha ahora se publican desde la
   misma lectura valida, con request y scope completos vigentes. Remoto exitoso y snapshot local preparado
   acreditan; ausencia/fallo no. Chrome/OPFS real cubre primera apertura sin visita y reapertura offline;
   orden inverso, vacio valido, ausencia y fallo quedan cubiertos de forma automatizada.
3. **P2 - un conflicto STATE_UPDATE contamina la advertencia RECORDS.** `getRecordsSyncSummary()` agrupa
   todos los `entity_records` no resueltos por owner+contrato, sin entidad ni tipo de operacion. Con un
   conflicto en la entidad target del workflow, RECORDS de Personas mostro `Hay cambios que requieren
   revision` y `Ver cambios afectados`. Los seis records siguieron utilizables. Correccion minima:
   scopear el resumen y su ruta de problemas por la entidad RECORDS activa y excluir operaciones
   `STATE_UPDATE`; conservar el resumen global en cabecera/diagnostico.
4. **P2 - hard navigation puede dejar OPFS temporalmente ocupado.** Una navegacion CDP completa en la
   misma pestaña produjo primero el bloqueo de una sola pestaña y despues `No pudimos abrir los datos
   guardados`. No se restablecio almacenamiento: cerrar Chrome por completo y reabrir el perfil libero el
   Access Handle y preservo snapshots/outbox. No bloqueo navegacion SPA normal. Correccion minima propuesta:
   reintento acotado de apertura despues de liberar el runtime anterior, sin ofrecer reset como primera
   salida y sin ampliar a soporte multi-tab.
5. **P2 - REPORT STATE_UPDATE muestra SELECT como objeto.** Core devolvio una proyeccion valida y el
   snapshot sobrevivio offline, pero Client aplico `String(value)` al objeto de estado y presento
   `[object Object]` incluso con `valueDisplay=LABEL`. Es independiente de persistencia. Correccion minima:
   normalizar el valor proyectado por `optionId/label` en la frontera REPORT y agregar regresion online/cache.

Se mantienen separados: la causa productiva de `Error finalizing statement` sigue sin confirmar; la
colision SQLite de dos AppViews sobre el mismo `server_id` continua como restriccion inducida; y el contenido
retenido al cambiar de AppView conserva su reproduccion independiente. Ninguno queda resuelto por esta
auditoria.

### Contrato Propuesto

- **Shell disponible**: service worker controlador y precache completo. No implica datos.
- **Datos disponibles**: todos los recursos obligatorios del scope vigente tienen marcador durable
  posterior a su persistencia. Colecciones parciales, queries no visitadas y configuraciones anteriores no
  cuentan como completas. Un vacio completo es dato valido; ausencia no es `sin registros`.
- **Cambios pendientes**: intencion/outbox durable, separada de disponibilidad de lectura. `Pendiente` no
  promete envio; red, sesion y permisos aun deben validarse.
- **Requiere atencion**: `failed`, `conflict`, inconsistencia outbox/record o storage inaccesible. Debe
  existir una accion scoped para resolver/reintentar sin borrar otras intenciones.
- **Cobertura parcial**: muestra recursos/fechas/queries acreditados frente a los requeridos. `Procesadas
  N/N` sigue siendo avance terminal, no disponibilidad.
- **Listo** puede conservar su significado operativo online, pero cualquier resumen de garantia offline
  debe derivarse del ledger anterior y mostrar `Disponible`, `Parcial`, `No preparado` o `Requiere
  atencion` por AppView. Usuario, contrato, AppView, revision/configuracion, entidad, fecha y query forman
  parte de la clave de vigencia.

Permisos revocados, validacion definitiva y conflictos reales nunca garantizan sincronizacion exitosa.
Deben detener el retry automatico, conservar la intencion local y ofrecer resolucion explicita. Respuesta
perdida y timeout conservan el mismo `clientRequestId`; la evidencia automatizada vigente y la traza
RECORDS A/B previa cubren replay idempotente sin aplicar dos veces.

## Cierre Cobertura STATE_UPDATE 2026-10-02

| Invariante | Implementación | Evidencia |
| --- | --- | --- |
| Primera apertura offline | Prewarm persiste `items/latest`, definición con nombres y cobertura target antes de acreditar el recurso. | Automatizada y Chrome/OPFS real sin visita previa. |
| Cobertura | `app_metadata` scoped distingue `complete`, `partial` y ausencia; sólo página 1 sin `hasMore` es completa. | Regresiones de completo, parcial, fallo de persistencia y aislamiento entre AppViews. |
| Fecha lógica | Escritura/lectura usan `YYYY-MM-DD`; snapshots ISO anteriores se seleccionan por prefijo sin conversión de zona. | Regresiones ISO/date-only y reapertura real de snapshot fechado. |
| Vacío vs ausencia | Vacío completo muestra `Sin actualizaciones`; ausencia, parcial y error tienen estados diferentes. | Prueba pura de transiciones y recorrido real con una fila. |
| Intención local | Reconciliación conserva cambios pendientes no coincidentes; no cambia outbox ni sincronización. | Regresión local existente más cobertura focalizada de snapshot. |
| Nombres | La definición preparada conserva nombres source/target; cachés anteriores usan etiquetas neutrales. | Regresión de definición y Chrome real sin id técnico visible. |
| Persistencia | Snapshot siguió disponible tras reiniciar Chrome; el endpoint STATE_UPDATE quedó bloqueado antes de reabrir offline. | Chrome 153/CDP con Expo SQLite OPFS/WASM real. |

No hubo migración ni cambio de esquema, API, dependencia, outbox o política de una pestaña. El error
productivo `Error finalizing statement` no se declara resuelto: la restricción SQLite inducida y la
retención de contenido entre AppViews continúan fuera de esta etapa.

## Cobertura Offline STATE_UPDATE 2026-10-02 (Diagnostico Previo)

Esta seccion conserva la reproduccion anterior a la correccion pendiente del worktree. No describe el
comportamiento vigente; el cierre y la matriz de robustez superiores la reemplazan para decisiones actuales.

| Superficie | Que prepara globalmente | Que significa terminal | Cobertura offline efectiva / brecha demostrada |
| --- | --- | --- | --- |
| RECORDS | Definicion asignada. Los registros siguen siendo demand-cached. | `success` al guardar definicion; cuenta como procesada. | Requiere un full refresh exitoso propio para estar lista. Busquedas o paginas parciales no cuentan como hidratacion completa. |
| Attendance | Definicion, entidad origen, todas las paginas origen y snapshots diarios del mes actual. | La AppView puede ser `success` aunque fallen dias individuales, porque esos fallos se conservan para reintento posterior. | Readiness distingue mes `complete`, `partial` y `none`; procesada no equivale a mes completo. |
| STATE_UPDATE generico | Respuesta inicial de workflow, definicion de entidad origen, todas las paginas origen y definicion preparada. | Devuelve `success` despues de guardar la definicion; readiness exige solamente source hydration. | La respuesta `items/latest` se descarta, no existe marcador target y una fecha ISO guardada no coincide con el scope date-only. Puede abrir como `Sin actualizaciones` con target ausente o inaccesible. |
| REPORT / PANEL | Definicion `unsupported` para prewarm; snapshots exactos se crean al consultar. | `skipped`, pero cuenta como procesada. | La cobertura depende de snapshots exactos visitados, no del contador global. |
| BOARD / DASHBOARD / workflow desconocido | Definicion controlada sin datos. | `skipped`, pero cuenta como procesada. | Sin cobertura de datos offline por prewarm. |

`10/10` es `appViewCompletedAt` para diez entradas; incluye exito, fallo y omitida como procesadas. Un
run global `completed` excluye resultados `failed`, pero no excluye `skipped` ni garantiza recursos de
apertura. Para STATE_UPDATE tampoco valida hoy el snapshot target ni su paginacion.

| Hallazgo | Evidencia | Clasificacion | Siguiente paso |
| --- | --- | --- | --- |
| Prewarm STATE_UPDATE omite historial inicial. | Test focalizado: una respuesta con un `latest` termina `completed 1/1`, hidrata source y deja cero snapshots target. Chrome/OPFS real: `3/3 completed`, busqueda offline encontro dos sujetos, pero ambos quedaron `Sin estado` y latest quedo vacio antes de visitar. | Defecto demostrado de cobertura/readiness. | Persistir la respuesta inicial y agregar hydration target scoped con estados complete/partial/absent. |
| Snapshot visitado no coincide con consulta offline por fecha. | Online mostro un latest y persistio un local `synced`; diagnostico seguro mostro fecha `2026-10-02T00:00:00.000Z`. El scope offline consulta `2026-10-02` con igualdad JSON y devolvio cero. | Defecto demostrado de normalizacion date-only. | Canonicalizar a `YYYY-MM-DD` al normalizar/persistir y cubrir reapertura offline. |
| Identificador como subtitulo. | La definicion preparada conserva ids, no nombres; la respuesta offline usa `targetEntityTypeId` como `name`. | Recurso de presentacion omitido, no fallo de Core. | Conservar nombres sanitizados de source/target en la definicion preparada. |
| `Sin actualizaciones` es ambiguo. | Source hydration por si sola habilita la respuesta; no hay marcador target. La lista vacia tambien se renderiza aunque una lectura produzca error y quede otra respuesta visible. | Defecto demostrado de clasificacion/presentacion. | Separar vacio remoto confirmado, no descargado, parcial y lectura fallida. |
| Finalizacion y contenido entre AppViews. | Un fixture duplicado sobre el mismo registro produjo `transaction:attendance-snapshot error` y `Error finalizing statement`; la respuesta anterior siguio visible bajo el titulo nuevo y la telemetria la trato como completada. | Defecto real inducido localmente; no prueba la causa del incidente reportado. | Preservar causa primaria y scopear response/telemetria por `appView.id` en una etapa separada. |

Evidencia real: Chrome de Windows/CDP, perfil desechable y Expo SQLite OPFS/WASM contra Core/PostgreSQL
locales; no se tomo captura ni se leyo una base productiva. La evidencia automatizada usa API/store
controlados. Falta el diagnostico seguro del incidente original para saber si compartia target, si fallo
otra operacion SQLite o si el unico problema fue cobertura/fecha.

## Diagnostico De Finalizacion SQLite 2026-10-02

| Hallazgo | Evidencia | Clasificacion | Siguiente paso |
| --- | --- | --- | --- |
| `Error finalizing statement` puede ocultar el fallo anterior. | Expo SQLite 57 ejecuta `finalizeAsync` en `finally`, y el worker Web reemplaza el codigo de `sqlite3_finalize` por ese texto generico. Un test temporal con statement controlado reprodujo la sustitucion. REPORT/PANEL ademas pueden sustituir el error original si falla su lectura de snapshot dentro del `catch`. | Defecto demostrado de preservacion de contexto; no demuestra la causa original del incidente. | Conservar error primario y causa segura en la frontera confirmada despues de identificar la operacion real. |
| Busqueda durante otra actualizacion. | El arnes controlado dejo una solicitud REPORT anterior pendiente y completo la busqueda nueva; los snapshots se separaron por query. El coordinador serial actual deja la operacion SQLite en cola y continua despues de errores. | Existente, con mocks; no validado en OPFS para este incidente. | No cambiar concurrencia, cache ni timeouts sin una reproduccion real. |
| Filas visibles junto al error. | La reproduccion STATE_UPDATE posterior retuvo la respuesta de la AppView anterior al cambiar de id y fallar el nuevo snapshot. | Defecto demostrado de scope visual; la colision fue inducida y no confirma la causa productiva. | Scopear response por AppView en una etapa separada. |
| Cabecera `Listo`. | Con esa respuesta retenida, opening telemetry clasifico la vista como completada aunque la lectura nueva fallo; el indicador volvio a `Listo`. | Incoherencia demostrada bajo el fixture duplicado, no bajo el incidente original. | Corregir junto al scope de respuesta, sin cambiar prioridades globales. |
| Riesgo de datos. | Las rutas candidatas de busqueda escriben cache/snapshot, no outbox ni Core. No se borro, reinicializo ni inspecciono almacenamiento del usuario. | Sin evidencia de perdida de intencion local; posible snapshot nuevo no persistido. | Mantener snapshots/outbox y evitar reset como diagnostico. |

La corrida focalizada valida uso de API/store/statements simulados: 7 tests seleccionados en 3 archivos.
No es evidencia SQLite real. El intento posterior de importar `SQLiteDatabase` real en Vitest no recolecto
tests por Flow de React Native en el arnes Node. La evidencia OPFS historica del 2026-09-23 corresponde a
otro escenario y no confirma el origen de `Versionado Procedimientos`.

## Matriz De Cierre RECORDS 2026-09-28

La tabla separa pruebas automatizadas con API controlada/SQLite stateful de evidencia obtenida en
Chrome con Expo SQLite OPFS/WASM real. Una prueba con mocks nunca se clasifica como validacion real
de navegador o Core.

El cierre tecnico final sobre el worktree no publicado paso 69 archivos y 817 pruebas, typecheck, lint y
build Web local. Las tres trazas Chrome/CDP y la integracion PostgreSQL se reutilizan sin atribuirles una
nueva ejecucion; el HEAD base publicado sigue siendo `a0d24a6dfc362004fad102bc586c564ef4471601`.

| Escenario | Comportamiento esperado | Evidencia disponible | Prueba asociada | Estado | Commit publicado | Limitaciones |
| --- | --- | --- | --- | --- | --- | --- |
| UPDATE A->B | La respuesta de A no elimina ni reemplaza B; B conserva valores, outbox y base remota confirmada, y luego puede sincronizarse. | Ademas del arnes stateful, Chrome/CDP con OPFS/WASM real perdio la respuesta de A, guardo B offline, reinicio, reprodujo A y envio B con otra clave sobre la version confirmada. PostgreSQL termino en B con dos mutaciones/auditorias. | `records-sync.local-db-regression.test.ts`: `keeps B locally visible...`, `preserves B across lost A...`; traza `CDP_SENTCOMMAND_S2_FINAL2_20260928`. | Correccion en el worktree verificada automaticamente y en navegador/Core locales. | `a0d24a6dfc362004fad102bc586c564ef4471601` no contiene la integracion PATCH ni el guard nuevo. | Datos sinteticos locales; no valida movil ni produccion. No se leyo el payload OPFS directamente. |
| CREATE->UPDATE durante envio | El registro pendiente abre por `local_id`; confirmar CREATE asigna `server_id`, conserva B como UPDATE y termina con un solo registro remoto. | Arnes stateful cubre un POST y un PATCH. Chrome real abrio/edito el pendiente y B sobrevivio respuesta y reinicio; Core/PostgreSQL local termino con un registro B. | `records-sync.local-db-regression.test.ts`: `turns CREATE followed...`; `offline-records.test.ts` para apertura local/remota. | Implementado y publicado; evidencia final de navegador parcial. | `a0d24a6dfc362004fad102bc586c564ef4471601` | La entrega final CREATE->UPDATE no tiene una traza CDP unica e ininterrumpida; el resultado DB no sustituye esa traza. |
| Resolucion `local_id`/`server_id` | Una ruta con `local_id` abre el pendiente sin consultar Core y sigue funcionando despues de conocer `server_id`, usando siempre owner+contrato+entidad. | Pruebas focalizadas y apertura/edicion en Chrome OPFS/WASM con perfil aislado. | `offline-records.test.ts`: `opens a pending CREATE...` y `keeps a local-id route accessible...`. | Implementado y publicado. | `a0d24a6dfc362004fad102bc586c564ef4471601` | La prueba automatizada usa store controlado; Chrome fue local y sintetico. |
| Conflicto visual obsoleto | Al completar A, si SQLite ya dejo B `pending_update`, la pantalla montada recarga ese estado; conflictos realmente persistidos siguen visibles. Una lectura ya no crea conflicto mientras A tenga `sentCommand` sin resolver. | El arnes stateful y Chrome/CDP real observaron GET posteriores al 200 descartado con A/B local pendiente y sin conflicto. El escenario de cambio ajeno conservo un conflicto real visible. | `records-sync.local-db-regression.test.ts`: `does not persist a read conflict...`; trazas S1/S3 del cierre actual. | Guard de lectura verificado en navegador local; conflictos reales siguen visibles. | `a0d24a6dfc362004fad102bc586c564ef4471601` no contiene el guard nuevo. | La observacion Access Handle/HMR requiere evitar recargas completas simultaneas; no se amplio esa investigacion. |
| PATCH aplicado con respuesta perdida | Persistir el comando exacto antes de PATCH; las lecturas conservan valores/base/descriptor y elegibilidad; reintentar A con la misma clave/version sin GET; si B existe, conservarla y luego preflight con la version confirmada de A. | Arnes stateful mas tres trazas Chrome/CDP con SQLite OPFS/WASM, Core y PostgreSQL locales: S1 replay exacto y una mutacion; S2 B con clave distinta/dos mutaciones; S3 cambio ajeno, conflicto B y cero PATCH B. | `records-sync.local-db-regression.test.ts`: replay/lecturas/B/conflicto; trazas `CDP_SENTCOMMAND_S1_20260928_1700`, `S2_FINAL2` y `S3_FINAL`. | Corregido y verificado automaticamente y en navegador/Core locales; no publicado. | `a0d24a6dfc362004fad102bc586c564ef4471601` no contiene este ajuste. | CDP probo comportamiento y persistencia de archivos OPFS, no decodifico `sentCommand` desde la base. La prueba es Web local, no movil/produccion. |

La ejecucion local informada por el usuario completo 5/5 AppViews, cero fallos, en 7686 ms. Confirma
una preparacion online correcta. No prueba por si sola arranque offline, OPFS tras recarga ni cuanto
de la mejora temporal corresponde a la deduplicacion de definiciones.

## Evidencia De Navegador 2026-09-23

Esta evidencia pertenece al arbol preconsolidacion respaldado. Demuestra el defecto y el resultado
del experimento, pero no sustituye la evidencia de la publicacion actual resumida en la matriz de cierre.

Se genero un export Web cuyo bundle contenia `http://localhost:3003` y no contenia el destino de
produccion ni `localhost:3000`. Chrome uso origen `localhost:19102`, perfil temporal aislado,
service worker controlador, `crossOriginIsolated=true` y el directorio OPFS `expo-sqlite`. Las
pausas fueron eventos CDP `Fetch.requestPaused`; no se agregaron retardos al producto ni se edito la
outbox manualmente.

| Escenario | Comportamiento/evidencia | Defecto y correccion | Riesgo pendiente |
| --- | --- | --- | --- |
| UPDATE -> UPDATE | Core respondio `200` a A=`Taller` mientras la respuesta seguia retenida. La UI confirmo `1 cambio pendiente`; B=`Bodega` produjo un segundo PATCH y Core respondio `200`. La lista termino sin pendientes. | OPFS primero reprodujo `Error finalizing statement`: se intentaba violar el indice de un UPDATE por registro. B ahora reemplaza la fila con nueva identidad y la respuesta A solo borra si esa identidad aun coincide. | La prueba uso respuestas locales controladas, no red movil real. |
| Recarga entre A y B | El GET preflight de B se pauso y aborto antes de Core; una recarga mantuvo service worker/OPFS y la intencion. | Se reprodujo `1 sincronizando` indefinido. La apertura ahora restaura atomicamente outbox interrumpida a pendiente; el ciclo recuperado envio B y termino sin pendientes. | La captura final del PATCH recuperado se confirma por Core/estado final, no por un segundo interceptor tras reload. |
| CREATE -> UPDATE | Cubierto por `records-sync.persistence.test.ts`: un POST, propagacion de `server_id`, un PATCH, una fila remota logica. | Sin defecto adicional en el arnes stateful. | No completado en Chrome: la instancia PostgreSQL local desaparecio tras interrumpirse la corrida y no se recreo ni migro. |
| Conflicto remoto real | El arnes stateful cambia la version remota entre A y el preflight de B; conserva B y marca conflicto sin segundo PATCH. | La base no se actualiza ciegamente; se usa el `updatedAt` aceptado por A solo mientras el preflight remoto coincide. | No completado con segundo contexto de navegador por la misma perdida de PostgreSQL local. |

Las pruebas Vitest anteriores usan mocks de SQLite/API, aunque atraviesan los metodos reales de
persistencia y sincronizacion. Solo las dos primeras filas tienen evidencia de Chrome con OPFS/WASM
real. No se tocaron PME, produccion, configuracion versionada ni contratos de Core.

## Sintesis De La Arquitectura Actual

### Limites Y Autoridad

Operational Core es la autoridad online. Client administra UI, cache local, intencion no resuelta,
orquestacion y diagnostico. SQLite/OPFS no es una segunda base autoritativa: contiene snapshots,
metadata, telemetria y outbox durable. El service worker conserva solo shell y assets; no cachea API,
no escribe SQLite y no sincroniza (`CLIENT_ARCHITECTURE.md`, System Boundaries y PWA Reload).

Un arranque offline web fue disenado como:

```text
shell PWA -> bundle -> SQLite/migraciones -> token+ownerKey -> contexto cacheado
-> AppViews asignadas cacheadas -> definicion preparada -> datos locales
```

Sin contexto autorizado cacheado no se presentan datos offline. SQLite indisponible lleva a recovery,
no a reset automatico (`CLIENT_ARCHITECTURE.md`, Offline Cold Start y SQLite/OPFS Recovery).

### Aislamiento Y Almacenamiento

- `context_snapshot` se aisla por `ownerKey`.
- AppViews y definiciones preparadas se aislan por owner, contrato y AppView.
- Registros y telemetria RECORDS se aislan por owner, contrato y entidad.
- Intencion workflow agrega semantica de AppView, sujeto, fecha, unicidad e historia.
- REPORT agrega consulta; PANEL agrega dataset, consulta y `configRevision`.
- Las definiciones de entidad usan contrato+entidad deliberadamente: Core entrega la misma metadata a
  ADMIN y MEMBER con acceso al contrato. Si Core introduce shaping por usuario/AppView, la propia
  arquitectura exige migrar el scope antes de habilitarlo (`CLIENT_ARCHITECTURE.md`, Entity
  Definitions Scope).

Todos los consumidores comparten un singleton SQLite y un coordinador serial. Migraciones son
single-flight y las transacciones no admiten que otra operacion entre a mitad. La indisponibilidad de
SQLite se propaga; reset requiere confirmacion explicita (`src/lib/local-db.ts`).

### Navegacion Y Preparacion

La lista de AppViews inicia lectura owner-scoped y `GET /views` en paralelo. Un cache autorizado util
puede montar el renderer antes de red; un resultado remoto no espera a que SQLite persista el cache.
La preparacion ocurre en segundo plano y distingue definicion de datos:

- RECORDS prepara definicion; sus registros son demand-cached.
- STATE_UPDATE prepara workflow/definicion y refresca completamente la entidad fuente.
- Attendance agrega fuente Personas y snapshots completos del mes actual, con concurrencia 3.
- Fechas Attendance fuera del mes se hidratan al abrirse online.
- REPORT/PANEL guardan snapshots de consultas ejecutadas; no forman parte de la descarga mensual o
  global de registros (`CLIENT_ARCHITECTURE.md`, AppViews y Prewarm).

Las definiciones repetidas por entidad se coalescen dentro de un run. El run completo se deduplica
por owner+contrato mientras esta activo (`src/lib/app-view-prewarm.ts`). Cada AppView termina en
`success`, `skipped` o `failed`, incluso si tambien falla el intento local de marcar su error; el run
espera a los workers restantes y publica un unico terminal. Un fallo no agenda loops automaticos: solo
un disparador normal posterior puede reintentar. La telemetria correlaciona run id seguro, disparador,
fingerprint, fase, duracion y resultado. La cabecera usa completadas/total como procesadas; esa cifra
incluye fallos y no equivale a disponibilidad offline.

### RECORDS

RECORDS es lectura/escritura generica de entidades. En apertura sin busqueda lee definicion, registros
y marca durable de full refresh. Puede presentar inmediatamente un snapshot completo; sin esa marca
solo presenta intencion local no resuelta, evitando representar un cache parcial como cero registros.
Luego descarga todas las paginas remotas y reconcilia (`RecordsRenderer.tsx`,
`offline-records.ts`).

Busqueda, pagina parcial y registro individual son no autoritativos y nunca eliminan por ausencia.
Solo un full refresh exitoso elimina filas `synced` ausentes; conserva `pending_create`,
`pending_update`, `syncing`, `failed` y `conflict`. El API actual pagina snapshots y no publica
tombstones, por lo que `updatedAt` solo no permite reconciliar eliminaciones.

CREATE/UPDATE offline confirma guardado despues de una transaccion atomica de snapshot+outbox.
Completado, conflicto y fallo tambien mantienen coherencia record/outbox. CREATE usa
`clientRequestId` persistente e idempotencia Core. UPDATE persiste el comando PATCH idempotente en el outbox, hace preflight GET para un comando nuevo y
compara la version remota antes de enviarlo. Un `sentCommand` incierto se reenvia exactamente y las
lecturas no sustituyen sus valores ni su version base (`records-sync.ts`; Core `EXTERNAL_API.md`,
Dynamic Entities).

### STATE_UPDATE Y Attendance

STATE_UPDATE es el primitivo comun; Attendance es un adapter, no otra cola. Ambos reutilizan
`entity_records`, `pending_operations`, sync, idempotencia, conflictos y diagnostico. La intencion
incluye estados, extras, omit-vs-null, fecha, overwrite y version esperada. La escritura offline es
atomica antes del feedback local (Client `docs/STATE_UPDATE.md`; Core `docs/STATE_UPDATE.md`).

Core persiste respuesta idempotente junto a la mutacion/auditoria. Mismo key+intencion reproduce la
respuesta; key reutilizada con otra intencion falla. Conflicto y overwrite son comandos distintos;
overwrite requiere key nueva y `expectedUpdatedAt` vigente. Ante timeout, Client intenta confirmar
por lectura y comparacion exacta antes de resolver la operacion (`state-update-sync.ts`).

Snapshots completos pueden retirar estados `synced` obsoletos; snapshots parciales nunca lo hacen.
Attendance marca cobertura por owner, contrato, AppView, entidad target y fecha. Mes parcial y fecha
sin hidratar son falta de cobertura, no lista vacia autoritativa.

### REPORT

REPORT es consulta derivada read-only calculada por Core. No crea outbox, no modifica registros y no
recalcula localmente. El snapshot se guarda por owner, contrato, AppView y consulta exacta
(`from/to/search`). La politica existente es remote-first con fallback local solo ante error de red.
Errores HTTP de permiso/configuracion no se ocultan usando cache (`offline-reports.ts`).

Esto es una decision actual documentada, no un defecto reproducido. Cambiar a stale-while-revalidate
requeriria definir autorizacion, vigencia y UX; no se asume como mejora correcta en esta auditoria.

### PANEL

PANEL es igualmente read-only en Client. Core ejecuta datasets, filtros, transformaciones, metricas y
composiciones sobre conjuntos completos; Client presenta la respuesta o un snapshot compatible. No
debe reconstruir COUNT/KPI desde paginas ni mezclar metricas de snapshots diferentes.

Snapshots se aislan por owner, contrato, AppView, dataset, filtros normalizados, busqueda, pagina,
pageSize y `configRevision`. KPI compuesto exige revision conocida. Cambio rapido de query oculta el
valor anterior y guards de secuencia impiden que una respuesta tardia reemplace la seleccion vigente
(`offline-panels.ts`, `PanelRenderer.tsx`, Core `ARCHITECTURE.md`, PANEL).

Remote-first, no cancelar transportes obsoletos y no incluir PANEL en prewarm global son decisiones o
limitaciones actuales; esta auditoria no demostro que violen una garantia.

### Orquestacion Y Recuperacion

El orden global es RECORDS y luego STATE_UPDATE. Reconnect, unknown-to-online, inicio con pendientes,
foreground y accion manual convergen en la misma orquestacion single-flight. Antes de POST automatico
se verifica scope, trabajo durable, `/ready` (maximo 3 intentos, espera acotada) y vigencia de sesion.
Si Core sigue inaccesible, catch-up usa 5/15/30/60 segundos mientras persistan las condiciones y se
cancela por offline, background, cambio de scope o pendientes=0.

Red/5xx conservan intent retryable. Validacion definitiva y errores de idempotencia requieren accion.
Conflictos nunca entran en overwrite/retry automatico. Un timeout no prueba exito ni fallo. Errores de
telemetria no cambian negocio (`CLIENT_ARCHITECTURE.md`, Global Sync Orchestration; `STATE_UPDATE.md`).

## Matriz De Comportamiento

| Experiencia | Lectura offline existente | Escritura offline | Cobertura y autoridad | Estado de evidencia |
| --- | --- | --- | --- | --- |
| RECORDS | Snapshot completo o intent local; busqueda/pagina SQLite | CREATE/UPDATE atomicos+outbox | Full refresh autoritativo; parciales no eliminan | PWA/OPFS real: falla terminal sin visita; datos y controles sobreviven reinicio despues de full refresh. |
| Attendance | Fuente local+definicion+snapshot por fecha | STATE_UPDATE comun | Mes actual prewarm; otras fechas bajo demanda | Chrome/OPFS real: primera apertura online/offline y reapertura muestran el dia preparado; scope/request guards rechazan lecturas obsoletas. |
| STATE_UPDATE | Fuente hidratada+snapshot target scoped+estados locales | Outbox/idempotencia/conflicto comun | Complete vs partial vs absent explicito | PWA/OPFS real: primera apertura, reinicio y conflicto visible tras reconexión pasan; latest posresolucion verificado solo para remote-b/remote-c del fixture de contrato CDP 9351; anomalia Core anterior pendiente. |
| REPORT | Snapshot exacto como fallback de red | No aplica | Resultado derivado por Core, query-scoped | OPFS real: ausente sin visita y durable tras visita; SELECT STATE_UPDATE tiene defecto de presentacion. |
| PANEL | Snapshot exacto compatible como fallback | No aplica | Core calcula; scope incluye revision y query; prewarm global no ejecuta datasets PANEL | OPFS real: ausente sin visita y KPI/tabla/paginacion durables tras visita. |
| Preparacion global | Definiciones y fuentes seleccionadas por renderer; snapshots validos previos se conservan ante fallo | No aplica | Single-flight owner+contrato; cada AppView llega a resultado terminal; processed incluye exito, skipped y fallo | Chrome/Core local: `5/5`, cero fallos; no equivalio a cobertura de RECORDS/PANEL/REPORT. |

## Carga Y Telemetria

La ultima ejecucion debe interpretarse asi:

- `source_records_fetch=3975 ms` mide refresco completo y reconciliacion de la entidad fuente.
- Para STATE_UPDATE, el codigo copia esa misma etapa a `snapshot`, conservando timestamps y duracion
  y cambiando el nombre. Los dos `3975 ms` se solapan al 100 % y no se suman.
- Para Attendance, `snapshot=4606 ms` posterior es una etapa real diferente: hidrata fechas del mes,
  con hasta tres requests internos concurrentes.

La competencia entre prewarm y experiencia visible es posible por arquitectura (concurrencia 4 mas
la pantalla, y 3 para mes Attendance), pero no fue medida en esta auditoria como causa de una demora
o fallo. Guards de UI descartan resultados tardios; eso no equivale necesariamente a abortar fetch.

## Verificacion Respaldada RECORDS A/B 2026-09-23

Todo el contenido de esta seccion corresponde al respaldo experimental previo a la consolidacion.
Se conserva como antecedente; la implementacion publicada y sus limites vigentes estan en la matriz
de cierre 2026-09-28.

Se reprodujo con los metodos reales de persistencia local y `syncPendingRecordsOnce`, un SQLite
stateful mock y respuestas Core controladas. Antes de la correccion, UPDATE A en vuelo y una edicion
B posterior reutilizaban el mismo id de outbox; confirmar A borraba esa fila ya actualizada, restauraba
A y dejaba el registro `synced`. CREATE en vuelo presentaba la misma perdida.

La correccion conserva una operacion separada para B mientras A esta `syncing`. La finalizacion
transaccional de A elimina solo A, conserva B, avanza `remote_updated_at` a la version confirmada de
A y, para CREATE, asigna a B el `server_id` creado. El sincronizador relee identidad y version
durables antes del preflight de B.

Evidencia automatizada:

- UPDATE A `Taller`, UPDATE B `Bodega`, confirmacion A, recarga del singleton local, GET de la
  version A, PATCH B y estado final B sin pendientes.
- CREATE A seguido de B durante el envio: un solo POST, enlace del UPDATE al `server_id`, PATCH B y
  estado final sin pendientes.
- Cambio remoto real entre A y B: conflicto antes de PATCH; no se adopta last-write-wins.
- Error de red en PATCH B: B y su base confirmada permanecen pendientes.
- UPDATE cargado antes de persistir el `server_id`: sync relee la identidad durable antes del GET.

Estas son pruebas Vitest con API y SQLite stateful mock. No ejecutan Expo Web, OPFS/WASM, service
worker ni un navegador real. No se usaron datos productivos ni se modifico Operational Core.

## Brechas Demostradas

1. **Cerrada: conflicto STATE_UPDATE oculto al volver online.** La intencion durable se fusiona ahora con
   la respuesta remota scoped y mantiene ambas acciones hasta resolucion explicita. La evidencia OPFS real
   cubre reconexion y reinicio; no cambia la politica de retry automatico.
2. **Cerrada: Attendance ocultaba el dia inicial preparado.** La carga inicial publica ahora datos y
   `loadedDate` desde una lectura valida del request/scope vigente; ausencia y fallo no acreditan cobertura.
3. **Resumen RECORDS no aislado por entidad/tipo.** Un conflicto STATE_UPDATE activa la advertencia local
   de una AppView RECORDS no relacionada.
4. **Hard navigation y Access Handle.** Una sustitucion abrupta del runtime puede requerir cerrar todo
   Chrome para recuperar OPFS, aunque no requiere borrar datos.
5. **SELECT de REPORT STATE_UPDATE no legible.** Se renderiza `[object Object]` online y desde snapshot.
6. **Corregida para prewarm genérico STATE_UPDATE: telemetría snapshot duplicada.** La rama ahora
   mide la persistencia real del snapshot y cobertura con `measurePrewarmStage`; ya no copia el intervalo
   de `source_records_fetch`. No implica revisión general de rankings ni otras experiencias.
7. **Cobertura automatizada conocida.** La documentacion canonica declara que los tests del
   coordinador usan un mock determinista y no ejecutan Expo Web OPFS/WASM. Esto es una brecha de
   verificacion; la matriz Chrome nueva cubre recorridos completos, no inyeccion de cada fallo SQLite.

No se reprodujeron perdida de outbox, overwrite silencioso, duplicacion remota, bloqueo global de la cola
por un conflicto ni fallo del shell offline. Los defectos demostrados son de acceso/recuperacion y scope
visible; no autorizan reset de almacenamiento.

## Limitaciones Documentadas

- PATCH RECORDS idempotente requiere el par `clientRequestId`/`expectedUpdatedAt` y un
  `sentCommand` durable. Operaciones historicas que ya se enviaron sin ese descriptor no adquieren
  idempotencia retroactiva y conservan el tratamiento conservador de conflicto.
- No hay endpoint externo de DELETE ni feed incremental con tombstones. Full snapshot sigue siendo la
  base segura para detectar eliminaciones.
- Multi-tab OPFS no se asume soportado; `ACCESS_HANDLE_BUSY` pertenece a recovery.
- REPORT/PANEL solo tienen cobertura para queries ejecutadas y compatibles; no se presenta una query
  distinta como cache valido.
- Reintento selectivo por AppView y cancelacion de lecturas obsoletas no forman parte del contrato
  actual. Su ausencia no se clasifica aqui como defecto.

## Escenarios No Verificados Aqui

La matriz nueva si verifico export/service worker controlador, preparacion online, primera apertura sin
visita, demanda de snapshots, cierre/reapertura offline, una escritura STATE_UPDATE, persistencia de un
conflicto y continuidad de PANEL/RECORDS. Permanecen sin evidencia nueva equivalente:

- Expo nativo y almacenamiento SecureStore/SQLite del dispositivo;
- respuesta perdida inyectada en el build actual (se reutiliza la evidencia RECORDS A/B y tests vigentes);
- permiso revocado entre guardado y envio, cuota OPFS agotada y fallo fisico de persistencia real;
- cambio de usuario/contrato/configuracion con pendientes durante el mismo recorrido de navegador;
- actualizacion de version del Client mientras hay cambios locales pendientes;
- cobertura Attendance mayor que el limite `latest` y REPORT/PANEL para queries no visitadas, por diseño.

No se accedio a produccion. Los fixtures/perfil fueron exclusivos de esta auditoria y deben eliminarse al
terminar; ninguna conclusion depende de borrar el almacenamiento para funcionar.

## Preguntas Pendientes

1. ¿En que entrega se publicara el contrato idempotente PATCH ya implementado, manteniendo Core antes que Client?
2. La rama genérica ya mide persistencia real en `snapshot`; una revisión general de rankings temporales
   y otras ramas permanece fuera de este cierre.
3. ¿PANEL/REPORT deben seguir declarandose explicitamente por query visitada o se espera que una futura
   preparacion global ejecute un conjunto acotado de queries configuradas?

Pasar suites no sustituye la verificacion PWA real, y la matriz PWA no sustituye inyeccion controlada de
todos los fallos. Ambas evidencias se mantienen separadas.
