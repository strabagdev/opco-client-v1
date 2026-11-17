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

## Presentación de registros e identidad — 17-11-2026, cambio local

Las listas de Attendance muestran una referencia completa por registro, sin ordinales ni abreviaturas. Para una captura de este dispositivo conservan el `local_id` existente antes/después del ACK, reapertura y edición; el ID remoto se muestra aparte al estar disponible. Para una fila recibida del servidor usan su ID remoto. La referencia local se mantiene en este almacenamiento; otro dispositivo sin esa intención local identifica la misma fila por el ID del servidor. No se crean claves ni metadata de presentación persistida. Ambas referencias pueden seleccionarse/copiarse completas; un fallo de portapapeles se informa sin afirmar que se copió.

El adaptador sólo lee el almacenamiento compartido. Resuelve el alias por scope y, en cachés sin definición de proyección, por los registros diarios existentes, contrastando experiencia/persona/DATE. Consulta la misma fila física para acreditar el origen local y no interpreta un ID del servidor como sustituto de la intención. Las lecturas iguales se comparten dentro de la pasada de presentación, sin TTL ni llamadas de red nuevas. Respuestas de una pasada retirada no publican etiquetas de otro scope.

Estado y contextos SELECT/RELATION se presentan con metadata y etiquetas embebidas o cacheadas de ese campo/contrato/usuario. Ausencia, vacío y etiqueta no disponible se distinguen; no se muestran IDs de relaciones como valores ni se utiliza la selección recordada para explicar otra fila. El formulario y el comando conservan sus valores originales. En modo múltiple los recientes conservan los eventos por identidad de registro, y fusionan sólo alias de la misma fila; ONE conserva la selección anterior de recientes por persona. Editar continúa usando el ID y la versión elegidos, con las mismas validaciones y confirmaciones.

`Hora de captura` sólo se atribuye cuando la intención física local y el formato existente de identidad de alta múltiple (experiencia + UUID) acreditan `eventOccurredAt`. El marcador de intención de una corrección histórica no acredita una captura original; las identidades virtuales `state_update_snapshot_` conservan su referencia remota aun al editar. Para formatos antiguos o no reconocidos se mantiene `Hora de referencia`. Una respuesta remota histórica que mezcla captura/alta del servidor se etiqueta `Hora de referencia`: el contrato actual no acredita cuál de esos dos orígenes tiene. `Última modificación` requiere una versión remota conocida; el `cached_at` de una captura pendiente no se presenta como modificación del servidor. No se inventa `Creado en servidor` a partir de ese fallback. Las marcas muestran fecha, segundos y zona IANA del dispositivo; si no es posible formatearla, se muestra UTC explícito. Una explicación aclara que no son la hora de la operación ni parte del DATE configurado.

Este ajuste no cambia Core, API, DATE, identidad, idempotencia, conteos, políticas, outbox, esquemas ni sincronización. No activa múltiples ni modifica PANEL. La referencia se acredita para el almacenamiento existente; borrar/restaurar una base o cambiar de dispositivo no conserva una identidad local que ya no esté disponible. Safari/native y lectores de pantalla físicos requieren sus propias verificaciones.


### Jerarquía visual de la lectura

El encabezado de cada fila prioriza sujeto, condición pendiente y acción Editar. Estado y contextos se presentan antes de la sección técnica. Las marcas temporales quedan como información secundaria; las referencias completas y sus acciones Copiar se conservan dentro de «Detalle técnico», cerrado por defecto. No se abrevian ni cambian de identidad por esta distribución. El ajuste no modifica los handlers de edición, sus bases, comandos o sincronización.

Al editar desde los recientes, la lectura incluye el registro seleccionado aunque no se haya ejecutado una búsqueda de esa persona. Así se conservan su referencia y la marca «Editando este registro» junto al formulario. No se reconstruye ni sustituye el destino del comando: continúa siendo el registro y la versión elegidos por el handler existente.

## Edición exacta y lista agrupada — cambio local 17-11-2026

Los recientes de SQLite conservan su `localRecordId`, incluso para snapshots virtuales y filas ya confirmadas. El editor resuelve el alias `serverId` de la misma fila dentro de usuario/contrato/entidad/AppView/fecha antes de comparar con `dailyRecords`. Nunca selecciona otra fila de la misma persona como alternativa. Conserva el ID local para la intención, el ID servidor para la escritura y la versión exacta del registro seleccionado. Una respuesta sin cobertura diaria se distingue de una fila ausente; ante ausencia se consulta únicamente ese ID para conservar los errores de existencia/permisos de Core. Una fila existente fuera de la consulta de persona/fecha no se usa como sustituto.

«Registros del día» agrupa exclusivamente por ID de la entidad relacionada. El encabezado usa la presentación de sujeto configurada y la cantidad de identidades distintas; dos personas con el mismo texto permanecen separadas. Copias local/ACK/snapshot de un registro se cuentan una vez, sin agrupar por fecha, estado, texto ni marca temporal. Un contexto local pendiente tiene prioridad sobre la copia remota de su misma identidad.

El detalle se abre por persona. Online consulta el día y sujeto exactos mediante el endpoint existente; offline sólo lee la caché compartida. Las coberturas parciales se indican como «registros disponibles» y no se convierten en un total acreditado del día. La consulta completa conserva pendientes y excluye copias sincronizadas que ya no estén en la respuesta autorizada. Una lectura retirada por cambio de scope no publica resultados. No se agregan descargas automáticas ni nuevas reglas de preparación.

Cada registro conserva su acción Editar, estado y contextos con etiquetas. IDs completos y copia quedan en «Detalle técnico», cerrado por defecto; sus valores no cambian. Las marcas temporales mantienen su origen y zona, separadas del campo DATE. Registrar uno nuevo y editar una identidad existente continúan siendo acciones distintas. No cambia Core, PANEL, permisos, esquemas, outbox, sincronización ni políticas de otras experiencias.

La reapertura de Attendance restaura la metadata de presentación ya preparada; si el reciente local sólo contiene `displayName`, la vista puede proyectar identificador/nombre desde la misma fila fuente autorizada del usuario/contrato. Se verifican la definición y el ID exacto; no se agregan lecturas de red, se inventan etiquetas ni se sustituyen sujetos. Una metadata ausente o incompatible conserva su aviso.

Una edición no se abre con sólo el ID remoto si falta su copia local: se informa la falta de preparación en vez de ofrecer un guardado que no puede seleccionar esa fila. La edición de una creación pendiente conserva su instante original y su confirmación explícita ya almacenada; no vuelve a proponer «crear otro». Si falta esa confirmación, exige revisar la intención original. El motor compartido mantiene su regla existente: cambiar el contenido nunca enviado puede cambiar la clave del comando, conservando la misma identidad de registro; repetir un comando idéntico conserva su clave. Las operaciones ya enviadas mantienen sus bloqueos y resolución explícita.

Validación local: reproducción del fallo original en la aplicación publicada de Pruebas sólo mediante lecturas; regresiones de aliases/ausencia/permisos y agrupación; renderer real con Core Next.js sin cambios, PostgreSQL sintético y Chromium/OPFS. Se comprueban edición independiente, creación pendiente, ACK, reintento idéntico, cierre/reapertura offline y los cuatro anchos. No se realizaron escrituras productivas ni cambios de políticas. Safari/native y lectores de pantalla físicos siguen pendientes. El listado conserva su ventana de recientes existente; «disponibles» indica conteo parcial hasta acreditar el detalle del sujeto.

El detalle agrupado solicita explícitamente el modo de historial de su política: `update-current` para ONE/política omitida y `append` para múltiples, ambos con la fecha seleccionada. No interpreta una proyección ONE como historial append ni convierte un detalle existente en vacío por ese desajuste. La regresión del handler verifica también la lectura offline de la política predeterminada.
