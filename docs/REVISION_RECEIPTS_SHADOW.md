# Recibos de revisión persistidos — etapa 3 Client en sombra, 11-11-2026

Implementación local optativa. **No activa reutilización, omisión de descargas ni cambia el
preparador automático**. No se añaden llamadas a lifecycle/Inicio, ni una política de frescura,
TTL/polling, migraciones, namespace o motor de sincronización.

## Arquitectura e integración

`OpcoApi.getOfflineRevisionManifest` y `getRevisionRead` reutilizan autenticación, renovación,
deadline y errores existentes. Sólo el método nuevo negocia readRevisionVersion=1 y transporta
expectedReadRevision. Los métodos ordinarios y sus respuestas siguen iguales. Antes de normalizar
el DTO se verifica SHA-256 del data original y se recalculan los fingerprints de la URL real:
recurso/scopes, selección, página/IDs repetidos y fecha/rango efectivos. No basta un fieldId, un
hash bien formado o un sello tomado de otra petición. Core anterior/incompatible se rechaza sin
fallback que acredite contenido. El parser opcional conserva el flujo de refresh existente.
La vía negociada exige resultados current/attendance explícitos (evento o null). No permite que
un normalizador de compatibilidad convierta una propiedad omitida en null; los lotes reutilizan
además el validador de cobertura por sujeto ya existente.

`captureCachedRecordsReceipt` descarga todas las páginas negociadas, comprueba revisión única,
conteos, IDs únicos, totalPages y límite de 500 páginas. No modifica el caché: contrasta con la
colección que el preparador/lector ordinario ya guardó. `captureCachedSnapshotReceipt` hace lo
mismo para una consulta/materialización exacta. Su adaptador es puro y no guarda registros.
El contraste requiere manifiesto compatible antes y después. Es tráfico diagnóstico adicional,
no ahorro ni un reemplazo del trabajo habitual. Ninguna pantalla lo inicia automáticamente.

`compareRevisionReceiptsShadow` compara manifiesto y materialización local y registra coincidencia,
discrepancia o imposibilidad. Coincidencia siempre se llama match_shadow, nunca permiso de reutilizar.
No se ha añadido UI ni un recibo agregado que diga que toda una experiencia está preparada.

## Persistencia sin esquema nuevo

LocalDatabase añade métodos de recibos; usa el singleton y coordinador SQLite existentes, sin
abrir otra conexión. El código nuevo sólo escribe sus claves en `app_metadata`:

- revision_receipt_v1: recibos por owner/contrato/app/usuario/recurso exacto;
- revision_receipt_active_v1: fence de sesión/scope para publicación tardía;
- revision_receipt_diagnostics_v1: últimos 30 estados/códigos sanitizados por scope.

No se toca schema_version=10, opco-client-v10-epoch2.db, pending_operations, payloads, versiones
base, identidades, clientRequestId, conflictos o valores de negocio. Las capturas son observadores;
la preparación y sincronización ordinarias siguen siendo las únicas que escriben esos datos.

Un recibo contiene versión/modo, receiptId/snapshotId opacos, owner/user/app/organización/contrato,
fingerprint de autorización, epoch/vector remoto, revisión de metadata, selección y hashes de
petición/contenido de cada página; selector del artefacto local, hash de lectura, fecha de
verificación y estado verified/invalid. No contiene copias de registros, comandos ni tokens.
Los selectores de consulta pueden contener filtros/búsquedas como las claves de caché existentes:
no deben exportarse como diagnóstico. El diagnóstico exportable sólo contiene estados/códigos.

La lectura/verificación del contenido **y publicación del recibo están en una transacción del
coordinador SQLite**. Se comprueba vigencia antes y después de esperar la cola y del hash, así
como el fence durable de sesión. Una sesión nueva impide publicar a un callback viejo incluso
si éste afirma incorrectamente que sigue vigente. Otro escritor después del commit invalida
el recibo al verificar nuevamente su hash; no se mantiene un booleano de validez en memoria.
El recibo sólo se devuelve después del commit. Un fallo final deja sin recibo nuevo y no reintenta
ni vuelve a guardar datos automáticamente.

## Pruebas locales por artefacto y completitud

| Artefacto | Prueba que exige |
| --- | --- |
| Colección RECORDS | Descarga íntegra bajo una revisión, total/IDs/páginas consistentes y todas las filas locales de ese owner/contrato/entidad synced y exactamente iguales. Cero remoto confirmado puede acreditar vacío local; una página con datos ausentes no puede. |
| Metadata de entidad | definition_json existente idéntico a la definición negociada. |
| Lista de AppViews | views_json existente para ese owner/contrato idéntico a la lista negociada. |
| PANEL | Clave exacta de usuario/contrato/AppView/dataset/revisión/filtros/search/página/tamaño, y panel_json compatible. Se exigen página/tamaño explícitos; no se adivinan defaults. |
| REPORT/MATRIX | Consulta exacta y report_json existente íntegro. No hay reconstrucción desde otros datos. |
| Attendance/STATE_UPDATE | Proyecciones v10 verificadas de los IDs concretos devueltos, valores/versión/sujeto/definición y autoridades explícitas para current/null. Sin el marcador de un current leído no se acredita ese resultado por inferencia. Errores de sujeto o contexto requerido no se convierten en null. |

Cada recibo dice coverage.complete=true **sólo para su artefacto declarado**. Únicamente RECORDS
puede decir completeCollection=true; todos dicen wholeExperience=false. Los recibos de datos
no acreditan por sí mismos toda la metadata derivada: metadataAccredited sólo es true para los
recibos de definición/lista. La revisión remota de metadata y el hash de la definición workflow
local quedan vinculados, pero aún falta componer la prueba completa que necesitaría una experiencia.

PANEL produce calculatedAt nuevo en cada GET: la comparación semántica de ese DTO excluye sólo
su reloj superior y el de cada métrica. No excluye campos de filas llamados igual ni modifica el
JSON almacenado. El hash durable conserva el JSON local completo, incluido su reloj original;
el hash HTTP conserva el data remoto completo. No se confunden con una revisión de datos.

Los registros locales pendientes/failed/conflict del artefacto no se sobrescriben ni se acreditan
como imagen remota exacta; el recibo se rechaza por overlay. Trabajo de otra entidad se conserva.
Los recibos se leen de nuevo y revalidan tras cierre/reapertura; un receipt viejo/corrupto/incompleto
nunca pasa como colección preparada. Un error SQLite se distingue de un mismatch y no crea prueba.

## Scope, permisos, cambios y recuperación

El owner debe coincidir con organizationId:userId, como el runtime actual. App y autorización se
vinculan además en el recibo. Otro owner/contrato/app no puede utilizarlo. El contexto debe venir de
la sesión vigente y el manifiesto autenticado, no del nombre de una entidad. Cambios de autorización,
epoch/vector/metadata, definición o contenido invalidan el recibo correspondiente; un 401/403 retira
la acreditación del scope exacto anterior y no de uno posterior con otra huella. Los datos quedan.

Una captura nueva retira la acreditación previa de ese recurso antes de descargar. Interrupción,
409, versión/sello incompatible, cobertura incompleta o persistencia fallida nunca publican un
recibo nuevo. Datos disponibles permanecen utilizables por los mecanismos habituales. Una consulta
con otros filtros/página/día tiene otra identidad; no hereda acreditación de una consulta visitada.
Recibos históricos pueden conservar procedencia para su propio scope, no para el nuevo.

Offline sólo se informa remote_unchecked después de comprobar integridad local: no equivale a
frescura remota. Online match_shadow prueba el vector observado, no ausencia de cambios futuros.
La revocación o modificación remota sin señal/red no puede conocerse localmente. No se añade TTL.

## Límites y condiciones antes de activar

- Todos los resultados devuelven reuseAllowed=false; no hay llamada desde los disparadores normales.
- Core sigue shadow y su vector inicial es por contrato: un ACK en otra entidad puede invalidar todos
  los recibos. No se acredita selectividad ni mejoras de tráfico en esta etapa.
- Antes de cualquier omisión debe aprobarse integración con las descargas normales (para evitar el
  segundo contraste), recibos de toda la metadata/materialización necesaria y una composición de
  cobertura completa por experiencia. No usar estos recibos granulares como certificado global.
- Requerir comparación remota compatible, guards de sesión, versionado de proyecciones, reinicio
  explícito de páginas incompatibles, invalidaciones e interrupciones; conservar la copia anterior,
  pendientes y conflictos. Revisar límites de privilegios/epoch/restore de Core etapas 1/2.
- El hash no es firma ni autorización y no defiende contra un dispositivo con acceso privilegiado
  que cambie simultáneamente contenido/recibos. Las reglas de seguridad siguen en Core.
- Crypto SHA-256 y UUID se validaron en web Chromium/Node. Si Web Crypto no está disponible, la
  captura falla explícitamente; no se promete soporte native/Safari físico nuevo. Las lecturas y
  escrituras existentes no dependen de esta vía optativa.

Rollback del lote retira APIs/métodos nuevos y deja claves metadata inertes; no requiere borrar
SQLite, OPFS, cachés, registros ni outbox. Mantener los lotes previos y sus índices intactos.
Evidencia: backups/offline-revision-receipts/2026-11-11/. Sin producción, commit, push o deploy.


## Evolución local: etapa 4, integración ordinaria — 11-11-2026

El texto anterior describe la etapa 3 optativa. El estado nuevo está en
[PREPARATION_REVISION_RECEIPTS](PREPARATION_REVISION_RECEIPTS.md): la preparación ordinaria integra
sellos/recibos compuestos, sin omitir lecturas. La vía observacional optativa anterior conserva su
contrato. No se promueve su prueba granular a cobertura de experiencia automáticamente; el namespace
y versión nuevos distinguen la composición. Persisten los límites de metadata/catálogos/contextos
y la incompatibilidad Attendance/Observación demostrada. No activar reutilización.


## Negociación Client V2 — continuación local, 13-11-2026

[Contrato V2 y observador](REVISION_NEGOTIATION_CLIENT.md): getOfflineRevisionManifest prefiere V2
validada y conserva V1-only ante incompatibilidad explícita de servidor antiguo. Las materializaciones
y recibos siguen igual; el marcador de handle/runtime es adicional, no durable ni permiso de omisión.
No se modifican SQLite, outbox, identidad, guardados o motores de envío.
