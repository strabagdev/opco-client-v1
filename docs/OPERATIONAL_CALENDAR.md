# Calendario operativo opcional — 2026-11-19

Implementación local; no configuración ni activación productiva. captureTime continúa pendiente.

## Corte actual acreditado

AttendanceWorkflow obtiene inicialmente DATE de `formatLocalDateInput(new Date())` y
`watchAttendanceLocalDay` observaba medianoche del dispositivo. `changeDate`/DateFieldInput
permiten fecha manual. `attendanceEntryToStateUpdateEntry` transporta esa fecha por separado
del optionId elegido; Core `parseStateUpdateBody`, `dateOnlyToUtcDate` y
`findExistingStateUpdates` usan el DATE UTC date-only como componente de persona + fecha.
`parseAttendanceDate` exige DATE válido; no infiere una jornada si el consumidor lo omite.
`getAttendanceWorkflowDay`/latest comparan EntityValue.dateValue por igualdad.
PANEL TODAY usa su zona configurada pero cortaba a las 00:00. Los filtros PANEL_FILTER EQ
se aplican al DATE almacenado; ni turno SELECT ni eventOccurredAt cambiaban ese corte.
El motor de unicidad no necesita una nueva identidad ni un cambio de esquema.

El schedule existente de STATE_UPDATE resuelve un catálogo versionado para una fecha
**explícita**, duraciones y contexto compuesto. No resuelve el instante de confirmación
ni el default de PANEL: se conserva sin cambios. Este cálculo civil puro es reutilizable
por consumidores futuros; no crea workflow/tipo DAILY ni calendario por contrato.

## Definición y editor

WORKFLOW/attendance acepta opcionalmente:

```json
{"operationalCalendar":{"version":1,"timeZone":"America/Santiago","dayStart":"08:00","bands":[{"optionId":"<opción real A>","start":"08:00","end":"20:00"},{"optionId":"<opción real B>","start":"20:00","end":"08:00"}]}}
```

El editor incluye habilitación, zona IANA, inicio y franjas ligadas a IDs de opciones
activas del SELECT de estado configurado. Las etiquetas no identifican opciones. Sin
propiedad no cambian fecha, turno, contratos de comandos ni política de repetición.
El editor antiguo que omite el campo conserva la definición guardada. Quitarla o
modificarla es un cambio explícito que exige revisar pendientes, no una migración.

Intervalos [inicio,fin); fin menor que inicio cruza medianoche. Inicio=fin y solapamientos
(incluso entre dos franjas envolventes) son inválidos. Huecos son válidos: sin franja
sugerida. Una opción puede tener franjas no solapadas. La zona debe existir en Intl IANA.

## Confirmación y DATE manual

Un único eventOccurredAt UTC ISO con milisegundos se obtiene en el clic definitivo del
alta; si hay advertencia positiva, al confirmarla, no al abrirla. Cancelar no estampa
ni persiste. El mismo instante alimenta DATETIME automático cuando captureTime está
configurado y el DATE AUTO. No se crea otro reloj ni una cola nueva.

`operationalDay:{version:1,calendarKey,mode:AUTO|MANUAL|PRESERVE}` conserva la definición
exacta. AUTO se verifica en Core contra **ese instante**, nunca contra now del servidor.
MANUAL mantiene la fecha elegida y no atribuye una franja histórica a la hora actual.
PRESERVE exige base/edición explícita y no fabrica hora para históricos. Editar un alta
pendiente mantiene el modo/instante originales del comando; editar un registro ACK usa
su ID/base y conserva captureTime. Reintentos y sincronización no recalculan DATE.

La pantalla distingue fecha automática/manual y permite volver explícitamente al día
actual. Reloj/resume observan el límite real del día operativo y medianoche civil para
el máximo del selector. Un aviso que cruza el límite de jornada queda obsoleto: no se
crea una intención silenciosa; hace falta confirmar en el nuevo día. Una advertencia
que sólo cruza una franja usa el instante definitivo, conservando la opción manual.

Configurar franjas **no** elige A/B. Una discrepancia se informa en el sector existente
de comunicaciones como nota informativa; no bloquea, no cambia el SELECT, no añade
mensajes por fila. Los errores y conflictos conservan prioridad. No se rediseñaron
las comunicaciones ni se cambiaron sus reglas generales.

## PANEL: una definición, un vínculo

El editor DATE ofrece «Hoy del día operativo vinculado» y la experiencia propietaria:

```json
{"id":"fecha","valueType":"DATE","required":true,"defaultValue":{"type":"OPERATIONAL_TODAY","calendarAppViewId":"<Attendance propietario>"}}
```

Sólo se guarda la referencia. Core verifica mismo contrato, experiencia activa y
que todos sus bindings usen la entidad y DATE del propietario. Proyecta calendario y
clave en la respuesta autorizada; Client persiste esa metadata con la definición.
No se duplican horarios editables. La referencia otorga metadata, no permisos sobre
personas o escrituras. El vector conservador existente de revisiones ya incluye todas
las AppViews del contrato; además reconoce calendarAppViewId como dependencia.

Hoy se convierte en DATE concreto para las consultas y claves normales. Se actualiza
al límite operativo y al regresar, mientras no exista una selección manual. Esa fecha
se comparte entre métricas y detalle vinculados. Datasets históricos sin PANEL_FILTER
continúan sin ese filtro; sus saldos no cambian al seleccionar otra fecha. No se cambian
consultas, cálculos, consolidación ni capacidades offline. Referencia no disponible:
409 explícito, no se adivina zona/fecha; las otras experiencias y copias utilizables
se conservan. El cliente comunica la falta de metadata en el mismo sector central.

## Horario de verano y reloj

Se convierten instantes reales a partes civiles IANA y se resuelve el inicio del día
con los offsets vigentes alrededor de esa fecha. Inicio repetido: primera ocurrencia;
inicio inexistente: primer instante real posterior al salto. No se resta 24h para
cambiar DATE; se resta un día civil. Franjas usan la hora civil observada: ambas
ocurrencias de una hora repetida corresponden a la misma franja, con UTC distinto.
No se corrige el reloj del dispositivo. Bases IANA diferentes pueden producir rechazo
AUTO en Core: conservar y revisar, sin adaptar automáticamente la intención.

## Compatibilidad, pendientes y transición

Desplegar Core compatible, verificar, después Client; sólo entonces configurar. La
activación requiere autorización aparte. Core entrega operationalDayContract y exige
capacidad operational-day-v1 en Attendance configurado. Client usa el Accept existente,
no una versión de bundle ni un header CORS nuevo. PANEL negocia la misma capacidad.
La ruta dedicada `/workflow/state-update/operational-day` impide que un Core anterior
ignore metadatos y escriba con semántica vieja: 404/405 se trata como actualización
necesaria, sin fallback al escritor legacy. Sin calendario los endpoints siguen iguales.
Core vuelve a leer y bloquea la AppView dentro de la transacción de identidad, también
para comandos legacy, para no eludir un cambio concurrente de configuración.

Pendientes antiguos sin calendario: se conservan con ID, DATE, base, contextos e
idempotencia. Al activar calendario pasan a revisión explícita; no se les calcula día
ni hora nueva. Pendientes con clave distinta también se conservan para revisión.
Preparación y admisión de recibos comparten el mes del DATE operativo. Antes del corte del
primer día de mes no se acredita el mes calendario como si cubriera el operativo. Un recibo de otro mes no acredita esa cobertura; si falta su prueba exacta se usa la
descarga normal. El vector de revisiones sigue siendo el conservador existente del
contrato; no se amplía la negociación ni se habilitan gates.

No se borra SQLite/OPFS/outbox ni se cambia epoch/namespace, esquema o migraciones.

La unicidad sigue persona + DATE **asignado**. ONE sigue UNCHANGED/CONFLICT y bloqueo
atómico; MULTIPLE sigue registro independiente e idempotencia por intención. Históricos
con DATE calendario no se reasignan. En la jornada de transición pueden coexistir
fechas asignadas con reglas anteriores: conteos/advertencias/ONE incluyen esos registros
en su DATE original. Una captura de madrugada antigua no se mueve sin evidencia.

Antes de activar: inventariar pendientes/conflictos de todos los dispositivos, drenar
los compatibles o resolverlos explícitamente, acreditar opciones y referencia PANEL,
acordar límite de corte y la interpretación de registros de ese día. No declarar una
transición limpia sólo por activar a las 08:00: pueden existir registros calendario de
madrugada con el mismo DATE. No cambiar automáticamente políticas ni históricos.

Rollback antes de configurar: volver a binarios anteriores compatibles con datos
existentes. Después de configurar/capturar: conservar Core y Client capaces de interpretar
los pendientes; restaurar la definición exacta si cambió accidentalmente. No desactivar
calendario ni bajar Core con pendientes nuevos sin revisar su compatibilidad. Nunca
recalcular, eliminar colas o restaurar bases productivas como mecanismo de rollback.

## Límites

La configuración productiva y captureTime permanecen pendientes. Ejemplo Misceláneos
preparado desde respaldo de configuración previo, no desde lectura nueva ni aplicación.
Releer/configurar por editor con control concurrente en una autorización posterior.
Safari físico, native y lector de pantalla no acreditados aquí. La autoselección de
contrato offline previa requiere selección explícita en el laboratorio; no se amplía
el alcance para corregirla. No se implementan recuperación histórica ni corrección
automática del reloj. Resultados, capturas y vencimientos de pruebas: informe del lote.
