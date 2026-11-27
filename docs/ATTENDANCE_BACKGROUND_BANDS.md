# Attendance: estabilidad de lista y nuevas capturas por franja

Cambio local sobre fe93336e, sin publicación/configuración productiva.

## Lista y consulta

La clave de consulta/presentación compatible se separa de los datos que están siendo
hidratados. Una renovación de las mismas filas no publica vacío ni desmonta sus grupos.
Las identidades todavía presentes se retienen mientras llega la lectura actualizada;
una fila realmente ausente se retira. Usuario, contrato, experiencia, fecha, definición
de presentación/campos y guardas de generación continúan retirando resultados obsoletos.
No es una caché paralela: se reutiliza el estado de presentación existente.

La lista diaria se mantiene montada pero oculta e inaccesible al lector de pantalla
mientras la búsqueda/edición la reemplaza visualmente. Volver conserva la expansión
por identidad si la consulta sigue siendo compatible. El primer acceso conserva su
loader; un fallo real se comunica en el sector existente, conservando sólo datos
compatibles. No se certifica cobertura completa por tener filas visibles.

Los avisos de dependencias de contexto usan el sector único existente. Una selección
inválida o sin evidencia sigue bloqueando la acción; preparación parcial/fallo conserva
su diagnóstico. Se reutilizan sin duplicación las correcciones de sellado, metadata
estable, observación editada, renovación y reconciliación por run/generación publicadas
en fe93336e. Se conservan coordinador, checkpoints y permisos. La recuperación de escrituras
reutiliza cobertura válida sin forzar otra preparación completa; alcance y observabilidad
en [OFFLINE_PREPARATION_OBSERVABILITY.md](OFFLINE_PREPARATION_OBSERVABILITY.md).

## Regla de nuevas altas

Sólo con calendario y franjas: resolver IANA/inicio/opción real desde el instante de
confirmación definitivo. Mostrar fecha/franja y ofrecer la única opción aplicable;
no se utiliza una etiqueta, default ni fecha consultada como identidad de la franja.
Con advertencia, cancelar no estampa captura ni crea intención. Cruzar franja actualiza
la misma confirmación, sin segundo diálogo, y exige revisar nuevamente. Cruzar jornada
exige comprobar la persona del día nuevo. Huecos, solapamientos y opción no disponible
bloquean explícitamente. El watcher existente observa opcionalmente cambios de franja,
sin un segundo reloj; la autoridad sigue siendo el instante del clic definitivo.

Sin calendario/franjas se conserva el comportamiento anterior. Ediciones por ID/versión
no se reasignan al reloj actual: conservan DATE/captura y permiten el cambio de estado
previsto. Pendientes legacy, incluso MANUAL, mantienen payload/identidad/clientRequestId;
la sincronización no usa el resolvedor de nuevas capturas. Captura es reloj del dispositivo,
no creación de servidor; no hay corrección automática de reloj ni relleno histórico.

## Compatibilidad y reversión

Sin migración, cambio de formato 10, namespace opco-client-v10-epoch2.db, contrato Core
ni nuevos gates. AUTO v1 ya publicado transporta fecha/estado/captura explícitos.
Rollback de código a fe93336e conserva base y pendientes y reenvía esos comandos tal
como fueron persistidos. Reintroduce parpadeo/pérdida de expansión y selección manual
para altas con franjas. No requiere borrar ni reconstruir almacenamiento.

La regla nueva es del Client: consumidores antiguos ya abiertos siguen ofreciendo
su selección manual; Core compatible acepta comandos históricos legítimos. Publicar
este parche no acredita una imposición servidor ni actualización instantánea de todos
los dispositivos. Antes de prometer el criterio operativo debe comprobarse la versión
de consumidores por el procedimiento normal, sin recargas forzadas.

## Evidencia y límites

Pruebas de regresión incluyen fallos en la base, límites de franjas, cambio de jornada,
DST, opción ausente, configuración genérica, edición y no configuración. Integración
se realiza con Chromium/OPFS y Core/autenticación/PostgreSQL locales reales y datos
sintéticos; controles de red/reloj son inyecciones identificadas, no incidentes reales.
Las mediciones separan solicitudes, lecturas de navegación, notificaciones, montajes,
loader e interacción. No se promete velocidad universal ni reducción de descargas.

La evidencia del operador y 6/7 interrumpida siguen sin correlación suficiente. No se
declara resuelto el dispositivo productivo sin publicar/comprobarlo. Cuatro vencimientos
anteriores no tienen causa demostrada. Safari/native, dispositivos físicos, ejecución
en suspensión y cortes eléctricos no quedan acreditados. C-13/C-14/C-15 permanecen fuera.
