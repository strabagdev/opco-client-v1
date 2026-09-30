# Auditoria Offline-First

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
| RECORDS | Snapshot completo o intent local; busqueda/pagina SQLite | CREATE/UPDATE atomicos+outbox | Full refresh autoritativo; parciales no eliminan | Existente en codigo/tests; PWA real no verificada aqui |
| Attendance | Fuente local+definicion+snapshot por fecha | STATE_UPDATE comun | Mes actual prewarm; otras fechas bajo demanda | Existente en codigo/tests; recarga OPFS no verificada aqui |
| STATE_UPDATE | Fuente hidratada+estados locales | Outbox/idempotencia/conflicto comun | Complete vs partial explicito | Existente en codigo/tests; recarga OPFS no verificada aqui |
| REPORT | Snapshot exacto como fallback de red | No aplica | Resultado derivado por Core, query-scoped | Existente; remote-first es deliberado |
| PANEL | Snapshot exacto compatible como fallback | No aplica | Core calcula; scope incluye revision y query; prewarm global no ejecuta datasets PANEL | Existente; remote-first es deliberado |
| Preparacion global | Definiciones y fuentes seleccionadas por renderer; snapshots validos previos se conservan ante fallo | No aplica | Single-flight owner+contrato; cada AppView llega a resultado terminal; processed incluye exito, skipped y fallo | Regresion controlada y Chrome/Core local: activa, incompleta estatica y retry exitoso |

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

1. **Telemetria ambigua de STATE_UPDATE.** `snapshot` duplica el intervalo de
   `source_records_fetch` aunque no ejecuta otra tarea. Presentarlo entre “top lento” permite sumar o
   atribuir trabajo inexistente. Es un defecto de observabilidad; no afecta datos ni preparacion.
2. **Cobertura automatizada conocida.** La documentacion canonica declara que los tests del
   coordinador usan un mock determinista y no ejecutan Expo Web OPFS/WASM. Esto es una brecha de
   verificacion, no evidencia de un fallo de almacenamiento.

Fuera de los defectos RECORDS ya clasificados en la matriz de cierre, no se reprodujeron corrupcion, mezcla
de scopes, reconciliacion destructiva parcial, overwrite silencioso, calculo local incorrecto de
REPORT/PANEL ni fallo de arranque offline.

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

El export servido en `127.0.0.1:8082` entrego `index.html`, `sw.js`, worker y WASM con cabeceras
esperadas. Estaba compilado para `web.opco.cl`, no para Core local, y no habia navegador automatizable;
por seguridad no se inicio sesion ni se escribieron datos. Esto solo verifica artefactos HTTP, no que
el service worker controle una pagina ni que OPFS persista.

Permanecen no verificados en navegador real aislado:

- preparar online, desconectar, navegar y recargar;
- navegador online con API inaccesible e intermitencia;
- cambio rapido de experiencia, filtro y contrato;
- escritura offline, recarga, reconexion y conflicto;
- respuesta perdida despues de aceptar una escritura;
- cambio de definicion y selecciones sin snapshot/cobertura parcial;
- actualizacion del Client con cambios locales pendientes.

Estas marcas no niegan la implementacion cubierta por codigo y pruebas. Solo delimitan lo que esta
auditoria no observo sobre service worker y OPFS/WASM reales.

## Preguntas Pendientes

1. ¿Se requiere una prueba PWA repetible con build explicitamente local, perfil/origen aislado y Core
   sintetico para convertir los escenarios anteriores en evidencia real?
2. ¿En que entrega se publicara el contrato idempotente PATCH ya implementado, manteniendo Core antes que Client?
3. ¿La etapa derivada `snapshot` de STATE_UPDATE debe conservarse como indicador de cobertura con
   otra clasificacion, o eliminarse de rankings temporales para evitar doble conteo?
4. ¿Hay una necesidad de producto medible para priorizar pantalla visible, cancelar lecturas o
   reintentar solo AppViews fallidas? Sin esa evidencia siguen siendo opciones de diseno, no brechas.

Pasar las suites existentes no cierra la verificacion PWA real. Del mismo modo, no ejecutar esos
escenarios en esta auditoria no invalida las garantias implementadas y documentadas.
