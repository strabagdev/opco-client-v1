# Recibos en la preparación ordinaria — etapa 4 Client, 11-11-2026

Integración local en sombra sobre la etapa 3. **reuseAllowed=false siempre**. No cambia los
triggers de Inicio/lifecycle/recuperación, su trabajo compartido ni la política previa de navegación.
Ninguna decisión de descargar depende de estos recibos. No modifica Core, contratos HTTP de
negocio, esquema/namespace SQLite, OPFS, outbox, comandos, identidad o sincronización.

## Recorrido y descargas reales

`prewarmAssignedAppViews` crea un observador de revisiones para su ejecución real. Si API/store
admiten el protocolo, negocia las MISMAS lecturas de definición/origen/Attendance/STATE_UPDATE.
Las entidades y definiciones siguen compartiéndose mediante los mapas de la pasada existente.
No se repite la descarga de datos para contrastarla, como hacía la vía optativa de etapa 3.

Se añaden dos manifiestos (antes/después) y un `/views` diagnóstico sellado por pasada efectiva.
Este último es necesario porque el handoff normal de Inicio no conserva un sello de su lista;
se compara con esa lista, sin reemplazarla ni cambiar asignaciones. Es coste adicional explícito.
No se ha modificado Home/lifecycle para añadir triggers ni se inicia una descarga al inspeccionar
un recibo local. Cuando la política previa reutiliza trabajo ya completado, no se recertifica.

| Experiencia / modo | Descargas ordinarias que se observan | Cobertura posible del recibo |
| --- | --- | --- |
| RECORDS | Definición de entidad; AppView de la lista autorizada | metadata-only. No acredita registros aunque otro workflow haya cacheado la misma entidad. |
| Attendance | GET inicial del día; definición del origen; colección origen completa; GET por cada día restante del mes | attendance-month: mes exacto, eventos completos y marcadores diarios persistidos. No otros meses, búsquedas arbitrarias ni catálogos de contextos. |
| STATE_UPDATE subject-date / snapshot | GET inicial, definición/origen completos y latest recibido | state-update-snapshot sólo si latest completo y contenido/marker local exactos; no promueve una primera página parcial. |
| STATE_UPDATE subject + append + DATE | Lo anterior, más current individual/lotes para todos los sujetos | state-update-current: origen y current explícito evento/null de todos; latest se declara bounded-first-page, sin certificar historia completa. |
| STATE_UPDATE identidad compuesta | Inicio prepara origen/definición, sin elegir contexto | context-required, businessDataIncluded=false. No se acredita target ni contextos seleccionados por inferencia. |
| PANEL / REPORT (TABLE o MATRIX) | AppView/configuración de la lista; sin consultas de negocio | metadata-only. Snapshots de consultas visitadas siguen siendo exactos y demand-cached, fuera de esta preparación. |
| BOARD / DASHBOARD / workflow no soportado | Configuración / UI no soportada existentes | Se rechaza certificado de experiencia operativa. |

El preparador de contexto seleccionado `prepareStateUpdateContextOnce` conserva sus lecturas y
marcadores previos; no se certifican automáticamente con un recibo de Inicio. Su integración y
los catálogos RELATION requerirán una cobertura adicional explícita antes de reutilizar el conjunto.
No se inventa una descarga de colecciones RECORDS, PANEL/REPORT o catálogos desde Inicio.

## Composición y persistencia

`preparation-revision-receipts.ts` envuelve sólo el API/store de esa pasada. Conserva las operaciones
diagnósticas existentes DAY_LOAD/PERSON_LOAD/SEARCH/RECONCILE y sus runIds opcionales. Los handlers
ordinarios siguen escribiendo exactamente sus datos. El observador captura sus definiciones listas,
respuestas normalizadas y sellos; revalida el hash crudo y que esas respuestas no se hayan mutado.

Páginas de una colección usan expectedReadRevision y total/tamaño/IDs/páginas consistentes. Un 409
no se reintenta ni degrada a otra consulta. Un cambio de datos entre consultas independientes no
interrumpe por sí solo las descargas ordinarias: se conserva lo que la preparación habitual guarda,
pero la composición exige vector único observado y manifiesto final compatible. No se emite prueba
mixta. Cambio de autorización/epoch/scope retira el intento. No hay polling, TTL o bucle de recuperación.

El recibo nuevo combina lista autorizada, definición local normalizada, definición/colección origen,
proyecciones workflow v10 y autoridades current, marcadores de mes/snapshot/current y proyecciones
visuales cacheadas. Las lecturas, comparación de valores/versiones/IDs, hash y publicación final
ocurren en una transacción del coordinador SQLite existente; la generación y el fence durable de
sesión se verifican antes y después de los awaits. La definición preparada debe coincidir con su
AppView de la lista sellada. Las celdas visuales cacheadas, cuando están configuradas,
deben coincidir con una proyección de los valores/metadata del origen verificado; se comprueba
también completitud de etiquetas. Una proyección antigua provoca PREPARATION_PRESENTATION_UNVERIFIED,
sin reemplazarla ni certificarla como actual. Un fallo final no devuelve ni publica un recibo.

Se emplean sólo claves nuevas en app_metadata:

- `preparation_revision_receipt:v1:`: usuario/owner/contrato/app/AppView, un recibo actual por experiencia;
- `preparation_revision_status:v1:`: historial acotado de estados/códigos y fingerprint de experiencia.

Cada recibo contiene scope/autorización, runId/snapshotId opacos, vector/epoch/metadata remotos,
recetas/referencias de cobertura, sellos/hashes y hash local. No duplica payloads de negocio ni
intenciones. La receta de consulta permanece privada, como las claves anteriores; el diagnóstico
exportable usa sólo estados/códigos/fingerprints, nunca filtros, valores, tokens ni nombres.

`coverage.complete=true` significa **la cobertura declarada de la preparación ordinaria**. No es
un certificado ilimitado: businessDataIncluded distingue metadata-only/context-required; latest
explicita histórico completo o primera página; arbitraryQueries=false y relationCatalogs=false.
El parser rechaza versiones/coberturas desconocidas, meses incompletos o metadata inflada a datos.

Una pasada efectiva retira primero la acreditación previa del owner/contrato. Los datos permanecen.
Las inspecciones vuelven a leer/hashar todos los componentes después de reapertura; cambio local,
metadata/marker, cobertura o autorización retira el recibo. Offline es remote_unchecked; con un
manifiesto compatible es match_shadow. El historial emitted/MANIFEST_MATCH_SHADOW no es vigencia
continua. Un cambio remoto sin red/señal sigue siendo desconocido. Siempre reuseAllowed=false.

## Incompatibilidad demostrada: Observación de Attendance

En Core etapa 2, `findAttendancePeople` devuelve [] sin búsqueda ni personRecordId. El preparador
mensual solicita sólo date; la respuesta tiene items=[] y latest omite Observación. Con ese campo
configurado y un evento existente, falta su valor en la descarga ordinaria: la proyección local
queda verified=false y no se acredita el día. El observador rechaza
`PREPARATION_OBSERVATION_UNBOUND`; no convierte ausencia en vacío/null ni altera los datos.

Demostrado con Core Next.js completo/PostgreSQL sintéticos. Se mantienen dos AppViews de fixture:
una con Observación, rechazada, y otra independiente sin ese campo configurado, con mes acreditado.
No se eliminó la configuración problemática para obtener PASS. Días fallidos, latest parcial y
pérdida de persistencia también se rechazan aunque el preparador legado haya terminado completed.

Propuesta separada, **sin implementar ni autorizar cambios Core aquí**: proyección snapshot
versionada que incluya todos los estados/extras configurados (incluida Observación) con presencia
explícita, mismo contexto/permisos y sello consistente. La alternativa Client sería usar current
adicional por registrado, como refreshAttendanceDaySnapshot ya hace bajo demanda; añadirlo a todos
los días altera las descargas y requiere autorización independiente. No se amplió ninguna vía.

## Compatibilidad y evidencia

Core anterior/sin manifiesto compatible: diagnóstico unavailable explícito y preparación habitual
sin recibos nuevos; no se inventan revisiones. Un 401/403 o owner/asignaciones incompatibles no
se degrada a lecturas de negocio bajo otro scope. Los mocks antiguos ahora tienen ruta 404 explícita
para el manifiesto y contador separado; no se rebajaron las aserciones de negocio/recuperación.

Recibos granulares de etapa 3 se conservan en su namespace, pero no se promueven a prueba de
experiencia. Runtimes anteriores ignoran las claves nuevas. Rollback del delta deja metadata inerte;
no requiere borrar almacenamiento ni modificar Core. La advertencia Array<T> nueva de etapa 3 se
corrigió usando T[]: sólo un cambio de tipo, sin cambio de JS/comportamiento.

Validación/evidencia e inventario independiente: backups/offline-revision-receipt-integration/2026-11-11/.
Focalizadas, typecheck/lint/build/diff-check; PostgreSQL privado y SQLite de archivo, más Chromium
CDP/OPFS real (ruta temporal de laboratorio, no renderer productivo ni datos productivos). No se
presentan pruebas físicas Safari/native ni estabilidad offline general como aprobadas.

## NO-GO para omitir descargas

Antes de activar: cerrar la incompatibilidad de Observación, definir/certificar contextos y catálogos
necesarios, completar las coberturas que hoy son sólo metadata o consultas exactas, validar versionado
cliente/servidor, revocación/epoch/restore, presupuesto de hashing/SQLite y comparación remota antes
cada reutilización. El vector actual es conservador por contrato y puede invalidar recibos ajenos a
la mutación. El hash acredita integridad/procedencia, no reemplaza permisos ni es firma del dispositivo.
Mantener preparación automática, recuperación, pendientes/conflictos e idempotencia independientes.


## 12-11-2026 — Observación en preparación Attendance (local)

Se corrige la omisión de latest en Core mediante proyección aditiva versionada y vinculada
al observationFieldId. Client conserva texto/null/vacío explícitos en el runtime compartido
y sólo acredita recibos tras verificación local completa. items=[] por falta de búsqueda
no significa día vacío. latest>10 sigue parcial; Core anterior sin proyección no se acredita.
No se activa reutilización ni omisión, no cambia otro workflow ni el motor offline.
Contrato, compatibilidad y límites: docs/ATTENDANCE_OBSERVATION_COVERAGE.md.


## 12-11-2026 — Attendance: descarga diaria completa (local)

[Contrato y límites](ATTENDANCE_DAY_COVERAGE.md): lista reciente legacy=10 conservada; snapshot
optativo paginado v1 (hasta100 por página), revisiones comunes, conteo/IDs/campos verificados y
persistencia sólo tras reunir el día completo. Los recibos mensuales incluyen todos los sellos;
HTTP409/interrupción/scope retirado conservan la copia previa y no acreditan lo incompleto.
Sin omisión/reutilización, cambios de escritores o de motores offline. Core anterior mantiene
la limitación legacy explícita; requiere Core nuevo antes de Client para ampliar cobertura.


## 12-11-2026 — Recibos de contextos y catálogos (local)

Se inventarían opciones SELECT y catálogos RELATION directos de RECORDS, Attendance y
STATE_UPDATE. Descargas completas compartidas por ejecución, páginas vinculadas a revisión,
verificación local transaccional y recibos separados versionados; vacío confirmado distinto
de ausencia/incompletitud. Pendientes/conflictos se conservan e impiden acreditar su colección.
No certifica registros de todas las combinaciones de contexto ni colecciones transitivas;
no activa reutilización/omisión ni cambia disparadores, comandos o sincronización. Core intacto.
Contrato, compatibilidad y límites: [CATALOG_REVISION_RECEIPTS.md](CATALOG_REVISION_RECEIPTS.md).


## 12-11-2026 — Datos RECORDS vinculados a revisiones (local)

[Contrato y límites](RECORDS_REVISION_COVERAGE.md): el refresco completo existente al abrir
RECORDS sin búsqueda obtiene una prueba durable sólo tras descargar/persistir/verificar todas
las páginas con revisión consistente. Búsquedas/páginas/ordenamientos específicos siguen parciales;
Inicio conserva metadata y no descarga colecciones nuevas. Cero confirmado, parcial y no preparado
se distinguen; datos anteriores, pendientes y conflictos se conservan. Namespace de recibos
aditivo, catálogos separados y reutilización/omisión deshabilitadas. Core y motores offline intactos.


## 12-11-2026 — PANEL y REPORT/MATRIX: consultas vinculadas (local)

[Contrato](CONSULTATION_REVISION_COVERAGE.md): recibos de ventanas exactas, nunca por metadata.
PANEL sólo completa un dataset al verificar todas sus páginas bajo la misma revisión; TABLE/MATRIX
acreditan su consulta completa sin modificar cálculos/orden. REPORT añade guard transaccional
opcional y lectura sólo SQLite con offline conocido. Copias anteriores, R1/R2 PANEL y pendientes
se conservan. Sin preparación automática nueva, omisión/reutilización, cambios Core o motores sync.


## 12-11-2026 — Conservación y solicitud exacta de recibos

[PREPARATION_RECEIPT_LIFECYCLE.md](PREPARATION_RECEIPT_LIFECYCLE.md):reconciliar con manifiesto
antes de retirar acreditación;request optativa verifica período,contexto,definición y snapshot.
Un mismatch de solicitud no destruye el recibo válido de otro período.401/403 retiran sólo la
acreditación vigente;offline nunca acredita frescura. Reutilización/omisión siguen deshabilitadas.
