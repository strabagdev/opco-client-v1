# Guía Offline-First

Fecha de revisión: 2026-09-23.

Esta guía explica el recorrido offline-first de Opco Client sin reemplazar la evidencia de
[`OFFLINE_FIRST_AUDIT.md`](OFFLINE_FIRST_AUDIT.md). La auditoría conserva los hallazgos, límites
y preguntas abiertas; este documento organiza el modelo operativo y separa con cuidado lo publicado
de lo que existe solo en el árbol local.

## Referencias Y Estado

Las referencias se obtuvieron de Git y de los registros de publicación en `docs/STATUS.md`. No se
consultó producción durante esta revisión.

| Repositorio | Base examinada | `origin/main` al iniciar la revisión | Referencia publicada documentada |
| --- | --- | --- | --- |
| Opco Client | `main` / `84c6d21a2692b3d26cd3072e01aa0d7303520686` | `84c6d21a2692b3d26cd3072e01aa0d7303520686` | Código funcional `fff8aaf9125d8f30a16906feb11606a796d7d1d9`, registrado como exitoso en Railway |
| Operational Core | `main` / `13093954193ffc6d739901e71a0e4dce1a7bf993` | `13093954193ffc6d739901e71a0e4dce1a7bf993` | Código funcional `90dd4b909a7a0d83553cf518ec7488d121d00a1b`, registrado como activo y ready |

Por tanto, `HEAD` y `origin/main` no se usan como sinónimos de producción. La clasificación
empleada en el resto del documento es:

- **A. Base publicada:** comportamiento presente en las referencias publicadas documentadas antes
  de esta recuperación.
- **B. Recuperado:** los cuatro cambios aislados incluidos en esta publicación sobre la base v10.
- **C. v11 incompleto:** experimento local de outbox/leases/sucesores. No es publicable.
- **D. No verificado:** comportamiento inferido o cubierto solo parcialmente, sin evidencia real
  suficiente para declararlo garantía.

El árbol Client publicable conserva SQLite v10. Sus 13 archivos recuperados son idénticos al
candidato validado `2026-09-24-four-patches-validation-84c6d21`, y los archivos de persistencia,
outbox y sincronización permanecen idénticos a la base `84c6d21a2692b3d26cd3072e01aa0d7303520686`.
El experimento v11 completo está preservado solo como respaldo fuera del repositorio activo.

## Responsabilidades

| Componente | Responsabilidad | Límite |
| --- | --- | --- |
| Operational Core | Autenticación y autorización, AppViews, definiciones, datos canónicos, validación, versiones, idempotencia soportada y auditoría. | No administra SQLite, OPFS ni la cola local del dispositivo. |
| SQLite / OPFS | Contexto y definiciones cacheadas, snapshots renderizables, intención local no resuelta, conflictos y telemetría. | No es una segunda fuente de verdad ni una caché HTTP general. |
| Service worker | Precarga del shell y assets estáticos; fallback de navegación para abrir la SPA sin red. | No guarda datos de negocio, no intercepta la API como fuente de datos y no sincroniza la outbox. |
| Opco Client | UI, selección de alcance, lectura con fallback permitido, guardado local, orquestación de sync, reconciliación y diagnóstico. | No reemplaza validaciones ni decisiones de conflicto de Core. |

Referencias: `docs/CLIENT_ARCHITECTURE.md` (System Boundaries, Web/PWA, Local Database y
Synchronization), `src/lib/local-db.ts`, `src/sync/pending-work-sync.ts`; en Core,
`docs/ARCHITECTURE.md`, `docs/EXTERNAL_API.md` y `docs/STATE_UPDATE.md`.

## Arranque

### Online

1. El service worker, cuando aplica en web, entrega el shell; el bundle restaura la sesión.
2. Client valida sesión, contexto, organización/usuario y contrato con Core.
3. Carga AppViews asignadas y usa Core como fuente autoritativa.
4. Abre SQLite mediante el singleton compartido y conserva caché e intención pendiente.
5. Prepara en segundo plano definiciones y cobertura offline según cada AppView.
6. El ciclo de pendientes empuja intención durable antes de una actualización remota destructiva.

En **A**, la creación RECORDS usa `clientRequestId` y Core mantiene idempotencia persistente para
CREATE. STATE_UPDATE también tiene idempotencia persistente y conflictos explícitos. Las mutaciones
Core no se reintentan automáticamente en el servidor.

### Offline

El service worker puede abrir el shell, pero la experiencia depende de snapshots SQLite ya
preparados para el mismo alcance. La sesión/contexto mínimo y las AppViews cacheadas permiten entrar
solo cuando la información requerida existe. Falta de cobertura se muestra como preparación
incompleta o experiencia no disponible; no se inventan datos ni se consulta una caché de API del
service worker.

El aislamiento se basa en `ownerKey`, `contractId` y, según el dato, `appViewId`,
`entityTypeId`, fecha, filtros, búsqueda, paginación y `configRevision`. Cambiar usuario o
contrato no autoriza reutilizar snapshots ni feedback de otro alcance.

## Lecturas Por Experiencia

| Experiencia | Online | Offline / snapshot |
| --- | --- | --- |
| RECORDS | Lee definición y registros de Core; persiste caché demandada. | Usa definición y registros ya cacheados. Búsquedas/cargas parciales no autorizan limpieza destructiva. |
| Attendance | Es un preset de STATE_UPDATE; hidrata fuente y estado por fecha. | Combina fuente local, snapshot de fecha e intención STATE_UPDATE. El mes actual puede prepararse; otras fechas son bajo demanda. |
| STATE_UPDATE | Lee metadata del workflow, definición fuente y estado actual. | Usa la infraestructura compartida `entity_records` + `pending_operations`; no tiene cola paralela. |
| REPORT | Consulta read-only y guarda snapshots compatibles por alcance y consulta. | Presenta un snapshot compatible; no crea outbox. |
| PANEL | Core calcula datasets/métricas; Client presenta la respuesta. | Usa `panel_snapshots` por dataset, filtros, búsqueda, página y revisión. No mezcla snapshots para recalcular KPI. |
| BOARD / DASHBOARD | Renderer controlado no soportado. | No se atribuye soporte offline inexistente. |

La deduplicación de cargas de definición durante una preparación es **B**:
`src/lib/app-view-prewarm.ts` comparte una promesa por `entityTypeId` dentro de una ejecución,
evicta fallos y vuelve a validar en ejecuciones posteriores. Es independiente del experimento v11,
pero no es una garantía de **A**.

## Escritura, Outbox Y Reconciliación

### Publicado

En **A**, RECORDS persiste el snapshot local y su operación CREATE/UPDATE en una transacción SQLite
antes de confirmar “guardado localmente”. `pending_operations` conserva payload, identidad,
intentos y último error. CREATE puede reintentarse con su `clientRequestId` porque Core lo hace
idempotente. UPDATE usa PATCH no idempotente: antes de enviarlo Client consulta el registro remoto y
compara `updatedAt` con la versión base local. Una diferencia produce conflicto, no
last-write-wins.

STATE_UPDATE persiste registro local y operación compartida atómicamente. Core vincula
`clientRequestId` con la intención semántica completa; misma clave y payload reproduce el resultado,
y la misma clave con otro payload devuelve `IDEMPOTENCY_KEY_REUSED`. Los conflictos requieren
decisión explícita y un overwrite usa nueva identidad más `expectedUpdatedAt`.

Tras una confirmación, Client elimina solo el trabajo confirmado, actualiza snapshot y versión y
luego puede reconciliar una lectura completa. Registros `pending_create`, `pending_update`,
`failed` o `conflict` no deben borrarse por ausencia en una respuesta parcial.

### Trabajo respaldado y v11

Las correcciones apartadas intentaban preservar una edición posterior, propagar
`server_id`/`remote_updated_at` y releer ambos antes del preflight. Se conservan únicamente en el
respaldo preconsolidación junto con **C**; no forman parte de `src/lib/local-db.ts`,
`src/sync/records-sync.ts` ni sus pruebas en esta publicación.

El experimento **C** añade schema 11, `dispatch_state`, cadena de predecesor, versión base por
operación, leases, estado `uncertain`, claim y sucesores UPDATE. El respaldo que lo contiene quedó
incompleto y su contrato TypeScript no coincide con los consumidores. No debe migrarse, reactivarse,
probarse como candidato ni describirse como solución final.

La respuesta perdida de PATCH sigue siendo el riesgo principal: igualdad posterior de valores no
prueba que esa operación concreta fue aceptada, y reenviar ciegamente puede duplicar efectos. No se
debe avanzar una sucesora ni reintentar PATCH hasta resolver la incertidumbre con una estrategia
diseñada y validada.

## Reconexión Y Errores

Una reconexión es una transición real offline→online. La orquestación es single-flight y procesa
RECORDS y luego STATE_UPDATE; conserva operaciones independientes aunque una falle. Antes de
escrituras, comprueba readiness y, si corresponde, refresca autenticación. Un refresh de credencial
con respuesta perdida tampoco se reintenta ciegamente.

La política publicada distingue:

- Red, timeout, SQLite no disponible y 5xx: recuperables según el motor y la seguridad de la operación.
- Autenticación definitiva, validación y otros 4xx: fallo accionable, sin bucle automático.
- Cambio de versión remoto: conflicto explícito; conserva intención local.
- STATE_UPDATE idempotente: reintento seguro solo con la misma identidad e intención.
- RECORDS UPDATE: PATCH no idempotente; el preflight evita sobrescritura conocida, pero no resuelve
  por sí solo una respuesta perdida.

La recuperación automática de un estado `syncing` y la distinción entre operación interrumpida y
otra activa pertenecen al trabajo local/experimental, no a **A**. La propuesta v11 de lease no está
terminada ni validada.

## Snapshots Y Cobertura

La presencia del shell no implica datos offline. Cada snapshot conserva su alcance y cobertura:

- AppViews y definiciones: owner + contrato y sus identificadores.
- RECORDS: owner + contrato + entidad; la cobertura depende de lo realmente cargado.
- Attendance/STATE_UPDATE: AppView, sujeto y fecha; preparación y cargas bajo demanda se distinguen.
- REPORT: consulta, periodo, presentación y revisión compatibles.
- PANEL: dataset, filtros normalizados, búsqueda, página, pageSize y `configRevision`.

Solo una carga completa exitosa puede habilitar reconciliación destructiva de registros `synced`.
Una página, búsqueda o snapshot parcial no puede borrar caché fuera de su cobertura. La auditoría
existente documenta los límites concretos y debe conservarse como referencia de evidencia.

## Estados De Cabecera

En **A**, la cabecera ya distingue conectividad, envío, pendientes, confirmación, restauración de
sesión y lecturas visibles. Los cambios **B** consolidan allí también preparación offline y eliminan
el banner global duplicado. Esa cabecera unificada aún no está publicada.

Prioridad conceptual del árbol local:

| Estado | Significado |
| --- | --- |
| `Requiere atención` | Error retenido, conflicto o recuperación de almacenamiento. |
| `Guardado localmente` | La transacción local terminó; no significa confirmación de Core. |
| `Guardado en Opco` | La escritura obtuvo confirmación remota. |
| `Sin conexión` | No hay conectividad; puede incluir cantidad pendiente confiable. |
| `Sincronizando cambios…` | Hay envío real de operaciones pendientes. |
| `Sincronización confirmada` | El ciclo confirmó operaciones en Core. |
| `Comprobando disponibilidad` / `Restaurando sesión` | Readiness o autenticación están activos. |
| `Actualizando …` | Lectura visible activa; no es envío de cambios. |
| `Preparando uso offline…` | Prewarm activo del alcance actual. |
| `Preparación offline incompleta/interrumpida` | Resultado persistido que requiere atención; no actividad viva. |
| `N cambios pendientes` | Existe intención durable sin envío activo. |
| `Listo` | No hay actividad/problema conocido; no certifica frescura de datos no consultados. |

También en **B**, RECORDS diferencia “Problema al actualizar registros” para
`refreshing/reconciling` de “Problema al enviar cambios” para `pushing`
(`src/renderers/records/records-renderer-state.ts`). Diagnóstico reutiliza las mismas fuentes de
estado y no debe convertir telemetría histórica en actividad actual.

## Escenarios No Verificados

Se mantienen como **D**, sin convertir pruebas con mocks en evidencia OPFS/Core real:

- CREATE→UPDATE completo en Chrome/OPFS real con un único registro remoto.
- Conflicto introducido desde otro contexto entre dos ediciones consecutivas en navegador real.
- Recuperación multi-contexto que distinga una operación interrumpida de otra todavía activa.
- Respuesta perdida de RECORDS UPDATE resuelta sin reenvío ciego ni avance de una sucesora.
- Las transiciones visuales de preparación offline fallida e interrumpida no se verificaron
  manualmente. La revisión local sí confirmó RECORDS, tabla PANEL y KPI con título único y valor `1`.
- Cobertura offline productiva de columnas/filtros relacionados de PANEL documentada como pendiente.

## Mejoras Locales Separables

| Mejora recuperada o pendiente | Archivos principales | Relación con sync experimental | Estado |
| --- | --- | --- | --- |
| Título único de KPI | `PanelRenderer.tsx`, `panel-renderer-logic.test.ts` | Independiente | Recuperado y validado |
| Cabecera unificada y alcance de preparación | `_layout.tsx`, `app-shell-feedback.*`, `sync-status-diagnostics.*`, `session.tsx` | Independiente del mecanismo outbox | Recuperado; transiciones fallida/interrumpida sin revisión visual manual |
| Mensajes de lectura/envío RECORDS | `RecordsRenderer.tsx`, `records-renderer-state.*` | Lee telemetría existente; no cambia envío | Recuperado y validado |
| Deduplicación de precarga | `app-view-prewarm.*`, `session.tsx` | Independiente | Recuperado y validado |
| Persistencia/outbox y ediciones consecutivas | `local-db.*`, `offline-records.ts`, `records-sync.*`, prueba de persistencia | Mezclada con v11 incompleto | Apartado; no incluido |

Para detalles y hallazgos históricos: `docs/OFFLINE_FIRST_AUDIT.md`. Para el mapa completo:
`docs/CLIENT_ARCHITECTURE.md`. Para el workflow compartido: Client y Core
`docs/STATE_UPDATE.md`.
