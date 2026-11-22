# C-04: errores de ejecución y finalización SQLite

## Estado local, 22-11-2026

Base: Client publicado `844e1d3a0f74c75c99969fd30d3c284c1f8a55a0` (C-01).
El diagnóstico del commit de auditoría `fe376189da510ea4886bdb24e72c85e40bbee7e5`
seguía vigente: desde ese commit sólo cambió la selección/conteo de RECORDS syncing
en estos archivos; no se había añadido preservación del error de un statement.

El `expo-sqlite` instalado, 57.0.1, ejecuta `finalizeAsync()` en el `finally` de
`runAsync`, `getFirstAsync` y `getAllAsync`. Si ejecución o lectura y finalización
fallan, el segundo rechazo reemplaza al primero antes de llegar al coordinador.
El worker Web devuelve el mensaje genérico `Error finalizing statement`.
Esto se reprodujo con SQLite WASM/OPFS real y datos sintéticos, en HEAD y en
`49913c3`: una restricción UNIQUE y lecturas JSON inválidas perdían su causa primaria.

La colisión histórica inducida entre AppViews que compartían un evento también
se reprodujo en `49913c3`; HEAD la admite con la representación de proyecciones
v10 incorporada después. No se modifica esa representación. Este contraste
no identifica la sentencia ni la causa del incidente productivo original.

## Corrección acotada

`preserveSQLiteStatementErrors` adapta los tres métodos de conveniencia mediante
la API pública `prepareAsync` / `executeAsync` / lectura / `finalizeAsync` de SDK 57.
Se aplica a la conexión singleton existente antes de migrar/crear su facade
coordinada. Los callbacks de transacción reciben la misma conexión protegida,
sin volver a entrar en la cola. No hay otra conexión, motor, cola, reintento,
migración, cambio de namespace ni modificación de comandos/clientRequestId.

- Finaliza exactamente una vez cada statement preparado, incluso si falla.
- Ante dos errores, vuelve a lanzar **el mismo error primario**, sin sustituirlo.
- Conserva el secundario en un WeakMap privado asociado al error primario.
- Un rechazo primitivo conserva su valor original; no admite asociación en WeakMap.
- Si sólo falla la finalización, sigue rechazando; no anuncia éxito.
- Conserva bindings array/objeto/variádicos y resultados originales del SDK.
- Los stores inyectados sin `prepareAsync` mantienen su propia implementación;
  no se reconstruye un error que ese backend ya haya descartado.

El resumen técnico sólo permite fase (`prepare`, `execute`, `read`, `finalize`),
clases de error de una lista fija y código numérico SQLite si fue reportado.
No infiere un código extendido desde un código base: OPFS reportó 19, no 2067.
No serializa SQL, bindings, nombres de campos, mensajes, stacks, tokens ni datos
de registros. Los errores originales son transitorios; los resúmenes siguen
en las últimas 20 operaciones en memoria del coordinador existente. No se
persisten ni se envían por red y no sobreviven a un cierre.

El botón existente **Copiar diagnóstico de sincronización**, en el diagnóstico
del sector único, añade `error principal` y `secundario` a la operación correspondiente.
No se agregan banners, avisos por fila, diálogos ni sectores de comunicación.
Los handlers de error existentes continúan decidiendo el mensaje de la experiencia.

## Verificación y límites

Las regresiones cubren prepare/execute/lectura/finalización, errores simultáneos,
error sólo al finalizar, valores rechazados que no son objetos, bindings, resultado
inmutable, continuidad de la cola, copia de diagnóstico y ausencia de datos sensibles.
El ensayo Chromium/OPFS compara histórico, HEAD y candidato con restricciones
inducidas y JSON inválido, manteniendo filas/outbox, integridad y lectura posterior.
Es una sonda del store/SDK reales, sin API ni sesión productivas, no una prueba
completa de una pantalla de negocio o de sincronización remota.

No reproduce ni declara resuelto el incidente original de Versionado Procedimientos.
Una mejora del diagnóstico no corrige por sí misma un constraint, I/O o corrupción.
No se cambia el comportamiento de otros fallos de cleanup como un ROLLBACK fallido,
ni el SDK global, `getEachAsync` o llamadas directas ajenas al singleton.
Safari/iPhone y native siguen sin ensayo físico.

La investigación C-02 está concluida con sus límites: su corrección documental
en CLIENT_ARCHITECTURE.md es un lote separado; no se transfiere ni mezcla ninguna base.

Referencias: [Expo SQLite SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/),
[semántica de sqlite3_finalize](https://www.sqlite.org/c3ref/finalize.html), código
instalado `node_modules/expo-sqlite/{src/SQLiteDatabase.ts,web/worker.ts}` y evidencia
histórica `design/validation/state-update-desktop-diagnosis-2026-10-12/`.
