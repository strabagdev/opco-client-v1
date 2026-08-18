# opco-client

Cliente generico multiplataforma para la API externa de Opco. Esta etapa valida el flujo Expo -> login -> token -> `/me` -> `/context` -> seleccion de contrato -> AppViews asignadas -> renderer `RECORDS` -> definicion de entidad -> cache local en SQLite -> listado, detalle, creacion y edicion de records.

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
- `app/(app)/index.tsx`: diagnostico autenticado, contexto, contrato y AppViews asignadas al usuario.
- `app/(app)/view/[appViewId].tsx`: ruta generica de experiencia; carga `/views` y resuelve renderer por `AppView.type`.
- `app/(app)/view/[appViewId]/record/[recordId].tsx`: detalle de record conservando contexto de AppView.
- `app/(app)/view/[appViewId]/record/new.tsx`: creacion dinamica de record para AppViews `RECORDS`.
- `app/(app)/view/[appViewId]/record/[recordId]/edit.tsx`: edicion parcial dinamica de record.
- `src/renderers/registry.ts`: registry central `RECORDS`, `WORKFLOW`, `BOARD`, `DASHBOARD`.
- `src/renderers/records/`: primer renderer real; lista, detalle y formulario dinamico.
- `src/renderers/unsupported/`: estado temporal para tipos de AppView no implementados.
- `src/lib/opco-api.ts`: cliente central de API y parsing de envelopes `{ ok, data/error }`.
- `src/lib/app-views.ts`: labels, orden y rutas basadas en AppView.
- `src/lib/record-form.ts`: conversiones, validacion required basica y payload parcial de formularios.
- `src/lib/local-db.ts`: esquema SQLite versionado minimo.
- `src/lib/definition-cache.ts`: lectura online con fallback cacheado.
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
16. Crear usa `POST /api/v1/contracts/:contractId/entities/:entityTypeId/records` con `clientRequestId`.
17. Editar usa `PATCH /api/v1/contracts/:contractId/entities/:entityTypeId/records/:recordId` con payload parcial.

## AppViews y EntityTypes

La navegacion normal ya no lista EntityTypes globales. Opco Client consume AppViews asignadas desde `/views`; una AppView representa la experiencia visible para el usuario, mientras que una EntityType representa el modelo de datos dinamico que esa experiencia puede usar.

DTO conceptual:

```ts
type AppView =
  | { id: string; name: string; slug: string; icon: string | null; sortOrder: number; type: "RECORDS"; config: { entityTypeId: string } }
  | { id: string; name: string; slug: string; icon: string | null; sortOrder: number; type: "WORKFLOW"; config: Record<string, unknown> }
  | { id: string; name: string; slug: string; icon: string | null; sortOrder: number; type: "BOARD"; config: Record<string, unknown> }
  | { id: string; name: string; slug: string; icon: string | null; sortOrder: number; type: "DASHBOARD"; config: Record<string, unknown> };
```

Si `/views` retorna `[]`, la home muestra: `No tienes experiencias asignadas para este contrato.` No hay fallback automatico al listado global de entidades.

## Renderers

Registry actual:

```text
RECORDS   -> RecordsRenderer
WORKFLOW  -> UnsupportedRenderer
BOARD     -> UnsupportedRenderer
DASHBOARD -> UnsupportedRenderer
```

`WORKFLOW`, `BOARD` y `DASHBOARD` muestran el nombre, icono, tipo y el mensaje temporal: `Esta experiencia todavia no esta disponible en esta version de Opco Client.`

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
```

`app_metadata` guarda `schema_version` y el `selected_contract_id`. `entity_definitions` guarda el JSON completo de la definicion retornada por Opco y su `synced_at`.

## Cache

Cuando `GET /api/v1/contracts/:contractId/entities/:entityTypeId` responde correctamente, la definicion se upsertea en SQLite. Si una lectura posterior falla por red u otro error y existe cache local, la pantalla muestra esa definicion e indica claramente que viene de cache.

Los records se leen y escriben contra la API remota y no tienen cache offline de escrituras en esta etapa. La cache de records o cola offline deberia vivir en un modulo separado junto a `src/lib/definition-cache.ts`, sin bloquear la visualizacion de datos remotos cuando SQLite Web falle o tarde demasiado.

En Expo Web, `expo-sqlite` depende de WASM y de headers de aislamiento cross-origin para `SharedArrayBuffer`. El proyecto incluye `metro.config.js` para empaquetar `.wasm` y configura `Cross-Origin-Embedder-Policy`/`Cross-Origin-Opener-Policy` en `app.json`. Aun asi, SQLite Web tiene limitaciones propias de navegador y la UI no debe depender de que la cache termine para mostrar datos remotos.

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

Esta etapa no implementa `WORKFLOW`, `BOARD` ni `DASHBOARD` reales, escrituras offline, cola de sync, background sync, resolucion de conflictos, camara/QR, archivos ni refresh tokens.
