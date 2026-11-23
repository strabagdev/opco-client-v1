# Attendance: consulta separada del día de registro

## Contrato local — 2026-11-23

Sustituye la propuesta de confirmación de fecha manual (árbol `529f11e`), que no
se publicó. Con `operationalCalendar`, toda **alta nueva** lleva `mode=AUTO` y
DATE calculado por el resolvedor existente a partir de `eventOccurredAt` del
instante definitivo de confirmación. La zona y el inicio provienen de la
configuración; no hay reglas particulares por contrato. DATETIME y DATE se
vinculan al mismo instante. DATE continúa siendo sólo fecha.

El selector, Anterior/Siguiente, `attentionDate`, Atrás y el estado conservado
son **fecha de consulta**. No autorizan altas retrospectivas con calendario.
La consulta puede permanecer en un histórico tras guardar un alta del día
operativo actual. La cabecera indica el día de las nuevas altas; el diálogo
existente de repetición muestra la fecha del registro, sin ofrecer fecha manual.
Las experiencias sin calendario conservan el comportamiento anterior.

## Lecturas, repetición y edición

Buscar/seleccionar una persona y comprobar su conteo usan el día operativo
actual, independientemente del histórico consultado. Para Uno por día se carga
el current del día de registro, no el current del histórico. Las copias con
trabajo pendiente prevalecen sobre su copia remota. Se conserva la política de
repetición, el SELECT manual A/B, la autorización, el contexto obligatorio y la
protección frente a confirmaciones obsoletas. No se crean diálogos adicionales.

Si cambia el día operativo durante una selección, un conteo o una advertencia,
se invalida esa autorización y se pide seleccionar/comprobar de nuevo. No hay
escritura, captura persistida ni reintento automático. Si sólo cruza medianoche
y el día operativo no cambia, el clic final aporta el instante y su DATE. La
advertencia por franja conserva la selección manual y usa el sector existente.

Editar identifica el registro y su fecha original: `mode=PRESERVE`. No convierte
una edición histórica en un alta de hoy, ni recalcula una captura anterior.
Uno por día conserva su identidad lógica y base/versionado existentes;
el updatedAt local nunca se usa como versión de servidor de un alta sin ACK; múltiples
conserva la edición por ID local/servidor. Los comandos ya persistidos, incluidos
los MANUAL anteriores, se reenvían sin reclasificación. No se cambia outbox,
SQLite/OPFS, esquema, namespace ni sincronización.

## Alcance y límites

Sólo Client. C-06 y la documentación C-02 quedan fuera del candidato. Las 27 filas
propuestas de producción siguen sin modificación y requieren autorización
separada. El rollback conserva almacenamiento y pendientes, pero reintroduce
la posibilidad de que una consulta manual determine la fecha de un alta.

Las comprobaciones locales distinguen handlers, persistencia SQLite/OPFS real y
API sintética. No acreditan un ACK productivo nuevo ni dispositivos Safari/native.
La política Core existente sigue aceptando comandos MANUAL anteriores por
compatibilidad; este parche impide generarlos desde el Client actualizado, no
revoca las capacidades de consumidores antiguos ni reescribe sus pendientes.
