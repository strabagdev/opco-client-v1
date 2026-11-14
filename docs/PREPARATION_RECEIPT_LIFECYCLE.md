# Ciclo de vida de recibos — corrección local en sombra,12-11-2026

Una nueva preparación ya no retira incondicionalmente las pruebas de preparación/catálogos
antes del primer manifiesto. Se compara ese manifiesto autenticado con las pruebas existentes
y su contenido local;scope,autorización,metadata,vector o epoch diferentes siguen invalidando.
El fence de sesión conserva la protección contra respuestas viejas. No hay omisión/reutilización.

Interrumpir un probe sin modificar materialización no elimina una prueba válida:queda como
procedencia remota no comprobada offline. Actualizar marcadores o contenido puede invalidar el
hash anterior:aquella prueba no se acredita entonces. Commit transaccional sustituye la prueba
sólo tras nueva persistencia verificada. Un rechazo401/403 conocido retira la acreditación del
intento vigente,sin borrar datos;si falla ese retiro,se registra REVISION_WITHDRAWAL_FAILED
y continúa denegado el acceso remoto. Un callback abortado no retira pruebas de otra generación. La vigencia se comprueba
también al terminar la transacción de retiro:un cambio durante sus awaits hace rollback.

inspectPreparationRevisionReceipts admite request optativa con AppView,kind,dates exactos,
snapshotId,identity y definición esperados. Un mes/contexto/definición distintos devuelve
PREPARATION_REQUEST_COVERAGE_MISMATCH sin destruir la prueba de su propia cobertura.
La integridad,scope y revisión se comprueban antes;match_shadow sin request conserva el
contrato diagnóstico anterior y nunca debe tratarse como permiso para una consulta cualquiera.
SELECT/RELATION se ligan por sus IDs/configuración en la definición,catálogos separados y
valores de identidad sólo cuando hay marcadores que realmente los cubren. No se infiere
contexto seleccionado desde metadata ni se habilitan nuevas identidades/cardinalidades.

Pruebas SQLite reales cubren mismatch de solicitud con conservación/reapertura,snapshot,
usuario/contrato,metadata/vector y epoch. PostgreSQL/OPFS cubren cambios/permisos y corte/reconexión.
Una restauración Core requiere rotar epoch antes de permitir decisiones de reutilización;no
se añadió rotación automática ni política DDL. El procedimiento sigue siendo gate operativo.
SQLite restaurado o alterado debe pasar hashes/marcadores actuales antes de acreditar nada.

reuseAllowed=false y clientMaySkipReads=false permanecen obligatorios;protocolo sombra intacto.
No TTL,polling,nuevas tablas/migraciones,cambios de escritores,outbox o guardados. Rollback sólo
retira este delta y deja las claves de recibos existentes;no borrar almacenamiento.


## Negociación y runtime — 13-11-2026

[Observador V2](REVISION_NEGOTIATION_CLIENT.md): los recibos persistidos conservan la distinción
procedencia/integridad; una comparación compatible tras reapertura no restaura el marcador volátil
de descarga verificada en el runtime. No borrar un recibo compatible por esa falta: conservar datos
y ejecutar la descarga normal. Guardas de scope/handle se comprueban alrededor de los awaits; no hay
ocultación de409, rechazo autorizado ni cambios en pendientes/conflictos. Omisión/reutilización false.
