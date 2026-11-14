# Reutilización selectiva — piloto local, 13-11-2026

Implementación optativa, apagada por defecto y no publicada. No cambia escritores, comandos,
identidad, outbox, conflictos, sincronización, schema SQLite ni namespace epoch2.

## Dos gates y compatibilidad

Client sólo solicita storagePolicyVersion=2 en preparación si
EXPO_PUBLIC_OFFLINE_REUSE_POLICY=attendance-runtime-v1 (o la opción de API sintética selectiveReuse)
está habilitada. Core sólo ofrece el piloto para contratos incluidos exactamente en
OPCO_OFFLINE_REUSE_CONTRACT_IDS y OPCO_OFFLINE_REUSE_POLICY=attendance-runtime-v1. No admite wildcard.
No se configuran estas variables en producción en este lote. No se activa el piloto de colaciones.

V1 y policy1 de V2 conservan sus flags false y forma. Policy2 añade negotiation.selectiveReuse:
version1, policy attendance-runtime-v1, enabled y AppView IDs Attendance asignadas. Sólo con el
gate servidor, mes explícito, tracking/dependencias válidos y negociación compatible concede
reuseAllowed/clientMaySkipReads en ese descriptor. coverageCertified/localReceiptVerified/
storageIdentityVerified siguen false: Core no inspecciona el dispositivo. Las banderas raíz legacy
siguen describiendo sombra general; no constituyen un permiso global de omisión. Client verifica
la concesión optativa por separado y rechaza una concesión policy2 al solicitar policy1.

Core anterior no concede policy2: se continúa con la descarga ordinaria sin acreditar omisión.
401/403 siguen denegando; no existe fallback que amplíe permisos. Nonce, petición, scope, app,
autorización, revisiones, definición y epoch conservan la validación V2. No hay TTL/polling nuevo.

## Alcance inicial

Sólo se puede omitir la preparación de negocio Attendance con recibo attendance-month completo:
mes exacto, fuente completa, todos sus días/eventos persistidos y campos/presentación verificados.
Se exige la misma definición/contexto y ausencia de overlays incompatibles en la materialización.
Los catálogos siguen descargándose y verificándose por el mecanismo ordinario; no heredan esta
omisión. STATE_UPDATE, RECORDS, PANEL, REPORT y MATRIX tampoco cambian su descarga. Metadata-only,
parcial, no visitado o contexto no cubierto jamás autoriza omisión.

Un handle nuevo, cold reopen/copia de perfil, cambio de sesión/token, scope, permisos, epoch,
revisión, configuración o contenido local deniega la omisión. Se conserva el dato offline útil.
No se certifica una frescura continua sin un nuevo evento/manifiesto.

## Consumo y retirada

La inspección existente admite un callback interno onVerified, ejecutado dentro de la misma
transacción SQLite de lectura/materialización/hash, antes de liberar la cola. No abre una conexión,
no cambia schema ni persiste nuevos formatos. El gate comprueba allí el marcador de recibo/handle/
sesión V2 y la generación vigente. El caller sólo acepta después de completarse la transacción;
rollback, cambio de scope o error descartan la decisión. Una escritura intercalada queda detrás
de ese punto de consumo. No se altera ni renueva verifiedAt/runId/snapshotId del recibo reutilizado.

El manifiesto inicial siempre se obtiene remotamente para el evento. Se conserva el /views sellado
para contrastar asignaciones. Antes de terminar se obtiene otro manifiesto y se vuelve a inspeccionar
lo reutilizado. Una discrepancia retira esa omisión y ejecuta UNA pasada ordinaria limitada a las
experiencias afectadas, con el gate deshabilitado: no puede recursar otra vez. Los permisos y el
scope siguen revalidándose. No es un retry de guardado ni altera recuperación de runs abandonados.
El aviso onAppViewPrepared se difiere hasta esa revalidación final. Si se retira la omisión
y falla la pasada ordinaria, no se publica una acreditación reutilizable para Inicio.
Invalidaciones durante ejecución conservan la pasada posterior del coordinador publicado.

## Diagnóstico

getSelectiveReuseDiagnostics mantiene50 códigos y booleanos de decisión, sin IDs ni valores:
NORMAL_DOWNLOAD, ATTENDANCE_REUSED, REUSE_WITHDRAWN. Sólo ATTENDANCE_REUSED lleva reuse/skipDownloads
true; es historial de la decisión local, no sincronización ni estado global de frescura. Los
recibos persistidos siguen en formato v1/sombra con reuseAllowed=false; no se migran ni se usan
sus flags como permiso. El historial previo de negociación sigue observacional y separado.

## Publicación y rollback futuros

No publicar ni activar con este lote. Para un piloto posterior: revisar migración/roles/DDL,
backups/epoch y fallos generales pendientes; Core nuevo primero, Client compatible después,
configurar ambos gates explícitamente y sólo en el alcance aprobado. Apagar cualquiera conserva
la descarga normal. No borrar datos, recibos, cachés, outbox o conflictos. Revertir el delta Client
sobre la consolidación mantiene el formato persistido compatible. Eliminar el soporte policy2
Core retira su concesión y mantiene V1/policy1. Safari/native/multitab permanecen sin acreditar.
