# Backend de incidencias MINSA

API de la plataforma de gestión de incidencias: visor de incidencias, revisión, entrenamiento de la IA, indicadores y portal de carga de archivos. Está construida con Express 5 y TypeScript. Comparte la base PostgreSQL del chatbot (`minsa-citas-whatsapp-bot`), que es la dueña de las migraciones: este repo nunca las ejecuta. El frontend es `minsa-incidencias-frontend`.

> **Estado (v0.1.0):** base del servidor (CORS, límite de peticiones por cubeta de tokens, errores estandarizados, cookie de sesión firmada, logs, conexión a PostgreSQL, cierre ordenado, `GET /salud` y `GET /salud/listo`). Todavía no hay autenticación ni módulos de negocio: ver [Siguientes pasos](#siguientes-pasos).

## Inicio rápido

| Quiero… | Comando | Detalle |
|---|---|---|
| Levantar la API en Docker | `npm run docker:up` | [Ejecutar con Docker](#ejecutar-con-docker) |
| Desarrollar en local | `npm run dev` | [Desarrollo local](#desarrollo-local) |
| Correr las pruebas | `npm test` | [Pruebas](#pruebas) |

## Ejecutar con Docker

Un solo comando construye la imagen, levanta el contenedor y **espera hasta que el healthcheck lo marque sano**:

```bash
npm run docker:up
```

1. Copia `.env.example` a `.env` (**ignorado por git: nunca se sube**) junto a `docker-compose.yml` y completa **`COOKIE_SECRET`** (mínimo 32 caracteres aleatorios, por ejemplo `openssl rand -hex 32`) y **`DATABASE_URL`** (ver [Conexión a la base de datos](#conexión-a-la-base-de-datos)). Si falta alguna, Docker Compose se detiene con un mensaje que la nombra, en lugar de arrancar un servidor roto.
2. Ejecuta `npm run docker:up`.
3. Verifica que responde y que llega a la base de datos:

   ```bash
   curl http://localhost:3033/salud
   # {"estado":"ok"}
   curl http://localhost:3033/salud/listo
   # {"estado":"ok","baseDeDatos":"ok"}
   ```

| Comando | Qué hace |
|---|---|
| `npm run docker:up` | Construye la imagen y levanta el contenedor en segundo plano; termina cuando está sano (máximo 180 s). |
| `npm run docker:logs` | Muestra los logs del contenedor en vivo. |
| `npm run docker:down` | Detiene y elimina el contenedor. |

**Desarrollo con recarga sobre el mismo compose.** Copia `docker-compose.override.yml.example` a `docker-compose.override.yml` (ignorado por git, nunca se versiona): Docker Compose lo carga solo, monta el código como volumen y corre `npm run dev` dentro del contenedor.

Detalles de la imagen:

- **Base:** `node:24-alpine` (el frontend usa Angular 22, que exige Node `^24.15`), multi-stage; la imagen final solo lleva las dependencias de producción y `dist/`.
- **Seguridad:** corre con el usuario sin privilegios `node`; los secretos solo entran como variables de entorno, nunca quedan dentro de la imagen.
- **Salud:** el `HEALTHCHECK` consulta `GET /salud`, que no toca la base de datos ni gasta el límite de peticiones.
- **Puerto:** 3033 dentro del contenedor; `HOST_PORT` cambia el puerto publicado (por defecto 3033).
- **Variables:** `docker-compose.yml` pasa al contenedor las variables del `.env` (`env_file`). Fija `NODE_ENV=production` y `PORT=3033` para que un valor olvidado no saque al servidor del puerto que usan el mapeo y el healthcheck. `COOKIE_SECRET` y `DATABASE_URL` son obligatorias y `CORS_ORIGINS` vale `http://localhost:4010` si no se define.
- **HTTPS:** lo termina el proxy inverso del servidor, no el contenedor.

> **Una sola instancia.** Las cubetas del límite de peticiones viven en la memoria del proceso. Con más de una réplica hará falta un almacén compartido (Redis o PostgreSQL) detrás de `TokenBucketLimiter`.

## Desarrollo local

Requiere Node `^24.15` (campo `engines` de `package.json`).

1. Instala las dependencias:

   ```bash
   npm install
   ```

2. Copia `.env.example` a `.env` y completa `COOKIE_SECRET` y `DATABASE_URL` (con `localhost` como host).
3. Levanta el servidor con recarga:

   ```bash
   npm run dev
   ```

> **Windows con control de aplicaciones.** Si una política de Windows bloquea `esbuild.exe` o los binarios nativos de `vitest`, `npm run dev` y `npm test` no arrancan. Usa Docker (`npm run docker:up` y el override de desarrollo) o WSL. No se modifica la política.

## Conexión a la base de datos

Esta API se conecta a la **base PostgreSQL del chatbot** (`minsa-citas-whatsapp-bot`), que es la dueña de las migraciones y deja las cargas iniciales (estados, categorías, roles, módulos). Aquí no se ejecuta ninguna migración. Solo se necesita una variable en el `.env`:

```bash
DATABASE_URL=postgresql://USUARIO:CLAVE@HOST:PUERTO/NOMBRE_DE_LA_BASE
```

| Dónde corre la API | `HOST` | Ejemplo |
|---|---|---|
| En Docker, con PostgreSQL en tu máquina | `host.docker.internal` (el compose ya lo resuelve) | `postgresql://postgres:CLAVE@host.docker.internal:5432/chatbot_prueba` |
| Sin Docker, con PostgreSQL en tu máquina | `localhost` | `postgresql://postgres:CLAVE@localhost:5432/chatbot_prueba` |
| Servidor de OGTI | el que indique OGTI; añadir `?sslmode=require` si lo exigen | `postgresql://rol_incidencias:CLAVE@host:5432/chatbot?sslmode=require` |

- **La base debe estar migrada** con la última migración del repo del bot (`npx prisma migrate deploy` desde ese repo).
- **Un rol de base de datos propio** por plataforma, no `postgres` (con `postgres` solo en tu máquina de desarrollo): la plataforma de gestión escribe en `gestion` e `ia` y solo lee `catalogo`.
- **El actor firma la auditoría.** Toda escritura va por `database.transaction(actor, ...)`, que abre la transacción y declara `set_config('app.actor', ..., true)`; el valor vale solo dentro de ella y la base lo usa en `usuario_creacion` y `usuario_modificacion`.
- **La conexión es perezosa:** la API arranca aunque la base no esté disponible; `GET /salud/listo` responde `503` hasta que haya conexión. `GET /salud` (el healthcheck de Docker) no toca la base.
- El código habla con un puerto `Database` (`src/database/database.ts`), no con el driver: cambiar de driver u ORM solo toca `pg-database.ts`.
- La clave nunca se registra: los errores de la base se enmascaran como `503` o `500` genéricos.

## Sesiones y autorización (diseño)

No se usa JWT. La sesión es **opaca y vive en la base**, y el navegador solo guarda su identificador:

1. Al iniciar sesión se crea una fila en `gestion.sesion_usuario` y se envía su `id` en una cookie **firmada**, `HttpOnly` y `SameSite=Strict`. La cookie **no lleva roles, módulos ni datos de la persona**.
2. En cada petición el backend lee la cookie con `readSessionId` (valida firma y formato), busca la sesión, comprueba que no esté revocada ni vencida y que el usuario siga activo, y **consulta sus roles y módulos en la base**. Nada de eso viaja al navegador.
3. El acceso se da **por módulo**: `gestion.rol_modulo` dice qué módulos abre cada rol (incidencias, revisión, indicadores, entrenamiento de la IA, usuarios) y `gestion.rol_categoria` qué categorías ve. Un usuario abre la unión de los módulos de sus roles.
4. Cerrar sesión y desactivar a un usuario revocan la sesión **en el servidor** (la base cierra todas las sesiones de un usuario desactivado): la cookie deja de servir aunque el navegador la conserve.
5. Las credenciales son `usuario` o `correo` más la huella `password_hash` (**Argon2id**, formato PHC; la base rechaza cualquier otro formato). La clave nunca se guarda.

Estas tablas las crea el repo del bot (migración `credenciales_sesiones_modulos`). El módulo de autenticación de este backend es el siguiente paso.

## Conexión con el frontend (CORS)

El frontend (puerto 4010) llama a esta API (puerto 3033) desde otro origen, así que el navegador exige CORS. Se configura con una lista de orígenes exactos en `CORS_ORIGINS`:

- Cada origen es esquema + dominio + puerto, sin ruta ni barra final. **Se rechaza el arranque** si hay un `*`, un dominio sin `https://` o una ruta.
- Se envía `Access-Control-Allow-Credentials: true` para que viaje la cookie de sesión; por eso nunca se permite un comodín.
- Solo se permiten los métodos `GET`, `POST`, `PUT`, `PATCH`, `DELETE` y la cabecera `Content-Type`.
- Un origen que no está en la lista no recibe `Access-Control-Allow-Origin`, y el navegador bloquea la respuesta.
- Para que la cookie `SameSite=Strict` viaje, frontend y API deben ser del **mismo sitio** (mismo dominio registrable, por ejemplo `gestion.minsa.gob.pe` y `api-gestion.minsa.gob.pe`; en local, `localhost` con puertos distintos).

## Variables de entorno

`.env.example` es solo la lista de variables, sin valores secretos: **esta sección es su documentación.** El `.env` real **no se sube** a git.

| Variable | Por defecto | Para qué |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` o `production` (en `production` la cookie lleva `Secure`) |
| `PORT` | `3033` | Puerto del servidor |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` o `silent` |
| `CORS_ORIGINS` | vacío | Orígenes permitidos separados por comas (ej. `http://localhost:4010`) |
| `TRUST_PROXY` | `false` | `true` si hay un proxy inverso delante, para leer la IP real del cliente (el límite de peticiones depende de eso) |
| `COOKIE_SECRET` | **obligatoria** | Firma de las cookies; mínimo 32 caracteres |
| `DATABASE_URL` | **obligatoria** | URL de PostgreSQL (`postgresql://usuario:clave@host:puerto/base`) |
| `RATE_LIMIT_WINDOW_SECONDS` | `300` | Ventana de referencia de la cubeta, en segundos |
| `RATE_LIMIT_AUTH_CAPACITY` | `300` | Peticiones por ventana para un usuario autenticado |
| `RATE_LIMIT_ANON_CAPACITY` | `100` | Peticiones por ventana para un cliente anónimo (por IP) |
| `RATE_LIMIT_LOGIN_WINDOW_SECONDS` | `900` | Ventana de los intentos de login, en segundos |
| `RATE_LIMIT_LOGIN_CAPACITY` | `5` | Intentos de login por ventana y **por correo** |
| `HOST_PORT` | `3033` | Solo Docker: puerto publicado en el servidor |

Una variable inválida o ausente detiene el arranque con el detalle de lo que falló (validación con `zod` en `src/config/env.ts`).

## Límite de peticiones (cubeta de tokens)

Cada cliente tiene una cubeta que nace llena y gasta un token por petición. Los tokens se rellenan de forma continua a `capacidad / ventana` por segundo. Con los valores por defecto, un usuario autenticado puede hacer una ráfaga de **300** peticiones y, de forma sostenida, **1 por segundo** (300 cada 5 minutos). Un cliente anónimo tiene 100 por 5 minutos y se identifica por IP.

**Login: por correo, no por IP.** Son 5 intentos por 15 minutos (después, 1 cada 3 minutos). Se cuenta por correo (sin distinguir mayúsculas ni espacios) porque varias personas comparten la IP de una red institucional y limitar por IP dejaría fuera a todo el equipo. Si el cuerpo no trae correo se limita por IP, para que omitirlo no sirva de atajo. Riesgo conocido: alguien podría gastar los intentos de un correo ajeno y retrasarle el acceso; se mitiga con el relleno continuo y, si hace falta, con un límite adicional por IP más correo.

Al agotarse responde `429` con el formato estándar de error y la cabecera `Retry-After` (segundos hasta tener un token). Todas las respuestas llevan `RateLimit-Limit` y `RateLimit-Remaining`. `GET /salud` y `GET /salud/listo` no gastan cubeta.

## Errores

Todo error responde con la misma estructura. El frontend decide qué mostrar leyendo `errorCode`, no `message`:

```json
{
  "success": false,
  "statusCode": 409,
  "errorCode": "CONFLICT",
  "message": "La operación entra en conflicto con el estado actual.",
  "timestamp": "2026-10-04T23:41:18.088Z",
  "path": "/recurso"
}
```

Los errores de validación agregan `details` (`path` y `message` por campo). Un error inesperado responde `500 INTERNAL_ERROR` genérico: el detalle real solo queda en los logs.

## Estructura del proyecto

```
src/
  server.ts            Arranque, cierre ordenado (SIGTERM/SIGINT) y pool de la base
  app.ts               createApp: logs, helmet, CORS, salud, límite, JSON, cookies, errores
  config/              env.ts (variables validadas) y logger.ts
  constants/           Mensajes de error y límites (sin números mágicos)
  database/            Puerto Database, adaptador PostgreSQL (pg) y actores de auditoría
  enums/               ErrorCode, HttpStatus
  errors/app-error.ts  AppError (estado HTTP, código interno y mensaje)
  middleware/          cors, rate-limit, error-handler (y el 404)
  routes/              Rutas por recurso (hoy solo salud)
  utils/               token-bucket, session-cookie
  test-utils/          Ayudas de pruebas (no entra al build)
```

Imports con el alias `@/` (apunta a `src/`); el build lo reescribe a rutas relativas con `tsc-alias`.

## Reglas

Las reglas del backend (capas, errores, cookies, CORS, límites) están en el vault de Obsidian, `Base de dato/Plataforma de gestión/Backend de gestión - Reglas v2.md`. Resumen de las que ya cumple el código:

- Un rol de base de datos propio; declarar el actor (`set_config('app.actor', ..., true)`) en cada transacción que escriba.
- Las reglas de negocio de la incidencia las hace cumplir la base, no este código.
- La cookie de sesión solo lleva un identificador opaco, firmado, `HttpOnly`, `SameSite=Strict`; se lee siempre con `readSessionId` y el estado vive en el servidor para poder revocarla.
- No registrar DNI, nombres, tokens ni texto de incidencias en los logs: cada petición solo registra id, método, ruta **sin query**, IP, estado y duración; nunca cabeceras ni cookies.
- Ningún secreto en el repositorio: el `.env` está ignorado y solo se versiona `.env.example`.

## Pruebas

```bash
npm test             # vitest + supertest
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
```

Las pruebas contra PostgreSQL real (`src/database/pg-database.integration.test.ts`) se omiten salvo que definas `TEST_DATABASE_URL` con una base ya migrada por el repo del bot. Solo leen los catálogos y comprueban el actor; no escriben datos:

```bash
TEST_DATABASE_URL=postgresql://USUARIO:CLAVE@HOST:5432/NOMBRE_DE_LA_BASE npm test
```

## Siguientes pasos

1. **Autenticación:** login, logout y renovación de sesión; `requireSession` y `requireModulo(...)`; creación del primer administrador (con un procedimiento aparte, no una migración); cabecera anti-CSRF; enchufar el límite de login (`createLoginResolver`) a la ruta.
2. **Rol de base de datos propio** con permisos mínimos (lo crea OGTI) y `sslmode` hacia su servidor.
3. Visor y revisión de incidencias, indicadores, entrenamiento de la IA y portal de carga (fases siguientes, sobre vistas SQL del repo del bot).

## Documentación relacionada

El diseño y las decisiones de la plataforma están en el vault de Obsidian, carpeta `Base de dato/Plataforma de gestión/`. El frontend hermano es `minsa-incidencias-frontend` y la base la define `minsa-citas-whatsapp-bot` (`prisma/`).
