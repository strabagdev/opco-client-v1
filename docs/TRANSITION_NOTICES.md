# Aviso de transición por experiencia

Attendance y PANEL admiten `config.transitionNotice` opcional:

```json
{"version":1,"text":"Texto definido por el administrador.","startsAt":"2027-01-03T05:00:00.000Z","endsAt":"2027-01-05T05:00:00.000Z"}
```

Texto plano de 1–1000 caracteres tras trim. Inicio incluido, fin excluido, UTC canónico
con milisegundos y Z. El editor etiqueta explícitamente las entradas como UTC y no usa
la zona del equipo para convertirlas. Deshabilitar elimina la propiedad; un formulario
antiguo que omite el control conserva el aviso. Core valida el período.

Reutiliza AppView.config y sus cachés app_views/app_view_definitions; sin tabla, migración,
preferencia ni cola adicional. El renderer visible publica por useExperienceActivityReporter
al sector único existente. No se replica en filas, modales ni banners. Conserva orden de
mensajes y prioridades actuales de almacenamiento/errores/conflictos/sync, que pueden ocupar
temporalmente ese sector. Texto idéntico no se repite. Sin configuración, comportamiento igual.

La vigencia se observa al montar, en cada frontera exacta y al volver al foco/foreground.
Recarga y reapertura offline usan la definición persistida y el reloj del dispositivo.
PANEL usa su definición coherente con la consulta guardada. Es necesario preparar/actualizar
esa definición online antes de depender del aviso offline. Una modificación o retirada remota
llega con la actualización normal; no hay revocación remota sin conexión. Un reloj erróneo
puede alterar la visibilidad, sin corrección automática. Metadata inválida no rompe la vista.

El aviso no activa captureTime/calendario ni cambia DATE, turnos, cálculos, registros,
captura, versiones, identidad, idempotencia, pendientes, conflictos ni outbox.

Publicación futura: Core compatible → Client compatible → configurar y preparar cada vista.
Consumidores antiguos pueden ignorar este dato; comprobar su actualización por dispositivo.
No retirar Core capaz de leer el PANEL configurado: versiones antiguas estrictas pueden
rechazar la propiedad. Retirar sólo el aviso no autoriza revertir calendario/captureTime.

Sin activación de Misceláneos. Este ajuste es independiente del inventario de dispositivos,
pendientes/fallidos/conflictos, pausa de capturas, DATETIME, calendario compartido, transición
y autorización operativa. Safari/native físicos permanecen pendientes.
