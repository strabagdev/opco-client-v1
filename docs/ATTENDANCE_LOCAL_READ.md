# Revisar un pendiente Attendance sin modificarlo

En la cabecera, abre Diagnóstico → Problemas → **Revisar cambio**. El detalle consulta la
referencia local exacta; muestra DATE operativa, estado, contextos configurados, captura y estado
de sincronización. «Detalle técnico» permite consultar la referencia, segundos, zona, UTC y
procedencia. No usa la fecha de sincronización como captura. Para una operación antigua sin
captura acreditada muestra «Hora de captura no disponible».

La pantalla no contiene acciones Editar, Registrar, Confirmar, Sincronizar, Reintentar o Descartar.
«Refrescar lectura local» vuelve a leer el registro. El motor ordinario mantiene su comportamiento:
si hay conexión, podría enviar operaciones por sus disparadores existentes; esta pantalla no lo
invoca ni lo pausa. Sin conexión, sólo consulta el almacenamiento existente.

## Diagnosticar una fila que falta en el grupo

Después de instalar una versión que incluya este parche (no está publicada):

1. Conserva el estado de conexión de la reproducción y el pendiente. Abre Attendance en la fecha
   afectada, consulta el grupo y, si corresponde, busca/selecciona la persona sin registrar nada.
2. Abre Diagnóstico → Problemas → Revisar cambio de esa operación.
3. Pulsa **Comprobar consultas locales** y luego **Copiar diagnóstico local**. Abrir el detalle
   técnico es opcional. No se ejecutan peticiones HTTP, preparación ni escritura por estas acciones.
4. Adjunta el diagnóstico junto con «Bundle de esta página» y lo observado en el grupo. No exportes
   la base SQLite completa, tokens ni credenciales. El texto contiene IDs técnicos y los contextos
   del cambio seleccionado; revísalo antes de compartirlo fuera del equipo autorizado.

Interpretación:

- `stored` muestra captura/eventOccurredAt, DATE, estado e IDs de contextos guardados; `outbox`
  permite contrastar su payload activo. Su enumeración sólo incluye pending_create/pending_update/
  syncing: cero no implica que se haya perdido una operación fallida o en conflicto.
- `daily` reproduce la consulta del grupo; `personSelection` reproduce la selección por persona;
  `recent` corresponde a la primera página de 20. Una exclusión de `recent` con hasMore no demuestra
  pérdida: el registro puede estar en una página posterior.
- `previousScreenReads` observa lo recibido/publicado por la pantalla desde que se inició este
  runtime. No reconstruye lecturas anteriores al cierre. `selectedIncluded=null` significa que
  la lista de IDs se truncó: no se puede afirmar ausencia.
- En lecturas por persona, `subjectMatches=false` identifica una consulta de otra persona;
  no atribuirle la omisión del pendiente. `null` corresponde a una consulta global del día.
- `consistency.atomic=false` es explícito. Si `selectedRecordStableAcrossReads=false`, hubo un
  cambio durante el diagnóstico: no concluir una exclusión a partir de esos resultados. No hay
  reintento automático; se puede comprobar de nuevo manualmente.
- El texto no contiene nombres de personas, observaciones, secretos, datos de otros contratos
  ni referencias de otras personas. Las comparaciones de scope se hacen por valores exactos,
  nunca por las huellas usadas sólo para anonimizar el informe.

Errores y resultados de copia se presentan en el sector único de comunicaciones existente.
No se declara frescura remota, cobertura completa o recuperación del grupo por consultar la fila.
La omisión observada en el dispositivo real sigue sin causa demostrada hasta recoger esta evidencia.
Misceláneos no se modifica. Safari/native requieren validación real separada.


## Visibilidad y diagnóstico ampliado — 20-11-2026

El grupo diario pasa a usar toda la colección local disponible. `dayListing` reproduce esa
lectura; `recent` conserva la primera página de 20 para reconocer cortes de paginación. Una
exclusión en recent no demuestra exclusión del grupo. La traza añade `group/presented-detail`
para contrastar el resultado al expandir, después de deduplicar aliases.

Si falla la metadata se siguen consultando los registros ya guardados, sin conceder permiso
para confirmar ni suponer preparado el día. El motivo y los errores de lectura se mantienen
en el sector único de comunicaciones. Las capturas/DATE/IDs/contextos no se reescriben.

El respaldo del perfil Chrome está cancelado. Conservar original y copias parciales y no
reanudar ese procedimiento. Para instalar este parche hará falta reconectar: el lifecycle
puede enviar automáticamente la operación antes de leerla con el bundle nuevo. Si llega ACK,
registrar el cambio de evidencia; no recrear el pendiente ni presentar su estado nuevo como
reproducción del anterior. La omisión real sigue abierta hasta obtener su diagnóstico.

La prueba de metadata incompleta con pendientes mostró un motivo oculto por el feedback de
readiness. Los errores visibles de Attendance se entregan ahora al notice del sector único,
conservando su texto y el aviso temporal; no se repite ese mismo error en el feedback inline.
No se cambia la clasificación de sync ni se presupone pérdida de la operación.

El motivo llegaba al snapshot de actividad pero la proyección de la cabecera no consumía
notice. Se conecta ese campo existente, sin crear canales ni alterar conexión/sync. Se conserva
la prioridad de atención de almacenamiento; el ensayo y una regresión específica acreditan
la propagación del aviso. Este punto no explica por sí mismo la omisión del grupo real.

El aviso de actualización fallida y el alcance offline sin cobertura se presentan también en
el mismo notice, en lugar de repetirlos bajo el resumen del día. Se prioriza el motivo preciso
y se conserva el alcance local disponible; las acciones y los estados de sync no cambian.
