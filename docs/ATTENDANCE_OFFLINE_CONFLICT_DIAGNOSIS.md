# Attendance: modificación offline de un estado existente — 2026-10-09

Etapa exclusivamente de reproducción y diagnóstico sobre main. Sin corrección funcional, Core/API/esquema/dependencias intactos; V11 pausado. No se accedió a producción ni se resolvió la intención del usuario.

## Resultado demostrado

Una persona sintética, una fecha lógica 2026-10-09 y ningún otro escritor. Chrome headless/CDP directo, perfil exclusivo y SQLite OPFS real; Core/PostgreSQL locales. DATABASE_URL proviene exclusivamente de Core .env.local, se valida 127.0.0.1:5432/opco_development y usuario opco_dev, y se pasa explícitamente al proceso Core y a los scripts Prisma. No se imprimen URL, password, token ni datos personales.

| Paso real | Autorización/precondición enviada | Respuesta Core |
| --- | --- | --- |
| CAPACITACIÓN online inicial | Sin overwrite ni expectedUpdatedAt | Creación local; primer intento sufrió timeout de compilación, pero persistió. Repetición con Core listo: HTTP 200 UNCHANGED. |
| Cambiar a PRESENTE online, antes de confirmar | Sin overwrite ni expectedUpdatedAt; nueva clientRequestId | HTTP 200 CONFLICT, CURRENT_VALUE_DIFFERS; aparece Confirmar cambio. |
| Aceptar Confirmar cambio | overwrite=true; expectedUpdatedAt del conflicto; nueva clientRequestId | HTTP 200 UPDATED. |
| Restaurar CAPACITACIÓN online mediante el mismo diálogo | Primera petición sin autorización; segunda confirmada con versión recibida y nuevo ID | CONFLICT seguido de UPDATED. Este restablecimiento es propio del ensayo, no otro escritor. |
| Desconectar y guardar PRESENTE | Sin confirmación visible. Intención con expectedUpdatedAt del vigente cacheado; overwrite ausente; identidad remota conservada | SQLite pending_update; una operación STATE_UPDATE, attempts=0; intención durable. |
| Reconectar | Mismo clientRequestId de SQLite, misma fecha/sujeto/estado/base; overwrite omitido en JSON | HTTP 200 CONFLICT, CURRENT_VALUE_DIFFERS. Una operación, attempts=1, last_error_code=CONFLICT; fila local conflict. |

En la petición offline efectiva, expectedUpdatedAt coincide **exactamente** con existing.updatedAt de la respuesta Core. Por tanto este rechazo local no es EXPECTED_UPDATED_AT_MISMATCH ni demuestra un cambio remoto concurrente. La intención y su clientRequestId coinciden antes del envío, en el POST y después del conflicto. No se perdieron identidad remota ni versión base. No se demuestra duplicación a partir del resumen productivo de dos conflictos y su detalle posterior de uno.

## Camino y distinción entre creación, edición y confirmación

`AttendanceWorkflow.saveStatus` construye una solicitud ordinaria sin autorización de reemplazo. Online `saveEntry` llama al endpoint genérico STATE_UPDATE. El adaptador `attendanceEntryToStateUpdateEntry` conserva overwrite/expectedUpdatedAt cuando existen. El primer conflicto abre el modal; `confirmConflict` vuelve a guardar con overwrite=true y conflict.existing.updatedAt, con una nueva clientRequestId.

Offline el mismo saveEntry no consulta Core ni genera ese conflicto/modal antes de guardar: toma selectedItem.attendance.updatedAt y llama a saveStateUpdateLocally con uniqueness=subject-date/historyMode=update-current y entry.overwrite (ausente en el guardado ordinario). La persistencia conserva server_id/server_record_id y remoteUpdatedAt; expectedUpdatedAt se toma del input o de la fila remota cacheada. pending_update distingue esta edición de pending_create. El payload no recibe autorización por el mero hecho de estar vinculado al remoto.

`syncPendingStateUpdatesOnce` transmite la versión, overwrite y clientRequestId persistidos; no los inventa. `serializeStateUpdateRequest` convierte stateValues a states con optionId y omite propiedades undefined. No envía serverRecordId/localRecordId como selector de escritura: Core resuelve la asistencia existente por AppView/configuración, sujeto y fecha. Estos IDs locales/remotos sirven para la persistencia durable/reconciliación, no sustituyen esa unicidad ni autorizan overwrite.

En `executeStateUpdateEntry`, Core calcula las diferencias de intención. Sin diferencias devuelve UNCHANGED. Con diferencias y sin overwrite devuelve **CURRENT_VALUE_DIFFERS**, antes de comprobar expectedUpdatedAt. Con overwrite requiere expectedUpdatedAt; su ausencia devuelve OVERWRITE_EXPECTATION_REQUIRED, y una versión distinta devuelve EXPECTED_UPDATED_AT_MISMATCH. Sólo autorización explícita y versión coincidente permiten UPDATED. Una clave idempotente corresponde a una intención inmutable; confirmar cambia la intención y usa un ID nuevo, mientras reintentar la misma intención conserva el ID.

El conflicto local observado es, por tanto, un rechazo de negocio **previsto por el contrato para una intención no autorizada**, no un fallo probado del sincronizador que pierda una confirmación. La asimetría de UX está demostrada: online permite obtener/aceptar la confirmación antes de escribir; offline guarda la solicitud ordinaria y pospone su rechazo a la reconexión. No se probó que una confirmación offline ya aceptada se perdiera: ese paso no existe en el recorrido ordinario actual.

## Por qué el diagnóstico recibido no contiene la causa exacta

CONFLICT es resultado de negocio en una respuesta HTTP 200, no una excepción HTTP. El sincronizador persiste el conflicto y registra CONFLICT con un intento/cero completados. Además, normalizeStateUpdateBatchResult conserva existing/requested/diferencias pero no copia conflictReason al resultado interno. El resumen no permite distinguir CURRENT_VALUE_DIFFERS de EXPECTED_UPDATED_AT_MISMATCH por sí solo. No se modifica telemetría en esta etapa.

## Propuesta mínima, sin implementar

Reutilizar una confirmación explícita en el recorrido offline cuando existe un vigente cacheado distinto y una versión remota acreditada. Sólo tras aceptar se persistirían overwrite=true y la versión que se mostró, con una clientRequestId correspondiente a esa intención confirmada y usando el outbox existente. Si no se dispone de base fiable, no autorizar reemplazo automáticamente. Mantener intacta la comprobación Core: cualquier cambio remoto posterior seguirá produciendo un conflicto por versión, con intención y acciones de resolución conservadas. No derivar overwrite=true de una edición, serverRecordId o expectedUpdatedAt por sí solos.

Se propone como corrección de la asimetría de confirmación, no como supresión del conflicto ni autorización implícita. No se agregó diálogo, overwrite forzado, reintento ni contrato nuevo.

## Validación y límites

Regresión nueva: attendance-existing-offline-diagnosis.test.ts ejecuta por AST los handlers reales saveEntry/confirmConflict, como las pruebas existentes del renderer. Verifica base preservada sin autorización offline y autorización/versionado explícitos online. Es una caracterización del comportamiento encontrado; no afirma que esa UX sea el comportamiento final deseado.

Checks focalizados: 12 pruebas de handlers (incluidas 2 nuevas), 18 del sincronizador; Core: 3 pruebas overwrite aprobadas, 46 casos fuera del filtro. Typecheck Client y lint del archivo nuevo aprobados; diff-check aprobado. Sin suite completa/build, ya que no cambió código funcional. La prueba end-to-end acredita adaptador, petición real, Core real, outbox y OPFS; no depende sólo de mocks de handlers.

Impedimentos del runner, separados del conflicto: CSP inicial del servidor temporal sin API local; corregida sólo mediante env de ese proceso. Recarga de la página produjo guardia de apertura SQLite; el perfil se preservó y se usó otro perfil exclusivo, sin resetear OPFS. El runner inicialmente esperaba Buscar, pero Attendance usa Buscar persona; se corrigió sólo el runner. Una escritura durante compilación local agotó timeout pero quedó persistida; su repetición UNCHANGED no duplicó la asistencia. El recorrido válido terminó con una sola intención offline y un conflicto.

Fixture: persona/contrato/AppView/entidades sintéticos; opciones CAPACITACIÓN y PRESENTE con IDs propios, FieldOption.value CAPACITACION/PRESENTE. defaultCheckInOptionId explícito PRESENTE. Sin observationFieldId ni contextFieldIds. No se afirma que esta configuración, roles o valores por defecto reproduzcan íntegramente producción; sí los roles de persona/fecha/estado y la unicidad necesarios para el caso.

Fixture PostgreSQL propio eliminado, incluyendo registros generados por Core y auditoría de ese contrato; cero recursos propios restantes. Procesos propios cerrados, perfiles sintéticos conservados con su OPFS. Ningún almacenamiento habitual/outbox del usuario se borró. Evidencia de peticiones sanitizada en /tmp/opco-attendance-diagnosis/evidence.json; no se agrega al repositorio ningún log, credencial, base ni export.

La causa local está demostrada. Es compatible con el diagnóstico productivo, pero sin petición/respuesta productivas no acredita que el rechazo del usuario haya tomado la misma rama. Para correlacionarlo faltan overwrite efectivo, presencia/igualdad de expectedUpdatedAt con existing.updatedAt y conflictReason de la respuesta de esa intención. Auditoría general e incidente productivo SQLite continúan abiertos.

## Corrección mínima implementada — 2026-10-09

La propuesta anterior corresponde a la etapa histórica de diagnóstico; ahora se aplica exclusivamente en AttendanceWorkflow.tsx. saveStatus consulta la fila cacheada bajo scope completo antes de autorizar un reemplazo offline de un vigente synced conocido por un estado distinto. Reutiliza ConflictModal, sin crear otro diálogo/runtime. Captura versión/intención por copia y la secuencia/scope; cancelar sólo limpia UI. Aceptar guarda overwrite y la versión capturada, nunca una base remota más nueva que la mostrada. La transacción y el sincronizador compartidos ya soportan esos campos y no se modifican.

Las intenciones antiguas, pendientes, failed y conflict no adquieren autorización al leerlas. Creación, mismo estado y edición/consolidación de pendientes conservan el recorrido existente; conflictos previos mantienen sus acciones explícitas. No se implementó una migración de autorizaciones ni se accedió al conflicto productivo.

Regresiones: 15 tests de caracterización/confirmación por handlers reales (aceptar/cancelar, captura de versión/intención, creación/mismo valor, pending/failed/conflict, otro AppView, scope tardío/desmontaje y persistencia de la versión explícita); 6 tests con SQLite real en disco (reapertura, envío autorizado/base inmutable, conflicto/versiones, operación antigua, edición pendiente, aislamiento y rollback); 10 handlers de resolución previos y 18 tests del sincronizador. Total 49 tests focalizados aprobados, máximo dos workers. Dos regresiones se ejecutaron además contra el handler de HEAD sin la corrección y fallaron: guardar antes de confirmar y sustituir la versión explícita por la selección. Con la corrección pasan. Typecheck y lint global aprobados; sólo dos warnings require preexistentes. Sin suite completa ni build global; export web temporal local necesario para CDP, con caché Metro privada y worker SQLite intacto.

### Chrome/OPFS definitivo y Core local

Contenido funcional final exportado sólo a /tmp/opco-attendance-replacement/export-source, API local, sin accessor extra ni modificación del worker. CDP directo automatizó los controles y la lectura SQLite; no se hizo revisión manual nueva de navegador. PostgreSQL confirmó mediante lectura opco_development/opco_dev en el servidor local, además de la validación exacta de DATABASE_URL y su paso explícito a los procesos.

- CAPACITACIÓN confirmada online. Offline, abrir Confirmar cambio dejó fila synced y cero operaciones; Cancelar conservó ambos sin cambios. Aceptar PRESENTE persistió una operación pending_update, overwrite=true y la versión confirmada.
- Cierre completo de Chrome; Core y servidor web detenidos **antes** de reabrir el mismo perfil. Reapertura por service worker/OPFS sin servicios: PRESENTE visible y la misma operación, ID, autorización, base y attempts=0. Se iniciaron después ambos servicios manteniendo la sesión CDP y se reconectó: HTTP 200 UPDATED, mismo recordId remoto que CAPACITACIÓN, una fila local synced y cero pendientes.
- Control independiente en perfil exclusivo con lectura fresca: PRESENTE remoto → confirmar CAPACITACIÓN offline. Un escritor exclusivamente sintético cambió esa misma fila a CAMBIO REMOTO SINTÉTICO después de aceptar, antes de reconectar. El POST conservó overwrite=true y la base confirmada; Core devolvió HTTP 200 CONFLICT / EXPECTED_UPDATED_AT_MISMATCH. OPFS conservó CAPACITACIÓN local, estado/versión remotos nuevos y la intención/ID/base originales, attempts=1. Lectura final PostgreSQL: exactamente una fila remota, todavía con el valor del escritor de control. Sin sobrescritura silenciosa.

Los dos perfiles definitivos aíslan controles deliberados, no prueban duplicación de una intención ni dos escritores en el incidente recibido. No se autorizó ninguna operación antigua o conflicto productivo. El caso de conflicto sobrevive también a reapertura en la regresión SQLite real de disco.

Límites/reintentos del runner: una primera reapertura con servicios vivos permitió sincronización desde una ventana restaurada antes de deshabilitar la red; **no se acredita como reapertura offline**. Se repitió con servicios detenidos y pasó. Un primer control usó una selección anterior al refresh y no acreditó una base compatible; el control válido usó una lectura nueva en perfil independiente. Una petición del escritor sintético usó inicialmente un objeto en states donde el serializer real envía optionId escalar; se corrigió sólo el runner. Ninguno motivó cambio de conectividad, persistencia, Core o contrato. No se limpiaron cachés para obtener el resultado.

Fixture propio eliminado: cero recursos restantes, incluidos registros creados por Core y auditoría/idempotencia del contrato sintético. Core, servidor web y Chrome propios cerrados. Perfiles de ensayo conservados, sin afectar almacenamiento habitual. Evidencia sanitizada en /tmp/opco-attendance-replacement/evidence.json y core-verification.json. No se agregan logs, credenciales, DB, export ni configuración local al lote.

Diff de esta corrección: AttendanceWorkflow.tsx; bloque de regresiones nuevo dentro de attendance-existing-offline-diagnosis.test.ts; archivo nuevo attendance-offline-replacement.test.ts; secciones nuevas de STATE_UPDATE.md, STATUS.md y este diagnóstico. Resto de documentación/hunks, V11 y pendientes independientes intactos. Main/HEAD e índice preservados; Core sin cambios. No suite completa, producción, commit/push/deploy. No se declara correlacionada la causa productiva exacta ni cerrada la auditoría general.


## 2026-10-10 — Cierre técnico de reemplazo Attendance: bloqueado

El candidato aislado comprende el renderer Attendance, sus dos archivos nuevos de regresiones y las secciones documentales de este reemplazo. No se modificó código funcional durante el cierre. Se añadieron tres regresiones de selección/persona y respuestas tardías. Suite completa aislada: 990 pruebas en 80 archivos, máximo dos workers; typecheck correcto, lint sin errores (dos advertencias preexistentes), build web correcto y diff-check correcto. El build emitió una advertencia no fatal de escritura del caché Metro temporal.

La revisión adicional detectó un bloqueo: después de confirmar offline un cambio remoto y reabrir SQLite, guardar otra vez el mismo valor pendiente pasa por saveStatus/saveEntry sin overwrite. La consolidación pierde overwrite=true y cambia la identidad idempotente, conservando fila y expectedUpdatedAt. Una regresión separada ejecuta los handlers reales y persistencia SQLite real con reapertura; falla al exigir que sobreviva la autorización de la misma intención. No forma parte de las 990 pruebas aprobadas. No se corrigió durante este cierre. El lote NO está listo para publicar. Falta preservar la autorización ya confirmada de una intención semánticamente idéntica, sin autorizar operaciones antiguas ni cambios diferentes.

Se reutiliza la evidencia previa Chrome/OPFS porque el renderer funcional es idéntico: Core local comprobó cancelación sin escritura, aceptación offline durable tras cierre/reapertura, sincronización en la misma fila sin duplicados y conflicto ante modificación remota posterior. Guards de persona/scope/respuestas tardías, rollback y operaciones antiguas se comprueban mediante pruebas automatizadas; el nuevo bloqueo sólo mediante handlers reales y SQLite, sin nuevo recorrido Chrome/Core. No acredita resolución del conflicto productivo ni cierre de la auditoría general. V11 continúa pausado.

Respaldo delimitado: /home/dannysilver/dev2026/backups/attendance-offline-replacement-close/2026-10-10/. Incluye parche candidato, inventario/hashes y regresión bloqueante separada. Pendientes ajenos conservados byte a byte. Sin cambios Core/API/esquema/dependencias/configuración, producción, commit, push o deploy.


## 2026-10-11 — Attendance: repetición de intención confirmada

Resuelto únicamente el bloqueo del cierre anterior. La regresión archivada se incorporó a src/lib/attendance-pending-authorization-review.test.ts y falló antes del cambio ejecutando saveStatus/saveEntry reales y SQLite con reapertura: overwrite desaparecía al consolidar un guardado ordinario; la comparación de identidad consideraba ese cambio una intención nueva.

Attendance lee la operación durable del registro dentro del usuario/contrato/entidad/AppView/persona/fecha. Compara todos los estados y extras con el normalizador de intenciones existente. Una intención confirmada idéntica vuelve a guardar con su base original; la persistencia comprueba nuevamente la equivalencia dentro de la transacción y retorna sin escribir fila/outbox. Conserva clientRequestId, overwrite, expectedUpdatedAt, intentos, errores y estado de envío. La opción interna preserveIdenticalConfirmedIntent se utiliza sólo en Attendance, update-current/subject-date, sin modificar contratos API ni otros workflows. No concede autorización a operaciones antiguas que carecen de ella.

Un cambio de estado o extras de un pendiente confirmado requiere nuevamente el modal existente, conservando la base de la intención anterior. Cancelar no escribe; aceptar crea una intención distinta explícitamente autorizada. Se mantienen guardias de scope/persona/secuencia/desmontaje y protección frente a respuestas tardías. No se refresca la base contra Core para evitar conflictos. El respaldo candidato de 2026-10-10 permanece intacto y describe el estado anterior bloqueado.

Evidencia automática: 180 pruebas afectadas / 6 archivos, máximo dos workers, PASS (50 handlers/persistencia/sync más 130 local-db/intenciones). La regresión integrada utiliza los handlers reales y SQLite en disco; verifica reapertura, comparación de extras, cancelación sin tocar ambas tablas, base e identidad, autorización explícita para contenido distinto, no reiniciar un envío en curso, operaciones antiguas y envío/conflicto posteriores. Typecheck PASS, lint sin errores con dos advertencias require preexistentes, diff-check PASS. Sin suite completa.

Evidencia Chrome/CDP automatizada, sin revisión manual: perfil exclusivo nuevo, SQLite OPFS real y Core/PostgreSQL exclusivamente locales; DATABASE_URL de .env.local validada como 127.0.0.1:5432/opco_development/opco_dev y pasada explícitamente. CAPACITACIÓN online → confirmar PRESENTE offline → cerrar Chrome y detener servicios → reabrir mismo perfil offline → volver a guardar PRESENTE: misma identidad/autorización/base, cero intentos. Cambiar a CAPACITACIÓN abre confirmación y cancelar conserva fila/outbox. Reiniciar servicios/reconectar devuelve UPDATED con la autorización/base originales, una sola fila remota con identidad inicial y cero pendientes. Control separado con consulta fresca: confirmar CAPACITACIÓN, cambiar después el remoto sintético y reconectar conserva CONFLICT, base/identidad local y ambas versiones. PostgreSQL confirma una sola fila remota.

Cambios de extras/cancelación, envío en curso y guardias de scope/respuestas tardías se acreditan por pruebas automatizadas, no por el recorrido Chrome nuevo. No se acreditan los intentos iniciales de login (CSP del servidor temporal sin API local), bloqueo de acceso exclusivo tras reintentos ni control que utilizaba selección antigua; se preservaron sus perfiles. No se amplió implementación a esos recorridos. Evidencia sanitizada: /tmp/opco-attendance-identical/evidence.json. Recursos PostgreSQL propios eliminados (cero restantes), procesos propios cerrados; perfiles sintéticos conservados, almacenamiento habitual intacto.

Archivos de esta corrección incremental: AttendanceWorkflow.tsx, local-db.ts, state-update-offline.ts, attendance-existing-offline-diagnosis.test.ts, nuevo attendance-pending-authorization-review.test.ts y estas secciones de ATTENDANCE_OFFLINE_CONFLICT_DIAGNOSIS.md/STATE_UPDATE.md/STATUS.md. El archivo attendance-offline-replacement.test.ts anterior sigue intacto. Pendientes excluidos preservados byte a byte. Main intacto, Core sin cambios. V11 pausado; conflicto productivo no autorizado/resuelto y auditoría general abierta. Sin producción, cambios de esquema/API/dependencias/configuración, commit, push o deploy.


## Diagnóstico productivo recibido — pendiente de correlación

El diagnóstico aportado por el usuario identifica una operación STATE_UPDATE de Attendance en conflicto del **09-10-2026**, con **retryCount=1**. Indica **cero operaciones elegibles para autosync**. El resumen global muestra **dos conflictos**, mientras el detalle aportado contiene una operación Attendance: la diferencia permanece sin explicación. No acredita duplicación, intervención de otro usuario ni una causa HTTP específica. Tampoco se presupone que ambos conteos correspondan al mismo scope o instante sin evidencia.

Esta información se registra separadamente de las reproducciones sintéticas locales. El lote no autoriza, reintenta ni resuelve ese conflicto productivo; los conflictos continúan requiriendo resolución explícita. No se amplía este cierre para investigar el conteo.


## 2026-10-11 — Cierre técnico final Attendance

Candidato aislado desde main/HEAD 50937aff0d4abf27faf887dd2823e36c58039b4b: nueve archivos (tres de implementación, tres regresiones y tres documentos). Se incluye la confirmación offline y la conservación de intención idéntica tras reapertura; en STATE_UPDATE.md y STATUS.md sólo las secciones Attendance desde 2026-10-09. Se excluyen V11, OFFLINE_FIRST_AUDIT, caracterización independiente de conflictos, pruebas experimentales/diagnóstico de cobertura y los prefijos ajenos de los documentos compartidos. Todos conservados byte a byte, índice y HEAD intactos.

Suite completa aislada final: **998 pruebas / 81 archivos PASS**, máximo dos workers, 24,30 s. Typecheck PASS, lint cero errores y dos warnings require preexistentes, build web/SW PASS, diff-check PASS. Primera corrida conjunta con build: 977 PASS/21 timeouts en state-update-prewarm-current-investigation.test.ts y un EPIPE; reejecución focalizada 22/22 PASS y suite completa posterior 998/998 PASS, sin cambios de código/pruebas/timeouts/configuración entre corridas. La causa del fallo inicial no se demuestra; no se lo atribuye a Attendance ni se oculta ese límite.

Implementación idéntica byte a byte al export Chrome/OPFS del ensayo 2026-10-11 en los tres archivos funcionales; no se repitió navegador ni se crearon fixtures. Se reutiliza CDP automatizado con Core real/PostgreSQL local: cancelar sin escritura, aceptación durable, cierre completo con servicios detenidos, reapertura offline, guardado idéntico con identidad/autorización/base conservadas, cambio distinto y cancelación, reconexión UPDATED en misma fila sin duplicados/pendientes y control con lectura fresca/modificación remota posterior que conserva conflicto. Extras cambiados, envío en curso, rollback, scopes y respuestas tardías se acreditan con pruebas automatizadas, no con nueva revisión manual de navegador.

Diagnóstico productivo separado: una operación Attendance del 09-10-2026 en conflicto, retryCount=1; cero operaciones elegibles para autosync. Resumen global: dos conflictos; diferencia no explicada, sin prueba de duplicación. No se autoriza ni resuelve el conflicto productivo; no se investiga ese conteo en este cierre. Auditoría general abierta, V11 pausado.

Parche/inventario/hashes y evidencia sanitizada en /home/dannysilver/dev2026/backups/attendance-offline-replacement-close/2026-10-11/. Respaldo bloqueado anterior del 2026-10-10 intacto; este nuevo cierre lo sucede. El lote no contiene secretos, configuración local, logs, export/build, bases ni perfiles. Core/API/esquema/dependencias/configuración sin modificaciones. Sin producción, commit, push o deploy.
