# Búsqueda manual y escaneo en workflows

Attendance y STATE_UPDATE mantienen dos entradas independientes: búsqueda manual y lector
opcional configurado por `codeSearch`. Comparten sólo las reglas visuales existentes de
`visual-stability.ts`: el campo manual ocupa su propio ancho, mínimo táctil de 44 px, y el
lector aparece a continuación. No depende del contrato, tipo de identificador o nombre
de la experiencia. Las etiquetas, colores y foco existentes se conservan.

Antes, Attendance usaba una fila compacta con `flex: 1` para el campo y sin ancho mínimo
útil; el lector consumía el espacio restante. En Chromium el campo mide 116 px a 320 px
de viewport y 36 px a 240 px. A 390 px la base sí permite escribir: no se considera
reproducido el fallo de teclado comunicado desde iPhone. El ajuste elimina esa compresión
y la dependencia del tamaño intrínseco de un input flex, sin afirmar una causa WebKit
que no se haya demostrado en un dispositivo real.

No se cambian onChangeText, onRead, debounce, normalización, selección, consultas, campos
configurados, permisos o persistencia. La entrada manual sigue siendo la búsqueda global
existente; el lector sigue consultando su campo configurado. No se convierten códigos a
números ni se imponen reglas de RUT. No se abre automáticamente la cámara o el teclado.

El contexto obligatorio sigue siendo previo a ambas entradas. `editable` conserva
`requiredContextMissing` en Attendance y `contextReady` en STATE_UPDATE; el lector conserva
las mismas guardas de contexto, scope, actividad, selección y permisos. Seleccionar una
persona no confirma ni persiste un registro. No hay nuevos avisos ni sectores de mensajes.

La búsqueda offline usa los lectores y datos preparados de SQLite/OPFS existentes; esta
presentación no crea cobertura nueva, catálogos alternativos ni colas. No cambia namespace,
outbox, captura, calendario operativo ni configuración de experiencias.

## Validación y alcance de plataforma

Pruebas de los fragmentos y estilos reales para ambos workflows: entrada manual presente y
editable, lector alternativo opcional y ambas entradas bloqueadas si falta contexto. Los
arneses de contraste reciben también los dos estilos compartidos, sin cambiar aserciones.
Pruebas existentes de handlers, normalización, cache, lector y contextos se conservan.

Chromium con Expo Web completo y API sintética aislada: eventos táctiles, texto, pegado del
portapapeles, búsqueda/selección, cambio de tamaño sin pérdida de nodo/valor/foco, cámara
ficticia/cancelación y búsqueda offline sobre OPFS real. Viewports 320, 360, 390, 768, 1024
y 1440 px; perfil web Android simulado. Esto no equivale a Android físico, Safari/iPhone,
teclado virtual del sistema, cámara óptica real ni native. El fallo concreto del iPhone
queda pendiente de comprobación física. No se valida producción con datos simulados.

Antes de publicar conviene comprobar en iPhone/Safari y Android/Chrome: seleccionar el
contexto, tocar/escribir/pegar, seleccionar el resultado sin confirmar, abrir/cancelar
lector y repetir offline con información previamente preparada. No borrar almacenamiento.
La activación de Misceláneos y su cierre operativo son trabajos separados.
