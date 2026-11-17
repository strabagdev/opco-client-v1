# Attendance: repetición de registros e intención durable

Implementación local 16-11-2026. Requiere Core compatible para activar políticas múltiples. No cambia configuraciones ni datos existentes.

- Sin propiedad o `ONE_PER_DAY`: escritura e identidad actuales, conflictos/correcciones explícitos y protección concurrente de Core.
- `MULTIPLE_WITH_WARNING`: consulta registros disponibles en SQLite y, online, el conteo autenticado del servidor antes de confirmar un registro adicional. El diálogo captura sujeto, fecha, estado, contexto y autorización. Cancelar no crea ninguna intención. Offline también se advierte cuando el dispositivo conoce cero registros: no se presume que el servidor esté vacío.
- `MULTIPLE`: una confirmación intencional crea una intención independiente, sin advertencia.

El diálogo presenta conteos remoto y local por separado: los ACK desconocidos no permiten probar su unión exacta. El conteo local incluye pendientes/incidencias y se identifica expresamente como información disponible en este dispositivo. Si falla la consulta online, se conserva el formulario y no se degrada silenciosamente a un conteo local.

## Captura y edición

Los contextos configurados preceden al buscador. Los obligatorios deben seleccionarse antes de buscar/escanear y también se validan al confirmar. Es una validación genérica por metadata, sin condiciones por contrato, entidad ni nombre de campo. Las selecciones se mantienen entre capturas. SELECT envía FieldOption.value en extraValues; RELATION conserva su ID mediante los adaptadores existentes.

En múltiples, buscar una persona abre **Nuevo registro independiente** y no preselecciona un registro previo para modificarlo. Los registros diarios y los recientes permiten **Editar** un evento concreto; la edición restaura sus contextos y conserva su ID/base. **Registrar uno nuevo** vuelve a creación explícita. La corrección remota exige confirmación; nunca se usa el último registro como sustituto del seleccionado.

No incluye capacidades nuevas para Observación: se reutilizan los adaptadores actuales al conservar/editar datos existentes.

## Durabilidad e idempotencia

Múltiples usa primero `saveStateUpdateLocally`, online y offline: snapshot e intención STATE_UPDATE se escriben en la transacción SQLite compartida. Después del commit se limpia la captura antes de intentar envío. Un fallo de red no permite reenviar el borrador como otra intención; queda el comando durable y la sincronización existente conserva su clientRequestId. Un doble clic comparte la confirmación mediante los guards actuales y no crea dos intenciones.

Los nuevos eventos tienen local_id propio mediante el generador UUID compartido. Una colisión se rechaza sin sobrescribir el evento previo. No hay una cola, tablas, esquema, namespace ni sincronizador paralelo. SQLite/OPFS deben estar operativos: no se degrada una captura múltiple a POST sin persistencia local.

Una edición local apunta al local_id exacto y, si existe, al targetRecordId del servidor. Nunca consolida por persona/fecha. Una creación con envío incierto no se puede editar hasta resolver ese envío. Una respuesta explícita ATTENDANCE_REPEAT_CONFIRMATION_REQUIRED acredita no creación; sólo entonces se permite revisar esa misma intención local y confirmar la advertencia, rotando la clave por el nuevo payload y conservando su identidad local. Bases y autorizaciones pendientes no se actualizan implícitamente.

El payload/ACK/snapshot conserva `eventOccurredAt` (hora UTC del dispositivo al primer intento de confirmación), independiente de DATE y de los timestamps del servidor. Se mantiene entre reaperturas, reenvíos y edición. No se usa como identidad ni para autorización; puede reflejar un reloj de dispositivo incorrecto.

Antes de un envío múltiple, el sync compartido consulta GET STATE_UPDATE y exige mismo AppView/fecha/política, append y subject-date. La comprobación se comparte por scope dentro del run. Un Core antiguo, otra política o una respuesta incompleta impide el POST y conserva la intención con error explícito. Un fallo de transporte utiliza los reintentos ya existentes, sin cambiar timeouts ni agregar loops. ONE_PER_DAY no añade esta lectura.

## Cobertura, compatibilidad y límites

Las lecturas/snapshots múltiples conservan cada ID remoto, aunque varios pertenezcan a la misma persona y fecha. La definición y el scope de lectura usan append; un current no equivale al historial del día. Se mantienen las páginas y comprobaciones de completitud existentes, pendientes y conflictos. No se amplía la preparación automática ni se activan gates de reutilización.

Los cambios de usuario, contrato, política/definición, fecha, selección, base o autorización invalidan confirmaciones; una búsqueda concurrente no se apropia del token de confirmación. La UI diferencia guardado local, entrega pendiente, ACK, fallo y conflicto. No declara sincronizado sólo porque se haya completado la persistencia local.

Antes de cambiar una experiencia, revisar escritores y clientes antiguos y drenar/revisar pendientes. No convertir intenciones de ONE_PER_DAY a múltiples automáticamente. No volver a un Core que ignore el protocolo con políticas múltiples activas; la ruta exclusiva rechaza un backend antiguo aunque cambie después de la comprobación; no hay fallback a update-current ni garantía de disponibilidad con ese backend. Un Client antiguo puede conservar la base pero no enviar estos comandos con garantías: actualizarlo antes de capturar con las nuevas políticas.

La validación y evidencia de este lote son locales; no acreditan Safari físico, native, lector de pantalla ni estabilidad offline general.

## Revisión de versiones y pendientes — 17-11-2026

Múltiples se envía únicamente a POST workflow/state-update/repetition. Core anterior o una versión que no implemente esa ruta devuelve 404/405, convertido en ATTENDANCE_POLICY_UNVERIFIED; el comando y su clave se conservan sin intento por el endpoint antiguo. Metadata parcial de repetición sin una política compatible se rechaza antes de HTTP. El modo ONE conserva la ruta y el cuerpo anteriores; su valor explícito redundante se omite únicamente en el wire, sin modificar la intención persistida.

El sync consulta la definición local por owner/contrato/AppView antes de enviar: un pendiente capturado con otra política, incluso legacy sin propiedad y definiciones con alias workflow, queda con ATTENDANCE_POLICY_CHANGED para revisión explícita. No se convierte una intención diaria en un alta múltiple ni viceversa, no se rota su clave ni se actualiza su base. Sólo se agregan las anotaciones diagnósticas existentes de fallo. Las configuraciones de otros workflows mantienen su tratamiento anterior.

Orden compatible: Core con ruta exclusiva y guardas → Client actualizado → verificar lecturas y colas → eventual activación separada. Rollback mientras sólo existe ONE puede volver a versiones anteriores tras verificar pendientes. Con cualquier política o intención múltiple, conservar Core compatible; volver a un Client antiguo implica rechazo de esas escrituras, nunca permiso para reactivar semántica ONE o borrar pendientes. La ruta segura evita corrupción en una reversión inesperada de Core, pero detiene la entrega hasta restaurar la versión compatible.
