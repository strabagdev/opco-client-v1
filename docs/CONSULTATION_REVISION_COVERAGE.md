# PANEL y REPORT/MATRIX — recibos de consultas preparadas, 12-11-2026

Lote independiente sobre `records-revision-coverage` (árbol36c7947…). Sin cambios Core/API,
esquemas, namespace u outbox. `mode:shadow`, `reuseAllowed:false`: no omite descargas ni acredita
una experiencia por tener metadata. Inicio conserva su política; las consultas siguen bajo demanda.

## Inventario real

| Superficie | Consulta existente | Cobertura acreditable |
| --- | --- | --- |
| Inicio | AppViews/definiciones, no resultados PANEL/REPORT | Metadata solamente |
| PANEL | Dataset explícito o discovery, filtros por ID, búsqueda, página/tamaño | Ventana exacta; resultado del dataset sólo cuando están todas las páginas compatibles |
| REPORT TABLE de entidad | from/to explícitos, orden configurado, campos/relaciones requeridos | Todos los registros devueltos del período exacto, sin paginación API |
| MATRIX de entidad | Mismo endpoint REPORT y período; row/column/value/summary por IDs configurados | Datos completos de esa consulta; agrupación/resúmenes originales en Client |
| TABLE con origen STATE_UPDATE CURRENT existente | Misma API, proyección completa de sujetos/current | Paquete exacto de esa proyección, sin reinterpretar fecha ni identidad |
| CURRENT_STATUS/LATEST_BY_RELATION u otros modos | Lectores existentes | No se añaden recibos para esos modos |

PANEL ordena/transforma en Core según su configuración; el cliente no introduce sort ni agrupa
páginas por semejanza. API acota tamaño a100: se conserva el valor solicitado en la identidad de
consulta y se valida el tamaño efectivo del resultado, sin convertir150 y100 en una misma clave.
REPORT no ofrece paginación; Core de entidad lee todo el rango con campos requeridos y orden
configurado. MATRIX mantiene conjuntos de valores por celda y resúmenes de ocurrencias existentes;
no se introduce una suma o consolidación distinta.

El origen STATE_UPDATE CURRENT conserva la semántica actual de Core: consulta todos los sujetos y
sus current, no filtra esas filas por from/to; el rango forma parte de su envolvente/identidad de
consulta. Se prueba sin corregir esa regla aquí. Períodos distintos no se consideran equivalentes.
La prueba de esta variante es Core/PostgreSQL/SQLite, no un ensayo UI adicional de esa variante.

## Frontera exacta y dependencias

La identidad contiene owner/contrato, AppView/definición, kind, dataset solicitado, filtros, búsqueda,
página/tamaño y revisión de configuración. Objetos de filtros se canonizan por claves; los valores,
IDs y orden de arreglos se conservan. Discovery y dataset explícito tienen recibos distintos aunque
el loader legacy conserve alias de snapshot. No se infiere un conjunto a partir de otro filtro o resumen.

PANEL incluye schema/options y valores/etiquetas relacionados autorizados de Core. REPORT incluye
fields/options y proyecciones RELATION ONE/MANY de los campos requeridos. La revisión de Core
contempla relaciones, eliminaciones, opciones, metadata y autorización. No se hacen consultas por
fila. Eso no acredita el catálogo completo para cambiar filtros o editar: PANEL conserva su carga
bajo demanda de catálogos y los recibos de selección de otros consumidores permanecen separados.

PANEL puede devolver métricas/moduleResults junto al dataset. Se conservan y hashean como fueron
recibidos, incluyendo null/reason; este recibo no certifica todas las tablas operandas ni toda la
experiencia/KPI. El alcance completo es sólo el resultado del dataset solicitado, no la AppView.

## Protocolo y persistencia

El observador envuelve el GET existente, liga asignación/definición y respuesta a los manifiestos
inicial/final y verifica hashes. PANEL adopta su definición coherente con las mismas comprobaciones
R1/R2 existentes; no retargetea snapshots antiguos. REPORT exige configuración coherente para
acreditar TABLE/MATRIX y un período explícito. No se añaden búsquedas, filtros o agrupaciones.

Cada página posterior de PANEL envía expectedReadRevision de la página1 acreditada del mismo marco.
Si no hay ancla válida, se lee página1 sólo para vincular la solicitud siguiente; esa lectura no
persiste ni acredita la página1. Si hay ancla antigua, Core puede responder409: se conserva la copia
previa y no se reintenta silenciosamente con otra revisión. Una página1 nueva abre otra revisión;
páginas antiguas restantes no completan el nuevo conjunto. No hay bucles, TTL ni polling.

Se escribe primero el snapshot mediante el writer existente, con guard antes y después del INSERT
en la transacción SQLite. REPORT necesitó incorporar ese guard opcional, igual que PANEL: una
lectura retirada después del INSERT hace rollback. No cambia ningún dato/comando/outbox. Offline
conocido consulta sólo SQLite; ausencia de snapshot se distingue de resultado vacío y fallo local.

Tras persistir, el recibo comprueba copia exacta contra contentHash Core (también calculatedAt),
metadata/asignación coherentes y receta de consulta. Fence propio por ventana/usuario/contrato;
no reemplaza el fence del preparador global. Un intento nuevo o cambio de scope retira al anterior,
incluso mientras espera SQLite. Hash y publicación del recibo son transaccionales.

Namespace aditivo `consultation_revision_receipt:v1:` en app_metadata, con claves de sesión/estado
asociadas. No tabla/migración nueva. Scope incluye usuario/aplicación/autorización; cada recibo guarda
snapshotId, epoch/vector/metadata, definición, selección, sellos, marco y hash local. Declara:

```json
{
  "kind": "exact-query-window",
  "completeWindow": true,
  "wholeExperience": false,
  "arbitraryQueries": false,
  "catalogsIncluded": false
}
```

## Inspección y completitud

- `windowPrepared=true`: ventana exacta íntegra y vinculada. No implica todas las páginas.
- `coverage=complete`: TABLE/MATRIX sin paginación, o todas las páginas1..N del mismo dataset/criterios/
  definición/autorización/revisión, total/tamaño efectivos coherentes e IDs únicos.
- `coverage=partial`: snapshot utilizable sin prueba compatible, o sólo algunas páginas válidas.
- `coverage=unprepared`: consulta exacta no guardada/disponible; nunca significa resultado vacío.

Offline usa remote_unchecked; con cotejo remoto, match_shadow o invalid. Completo no significa
vigente sin comparar. SQLite, metadata/versión incompatible o contenido faltante exponen motivo
explícito, sin inventar cero resultados. Las páginas con metadata de cobertura desconocida no
completan un conjunto. Un resultado vacío sólo es completo con su respuesta y snapshot verificados.

Interrupciones conservan snapshots previos y, si siguen íntegros, su recibo/snapshotId anterior:
no se emite otro de la descarga fallida. Una discrepancia remota o local invalida la prueba al
inspeccionar. El estado no se actualiza por push; no existe garantía de frescura continua.

## Compatibilidad y límites

Core anterior sin protocolo mantiene GETs legacy y diagnóstico no acreditado;401/403 no se rebajan
a lecturas sin revisión. Clientes anteriores ignoran nuevos keys. Snapshots anteriores siguen
utilizables, pero no se convierten en consultas completas por ausencia de recibo o por metadata.
REPORT mantiene su snapshot legacy por período/búsqueda (sin columna configRevision): otra versión
puede reemplazar esa copia al completarse; los recibos distinguen definiciones y detectan la copia
reemplazada, sin crear historial de snapshots. PANEL conserva sus claves R1/R2 existentes.

Guardas offline/cancelación se aplican al lector compartido REPORT; los otros modos conservan
consultas/resultados/cálculos y no obtienen acreditación nueva. Todas las escrituras de negocio,
pendientes, conflictos, bases, idempotencia y sincronización permanecen intactas.

Coste: manifiestos/asignación, verificación de bytes y lectura de páginas ya almacenadas para
componer cobertura. Puede agregar un ancla página1; no se presenta ahorro de tráfico. Medir tamaño,
hashing y cola antes de activar reutilización. No se acreditan otros filtros, todos los períodos,
catálogos transitivos, operandas KPI ni revocación instantánea offline. Safari/native/multi-tab
continúan pendientes. No se atribuye este lote a incidentes productivos anteriores.

Orden futuro: Core sombra/lecturas vinculadas existentes → Client recibos, sin omisión. Rollback
Client ignora nueva metadata y conserva snapshots/colas. No revertir almacenamiento ni restaurar
PostgreSQL. NO-GO para activar reutilización sin cerrar comparación remota, coberturas necesarias,
política epoch/restore/autorización y presupuesto de rendimiento.

Evidencia, pruebas, tiempos y parche: `backups/consultation-revision-coverage/2026-11-12/REPORT.md`.
