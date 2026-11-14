# Attendance — cobertura de Observación, 12-11-2026

Implementación local independiente sobre la integración de recibos del 11-11. Reutilización
y omisión de descargas permanecen desactivadas. Sin cambios de escritores, sincronización,
outbox, identidad, permisos, namespace ni esquema.

## Causa y contrato

Core devuelve items=[] intencionalmente para una consulta de fecha sin búsqueda/persona.
Antes latest no seleccionaba ni serializaba el campo observationFieldId. Había eventos y
contextos, pero no prueba del valor de Observación: PREPARATION_OBSERVATION_UNBOUND era correcto.
No se debe convertir esa omisión en null ni interpretar items=[] como un día vacío.

Core ahora añade, sólo cuando está configurado, observationProjection={version:1,fieldId:ID}
y latest[].observation (string|null), seleccionando el campo en la consulta existente.
La propiedad ausente, versión desconocida o fieldId diferente no constituyen cobertura.
Cadena vacía y null explícito se conservan. El sello de lectura incluye la proyección.

Client usa attendanceLatestObservationIsBound para el adaptador al runtime compartido y la
composición del recibo. No cambia cómo se calcula completeness: exige día completo según
summary/latest y verificación transaccional del contenido y marcador local. Si latest está
vacío y summary.totalRegistered=0, es un día vacío legítimo; no se inventa un evento.

## Compatibilidad y límites

- Core nuevo / Client anterior: propiedades aditivas ignorables; comportamiento anterior.
  Ese Client puede conservar la limitación previa de cobertura, no gana garantías nuevas.
- Client nuevo / Core anterior: ausencias explícitamente no acreditadas; el fallback current
  existente bajo demanda se conserva. No hay nuevas descargas por persona en la preparación.
- Máximo latest=10: más registros implica día parcial y rechazo del recibo mensual. No hay
  nueva paginación ni certificación de datos no descargados.
- Contextos/catálogos RELATION, consultas PANEL/REPORT y colecciones RECORDS no adquieren
  cobertura automática nueva. Se conservan los límites de PREPARATION_REVISION_RECEIPTS.md.
- Un cambio remoto, permisos, scope o revisión incompatibles invalida el recibo; conserva
  datos utilizables. Sin red el estado es remote_unchecked, no fresco acreditado.
- El rollback de este delta sólo retira acreditación de Observación donde falte la proyección;
  no requiere borrar SQLite, OPFS, recibos inertes, outbox ni conflictos.

## Verificación

El informe reconstruible del lote registra RED→GREEN, PostgreSQL/Core HTTP aislados,
reapertura SQLite y Chromium/OPFS, revisión entre páginas y datos locales protegidos.
Sólo fixtures sintéticos. No valida producción, Safari/iPhone físico ni native.
