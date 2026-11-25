# Recuperación de envíos transitorios — C-10

Base Client db480c3809d885606424c95f9f69a81ec9598146. Esta corrección sólo cambia
la oportunidad de otra pasada, no sus comandos, selección, persistencia ni ACK.

`usePendingWorkLifecycle` consume `syncPendingWork` y sus resultados
`records.retriable` / `stateUpdate.result.retriable`. Si queda trabajo recuperable,
reutiliza la misma espera que readiness y los intervalos ya existentes de 5, 15,
30 y 60 segundos (60 es el máximo intervalo, no una garantía de ejecución).
Un bloqueo transitorio al refrescar autenticación usa esa misma espera. Login y la
acción manual de Diagnóstico STATE_UPDATE notifican el resultado al lifecycle;
el diagnóstico conserva su alcance STATE_UPDATE y no se convierte en otro motor.

Sólo se programa con owner, contrato, token y generación actuales, conexión online,
app activa y sin ciclo compartido activo. Al vencer, la espera vuelve a comprobar
ese scope, consulta los pendientes elegibles existentes y comprueba otra vez la
generación después de la lectura asíncrona. No basta que coincida el usuario tras
logout/login. Una callback obsoleta no cancela la espera de la sesión nueva.

Una pasada manual/foreground consume la espera previa, conserva su posición de
backoff y decide al finalizar: otro error recuperable programa la siguiente espera;
un resultado terminado sin retryable la cancela y reinicia la secuencia. Los
single-flight existentes siguen decidiendo los envíos; no se añade cola, motor,
temporizador paralelo ni estado persistido de reintento. La devolución de una
promesa no acredita un ACK si el motor todavía conserva trabajo pendiente.

`failed` y `conflict` siguen excluidos de selección automática. Validación, revisión
de calendario/escritura y autenticación realmente inválida no generan reintentos
indiscriminados. Las guardas de autenticación C-08 conservan el ACK válido del owner
original, pero no permiten replay con credenciales de otra generación. Una escritura
incierta conserva su comando/clientRequestId y las reglas existentes de
idempotencia/reconciliación. SQLite no disponible mantiene las barreras C-06/C-07;
esta mejora no abre otra conexión ni repite escrituras locales inciertas.

Offline, background o cambio de sesión/scope cancelan la espera. Si otro camino
resuelve o retira el último pendiente, como máximo la espera ya programada hace
una comprobación de elegibilidad y se detiene: no sigue consultando periódicamente
sin trabajo. Una nueva pasada manual exitosa la cancela de inmediato.

El navegador puede suspender JavaScript. No se promete envío en segundo plano,
tiempo exacto de reintento ni ejecución al cerrar. El regreso a foreground y la
reapertura conservan sus disparadores normales y vuelven a evaluar SQLite/outbox;
no recalculan identidades, DATE, captura, payload ni clientRequestId.

Validación: regresiones del hook con reloj controlado y escenarios aislados con
Core/autenticación/PostgreSQL y Chromium/OPFS reales. Fallos HTTP/red y pérdida de
respuesta se inducen en un proxy aislado; no equivalen a incidentes productivos.
Los tiempos y resultados exactos quedan en el informe del lote. Safari/native,
dispositivos físicos y suspensión del sistema operativo conservan sus límites;
los timeouts históricos sin causa no quedan resueltos por esta corrección.

## Cierre de bloqueos de revisión

La consulta de elegibilidad conserva la identidad de la evaluación que la inició,
además del scope/generación. Se comprueba al resolver y dentro del actualizador
asíncrono de diagnóstico. Una pasada manual, otro intento o una nueva espera
retiran la evaluación anterior: ni cero ni un resultado positivo antiguos pueden
cancelar la espera vigente, adelantarla o reiniciar el backoff. Startup, foreground
y reconnect usan la misma comprobación antes de publicar o continuar.

El ticket de la pasada existente también identifica sus publicaciones. Indicadores
se derivan del scope activo; readiness, refresh, resultados, errores, fases y
`finally` sólo publican si conservan ticket y generación. Volver al mismo usuario
tras logout no reactiva el ticket anterior. Esto corrige recorridos heredados
relacionados con C-11; no constituye cierre de toda la auditoría C-11.

Diagnóstico manual STATE_UPDATE entra por el coordinador lifecycle existente,
conserva su alcance y espera la pasada del mismo scope. Una pasada combinada que
encuentra esa acción espera su finalización y luego incluye RECORDS. El resultado
manual no cancela recuperación pendiente de RECORDS. No hay otro mutex ni cola.

Los single-flight de cada motor y las guardas C-08 siguen protegiendo comando,
propietario, sesión y ACK durable. La mera coincidencia de dos peticiones no prueba
una violación de integridad ni exige exclusión HTTP global. La respuesta válida de
una sesión anterior se procesa por el motor para su propietario; sólo se retira su
publicación sobre la UI nueva. El login conserva su recorrido previo a selección
de contrato; no se afirma exclusión global entre todos los emisores de la app.

Si Diagnóstico falla antes de entregar resultado, una recuperación previa sólo se
retoma después de verificar pendientes elegibles y vigencia del mismo ticket.
La excepción no elimina la espera de RECORDS ni oculta el error manual; si SQLite
no permite comprobar elegibilidad, no se envía a ciegas.

Una renovación válida del token dentro de la misma sesión no retira su resultado:
el callback de vistas, ejecutado sólo tras comprobar el scope del propio recorrido,
vincula la publicación final al scope ya renovado. Sigue rechazándose otra generación.
