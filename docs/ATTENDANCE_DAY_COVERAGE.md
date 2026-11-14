# Cobertura diaria completa Attendance — local, 12-11-2026

Sustituye la limitación de diez eventos exclusivamente para la descarga del snapshot del día.
La lista reciente y búsquedas siguen usando el contrato anterior. No activa reutilización ni
omisión de descargas; no hay cambios de motores SQLite, OPFS, outbox, sincronización o escritores.

## Flujo y prueba de completitud

Core anuncia daySnapshotCapabilities v1/maxPageSize100 y conserva latest legacy diez. Si ese
DTO ya contiene todo el día (0..10), no se agregan solicitudes. Para días mayores, completeAttendanceDay
descarga todas las páginas con daySnapshotVersion=1, readRevisionVersion=1 y pageSize<=100.
Cada página posterior lleva expectedReadRevision de la primera. No se reutilizan las diez filas
de seed como una página, ni se persiste parcialmente el nuevo día.

Se validan sello crudo y petición efectiva, revisión común, conteo/índices/tamaño/hasMore, fecha,
AppView, origen/destino, roles/configuración y valores normalizados contra el cuerpo sellado.
Los IDs de evento son únicos y la cantidad total exacta. No se fusionan por sujeto los eventos
de las páginas. Un error, HTTP409, falta de página, versión desconocida o scope retirado aborta
sin fallback/reintento automático. El contenido anterior sigue disponible.

La prueba en memoria está ligada a ownerKey, contrato y AppView; reutilizar ese objeto bajo
otro scope se rechaza también antes de persistir. El refresco devuelve al renderer su DTO
legacy acotado, mientras el almacenamiento recibe el día completo.

Sólo el agregado inmutable creado por ese verificador obtiene prueba de completitud en memoria;
un objeto de red, JSON reabierto o spread de DTO no puede inventarla. cacheAttendanceRemoteSnapshot
usa ese agregado en la transacción de snapshots ya existente, con expectedRemoteEventCount y
verificación de contenidos/campos. El marcador diario sólo se publica tras persistencia completa.
Tras reapertura, la prueba durable son contenidos, marcador y recibo con hashes existentes.

La preparación mensual integra sellos de todas las páginas en una parte por fecha; exige cada
fecha del mes y manifiestos compatibles. No mezcla revisiones entre páginas o consultas.
Observación conserva su marca v1/fieldId y texto/vacío/null. SELECT y RELATION conservan valores,
IDs y etiquetas; no se crea ninguna cola ni se cambia una intención pendiente.

## Compatibilidad y límites

- Core nuevo / Client anterior: últimas diez filas y consultas iguales; nuevas propiedades opcionales.
- Client nuevo / Core anterior: ausencia de capacidad mantiene cobertura limitada legacy. No
  acredita días >10. Capacidad incompatible requerida para paginar o protocolo de revisiones roto falla explícitamente.
- Lectura visible/ACK: refreshAttendanceDaySnapshot usa el mismo verificador cuando el API lo
  soporta. No amplía el listado UI a una nueva paginación ni cambia guardados/confirmaciones.
- No hay tope global nuevo ni truncamiento silencioso: todas las páginas anunciadas deben llegar.
  Coste/memoria crecen con el día; fixture máximo real137, unitario301, no escala productiva demostrada.
- Históricos sin sujeto/estado/campos configurados válidos no se descartan para certificar: la
  inconsistencia mantiene incompletitud. Duplicados históricos no se reparan ni fusionan.
- RECORDS/PANEL/REPORT, catálogos/contextos de otras recetas y STATE_UPDATE no amplían cobertura.
  Cobertura completa no prueba frescura offline; reuseAllowed sigue false.
- Publicación futura Core → Client con todos los prerrequisitos de revisiones/Observación. Rollback
  preferido Client primero, manteniendo Core aditivo. No borrar almacenamiento ni restaurar DB.

## Evidencia

Regresiones focalizadas, Core/PostgreSQL16 aislados, SQLite con cierre/reapertura y Chromium/CDP
con OPFS real. Días 0/1/10/11/30/137, con/sin Observación; corte/revisión409, pending/conflict y
reconexión. El reporte del respaldo separa transporte real de las inyecciones y fallos de arnés.
Safari/iPhone físico y native no acreditados. No configura ni consulta producción.
