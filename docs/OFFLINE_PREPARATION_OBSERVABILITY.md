# Preparación: selección, recuperación y diagnóstico — local

El ensayo de reposo con una sola página no reprodujo un temporizador autónomo: base
y candidato completaron 60 segundos sin nuevas llamadas al preparador. No acredita
la causa de la sesión productiva ni cierra «6/7 interrumpida».

Sí se reprodujo otra ruta: la recuperación automática de una escritura transitoria
llamaba al preparador con un nuevo invalidationKey y sin reuseCompleted en cada espera
de C-10 (5, 15, 30, 60 s). Una preparación anterior completa se volvía a ejecutar aun
con token, permisos, período y ámbito iguales. La ruta startup-with-pending conserva
la relectura de asignaciones/autorización, pero usa la reutilización existente de
salidas completas sin solicitar esa invalidación artificial. Un inicio frío o prueba
faltante sigue preparando; cambios de configuración, autorización, período, epoch o
prueba incompatible siguen invalidando. Reconnect/foreground y acciones explícitas
mantienen sus invalidaciones. No se cambia el backoff, orden de envíos ni comando.

La preparación no tiene una cola/timer propio de reintentos. Fallos parciales permanecen
visibles; los disparadores existentes seleccionan sólo el trabajo que su prueba no
permite reutilizar. Si hay trabajo de envío elegible, la recuperación se coordina por
C-10; si no lo hay, no se añade polling ni bucles para la preparación.

## Metadata diagnóstica aditiva

Se reutilizan los mismos JSON de diagnóstico/recibo y su ámbito owner+contrato.
requestContext registra ejecución anterior, número reutilizado y fingerprints/motivos
seleccionados: petición completa, invalidación solicitada, definición/autorización/período
cambiados, credenciales distintas o prueba ausente/incompatible. Una invalidación
solicitada no se etiqueta como un cambio remoto demostrado.

globalFailure conserva sólo fase/código seguro/HTTP para fallos fuera de AppView.
lastFailure conserva una única instantánea no recursiva del último fallo del mismo
ámbito al iniciar otro run, incluso tras recargar. No es una copia de datos, un motor
ni un registro de SQL/payloads. El diagnóstico distingue el run actual de ese fallo.
No se inventa una causa para históricos que ya la perdieron. Cancelación se identifica
sin simular una preparación completa ni cambiar registros/outbox.

Antes, INSERT OR REPLACE conservaba sólo el último run y el catch global descartaba
la causa; por eso un historial «failed» puede coexistir con detalle de un run posterior
y cero fallos de AppView. Dependencias/revisiones también tienen estados separados;
no se atribuye un fallo global a PANEL por aparecer como última AppView. La corrección
no reconstruye el run productivo anterior de las 02:16.

Sin migración, cambio de formato 10/namespace ni borrado. El parser anterior ignora
campos aditivos, preservando pendientes y caché al revertir. Rollback a fe93336e
reintroduce la preparación completa en cada recuperación y la pérdida de causa/historia,
así como los defectos de lista/franja del lote Attendance. C-13/C-14/C-15, Safari/native
y los vencimientos históricos permanecen separados.
