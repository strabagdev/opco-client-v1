# opco-client

Cliente generico multiplataforma para la API externa de Opco. Esta etapa valida el flujo base Expo -> login -> token -> `/me` -> `/context` -> seleccion de contrato -> entidades -> definicion de entidad -> cache local en SQLite -> listado y detalle read-only de records.

## Stack

- Expo SDK 57
- React Native 0.86
- TypeScript
- Expo Router
- expo-secure-store
- expo-sqlite
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
- `app/(app)/index.tsx`: diagnostico autenticado, contexto, contrato y entidades.
- `app/(app)/entity/[entityTypeId].tsx`: definicion cacheada, busqueda, paginacion y listado de records.
- `app/(app)/entity/[entityTypeId]/record/[recordId].tsx`: detalle read-only de un record con labels desde la definicion.
- `src/lib/opco-api.ts`: cliente central de API y parsing de envelopes `{ ok, data/error }`.
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
10. Con contrato seleccionado se listan entidades.
11. Al abrir una entidad se carga su definicion y sus records reales paginados.
12. Al abrir un record se muestra su detalle read-only con labels dinamicos desde la definicion.

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

Los records se leen desde la API remota y no tienen cache offline en esta etapa. La cache de records de 6B deberia vivir en un modulo separado junto a `src/lib/definition-cache.ts`, sin bloquear la visualizacion de datos remotos cuando SQLite Web falle o tarde demasiado.

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

Esta etapa no implementa creacion de registros, PATCH, escrituras offline, cola de sync, background sync, resolucion de conflictos, camara/QR, archivos ni refresh tokens.
