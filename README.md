# opco-client

Cliente generico multiplataforma para la API externa de Opco. La implementacion actual cubre Expo -> login -> token -> `/me` -> `/context` -> seleccion de contrato -> AppViews asignadas -> renderers `RECORDS`, `WORKFLOW` y `REPORT` -> cache local en SQLite -> registros, workflows de estado, reportes de consulta y sincronizacion offline-first donde esta soportada.

## Stack

- Expo SDK 57
- React Native 0.86
- TypeScript
- Expo Router
- expo-secure-store
- expo-sqlite
- @react-native-community/datetimepicker
- Vitest para logica pura

## Configuracion

Copia `.env.example` a `.env` y ajusta:

```bash
EXPO_PUBLIC_OPCO_API_URL=http://localhost:3000
EXPO_PUBLIC_OPCO_CLIENT_ID=opco_app_example
```

`EXPO_PUBLIC_OPCO_CLIENT_ID` es publico y se envia en `/api/v1/auth/login`. No agregues secretos server-side de Opco a este repositorio: no `API_AUTH_SECRET`, no `AUTH_SECRET`, no `DATABASE_URL`.

## Arquitectura

- `app/`: rutas Expo Router.
- `app/(auth)/login.tsx`: login minimo con email/password.
- `app/(app)/index.tsx`: Home autenticada, contexto, contrato, AppViews asignadas, categorias de experiencias y disponibilidad offline.
- `app/(app)/view/[appViewId].tsx`: ruta generica de experiencia; carga `/views` y resuelve renderer por `AppView.type`.
- `app/(app)/view/[appViewId]/record/[recordId].tsx`: detalle de record conservando contexto de AppView.
- `app/(app)/view/[appViewId]/record/new.tsx`: creacion dinamica de record para AppViews `RECORDS`.
- `app/(app)/view/[appViewId]/record/[recordId]/edit.tsx`: edicion parcial dinamica de record.
- `src/renderers/registry.ts`: registry central `RECORDS`, `WORKFLOW`, `REPORT`, `BOARD`, `DASHBOARD`.
- `src/renderers/records/`: lista, detalle y formulario dinamico para AppViews `RECORDS`.
- `src/renderers/workflows/`: `AttendanceWorkflow` y workflow generico `STATE_UPDATE`.
- `src/renderers/reports/`: renderer read-only para reportes `TABLE` y `MATRIX`.
- `src/renderers/unsupported/`: estado temporal para tipos de AppView no implementados.
- `src/lib/opco-api.ts`: cliente central de API y parsing de envelopes `{ ok, data/error }`.
- `src/lib/app-views.ts`: labels, orden y rutas basadas en AppView.
- `src/lib/record-form.ts`: conversiones, validacion required basica y payload parcial de formularios.
- `src/lib/local-db.ts`: esquema SQLite versionado para definitions, records locales y cola pendiente.
- `src/lib/definition-cache.ts`: lectura online con fallback cacheado.
- `src/lib/offline-records.ts`: lectura/escritura offline-first para AppViews `RECORDS`.
- `src/sync/records-sync.ts`: sync engine central de operaciones pendientes.
- `src/lib/connectivity.ts`: estado de conectividad `online`/`offline`/`unknown` y eventos web.
- `src/state/session.tsx`: token, restauracion de sesion, logout y estado compartido.

## Flujo

1. Al iniciar se lee el token desde SecureStore.
2. Si no existe token, se muestra login.
3. Si existe token, se llama `GET /api/v1/me`.
4. Si `/me` responde 401, se borra el token y se vuelve a login.
5. Si falla por red, el token se conserva para el futuro modo offline-first.
6. Luego se llama `GET /api/v1/context`.
7. Con cero contratos se muestra empty state.
8. Con un contrato se selecciona automaticamente.
9. Con multiples contratos se muestra selector y se persiste el ultimo `contractId`.
10. Con contrato seleccionado se llama `GET /api/v1/contracts/:contractId/views`.
11. La home muestra solo AppViews activas/asignadas retornadas por Opco, ordenadas por `sortOrder`.
12. Al abrir una AppView se usa la ruta generica `/view/:appViewId`.
13. Si `AppView.type` es `RECORDS`, `config.entityTypeId` define que EntityType se lee.
14. El titulo principal viene de `AppView.name`; la EntityType se muestra como metadata secundaria.
15. Al abrir un record se conserva el contexto de AppView en `/view/:appViewId/record/:recordId`.
16. Crear en AppViews `RECORDS` escribe primero en SQLite con `local_id` y `clientRequestId`, y luego intenta sincronizar.
17. Editar en AppViews `RECORDS` actualiza SQLite primero, consolida la cola y luego intenta `PATCH`.
18. La cola se sincroniza al iniciar sesion, al recuperar conectividad web, despues de crear/editar y con el boton `Sincronizar`.

## AppViews y EntityTypes

La navegacion normal ya no lista EntityTypes globales. Opco Client consume AppViews asignadas desde `/views`; una AppView representa la experiencia visible para el usuario, mientras que una EntityType representa el modelo de datos dinamico que esa experiencia puede usar.

DTO conceptual:

```ts
type AppView =
  | { id: string; name: string; slug: string; icon: string | null; sortOrder: number; type: "RECORDS"; config: { entityTypeId: string } }
  | { id: string; name: string; slug: string; icon: string | null; sortOrder: number; type: "WORKFLOW"; config: Record<string, unknown> }
  | { id: string; name: string; slug: string; icon: string | null; sortOrder: number; type: "REPORT"; config: Record<string, unknown> }
  | { id: string; name: string; slug: string; icon: string | null; sortOrder: number; type: "BOARD"; config: Record<string, unknown> }
  | { id: string; name: string; slug: string; icon: string | null; sortOrder: number; type: "DASHBOARD"; config: Record<string, unknown> };
```

Si `/views` retorna `[]`, la home muestra: `No tienes experiencias asignadas para este contrato.` No hay fallback automatico al listado global de entidades.

Home clasifica experiencias por `AppView.type`: `RECORDS` bajo Registros, `WORKFLOW` bajo Flujos, y `REPORT`, `BOARD`, `DASHBOARD` o tipos futuros desconocidos bajo Analisis. Las secciones vacias no se renderizan.

## Renderers

Registry actual:

```text
RECORDS   -> RecordsRenderer
WORKFLOW + attendance    -> AttendanceWorkflow
WORKFLOW + state-update  -> StateUpdateWorkflow
WORKFLOW + desconocido   -> UnsupportedRenderer
REPORT    -> ReportRenderer
BOARD     -> UnsupportedRenderer
DASHBOARD -> UnsupportedRenderer
```

`REPORT` es consulta/presentacion: no crea, edita ni sincroniza registros locales. Soporta `TABLE` y `MATRIX`, `timeFilter.mode = RANGE | MONTH`, `defaultPeriod = CURRENT_MONTH`, `allowChange`, y `valueDisplay[fieldId] = LABEL | INTERNAL_VALUE`. `INTERNAL_VALUE` se muestra en reportes en mayusculas solo como presentacion; no modifica datos, opciones ni API. `REPORT` no es `BOARD` ni `DASHBOARD`.

`BOARD`, `DASHBOARD` y workflows desconocidos muestran UI controlada de unsupported con nombre, icono, tipo y mensaje temporal.

## CRUD Records

`RecordsRenderer` reutiliza la definicion dinamica de EntityType, busqueda, paginacion y cache de definiciones. El formulario se construye desde `EntityField` y soporta inicialmente:

- `TEXT`
- `TEXTAREA`
- `INTEGER`
- `DECIMAL`
- `MONEY`
- `BOOLEAN`
- `DATE`
- `DATETIME`
- `TIME`
- `SELECT`
- `MULTISELECT`
- `RELATION`

`FILE` e `IMAGE` se muestran como no soportados todavia y no se envian en el payload.

Los campos temporales usan controles amigables por plataforma:

- `DATE`: web usa un input nativo equivalente a `type="date"`; Android/iOS usan `@react-native-community/datetimepicker`. El payload siempre es `YYYY-MM-DD`, sin timezone.
- `TIME`: web usa un input nativo equivalente a `type="time"`; Android/iOS usan picker nativo de hora. El payload siempre es `HH:mm`, sin fecha, timezone ni segundos.
- `DATETIME`: se muestra como dos controles visuales, `Fecha` y `Hora`. Ambos componen un unico valor ISO 8601 para la API, manteniendo la semantica actual de Operational Core. Al editar, el ISO existente se separa en fecha y hora.

Los campos temporales opcionales muestran una accion discreta `Limpiar`, que envia `null`. Los required no pueden guardarse vacios.

La UI valida `required` basico para evitar submits obviamente vacios, valida `DATE`, `TIME` con horas `00`-`23` y minutos `00`-`59`, y `DATETIME`, convierte tipos JSON razonables y muestra errores por campo cuando la API devuelve detalles estructurados. La API de Opco sigue siendo la autoridad final de permisos y validacion.

## Cold Start Offline

Hardening 1A soporta dos capas distintas:

- App shell offline: en web/PWA, `npm run build:web` genera `manifest.json` y `sw.js`. El service worker precachea `index.html`, bundles JS, assets, iconos y `expo-sqlite` WASM, y usa fallback de navegacion a `index.html` para rutas de Expo Router como `/`, `/login`, `/view/:appViewId` y `/view/:appViewId/record/:recordId`.
- Data offline: una vez cargado el shell, la app reconstruye sesion, contrato, AppViews, definiciones, listados y detalles desde SQLite/storage.

El service worker no cachea respuestas de API. Las rutas `/api/*` y `https://web.opco.cl/api/v1/*` quedan network-only; la persistencia operacional vive en SQLite y storage para evitar una segunda cache HTTP de datos.

En native Expo no hay service worker: el binario ya es el app shell. El cold start offline depende de SecureStore y SQLite.

La sesion offline usa un snapshot minimo y seguro de `/me`, `/context`, contratos, contrato seleccionado, `ownerKey` y timestamps de sincronizacion. Passwords y secretos no se persisten. Los tokens siguen en SecureStore en native; en web el access token esta en storage y el refresh token vive en cookie HttpOnly del backend.

Si el access token expira mientras no hay red, la app no expulsa al usuario por el vencimiento local. Si existe `ownerKey` y snapshot previamente verificado, entra como sesion offline no verificada y permite navegar datos ya autorizados. Al reconectar, el controlador de reconnect revalida/renueva sesion, refresca `/me` y `/context`, sincroniza pendientes una sola vez y dispara refresh de RECORDS. Si el servidor rechaza la identidad con un 401 real, la sesion se invalida y vuelve a login; ese 401 nunca usa cache como bypass.

Si no hay snapshot suficiente, se muestra: `No hay datos guardados en este dispositivo. Conectate al menos una vez.` No debe quedar spinner infinito ni login forzado por un error de red.

`client.opco.cl` es instalable como PWA cuando el navegador lo permite. El cache del shell se versiona por hash de build y elimina caches viejos al activar una version nueva, sin borrar SQLite ni operaciones pendientes. La app solo muestra `Disponible sin conexion` cuando el documento esta controlado por el service worker, el shell responde el handshake de cache completo y ya existen snapshot de sesion, contrato seleccionado y AppViews cacheadas. Si el shell aun no controla la pagina, muestra `Preparando uso sin conexion...`; si faltan datos operacionales, muestra `Abre al menos una experiencia con conexion para usarla offline.` La limitacion multi-tab de Expo SQLite Web/OPFS se mantiene: no se asume soporte multi-tab concurrente.

En iOS hay que distinguir Safari normal de una Web App agregada a la pantalla de inicio. Son contextos de almacenamiento separados: visitar `client.opco.cl` en Safari no prepara necesariamente el service worker, Cache Storage ni SQLite de la PWA instalada. La prueba principal soportada en iPhone es abrir la PWA desde su icono, online, esperar `Disponible sin conexion`, navegar una experiencia `RECORDS`, cerrar completamente y reabrir offline desde el mismo icono.

## Offline-First RECORDS

Las AppViews `RECORDS` son offline-first para navegacion, listado, detalle, creacion y edicion. La app conserva snapshots por `ownerKey` de `/me`, `/context`, contrato seleccionado y AppViews por contrato, sin persistir credenciales adicionales. Con ese snapshot puede reabrir sin red, reconstruir `owner_key` y llegar hasta las pantallas cacheadas. La cache de records esta scopeada por `owner_key`, `contract_id` y `entity_type_id`; `owner_key` se construye como `organization.id:user.id`. Si la app no puede conocer ese contexto, no muestra cache local, para evitar que otro usuario del mismo dispositivo vea datos ajenos.

Al estar online, el cliente precachea en segundo plano las definiciones de todas las AppViews asignadas del contrato activo. Este prewarm corre por `ownerKey + contractId`, con concurrencia limitada y single-flight, y no bloquea Home. `RECORDS` guarda la definicion de EntityType, campos, opciones y configuracion de display; `WORKFLOW` guarda la metadata de runtime; `REPORT` queda disponible como consulta online/read-only; `BOARD` y `DASHBOARD` guardan lo suficiente para mostrar el estado unsupported offline. Los workflows de estado usan el outbox compartido `STATE_UPDATE` en `pending_operations`, scopeado por `ownerKey + contractId + appViewId`, con `subjectRecordId`, `date`, `stateValues`, `extraValues`, `clientRequestId`, `overwrite` y `expectedUpdatedAt`. Attendance es un preset/adaptador de `state-update`: conserva labels y UX de asistencia, pero sus escrituras offline se expresan como `STATE_UPDATE` y usan el sync/recovery/telemetry generico.

El prewarm de definiciones no descarga EntityRecords de forma global. Los records siguen siendo cache bajo demanda cuando el usuario visita, busca o refresca una experiencia, excepto Attendance, que precachea su fuente configurada de Personas y snapshots por fecha del mes actual. Por eso la disponibilidad offline distingue definicion de datos: `definition-missing`, `data-not-cached`, `data-partial`, `ready`, `online-only` y `unsupported`. Un `RECORDS` con definicion preparada pero sin records cacheados abre su estructura y muestra `No hay datos guardados para esta experiencia.`

Home deriva disponibilidad desde `app_view_definitions`, `sync_telemetry`, metadata de snapshots Attendance y cache local. Tambien escucha cambios de cache/metadata SQLite para recalcular sin F5, remount ni foco; `useFocusEffect` permanece como fallback.

Al reconectar o cambiar contrato, el cliente refresca `/views`, reconcilia AppViews revocadas, prepara nuevas/cambiadas y conserva una definicion previa valida si un prewarm falla por red. Las definiciones preparadas se guardan en SQLite en `app_view_definitions`, scopeadas por `owner_key`, `contract_id` y `app_view_id`, separadas de records y de la telemetry de sync. Precargar una definicion nunca actualiza `lastSuccessfulSyncAt` de records.

Cada record local tiene:

- `local_id`: identidad estable generada por cliente. Un CREATE offline navega y renderiza usando este id.
- `server_id`: nullable hasta que Operational Core confirma el record.
- `remote_updated_at`: ultimo `updatedAt` remoto conocido. Es la version base observable que el cliente usa para detectar conflictos optimistas; no se genera en el cliente.
- `sync_status`: `synced`, `pending_create`, `pending_update`, `syncing`, `failed` o `conflict`.
- `conflict_remote_values_json`, `conflict_remote_display_name`, `conflict_remote_updated_at`: snapshot remoto guardado cuando un UPDATE local entra en conflicto.

Cuando un CREATE pendiente sincroniza con exito, el mismo row conserva su `local_id`, recibe `server_id`, guarda `remote_updated_at = response.record.updatedAt` y pasa a `synced`; no se crea una segunda card. Cuando GET records responde, la cache remota se upsertea sin borrar records pendientes. Dos AppViews `RECORDS` sobre la misma EntityType comparten cache porque el scope real es `contractId + entityTypeId`.

Crear offline:

- valida required/tipos localmente;
- genera `local_id` y `clientRequestId`;
- guarda `entity_records`;
- inserta pending operation `CREATE`;
- muestra el record de inmediato con estado `Pendiente`;
- intenta sync best-effort si hay sesion.

Editar offline:

- aplica cambios localmente de inmediato;
- conserva `remote_updated_at` sin modificar, porque esa es la version remota base que el usuario estaba editando;
- si existe CREATE pendiente, fusiona los cambios en el payload de ese CREATE;
- si ya existe UPDATE pendiente, lo consolida al estado final actual;
- nunca intenta UPDATE server-side si todavia no hay `server_id`.

El sync engine procesa una sola corrida a la vez con single-flight. Marca operaciones como syncing, incrementa attempts, llama POST/PATCH, guarda la respuesta en cache y elimina la operacion exitosa. `clientRequestId` se conserva en todos los reintentos de CREATE para aprovechar la idempotencia de Operational Core si una respuesta se pierde.

La observabilidad local de sincronizacion de `RECORDS` se guarda en SQLite por `ownerKey + contractId + entityTypeId`. Distingue push de `pending_operations`, refresh de snapshot remoto completo y reconcile local de ese snapshot. La UI normal muestra `Ultima sincronizacion` para la EntityType de la AppView actual, no para todo el contrato. `lastSuccessfulSyncAt` significa ultima sincronizacion completa y exitosa de esa EntityType: push si habia pendientes, refresh completo y reconcile. No se considera sincronizado solo porque el push termino si el pull/reconcile fallo. Ejemplo: si Personas sincroniza correctamente, no cambia la telemetria de Materiales o Equipos aunque compartan contrato. Si hay problemas, muestra `Problema de sincronizacion` sin detalles tecnicos. En desarrollo o con `?syncDiagnostics=1`, `RECORDS` muestra diagnostico no sensible: fase actual, ultimo intento, ultimo push, ultimo snapshot remoto, ultima reconciliacion, ultima sincronizacion exitosa, codigo/fase del ultimo error y conteos de pendientes, errores y conflictos.

Antes de sincronizar un UPDATE, el cliente hace preflight con `GET /api/v1/contracts/:contractId/entities/:entityTypeId/records/:recordId` y compara `remote.record.updatedAt` contra `entity_records.remote_updated_at`.

- Si coinciden, ejecuta PATCH y guarda `remote_updated_at = response.record.updatedAt`.
- Si difieren, no ejecuta PATCH, conserva los valores locales, marca `sync_status = conflict` y guarda el snapshot remoto.
- Si el preflight falla por red o 5xx, la operacion queda pendiente para un intento futuro.
- Si el preflight devuelve 404, la operacion queda `failed` con error claro.
- Si un cache viejo tiene `remote_updated_at = null`, no se parchea a ciegas: el preflight obtiene el remoto y el registro queda en conflicto para resolucion explicita.

Errores:

- `NETWORK` y 5xx quedan pendientes para retry posterior.
- `TOKEN_EXPIRED` se recupera en la capa auth antes de perder operaciones.
- Validacion, 4xx definitivos e `IDEMPOTENCY_CONFLICT` pasan a `failed` y se muestran como `Error`.

Los conflictos se resuelven desde la pantalla de detalle:

- `Usar mi version`: refresca el record remoto actual, actualiza `remote_updated_at`, limpia el snapshot, vuelve a `pending_update` y reintenta sync. Si Opco vuelve a cambiar antes del PATCH, se detecta otro conflicto.
- `Usar version de Opco`: pide confirmacion, refresca el record remoto actual, reemplaza los valores locales, elimina el pending UPDATE, limpia el snapshot y queda `synced`. No hace PATCH.
- No hay merge campo por campo todavia; la pantalla muestra solo campos diferentes con labels de la definicion.

Los records `failed` no se reintentan automaticamente. El usuario puede usar `Reintentar`, que limpia el error, restaura `pending_create` o `pending_update` segun la operacion, conserva el `clientRequestId` original de CREATE y dispara sync.

La UI muestra badges solo para estados no normales: `Pendiente`, `Sincronizando`, `Error` y `Conflicto`. El listado muestra summary global solo si hay algo relevante, por ejemplo `2 pendientes · 1 conflicto`, con acciones `Sincronizar` y `Ver problemas`.

## Attendance

`AttendanceWorkflow` permite registrar asistencia sin conexion cuando ya se preparo online. Es un adapter/preset sobre `STATE_UPDATE` y usa `statusFieldId`, `personFieldId`, `dateFieldId`, `contextFieldIds` y `observationFieldId` cuando existe. La preparacion requiere AppView config, statuses dinamicos, definition de la EntityType fuente, snapshot local de Personas y snapshots de asistencia por fecha. Si falta algo, la experiencia indica que debe abrirse con conexion para preparar su uso sin conexion.

Offline, la busqueda de Personas lee `entity_records` SQLite de la `sourceEntityTypeId`; no llama API ni crea una tabla paralela de Personas. Al elegir un estado, la app persiste primero una operacion `STATE_UPDATE` en `pending_operations` usando `ownerKey + contractId + appViewId + date + subjectRecordId`, conserva un `clientRequestId` estable y consolida registros repetidos de la misma Persona+Fecha porque Attendance declara `historyMode = update-current` y `uniqueness = subject-date`. Solo despues muestra `Guardado en este dispositivo.`

Los campos de contexto se configuran por `contextFieldIds`. En UI y seleccion local, un SELECT/MULTISELECT se recuerda por `optionId`; al generar `extraValues` persistibles para Core se resuelve a `FieldOption.value`. El label nunca es identidad ni valor persistible. Si no puede resolverse un `option.value`, el cliente falla localmente en vez de enviar un `optionId` invalido.

`observationFieldId` es opcional. Si no existe, no hay input de observacion, no se genera stateValue/extraValue de observacion y el cliente no infiere observacion desde otros `extraValues` de texto o contexto.

Attendance guarda snapshots remotos por fecha sobre la misma infraestructura `entity_records`/`STATE_UPDATE`. Al mostrar un dia, combina snapshot remoto, registros locales synced y operaciones pending/failed/conflict para que los cambios locales se superpongan sin duplicar. Online, abrir un dia hidrata esa fecha y deja su telemetry diaria. El prewarm automatico descarga el mes actual completo con concurrencia maxima 3; no descarga meses anteriores de forma masiva. Fechas fuera del mes actual se hidratan solo al abrirlas online.

La disponibilidad mensual de Attendance se deriva como `attendanceMonthStatus`: `complete` cuando todas las fechas del mes actual tienen snapshot completo; `partial` cuando al menos una fecha esta hidratada y falta otra; `none` cuando ninguna fecha del mes esta hidratada. Home usa ese estado para mostrar ready, datos parciales o datos no disponibles offline. La fecha seleccionada dentro del workflow sigue usando su propia telemetry diaria.

Al reconectar, el sync compartido procesa Attendance como `STATE_UPDATE` con `POST workflow/state-update` y una entrada por operacion. `CREATED`, `UNCHANGED` y `UPDATED` limpian el pending y dejan estado confirmado. `ERROR` queda `failed` con mensaje legible y puede conservar `lastErrorDetails` estructurado. `CONFLICT` conserva el pending, guarda el snapshot remoto y pide decision explicita: `Usar mi cambio` reintenta con `overwrite=true` y `expectedUpdatedAt` remoto; `Usar Opco` descarta la intencion local. No hay overwrite silencioso ni last-write-wins.

Los conflictos `STATE_UPDATE` pueden conservar diferencias de `stateValues` y `extraValues` cuando Core las entrega. La UI generica resuelve SELECT/MULTISELECT a labels visibles si tiene definicion preparada, conserva valores tecnicos para diagnostico y muestra campos desconocidos con fallback tecnico en vez de ocultarlos. La persistencia de conflicto actualiza pending operation y record local dentro de una sola transaccion SQLite.

La telemetry de Personas sigue describiendo el snapshot de Personas. Attendance usa el scope generico de workflow `workflow:<appViewId>` para push de operaciones `STATE_UPDATE`. El reset destructivo de SQLite cuenta tambien operaciones de estado porque se almacenan en `entity_records`/`pending_operations` compartidos.

`ATTENDANCE_UPSERT` no tiene migrador legacy porque Attendance offline no estaba publicado como soporte estable: la regla anterior del cliente era online-only. La unica outbox vigente para asistencia offline y workflows de estado es `STATE_UPDATE`.

## Prueba Manual Cold Start Offline

Matriz A, Safari normal:

1. Con conexion, abrir `client.opco.cl` en Safari, iniciar sesion y abrir una AppView `RECORDS`.
2. Recargar online y confirmar `Disponible sin conexion`.
3. Cerrar Safari completamente.
4. Activar modo avion.
5. Reabrir la misma URL.
6. Esperado: si Safari conserva el contexto, el shell abre; si iOS descarta ese contexto, no usar este resultado como aceptacion principal de PWA.

Matriz B, Home Screen PWA:

1. Con conexion, instalar `client.opco.cl` en pantalla de inicio.
2. Abrir desde el icono, iniciar sesion y esperar `Disponible sin conexion`.
3. Abrir una AppView `RECORDS`, listado y detalle; crear o editar un dato de prueba si es seguro.
4. Cerrar completamente la PWA.
5. Activar modo avion.
6. Reabrir desde el mismo icono.
7. Esperado: shell abre, no hay error del navegador, no fuerza login, muestra modo offline, contrato y AppViews visibles, listado/detalle cacheados y pending visibles.
8. Crear/editar `RECORDS` offline.
9. Rehabilitar red.
10. Esperado: sesion revalidada, sync automatico single-flight, pending desaparece y datos se reconcilian.
11. Abrir Attendance offline.
12. Esperado: mensaje de conexion requerida, sin crash y sin pending falso.

Para diagnostico en desarrollo, o agregando `?pwaDiagnostics=1`, la home muestra datos no sensibles: modo browser/standalone, soporte de service worker, scope, controller, script activo, version de cache, shellReady, snapshot de sesion, cache de navegacion y SQLiteReady. En un Mac se puede usar Safari Develop/Web Inspector para inspeccionar la Home Screen Web App, service worker, Cache Storage y consola.

## SQLite

Base local: `opco-client.db`.

Tablas:

```sql
app_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
)

entity_definitions (
  entity_type_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (entity_type_id, contract_id)
)

context_snapshot (
  id TEXT PRIMARY KEY NOT NULL,
  owner_key TEXT,
  me_json TEXT NOT NULL,
  context_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
)

app_views (
  owner_key TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  views_json TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (owner_key, contract_id)
)

entity_records (
  local_id TEXT PRIMARY KEY NOT NULL,
  server_id TEXT,
  owner_key TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  entity_type_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  values_json TEXT NOT NULL,
  remote_updated_at TEXT,
  cached_at TEXT NOT NULL,
  sync_status TEXT NOT NULL,
  sync_error_code TEXT,
  sync_error_message TEXT,
  conflict_remote_values_json TEXT,
  conflict_remote_display_name TEXT,
  conflict_remote_updated_at TEXT
)

pending_operations (
  id TEXT PRIMARY KEY NOT NULL,
  client_request_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  owner_key TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  entity_type_id TEXT NOT NULL,
  local_record_id TEXT NOT NULL,
  server_record_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT
)

sync_telemetry (
  owner_key TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  entity_type_id TEXT NOT NULL,
  sync_phase TEXT NOT NULL,
  last_sync_attempt_at TEXT,
  last_push_completed_at TEXT,
  last_full_refresh_completed_at TEXT,
  last_reconcile_completed_at TEXT,
  last_successful_sync_at TEXT,
  last_sync_error_at TEXT,
  last_sync_error_code TEXT,
  last_sync_error_phase TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_key, contract_id, entity_type_id)
)

app_view_definitions (
  owner_key TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  app_view_id TEXT NOT NULL,
  app_view_type TEXT NOT NULL,
  workflow_key TEXT,
  definition_json TEXT NOT NULL,
  last_prepared_at TEXT NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (owner_key, contract_id, app_view_id)
)
```

`app_metadata` guarda `schema_version` y el `selected_contract_id`. `context_snapshot` guarda identidad/contexto operativo minimo para bootstrap offline. `app_views` guarda las experiencias asignadas por contrato. `app_view_definitions` guarda el shell preparado por owner/contrato/AppView. `entity_definitions` guarda el JSON completo de la definicion retornada por Opco y su `synced_at`. `entity_records` guarda datos renderizables, version remota base, snapshot de conflicto y estado de sync. `pending_operations` guarda cola `CREATE`/`UPDATE`/`STATE_UPDATE`, payload final, errores y attempts. `sync_telemetry` guarda fases y timestamps de sync por owner/contract/entityType, sin payloads, record IDs, tokens ni mensajes remotos completos.

Las migraciones SQLite no resetean la DB local. Agregan columnas/tablas nuevas y conservan `local_id`, `server_id`, cache, telemetria y pending operations existentes.

Si SQLite no abre, una migracion falla o el storage local queda inaccesible, la app marca `SQLITE_UNAVAILABLE` en un estado global de storage (`initializing`, `ready`, `unavailable`). Este estado no se mezcla con `NETWORK`: una falla de red puede usar cache local, mientras que `SQLITE_UNAVAILABLE` significa que el dispositivo no pudo acceder a esa cache. Las causas internas se clasifican como `OPEN_FAILED`, `MIGRATION_FAILED`, `STORAGE_UNAVAILABLE`, `CORRUPTION_SUSPECTED` o `UNKNOWN`, pero la UI no muestra detalles tecnicos.

En cold start, `SQLITE_UNAVAILABLE` muestra una pantalla controlada: `No pudimos abrir los datos guardados en este dispositivo.`, con `Reintentar` y `Restablecer datos locales`. `Reintentar` reutiliza el singleton, limpia solo promises fallidas y vuelve a abrir/migrar sin borrar la DB, cache, pending operations ni sesion. Si una migracion falla, no se avanza `schema_version` y la DB no queda marcada como valida hasta que una inicializacion posterior complete correctamente.

`Restablecer datos locales` es un escape hatch destructivo, no la ruta principal. Antes de ejecutar reset, la app intenta contar registros `pending_create`, `pending_update`, `failed` y `conflict` y advierte: `Hay N cambios locales que aun no se han sincronizado. Si restableces los datos locales, se perderan.` Solo despues de confirmacion explicita cierra la DB si puede, elimina la SQLite local de Opco Client, limpia singleton/promises y recrea el schema. No toca el servidor, no hace logout remoto y no borra tokens innecesariamente. Si despues del reset no hay red, muestra `Conectate para volver a descargar los datos.` y no simula cache existente.

En `RECORDS`, si SQLite esta `unavailable`, los writes offline quedan bloqueados para no crear pendientes falsos. Si SQLite falla durante sync, la telemetry registra `SQLITE` en la fase correspondiente cuando el store puede escribirlo, y nunca actualiza `lastSuccessfulSyncAt` por un ciclo incompleto.

## Cache

Cuando login, `/me` y `/context` responden correctamente, la app guarda el snapshot minimo de navegacion. Si al reabrir `/me` o `/context` fallan por red y existe snapshot, el estado queda offline con `me`, `context`, contrato seleccionado y `owner_key` disponibles.

Cuando `GET /api/v1/contracts/:contractId/views` responde correctamente, las AppViews se upsertean en SQLite. Si una lectura posterior falla por red y existe cache local para ese contrato, Home y las rutas `/view/:appViewId` usan las AppViews cacheadas. Errores auth definitivos no usan esta cache como bypass.

Cuando `GET /api/v1/contracts/:contractId/entities/:entityTypeId` responde correctamente, la definicion se upsertea en SQLite. Si una lectura posterior falla por red u otro error y existe cache local, la pantalla muestra esa definicion e indica claramente que viene de cache.

Cuando `GET records` responde correctamente, los records remotos se upsertean en SQLite y se combinan con operaciones locales pendientes. Si falla por red, el listado y detalle intentan leer cache local y muestran `Sin conexion. Datos guardados localmente.`

En Expo Web, `expo-sqlite` depende de WASM y de headers de aislamiento cross-origin para `SharedArrayBuffer`. El proyecto incluye `metro.config.js` para empaquetar `.wasm` y configura `Cross-Origin-Embedder-Policy`/`Cross-Origin-Opener-Policy` en `app.json`. Aun asi, SQLite Web tiene limitaciones propias de navegador: OPFS puede no estar disponible, el Access Handle puede estar ocupado, el navegador puede restringir storage o puede haber eviction. La UI no debe depender de que la cache termine para mostrar datos remotos, y la recuperacion destructiva solo borra el almacenamiento local despues de confirmacion.

`@react-native-community/netinfo` entrega el estado `online`/`offline`/`unknown` y dispara sync al recuperar conectividad. Aun asi, la app no confia solo en ese estado: una request puede fallar aunque NetInfo diga online, y ese error real conserva la operacion pendiente para retry posterior.

Operational Core puede devolver detalles estructurados de validacion para `STATE_UPDATE`. El cliente persiste `lastErrorDetails` en la operacion pendiente, muestra un resumen humano en el banner global (`Un cambio no pudo sincronizarse.`) y permite abrir `Ver detalle` para ver campo, valor rechazado, tipo esperado, codigo tecnico y retryability cuando esos datos existen. Resolver o sincronizar correctamente deja de mostrar el error como pendiente; la evidencia tecnica puede conservarse en diagnosticos.

## Token Storage

En iOS y Android el access token se guarda con `expo-secure-store`. En Web/notebook, que tambien es una plataforma soportada por el cliente, actualmente se guarda en `localStorage` para mantener sesion entre recargas. `localStorage` no ofrece la misma proteccion que SecureStore frente a JavaScript ejecutado en la pagina, por lo que no debe tratarse como equivalente de seguridad. Una evolucion futura para Web podria mover la sesion a un BFF con cookies `HttpOnly`/`Secure` y reducir la exposicion del bearer token al runtime del navegador. La password nunca se persiste.

## Comandos

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm test
npm run diagnostics
npm run build:web
npm run start:web
npm start
```

## Despliegue Web En Railway

Expo Web se exporta como SPA con `web.output = "single"` en `app.json`. Esto genera `dist/index.html` y permite que rutas de Expo Router como `/login`, `/entity/:entityTypeId` o `/entity/:entityTypeId/record/:recordId` funcionen al recargar si el servidor devuelve `index.html` como fallback.

Railway debe configurarse con:

```text
Build Command: npm run build:web
Start Command: npm run start:web
```

`npm run build:web` ejecuta `expo export --platform web`. Las variables `EXPO_PUBLIC_OPCO_API_URL` y `EXPO_PUBLIC_OPCO_CLIENT_ID` se incorporan al bundle durante ese build, por lo que deben existir en el servicio de Railway antes de compilar.

`npm run start:web` ejecuta `node scripts/start-web.mjs`. Railway inyecta `PORT` automaticamente y el proceso escucha en `0.0.0.0` para ser accesible desde el proxy externo. El server sirve archivos desde `dist` y usa `dist/index.html` como fallback SPA. No hay puerto fijo en codigo.

Al generar el dominio en Railway, usa el servicio web de `opco-client` y deja que Railway detecte el puerto expuesto por la variable `PORT`. Si Railway solicita un target port explicitamente, selecciona el puerto en el que el proceso esta escuchando en runtime: el valor de `PORT` mostrado en los logs del deploy, no `8080` ni otro valor fijo local.

Despues de generar el dominio Railway de `opco-client`, agrega ese origin exacto a `API_ALLOWED_ORIGINS` en Operational Core. No uses comodines: debe ser el origin completo, por ejemplo `https://<dominio-railway>`.

## Limitaciones actuales

Esta etapa no implementa offline generico para todo `WORKFLOW`, `BOARD` ni `DASHBOARD`: solo `WORKFLOW + attendance` y `WORKFLOW + state-update` usan el runtime `STATE_UPDATE` compartido. `BOARD` y `DASHBOARD` siguen unsupported. `REPORT` existe como consulta/presentacion online y no modifica registros. Tampoco hay delete offline, FILE/IMAGE offline, background sync del SO, merge sofisticado campo por campo para RECORDS, camara/QR ni adjuntos.
