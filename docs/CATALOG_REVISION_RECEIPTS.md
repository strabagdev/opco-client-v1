# Contextos y catálogos vinculados a revisiones — 12-11-2026

Lote local independiente sobre `attendance-day-coverage` (árbol Client
`e53c9b271d2036c806dbbd34c5c11fe8dacc0cba`). Core no cambia; requiere el contrato
optativo de revisiones de los lotes Core sombra/lecturas vinculadas. Todo recibo
es `mode: shadow`, `reuseAllowed: false`. No se omiten descargas ni se cambia cuándo
Inicio prepara las experiencias. No se acredita frescura al estar offline.

## Inventario y frontera de cobertura

| Consumidor | Metadata/opciones | Catálogos completos directos |
| --- | --- | --- |
| RECORDS | Definición activa, SELECT/MULTISELECT activos y ordenados, configuración RELATION | Cada destino RELATION de campos activos ONE/MANY |
| Attendance | Configuración, estado SELECT, contextos configurados SELECT/RELATION, campos de identidad preparados | Origen de sujetos y destinos de contextos RELATION simples admitidos por el workflow |
| STATE_UPDATE | Estados, extras e identidad preparados (SELECT, MULTISELECT o RELATION según capacidades existentes) | Origen de sujetos y destinos RELATION ONE/MANY de esos controles |

`relationKind` y las representaciones históricas se interpretan mediante los helpers
existentes de formularios; no se reparan definiciones. No se habilitan campos inactivos
ni se amplían capacidades de un renderer. Las opciones inactivas quedan en la definición
firmada y sólo las opciones activas/ordenadas deben coincidir con el control preparado.
Attendance conserva la convención de estado SELECT implícito del adaptador compartido.

Los contextos son valores de selección; **sus catálogos no certifican los registros de
negocio de todas sus combinaciones**. `prepareStateUpdateContextOnce`, la identidad,
comandos y sincronización conservan su comportamiento. Tampoco se descargan recursivamente
los formularios de cada entidad relacionada. Las etiquetas relacionadas incluidas en una
respuesta están vinculadas al vector transitivo de Core; eso no acredita la colección
completa del siguiente nivel. Si otra AppView utiliza ese nivel directamente se inventaría
como dependencia propia. PANEL/REPORT no adquieren nueva preparación ni consultas offline.

## Descarga y consistencia

La preparación ordinaria obtiene su manifiesto autenticado y mantiene el fence de sesión
existente. Al terminar las lecturas de las experiencias, inventaría las dependencias desde
sus definiciones preparadas y las contrasta con definiciones Core vinculadas a revisiones.
Solicita cualquier definición/colección directa aún ausente. Un mapa de promesas por ejecución
comparte las descargas entre consumidores del mismo usuario, contrato, autorización y sesión.
No comparte mediante TTL, recibos antiguos ni sólo el indicador `complete`.

Las colecciones se descargan por el servicio de refresh completo existente: todas las páginas
sin filtro, conteo/IDs únicos/total coherentes, revisión esperada común. Una búsqueda o página
no acredita la colección. El ensamblado precede a reconciliar; 409, transporte interrumpido,
metadatos incompatibles o scope retirado impiden acreditar y conservan la copia previa utilizable.
La nueva fase termina antes del diagnóstico final de preparación; los rechazos del recibo se
registran como tales y no se transforman en éxito de cobertura de negocio.

Todos los sellos se verifican contra el manifiesto final, incluyendo hashes de respuesta y
normalización. Un cambio de datos, relaciones/eliminaciones, opciones, metadata o autorización
rechaza el conjunto afectado. El vector de Core es conservador por contrato: puede invalidar
catálogos no modificados; no se presenta como invalidación fina por entidad.

## Recibo persistido y comprobación

Namespace aditivo en `app_metadata`: `catalog_revision_receipt:v1:`. No hay tabla, migración,
segunda base ni cola nuevas. Clave con owner/contrato/aplicación/usuario/AppView; contenido
con fingerprint de autorización, dependencias/roles/cardinalidad, recetas de materialización,
sellos de todas las páginas, epoch/vector/metadata, snapshotId y hash local.

Cobertura explícita:

```json
{
  "kind": "field-options-and-direct-catalogs",
  "complete": true,
  "contextBusinessRecords": false,
  "transitiveCatalogs": false
}
```

El commit usa la transacción/coordinador SQLite existente: verifica sesión antes y después
de materializar y hashear, compara los registros persistidos con las respuestas completas,
comprueba definiciones y opciones y sólo después escribe el recibo. Un catálogo legítimamente
vacío tiene total 0 vinculado a revisión y sin filas locales; ausencia de prueba no significa
vacío. Pendientes/conflictos en la colección impiden certificarla y se conservan.

Al inspeccionar después de reabrir se recomputan metadata, contenido y receta. Versiones no
soportadas, partes ausentes, cambios locales de opciones/configuración y overlays se rechazan.
Offline: `remote_unchecked`; con manifiesto compatible: `match_shadow`; discrepancia: `invalid`.
La inspección no descarga. Sin consulta/inspección no existe invalidación por push; la retirada
al comenzar otra preparación y el cotejo remoto/local impiden reutilizar una prueba obsoleta.
Un fallo al persistir deja datos disponibles pero no un recibo válido. Dos consumidores vivos
compatibles comparten trabajo; una ejecución abortada no publica su prueba.

## Compatibilidad y publicación futura

Core previo sin revisiones mantiene el camino ordinario sin acreditar estos recibos. Clientes
anteriores ignoran el nuevo namespace; los recibos de negocio v1 conservan sus límites, incluido
`relationCatalogs: false`. No se reinterpretan como cobertura ampliada. Para futura reutilización
haría falta comprobar conjuntamente las pruebas de negocio y catálogos vigentes para el scope
exacto. Esa activación continúa NO autorizada/NO implementada.

Orden futuro: Core sombra + lecturas vinculadas + cobertura Attendance → Client recibos y esta
fase, manteniendo la omisión deshabilitada. Rollback de Client ignora metadata adicional y conserva
caché/outbox; rollback de Core impide nueva acreditación sin promover datos antiguos a vigentes.
No se cambiaron API, guardados, IDs, versiones base, permisos ni sincronización.

## Riesgos y aceptación

La certificación agrega lecturas de catálogos que antes podían quedar sólo bajo demanda y hashing
proporcional a sus tamaños. No hay presupuesto/límite nuevo ni estimación productiva demostrada;
catálogos grandes requieren medición y diseño de cobertura antes de activar reutilización. No se
promete revocación remota inmediata estando offline ni soporte multi-tab. Safari físico/native,
colecciones transitivas y cobertura de negocio de todos los contextos quedan fuera de lo acreditado.

Evidencia reproducible, conteos, resultados y tiempos en
`backups/offline-catalog-context-coverage/2026-11-12/REPORT.md` e inventario asociado. Todo usa
Core/PostgreSQL/SQLite aislados con datos sintéticos; el arnés Chromium llama preparación y
lectores reales, sin acreditar una nueva inspección de todos los renderers o de dispositivos físicos.
