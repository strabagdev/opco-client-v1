# RECORDS: recibos de datos preparados — 12-11-2026

Lote local independiente sobre `offline-catalog-context-coverage` (árbol3630d4b…). Sin cambios
Core, esquemas, namespace, guardados, outbox o sincronización. Todo recibo mantiene `mode:shadow`
y `reuseAllowed:false`. No se omiten descargas ni se cambia la preparación de Inicio.

## Qué se prepara realmente

| Camino | Consulta y almacenamiento existente | Acreditación nueva |
| --- | --- | --- |
| Inicio | Metadata AppView/entidad; catálogos directos por el lote anterior | Sigue sin certificado de datos RECORDS |
| Abrir/reintentar RECORDS online sin búsqueda | `refreshEntityRecordsCache`: colección sin filtros, páginas100 hasta completar, máximo1000 páginas; reconciliación completa, presentación local inicial25 | Colección completa sólo tras verificar revisión y persistencia |
| Buscar online | Texto debounced350ms, página1/tamaño25; upsert de esa página | Parcial; no certificado de colección |
| Cargar más online | Página siguiente/tamaño25 de búsqueda vigente; upsert sin limpieza | Parcial por sí sola; no se crea una prueba completa |
| Abrir/buscar/paginar con offline conocido | SQLite únicamente; orden/filtros locales existentes | Inspección local de recibo, nunca frescura remota |
| Detalle | ID individual, demand-cache | No acredita una colección |

El renderer no ofrece filtros estructurados ni ordenamiento configurables nuevos. El servicio/API
existente admite `search`, `fieldIdHasValue`, `sort` (`displayName`, `updatedAt`, `field:`/`fieldId:`),
`direction`, `page` y `pageSize`. La serialización vinculada conserva exactamente los criterios de
la API original, incluidos trim/omisión de búsqueda y campo de filtro vacíos. Las pruebas incluyen
combinaciones distintas para impedir que una lectura parcial certifique otra cobertura.

La cobertura completa es **membresía y contenido de la colección sin filtros**. El orden de las
páginas se verifica durante la descarga y el hash local se calcula por ID. No promete equivalencia
de collation/búsquedas SQL y SQLite ni resultados de consultas arbitrarias. No modifica esas consultas.

## Integración y revisiones

`createRecordsRevisionRead` envuelve las lecturas que ya realiza el renderer. Negocia el manifiesto,
verifica asignación AppView mediante `/views` vinculado, y utiliza las lecturas optativas Core de
entidad/registros. No descarga catálogos nuevos ni crea un segundo refresco. Páginas posteriores
usan expectedReadRevision; 409, cambio de vector/autorización, página corta, conteos incompatibles
o IDs duplicados se rechazan antes del writer completo existente.

Después del refresco se contrastan todos los sellos/hashes con un manifiesto final. Sólo una
secuencia completa, sin filtros y con definición/asignación vinculadas puede emitir recibo. Un
resultado mostrado no demuestra persistencia ni equivale a recibo emitido. Un fallo del recibo se
registra y no destruye la lista; un fallo de transporte conserva el fallback local existente.

La definición estable de AppView participa en el efecto de lectura: un cambio real de configuración
retira el intento anterior; cambios de identidad de objeto con contenido idéntico no crean un loop.
Se mantienen los guards de lectura existentes, y un fence durable independiente por AppView impide
que un recibo retirado reemplace uno más reciente. No se reemplaza el fence global del preparador.

## Recibo y almacenamiento

Namespace aditivo `records_revision_receipt:v1:` en `app_metadata`, más keys de sesión/diagnóstico
`records_revision_active:v1:` y `records_revision_status:v1:`. Sin nuevas tablas, migraciones o bases.
Clave owner/contrato/AppView; contenido además usuario, aplicación, autorización y entidad. Cambios
incompatibles no comparten prueba. Recibos previos metadata-only y catálogos permanecen separados.

```json
{
  "kind": "unfiltered-collection",
  "complete": true,
  "arbitraryQueries": false,
  "catalogsIncluded": false
}
```

El commit usa el coordinador SQLite existente en una transacción: fence antes/después del hash,
comparación de cada fila/ID/updatedAt/values/displayName con las respuestas completas, definición,
lista asignada y receta sellada. Sólo entonces persiste snapshotId/vector/metadata/hash. Cero
filas requiere respuesta vacía válida y persistencia vacía, nunca ausencia de caché. Un pending,
failed o conflict en esa colección impide acreditarla y permanece intacto.

`inspectRecordsRevisionCoverage` distingue:

- `complete`: prueba íntegra de todos los datos declarados; `remote_unchecked` offline o
  `match_shadow` tras cotejo del manifiesto. Nunca significa vigente sin ese cotejo.
- `partial`: filas locales o consulta parcial conocida sin recibo íntegro/compatible.
- `unprepared`: sin datos ni prueba; no se convierte en colección vacía.

Un fallo SQLite no se transforma en cero registros: se rechaza la lectura o se registra prueba
inválida con motivo. Versiones no soportadas, partes ausentes o contenido alterado invalidan.
Una actualización interrumpida puede conservar el recibo **anterior** si la copia anterior sigue
íntegra: se conserva su snapshotId/fecha; no se emite uno para la descarga interrumpida. Un vector
remoto cambiado invalida esa prueba al comparar o iniciar la siguiente lectura vinculada.
Un upsert parcial puede alterar una copia antes completa: el hash posterior detecta esa diferencia;
no se infiere cobertura nueva desde el conteo o la telemetría legacy.

## SELECT/RELATION y compatibilidad

La definición vinculada incluye opciones, IDs, values, labels, orden y configuración. Las filas
incluyen la proyección RELATION ONE/MANY con etiquetas autorizadas. El vector Core contempla las
entidades relacionadas, aristas y eliminaciones. Esto acredita valores/etiquetas preparados para
lectura; los catálogos completos para elegir/editar relaciones tienen sus recibos separados del
lote anterior. No hay consultas por cada fila ni habilitación automática de campos.

Core anterior sin manifiesto usa las lecturas ordinarias y deja diagnóstico explícito no acreditado.
401/403 no se rebajan a lecturas remotas sin revisión. No hay fallback tras 409 a otra comparación ni
mezcla de páginas. Clientes anteriores ignoran el nuevo namespace. Rollback Client conserva filas,
pendientes y metadata adicional; Core previo impide nueva acreditación. Orden futuro: Core sombra/
lecturas vinculadas existentes → Client de recibos, aún sin omisión. No se publica en este lote.

## Coste y límites

Se añaden probes de manifiesto/asignación a las lecturas online observadas; no hay ahorro de tráfico
en esta fase. Hashing proporcional al tamaño y una inspección transaccional adicional. No TTL,
polling, nueva descarga desde Inicio ni certificado de frescura continua. Grandes colecciones,
catálogos transitivos, revocación estando offline, Safari/native y multi-tab conservan sus límites.
Cobertura de datos y cobertura de catálogos deben evaluarse juntas antes de futura reutilización;
esta integración todavía no autoriza ni implementa esa activación.

Inventario, pruebas y evidencia: `backups/records-revision-coverage/2026-11-12/REPORT.md`.
