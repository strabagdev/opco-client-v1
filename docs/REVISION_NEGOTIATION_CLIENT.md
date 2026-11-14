# Negociación de revisiones Core V2 — Client local en sombra, 13-11-2026

No activa reutilización ni omisión: todos los diagnósticos nuevos dicen `reuse=false` y
`skipDownloads=false`. No cambia cuándo Inicio prepara, qué datos descarga, ni comandos,
conflictos, outbox, sincronización, permisos, esquema SQLite o namespace OPFS.

## Cliente HTTP y compatibilidad

`getOfflineRevisionManifest` solicita V2 mediante autenticación, refresh y deadline existentes.
Cada petición genera un nonce UUID nuevo y negocia representación de lectura/recibo/política1.
Verifica el nonce, versiones, banderas false, contexto/selección, forma/hash del manifiesto,
fingerprint de la petición real, bindings de scope/revisión/epoch/definiciones y comparaciones.
Las expectativas ausentes no significan coincidencia. Las revisiones conservan representación
string; el checksum de tracking de Core es MD5 de32 caracteres, no una firma ni SHA-256.

Preparación, RECORDS y consultas PANEL/REPORT pasan su owner y guard vigente; al terminar pasan
además su manifiesto inicial como expectativa. Contrato/app/autorización ajenos, respuestas
retiradas, incompletas o incompatibles no obtienen una acreditación. La comparación se repite
al publicar observaciones de recibos. No se decodifica un JWT para sustituir autorización Core.

Sólo400 INVALID_OFFLINE_MANIFEST_QUERY/INVALID_OFFLINE_MANIFEST_VERSION negocian una petición
V1 explícita, con el mismo período/selección. Un servidor histórico que devuelve V1 ignorando
parámetros también queda marcado V1-only. V1 se valida, pero nunca obtiene atestación V2.
La validación V1 por defecto sigue rechazando V2 sin negociación. No se reintenta V1 ante401,
403,409,503, nonce incorrecto o respuesta V2 corrupta. El fallo diagnóstico vuelve al camino
ordinario autorizado que ya poseen los preparadores/lectores;401/403 siguen denegando acceso.
No se convierte una denegación en permiso para descargar datos.

## Recibos y vínculo con almacenamiento

El adaptador `observeNegotiatedReceipts` envuelve únicamente commits e inspecciones existentes
de recibos genéricos, preparación, catálogos, RECORDS y consultas. Conserva sus argumentos,
retornos y errores. Usa el getter del singleton existente; no abre otra conexión ni ejecuta
SQL, migraciones, nuevas tablas o escrituras de negocio. Los hashes/materializaciones siguen
verificándose por las transacciones existentes.

Después de un commit completo y verificado, reconoce en memoria ese snapshot/recibo únicamente
si el manifiesto tiene una atestación V2 compatible, scope vigente y bindings no alterados.
Comprueba el mismo handle coordinado antes/después de los awaits y el guard de generación.
El marcador incluye el recibo completo y un fingerprint privado del token de la petición; no
exporta el token ni ese fingerprint. Un refresh de token puede retirar esta acreditación de
forma conservadora, sin afectar descargas ni datos. Hay un límite FIFO de500 marcadores por
handle: descartarlos sólo deniega acreditación, nunca elimina datos. No es un TTL de frescura.

Las inspecciones conservan su resultado previo `match_shadow` para procedencia/contenido. El
observador adicional distingue `REVISION_RUNTIME_RECEIPTS_MATCH` de
`REVISION_STORAGE_RUNTIME_UNACCREDITED`; ninguno permite omisión. Una cobertura parcial o no
preparada no cuenta como coincidencia completa. Metadata-only acredita exclusivamente metadata;
una ventana PANEL no acredita otras consultas ni automáticamente toda su colección.

Reabrir, recuperar o reemplazar el handle deja los marcadores anteriores fuera del runtime.
Una copia íntegra de perfil con el mismo epoch puede conservar contenido y recibos válidos,
pero no el marcador en memoria: requiere descarga normal verificada antes de nueva acreditación.
Epoch, permisos, metadata o revisión distintos conservan la invalidación de recibos existente.
No se cambia ni normaliza su formato persistido. Datos locales útiles, pendientes y conflictos
siguen disponibles por sus mecanismos normales.

Esto no es un detector universal de modificaciones privilegiadas de archivos ni un testigo
externo durable. No acredita ahorro entre runtimes ni cambios de namespace en caliente. El
namespace compilado sigue opco-client-v10-epoch2.db y su handle real es la frontera observada.
Un restore Core sigue requiriendo el procedimiento separado de epoch; Client no lo rota.

## Diagnóstico y límites

`getRevisionNegotiationDiagnostics` expone las últimas50 observaciones en memoria: fase, código,
conteos matched/rejected y las dos banderas false. No incluye IDs, filtros, períodos, valores,
nonce, token, payloads ni fingerprint de sesión. Es historial diagnóstico, no estado global
actual ni un indicador de sincronización. Se pierde al cerrar el runtime. Los estados existentes
siguen registrando errores/cobertura en sus claves de recibos; no se añade una cola o esquema.

No hay cambios de UI ni un nuevo panel diagnóstico en este lote. Los arneses pueden leer ese
historial mediante la función exportada. Un fallo del observador no modifica el resultado del
commit/inspección original, ni entra en un retry. SHA-256/Web Crypto conserva el límite existente:
si falta soporte, no se fabrica acreditación; la descarga ordinaria conserva su propio flujo.

## Compatibilidad y rollback

Requiere las etapas locales Core de revisiones/lecturas y la negociación V2 para acreditación
nueva, pero Core V1 mantiene las descargas/recibos legacy sin ella. No hay ETag/304 ni omisión.
El vector Core sigue siendo conservador por contrato; no se promete invalidación selectiva fina.
Los protocolos de páginas/HTTP409, intenciones, bases, autorización e idempotencia no cambian.

Rollback: retirar sólo este delta, conservando snapshots, recibos y tablas existentes. No hay
migraciones ni claves nuevas que limpiar. No borrar OPFS/SQLite, intenciones o conflictos. El
orden futuro sigue Core V2 primero, Client después; activar omisión requerirá un gate separado.
