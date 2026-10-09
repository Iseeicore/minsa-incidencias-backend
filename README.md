# Backend de incidencias MINSA

API de la plataforma de gestión de incidencias: visor de incidencias, revisión, entrenamiento de la IA, indicadores y portal de carga de archivos. Está construida con Express 5 y TypeScript. Comparte la base PostgreSQL del chatbot (`minsa-citas-whatsapp-bot`), que es la dueña de las migraciones: este repo nunca las ejecuta. El frontend es `minsa-incidencias-frontend`.

> **Estado:** base del servidor (CORS, límite de peticiones por cubeta de tokens, errores estandarizados, logs, conexión a PostgreSQL, cierre ordenado y salud) y **autenticación por correo con sesión opaca y vistas por rol** (ver [Autenticación y sesiones](#autenticación-y-sesiones)). Todavía no hay módulos de negocio: ver [Siguientes pasos](#siguientes-pasos).

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

Esta API se conecta a la **base PostgreSQL del chatbot** (`minsa-citas-whatsapp-bot`), que es la dueña de las migraciones y deja las cargas iniciales (estados, categorías, roles, tipos de área y el área `OTRANS`). Aquí no se ejecuta ninguna migración. Los establecimientos y sus áreas (`EESS-<renipress>`) los carga el repo del bot (`npm run db:seed:eess`); sin ese padrón, ningún caso puede derivarse a un establecimiento. Esta API necesita la versión del esquema con áreas y establecimientos (`catalogo.area`, `catalogo.establecimiento_salud`, `incidencia_paciente.area_destino_id`). Solo se necesita una variable en el `.env`:

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

## Autenticación y sesiones

No se usa JWT. La sesión es **opaca y vive en la base**, y el navegador solo guarda su identificador. Se inicia sesión **solo con el correo** y la clave.

| Ruta | Qué hace | Respuesta |
|---|---|---|
| `POST /auth/login` | Cuerpo `{ "correo", "password" }`. Normaliza el correo, verifica la clave (Argon2id) y crea la sesión. Límite: 5 intentos por 15 minutos por correo | `204` con la cookie de sesión; `401 INVALID_CREDENTIALS` si el correo o la clave no sirven (el mismo error para un correo inexistente, una clave mala o un usuario desactivado); `400` si el cuerpo es inválido; `429` si se agotaron los intentos |
| `GET /auth/me` | Quién soy: nombre, correo, las vistas que puedo abrir, mis roles y mi área | `200 { nombreCompleto, correo, vistas, roles, area }` con `roles: string[]` (códigos activos) y `area: { codigo, nombre, tipo } \| null` (nunca ids); `401` sin sesión (`UNAUTHORIZED`) o con una sesión que ya no sirve (`INVALID_SESSION`) |
| `POST /auth/logout` | Revoca la sesión en la base y borra la cookie | `204` (siempre, aunque no hubiera sesión) |

Cómo funciona:

1. Al iniciar sesión se crea una fila en `gestion.sesion_usuario` y se envía su `id` en una cookie **firmada**, `HttpOnly` y `SameSite=Strict` (con `Secure` en producción), con la vigencia máxima de 8 horas. La cookie **no lleva roles, vistas ni datos de la persona**.
2. En cada petición `attachSession` lee la cookie con `readSessionId` (valida firma y formato) y consulta **en una sola consulta** si la sesión sigue abierta: no revocada, dentro de sus 8 horas y de los 30 minutos de inactividad, y con el usuario activo. De paso trae los roles activos del usuario (un rol desactivado no cuenta) y su área (`gestion.usuario_interno.area_id`); el servicio convierte los roles en vistas. Si la sesión ya no sirve, borra la cookie.
3. La actividad se renueva como mucho una vez por minuto (no se escribe en cada petición).
4. El acceso se da **por vista**: `requireVista(VistaCodigo.CASOS)` responde `403` si el usuario no la tiene. Un usuario abre la unión de las vistas de sus roles (ver [Vistas por rol](#vistas-por-rol)).
5. **Interruptor de apagado:** cerrar sesión revoca la fila; desactivar a un usuario hace que la base cierre todas sus sesiones (disparador); la cookie deja de servir aunque el navegador la conserve.
6. Cada login crea una sesión nueva (si traía otra abierta, la cierra): el identificador se rota.
7. **Tiempos:** si el correo no existe se verifica igualmente una clave falsa, para que el tiempo de respuesta no delate qué correos están registrados.

### Vistas por rol

En el MVP los permisos son una **tabla fija en el código** (`src/constants/permisos-por-rol.ts`), sin permisos editables por persona: el rol define las vistas y, más adelante, las acciones. Los roles nunca viajan al navegador; solo las vistas que resultan. Los módulos se eliminaron: la base ya no tiene `gestion.modulo` ni `gestion.rol_modulo`.

| Rol | Área | Vistas |
|---|---|---|
| `ADMINISTRADOR` | sin área | `INICIO`, `CASOS`, `BANDEJAS`, `DERIVACIONES`, `QR`, `USUARIOS` |
| `GESTOR` (revisa y atiende los casos de su establecimiento) | el área de su establecimiento (`EESS-<renipress>`), siempre | `INICIO`, `CASOS`, `BANDEJAS` (sin `DERIVACIONES`, `QR` ni `USUARIOS`). Conserva la **acción** `derivar` en los casos, no la vista |
| `OTRANS` (denuncias por corrupción) | área `OTRANS` | `INICIO`, `CASOS`, `BANDEJAS` (sin `DERIVACIONES`, `QR` ni `USUARIOS`) |
| `ESTABLECIMIENTO` (responsable del establecimiento) | el área de su establecimiento (`EESS-<renipress>`) | `INICIO`, `CASOS`, `BANDEJAS`, `QR`, `USUARIOS` (sin `DERIVACIONES`) |

`QR` es la pantalla del generador de códigos QR de WhatsApp por establecimiento. No tiene endpoint propio: el cliente usa `GET /areas?tipo=ESTABLECIMIENTO` (el administrador lista todos; un establecimiento solo el suyo, con `establecimiento.codigoRenipress`). `USUARIOS` es la gestión de usuarios (ver [Usuarios por establecimiento](#usuarios-por-establecimiento)): solo la tienen quienes pueden crearlos.

El rol `DIRIS` existe en la base pero está **desactivado**: solo se consultan roles activos y la tabla no lo conoce, así que no da ninguna vista. Los roles `REVISOR`, `AREA_QUEJA`, `AREA_RECLAMO` y `AREA_DENUNCIA_CORRUPCION` ya no existen.

- **Varios roles:** se unen sus vistas, sin repetir y en el orden del menú (`vistasDeRoles`).
- **Área de la persona:** cada usuario interno tiene a lo sumo un área (`catalogo.area`; tipos `ESTABLECIMIENTO`, `OTRANS`, `DIRIS`, `INSTITUTO`, `ORGANISMO`). Un rol con tipo de área (`GESTOR` y `ESTABLECIMIENTO`: un establecimiento; `OTRANS`: la oficina de transparencia) solo se asigna a quien pertenece a un área de ese tipo: lo hace cumplir un disparador de la base, no esta API.
- **Sin ningún rol activo** (por ejemplo, un rol desactivado después): la sesión es válida y `GET /auth/me` devuelve `vistas: []`; cualquier ruta con `requireVista` responde `403`. No se rechaza la sesión porque la persona sí se autenticó; lo que no tiene es acceso.
- **Qué ve cada rol dentro de las vistas** (categorías) lo decide la base (`gestion.rol_categoria`) y **qué puede hacer** (acciones) lo decide la misma tabla fija; ver [Incidencias](#incidencias-casos).
- **La sesión de la petición lleva los roles** (`req.sesion.roles`) y `GET /auth/me` devuelve sus códigos (`roles`, p. ej. `["ADMINISTRADOR"]`) para que el cliente distinga al superadministrador del gestor, que comparten vistas; nunca devuelve ids de usuario ni del área.

## Áreas (destino al derivar y filtro por establecimiento)

Pide solo sesión (sin vista concreta): qué áreas ve cada persona lo decide el servidor según sus roles. Solo lista áreas **activas** (de un tipo de área activo).

| Ruta | Qué hace |
|---|---|
| `GET /areas` | Query: `tipo` (`ESTABLECIMIENTO`, `OTRANS`, `DIRIS`, `INSTITUTO` u `ORGANISMO`), `q` (texto, sin tildes ni mayúsculas, máximo 100; usa `nombre_busqueda` en los establecimientos y `f_unaccent(nombre)` en las demás áreas, sin filtrar por nivel de atención; si `q` son solo dígitos, además coincide el código RENIPRESS exacto, sin ceros a la izquierda), `limite` (50 por defecto, máximo 200) y `cursor` (opaco, keyset por nombre e id). Responde `{ items, siguiente, hayMas }` con `items: [{ id, codigo, nombre, tipoArea, establecimiento }]`, donde `establecimiento` es `null` o `{ codigoRenipress, nivelAtencion, categoria }`. Orden estable por nombre e id; sin total. Un cursor inválido o un `tipo` desconocido responde `400` |

- **Quién ve qué** (`veTodasLasAreas` en la tabla de permisos): `ADMINISTRADOR` (filtra por establecimiento y elige el destino al derivar) y `GESTOR` (elige el establecimiento destino al derivar) listan todas; `OTRANS` y `ESTABLECIMIENTO` solo ven **su propia área** (una sola; ninguna si no tienen área). Que el gestor liste áreas no amplía sus **casos**: esos siguen siendo solo los de su área. Con varios roles basta que uno lo permita.
- Cada item trae su `codigo`: es el que se envía como `areaDestino` en `POST /incidencias/:codigo/derivar` (en un establecimiento, `EESS-<codigoRenipress>`). El `id` numérico es solo informativo.

## Incidencias (casos)

Cada caso se identifica por su **código legible** (`MINSA-AAAA-NNNNNN`, columna `codigo`, lo asigna la base). El `id` interno (UUID) y el `trace_id` del chat nunca salen de la API. Todas las rutas piden sesión y la vista `CASOS`, salvo `por-vencer`, que solo pide sesión (la campana de avisos).

| Ruta | Qué hace |
|---|---|
| `GET /incidencias` | Lista con **paginación por cursor** (keyset), del caso más reciente al más antiguo (`fecha_creacion` y `id`, descendente). Query: `limite` (20 por defecto, máximo 100), `cursor` (opaco: el `siguiente` de la respuesta anterior; sin él, empieza por lo más reciente), `estado`, `motivoArchivo` (`DATOS_INSUFICIENTES`, `NO_CORRESPONDE`, `VENCIDA_SIN_ATENDER` o `RESUELTA_VIGENCIA`; con `estado=archivado` es la **bandeja de archivados**, que cada área ve solo la suya por la misma visibilidad y el mismo cursor e índices), `categoria` (o `sin-categoria`) y `texto` (código o relato, búsqueda literal, máximo 100; el código se encuentra también solo con su número, p. ej. `000017`, sin `MINSA-2026-`), `desde` y `hasta` (`AAAA-MM-DD`, ambos inclusivos, sobre la **fecha de llegada** del caso y como **días de Lima**, `America/Lima` UTC−5: un caso llegado a las 23:30 de Lima cuenta en ese día; si solo viene uno el otro queda abierto; una fecha inexistente como `2026-02-31`, `desde` posterior a `hasta` o un rango de más de 366 días responde `400 VALIDATION_FAILED`; se combinan con todos los filtros, la visibilidad y el cursor, y usan el índice `ix_incidencia_paciente_cursor`), y `establecimiento` (código RENIPRESS del establecimiento de origen; se quitan los ceros a la izquierda y debe quedar de 1 a 8 dígitos sin cero inicial, si no responde `400`; filtra por `establecimiento_id` con el índice `ix_incidencia_paciente_origen_fecha`, se combina con los demás filtros y con el cursor, y **nunca amplía** lo que el rol ya ve: un código sin casos visibles da lista vacía). Responde `{ items, siguiente, hayMas }`: `items` con el resumen de cada caso, `siguiente` el cursor de la página que sigue (`null` en la última) y `hayMas` si queda algo. El código exacto no sale primero: el orden es siempre fecha de llegada e id para que el cursor sea estable. **No hay total ni número de página** (con millones de casos un `COUNT(*)` y un `OFFSET` serían lentos) ni orden elegible. Un cursor que esta API no emitió responde `400`. Como el cursor es la posición del último caso entregado, un caso nuevo no mueve ni repite las páginas ya pedidas |
| `GET /incidencias/conteos` | Contadores de las pestañas de la bandeja. Pide la vista `CASOS` y acepta **los mismos filtros y la misma validación** que `GET /incidencias` (`estado`, `motivoArchivo`, `categoria` o `sin-categoria`, `texto`, `establecimiento`, `desde`, `hasta`) salvo `limite` y `cursor`, que se ignoran. Usa las mismas condiciones y la misma visibilidad que el listado, así que nunca cuenta lo que el listado no mostraría (la corrupción no se cuenta al establecimiento ni al gestor, ni los casos de otra área). Responde `200 { todos, total, porEstado }`, donde cada contador es `{ cantidad, conMas }` y `porEstado` trae siempre los seis estados (`registrado`, `clasificado`, `derivado`, `en-gestion`, `resuelto`, `archivado`), con `0` si no hay. `todos` y `porEstado` se calculan con todos los filtros **menos** `estado` y `motivoArchivo` (cada pestaña muestra su cantidad real bajo los demás filtros); `total` usa **todos** los filtros, también `estado` y `motivoArchivo` (el «Y» de «Mostrando N de Y»). **Cada conteo está acotado** a `CONTEO_TOPE` = 1000 (`src/constants/incidencias.ts`): la consulta se detiene en 1001 filas (`SELECT count(*) FROM (SELECT 1 … LIMIT 1001)`), y si hay más devuelve `cantidad: 1000` y `conMas: true` (en pantalla, «1000+»). `porEstado` sale de una sola consulta con un `LATERAL` por estado (usa `ix_incidencia_paciente_destino_estado_fecha` y `ix_incidencia_paciente_estado_fecha`); `todos` es la suma de ese resultado y `total` solo hace una consulta aparte cuando hay `estado` o `motivoArchivo`. Va antes de `/incidencias/:codigo` |
| `GET /incidencias/por-vencer` | La campana: `{ total, porVencer, vencidos, casos }`. Cuenta los casos abiertos cuyo plazo de atención (desde la llegada o, si se reabrió, desde la última reapertura) vence dentro de `PLAZO_AVISO_HORAS` o ya venció, **y que a esa persona le toca atender** (los que cumplen alguna regla de acción de sus roles): el gestor y cada establecimiento cuentan lo abierto de su área (clasificado, derivado o en gestión), y OTRANS la corrupción abierta de su área. **El contador baja** cuando el caso se resuelve o se archiva. El administrador cuenta todos los abiertos que ve (`avisaTodoLoAbierto` en la tabla de permisos). `casos` trae hasta 10, los más antiguos primero |
| `GET /incidencias/:codigo` | Detalle: el resumen más `resolucion`, `archivo`, `reapertura`, `descripcion`, `reclamante`, `evidencias` e `historial` |
| `POST /incidencias/:codigo/confirmar` | Confirma la categoría de la IA (una sola vez) |
| `POST /incidencias/:codigo/corregir` | Cuerpo `{ "categoria": "denuncia-corrupcion" \| "queja" \| "reclamo" \| "otro" }`. Corrige la categoría (una sola vez, y nunca después de confirmar). El gestor y el responsable del establecimiento pueden elegir `queja`, `reclamo`, `otro` y también `denuncia-corrupcion` (salida de emergencia de una corrupción que llegó etiquetada como queja o reclamo); OTRANS y el administrador, cualquiera. **Reclasificar a corrupción es irreversible para quien lo hace**: la base manda el caso a OTRANS y deja de ser visible para el establecimiento y el gestor. En ese caso (y solo si el caso sale de la vista de quien corrige) la respuesta es `200 { "codigo": "MINSA-...", "enviadoAOtrans": true }`, sin datos del caso; si no, la respuesta no cambia (`{ mensaje, caso }`) |
| `POST /incidencias/:codigo/derivar` | OTRANS, el administrador y el gestor (este solo una queja, reclamo u otro ya revisado, en `clasificado`, hacia **otro** establecimiento); el responsable del establecimiento no deriva. Cuerpo opcional `{ "areaDestino": "EESS-6206" }` (código del área). Pasa a `derivado` y fija el área de destino en la misma sentencia. Sin `areaDestino`, va al área del **establecimiento de origen** del caso (una denuncia por corrupción se queda en el área de OTRANS donde ya está). Debe ser un área **activa de tipo `ESTABLECIMIENTO`** (`OTRANS` si es corrupción, que solo derivan OTRANS y el administrador y nunca hacia un establecimiento); si no hay destino, o el área no sirve (tipo equivocado, inexistente o desactivada), responde `422 UNPROCESSABLE` con un mensaje claro y el caso no cambia |
| `POST /incidencias/:codigo/tomar` | Pasa a `en-gestion`. Desde `clasificado` ya revisado o desde `derivado`: al clasificarse una queja, un reclamo u otro, la base le asigna como destino el área de su establecimiento de origen, así que el área lo toma sin que nadie lo derive |
| `POST /incidencias/:codigo/resolver` | Cuerpo `{ "medidasTomadas": "...", "fundamento": "...", "resultado": "ATENDIDO" \| "CERRADO" }`. Los dos textos son obligatorios, de 10 a 4000 caracteres (sin contar los espacios de los bordes). La base registra la resolución una sola vez y pone `resuelto`. Ya no existe el campo único `resolucion` en el cuerpo |
| `POST /incidencias/:codigo/archivar` | Cuerpo `{ "motivo": "DATOS_INSUFICIENTES" \| "NO_CORRESPONDE", "detalle": "..." }`. El `detalle` (justificación) es obligatorio, de 10 a 2000 caracteres. Se archiva a mano desde `clasificado`, `derivado` o `en-gestion`. La base firma quién y cuándo, y saca el caso del entrenamiento de la IA (`ia.entrenamiento_categoria.apto_entrenamiento = false`). Los motivos `VENCIDA_SIN_ATENDER` y `RESUELTA_VIGENCIA` los pone el sistema: aquí responden `400` |
| `POST /incidencias/:codigo/reabrir` | Cuerpo `{ "motivo": "..." }` (10 a 2000 caracteres). Un `archivado` vuelve a `en-gestion`, tomado por quien reabre, con el motivo; la base limpia el archivo, registra quién y cuándo reabrió, y devuelve el caso al entrenamiento. Solo se reabre lo archivado por `DATOS_INSUFICIENTES`, `NO_CORRESPONDE` o `VENCIDA_SIN_ATENDER`; uno `RESUELTA_VIGENCIA` responde `409` (la lista de `acciones` incluye `reabrir` para todo archivado: el cliente debe ocultarlo si `archivo.motivo` es `RESUELTA_VIGENCIA`) |

Las acciones responden `200 { mensaje, caso }`. Si la acción saca el caso de la vista de quien la hizo (por ejemplo, OTRANS lo corrige a queja, que la base devuelve al establecimiento de origen), `caso` es `null` y el `mensaje` lo avisa; a partir de ahí el caso responde `404` para esa persona.

**Resumen de un caso** (compatible con el tipo `Caso` del frontend donde la base tiene el dato):

| Campo | Contenido |
|---|---|
| `codigo` | `MINSA-2026-000001` |
| `categoria`, `categoriaIa` | `denuncia-corrupcion`, `queja`, `reclamo`, `otro` o `null` (aún sin clasificar) |
| `confianzaIa` | 0 a 100, o `null` |
| `estado` | `registrado`, `clasificado`, `derivado`, `en-gestion`, `resuelto`, `archivado` |
| `area` | Área de destino del caso, `{ codigo, nombre }` (un establecimiento, u `OTRANS` para la corrupción); `null` mientras no se ha derivado ni asignado. Reemplaza al nombre de texto de la versión anterior |
| `establecimiento` | Establecimiento de origen (donde ocurrió), `{ codigoRenipress, nombre, nivelAtencion, categoria }` (`nivelAtencion` es el código del catálogo I/II/III y `categoria` el texto del padrón, p. ej. `I-3`; ambos `null` si el padrón no los trae); `null` si el caso no lo trae. Nunca ids |
| `responsable` | Nombre de quien derivó, o si no de quien corrigió, o si no de quien confirmó; `"Sistema"` si lo hizo el sistema; `null` si nadie |
| `revisadoPorHumano`, `corregida` | Si una persona confirmó o corrigió; si la corrigió |
| `horasDesdeLlegada`, `horasDesdeResolucion` | Horas completas, con la hora de la base. `horasDesdeLlegada` cuenta siempre desde que llegó (no desde la reapertura); el plazo es lo que usa la reapertura |
| `plazo` | `{ tipo, estado, venceEn, horasRestantes }`. Caso abierto: `tipo: "atencion"` (`PLAZO_ATENCION_DIAS` desde que llega o, si se reabrió, **desde su última reapertura** `reapertura.reabiertoEn`: un reabierto hace 1 día queda con ~2 días) y `estado` `en-plazo`, `por-vencer` (quedan `PLAZO_AVISO_HORAS` o menos) o `vencido`. Caso resuelto: `tipo: "vigencia"` (`VIGENCIA_RESOLUCION_DIAS` desde que se resuelve), `en-plazo` o `vencido`. Archivado: todo `null`. Las horas pueden ser negativas si ya venció |
| `acciones` | Acciones que **esta persona** puede ejecutar ahora: `confirmar`, `corregir`, `derivar`, `tomar`, `resolver`, `archivar`, `reabrir` |
| `etiquetas`, `prioridad`, `organismo` | Aún no existen en la base: `[]`, `null` y `null`. No se inventan datos |

El detalle agrega:

- `descripcion`.
- `resolucion`: `null` mientras no se resuelve, o `{ medidasTomadas, fundamento, resultado }` con `resultado` `ATENDIDO` o `CERRADO`.
- `archivo`: `null` si no está archivado, o `{ motivo, detalle, archivadoEn }` con `motivo` `DATOS_INSUFICIENTES`, `NO_CORRESPONDE`, `VENCIDA_SIN_ATENDER` o `RESUELTA_VIGENCIA`; `detalle` es la justificación de la persona y es `null` si lo archivó el sistema.
- `reapertura`: `null` si nunca se reabrió, o `{ reabiertoEn, motivo }` de la **última** reapertura (se conserva aunque el caso se archive o resuelva de nuevo).
- `reclamante`: nombre abreviado y solo los últimos 4 dígitos del documento (`Luis A. · DNI ••••1907`); `Anónimo` si el reporte lo es.
- `evidencias`: `{ nombre, tipo, fecha, sensible, verificada }`. **Solo metadatos**: nunca la ruta, el id de Meta ni el contenido. `sensible` es verdadero en las de corrupción; `verificada` cuando ya hay huella SHA-256 del archivo.
- `historial`: `{ titulo, detalle, hora, fecha }` por cada hito (recibido, clasificado por la IA, categoría confirmada o corregida, derivado, tomado, resuelto, archivado, reabierto), con el **nombre** de quien actuó. Nunca copia el relato, el documento ni el correo.

**Qué ve cada rol.** Un caso es visible si su categoría está entre las de algún rol **activo** de la persona (`gestion.rol_categoria`) o, si aún no tiene categoría, si algún rol los ve (solo el administrador) **y**, para los roles ligados a un área (`GESTOR`, `OTRANS`, `ESTABLECIMIENTO`; `gestion.rol.tipo_area_id`), el caso está destinado a **su** área (`area_destino_id` igual a la suya, también cuando está archivado). El administrador no tiene área y no se filtra por ella. Con varios roles se une. Un caso que la persona no ve (de otra área, aún sin derivar para un establecimiento, o de una categoría que su rol no ve) responde `404`, igual que uno que no existe. Las denuncias por corrupción **nunca** las ve un establecimiento: además de `rol_categoria` se comprueba `catalogo.categoria_incidencia.es_sensible` en la misma consulta, que alimenta también la lista, el detalle, las acciones y los conteos de la campana.

**Qué puede hacer cada rol** (`src/constants/permisos-por-rol.ts`; con varios roles se unen las acciones, y cada regla vale solo para su categoría):

| Rol | Ve | Acciones |
|---|---|---|
| `ADMINISTRADOR` | Todo, de cualquier área y categoría (también los casos sin categoría) | `confirmar` y `corregir` en `clasificado` sin revisar; `derivar` en `clasificado` ya revisado; `archivar` en `clasificado`, `derivado` y `en-gestion`; `reabrir` en `archivado`. **No** `tomar` ni `resolver`: ese trabajo lo hace el área |
| `GESTOR` y `ESTABLECIMIENTO` (mismas capacidades, más `derivar` solo el gestor) | Queja, reclamo y otro destinados al área de **su** establecimiento (nunca corrupción) | `confirmar` y `corregir` (a queja, reclamo, otro o corrupción) en `clasificado` sin revisar; solo el gestor: `derivar` en `clasificado` ya revisado, a otro establecimiento; `tomar` en `clasificado` ya revisado y en `derivado`; `resolver` en `derivado` y `en-gestion`; `archivar` en `clasificado`, `derivado` y `en-gestion`; `reabrir` en `archivado`. El responsable del establecimiento **no deriva** |
| `OTRANS` | Solo corrupción destinada a `OTRANS` | `confirmar` y `corregir` en `clasificado` sin revisar; `derivar` en `clasificado` ya revisado; `tomar` directo desde `clasificado` ya revisado y en `derivado`; `resolver` en `derivado` y `en-gestion`; `archivar` en `clasificado`, `derivado` y `en-gestion`; `reabrir` en `archivado` |

El `GESTOR` ya no es global: pertenece siempre a un establecimiento y solo ve los casos de su área (lista los establecimientos solo para elegir el destino al derivar).

**Invariante: la corrupción nunca queda en un establecimiento.** Ninguna regla de acción del establecimiento ni del gestor cubre un caso de corrupción, la consulta de visibilidad lo oculta (`es_sensible`, además de `rol_categoria`) y todas sus rutas responden `404`. La única relación que tienen con ella es reclasificar hacia corrupción al corregir (arriba). La automatización y la IA nunca derivan corrupción a un establecimiento: `derivar` valida el tipo de área del destino.

**Filtro de corrupción (v1, aún no conectado): ante la duda, OTRANS.** Cuando se conecte, cualquier señal de corrupción, incluso con certeza baja, debe enviar el caso a revisión de OTRANS y nunca a un establecimiento. Este backend no lo conecta todavía. Quien tiene `ESTABLECIMIENTO` además gestiona los usuarios de su establecimiento (ver [Usuarios por establecimiento](#usuarios-por-establecimiento)).

**Errores.** `401` sin sesión; `403` si la persona no tiene la vista o la acción no le corresponde en el estado actual del caso (el cálculo es el mismo de `acciones`); `404` si el código no existe o la persona no lo ve; `400` si la consulta o el cuerpo no son válidos; `422` si la categoría nueva es igual a la actual, si el destino de la derivación no sirve (sin destino, área inexistente, desactivada o de un tipo que no recibe el caso; también si la base rechaza el área, p. ej. una corrupción hacia un establecimiento) o si la base rechaza un texto por corto; `409` si la base rechaza el cambio por una regla (ya se corrigió una vez, ya se confirmó, transición no permitida, establecimiento de origen inmutable, motivo de archivo, un archivado por vigencia que no se reabre), por ejemplo cuando dos personas actúan a la vez: el servicio bloquea el caso (`FOR UPDATE`) y la base sigue siendo la última barrera. El mensaje de la base nunca se repite tal cual (`src/database/reglas-de-la-base.ts` lo traduce). Las marcas `derivado_*`, `tomado_*`, `archivado_en` y `reabierto_*` las llena la base con el actor declarado: esta API no las envía.

**Cada acción firma a quien la hace.** Corre en una transacción con el actor `usuario:{correo}` y la base llena quién y cuándo (`categoria_corregida_por`, `categoria_confirmada_por`, `resuelto_por`, historial). Confirmar y corregir copian el caso a `ia.entrenamiento_categoria`; archivar a mano la marca no apta (`apto_entrenamiento = false`) y reabrir la vuelve a marcar apta. El archivado por vencimiento **no** lo dispara este servicio todavía. El plazo de atención de un caso reabierto cuenta desde la reapertura (`reabierto_en`) en la base, en el campo `plazo` y en la campana, y un reabierto tiene otros `PLAZO_ATENCION_DIAS` antes de archivarse por vencimiento.

## Usuarios por establecimiento

Piden sesión y la vista `USUARIOS` (solo `ADMINISTRADOR` y `ESTABLECIMIENTO`; el gestor y OTRANS reciben `403`). Qué puede hacer cada rol sale de la tabla de permisos (`usuarios` en `src/constants/permisos-por-rol.ts`).

| Ruta | Qué hace |
|---|---|
| `GET /usuarios` | Query: `q` (sin tildes ni mayúsculas, sobre el nombre o el correo, máximo 100), `area` (código del área; solo lo respeta el administrador), `limite` (50 por defecto, máximo 200) y `cursor` (opaco, keyset por nombre e id). Responde `{ items, siguiente, hayMas }` con `items: [{ id, nombreCompleto, correo, rol, activo, area }]` (`area` es `{ codigo, nombre }` o `null`; los desactivados también salen, con `activo: false`). Sin total. Un cursor inválido responde `400` |
| `POST /usuarios` | Cuerpo `{ "nombreCompleto", "correo", "rol", "area"? }`. Responde `201 { usuario, claveInicial }` |
| `PATCH /usuarios/:id` | Cuerpo con al menos uno de `{ "nombreCompleto"?, "rol"?, "activo"?, "area"? }`. Responde `200 { usuario }`. Desactivar es `activo: false`: **nunca se borra** |
| `POST /usuarios/:id/restablecer-clave` | Sin cuerpo. Responde `200 { usuario, claveInicial }` |

**Reglas**

- **Responsable del establecimiento (`ESTABLECIMIENTO`)**: solo ve, crea, edita, desactiva y restablece la clave de usuarios de **su** establecimiento. El área de un usuario nuevo **sale siempre de su sesión**: cualquier `area` del cuerpo se ignora. Solo asigna los roles `GESTOR` o `ESTABLECIMIENTO` (otro rol responde `403`). Un usuario de otra área, de OTRANS o un administrador responde `404`, igual que uno que no existe. No cambia el área de nadie (`403`; reenviar la que ya tiene no hace nada).
- **`ADMINISTRADOR`**: gestiona usuarios de cualquier área y asigna cualquier rol vigente (`DIRIS` está desactivado). `area` (su código) es obligatoria para `GESTOR`, `ESTABLECIMIENTO` y `OTRANS`, y está prohibida para `ADMINISTRADOR` (`422`). Solo él cambia el área de un usuario; al pasar a administrador se le quita el área.
- **Nadie cambia su propio rol ni se desactiva a sí mismo**: `409 AUTOEDICION_NO_PERMITIDA` (también el administrador).
- **Sesiones**: desactivar o cambiar el área cierran las sesiones del usuario (lo hacen los disparadores de la base; la API no lo duplica). Cambiar el rol y restablecer la clave las cierran desde la API.
- **El correo** se guarda sin espacios y en minúsculas. El nombre lleva de 3 a 120 caracteres.
- **Auditoría**: quien crea o cambia queda como actor (`usuario:{correo}`) en `usuario_creacion`, `usuario_modificacion` y `eliminado_por`.

**Errores con código estable** (el cliente decide por `errorCode`): `409 LIMITE_USUARIOS_ESTABLECIMIENTO` (tope de **3 usuarios activos por establecimiento**, de cualquier rol, también para el administrador y al reactivar o mover a alguien; lo hace cumplir la base y aquí se traduce), `409 CORREO_REPETIDO` y `409 AUTOEDICION_NO_PERMITIDA`; además `400` (cuerpo inválido), `403`, `404` y `422` (área obligatoria, prohibida, inexistente, desactivada o de un tipo que no corresponde al rol).

**La clave inicial** (`claveInicial`) la **genera el sistema**: 20 caracteres aleatorios con `crypto.randomInt`, sin caracteres ambiguos (`0 O 1 l I`). Se devuelve **una sola vez**, en la respuesta de crear y de restablecer, con `Cache-Control: no-store`; no hay forma de consultarla después. En la base solo queda su huella Argon2id (la del hasher de siempre). **Nunca** pasa por los logs (el cuerpo de las peticiones no se registra y el logger oculta `claveInicial`, `password`, las huellas y el detalle de los errores de la base), la auditoría de casos ni los mensajes de error. Quien crea el usuario debe entregársela por un canal seguro. **No hay cambio obligatorio de clave en el primer ingreso**: queda como mejora futura (junto con la pantalla de cambio de clave).

### Crear el primer administrador

Nadie puede iniciar sesión hasta que exista un usuario, y la migración no los crea. El primer administrador se crea con un comando aparte, con la base ya migrada. En Docker:

```bash
docker compose run --rm \
  -e ADMIN_NOMBRE="Nombre Apellido" \
  -e ADMIN_CORREO="persona@minsa.gob.pe" \
  -e ADMIN_PASSWORD="una-clave-de-12-o-mas-caracteres" \
  minsa-incidencias-backend node dist/scripts/crear-admin.js
```

Opcionalmente `-e ADMIN_AREA="OTRANS"` (o `EESS-6206`) le da un área por su código (debe existir y estar activa; la compatibilidad rol-área la verifica el disparador de la base). Guarda la huella Argon2id (nunca la clave), asigna el rol `ADMINISTRADOR` y firma con el actor `sistema:crear-admin`. Rechaza un correo repetido y una clave de menos de 12 caracteres. La clave queda en el historial de tu terminal: úsalo solo para el primer acceso y cámbiala cuando exista esa pantalla.

## Filtro de corrupción por reglas (`reglas-corrupcion-v1.3`)

Función pura, sin IA, sin base de datos y sin red (`src/services/filtro-corrupcion/`), pensada para correr en el backend y para que la reutilice después el bot: `evaluarTextoCorrupcion(texto, contexto?)`. **Solo propone**: la persona siempre confirma o corrige la categoría, y el filtro nunca asigna destino (la corrupción sigue yendo a OTRANS por la base). Aún **no está conectado** a la creación ni a la confirmación de casos: guardar la propuesta en `chatbot.incidencia_analisis` (`senales`, `categoria_confianza`, `version_clasificador`) espera la migración del repo del bot.

- **Entrada:** el texto (desde 20 caracteres con `trim`; menos devuelve `aplica: false` y el faltante `DATOS_INSUFICIENTES`) y, opcionalmente, `{ entidades, establecimientoConocido, tieneArchivos }`. `entidades` es el catálogo contra el que se compara el texto (`{ codigo, nombre, alias? }`); **sin él se usa el catálogo oficial** (37 entidades y sus titulares, generado en `src/services/filtro-corrupcion/catalogo-entidades.data.ts`) y `[]` desactiva la detección de entidad.
- **Cómo puntúa:** normaliza (minúsculas, sin tildes ni signos, sin montos), busca frases como secuencias de palabras y suma: fuerte +3, media +2, débil +1, cargo +1, entidad del catálogo +1, **nombre del titular +2** (`PUNTOS_NOMBRE_TITULAR`), **ubicación +1** (`PUNTOS_UBICACION`), negativa decisiva −2, negativa leve −1 (cada una cuenta una vez; las negativas, una por tipo). El aporte total de **identidad** (cargo + entidad + nombre + ubicación) tiene un tope de 4 (`TOPE_PUNTOS_IDENTIDAD`). **4 o más: alta; 2 o 3: media; 0 o 1: baja (no corrupción).** Sin al menos una señal fuerte, media o débil nunca se propone corrupción por las reglas, aunque el cargo y la entidad sumen (la vía de la identidad exige un indicio, ver abajo). "denuncia", "abuso", "cobro" y "pago" nunca son señal.
- **Salida:** `{ aplica, puntaje, certeza, propuestaCorrupcion, origenPropuesta, senales: [{ frase, tipo, peso }], actor, nombreMencionado, entidad, identidad, titular, faltantes, requiereOtrans, referenciaDerivacion, requiereSegundaOpinion, senalSensible, categoriaSugerida, escalarAOtrans, versionReglas }`. Campos aditivos de la v1.3: `origenPropuesta` (`"REGLAS"`, `"IDENTIDAD"` o `null` sin propuesta) e `identidad: { puntos, entidad, viaEntidad, titular, nombreCoincide, ubicacion }` (ver «Identidad»); `entidad` ahora también sale cuando el texto solo nombra al titular del catálogo. Campos aditivos de la v1.2: `requiereSegundaOpinion` (zona gris, ver abajo), `senalSensible` (`"ACOSO"` o `null`), `categoriaSugerida` (`"RECLAMO"` o `null`) y `escalarAOtrans` (booleano). Campos de la v1.1: `entidad` es `null` o `{ codigo, nombre, tipo }` (`tipo` solo es `null` si el catálogo recibido no lo trae); `titular` es `null` o `{ cargo, esEquivalenteDelMaximo, nombreCoincide }` y solo sale si el cargo es el máximo (director general, director ejecutivo, director del hospital o de la DIRIS, jefe institucional, jefe del SIS, superintendente, presidente ejecutivo, coordinador general, ministro); `esEquivalenteDelMaximo` es `true` si el título no es «director general» ni «jefe institucional»; `nombreCoincide` dice si el texto nombra al titular que el catálogo registra para la entidad detectada, y **solo informa**: nunca cambia puntaje, certeza ni categoría. `requiereOtrans` es `true` solo si se propone corrupción (siempre pasa por la OTRANS; la base lo hace cumplir) y `referenciaDerivacion` es `null` o `{ codigoEntidad, contactosDisponibles: ["OCI" | "SECRETARIA_TECNICA_PAD" | "INTEGRIDAD" | "PROCURADOR"], destinoSiTitular: { texto, entidadDestinoCodigo } | null, aplicaAlTitular }` (solo si se propone corrupción y la entidad está en el catálogo; la ficha completa es otra fase). `destinoSiTitular` es a dónde va la denuncia contra el titular según la lista oficial (`texto` tal cual de la fuente, p. ej. «SIS (…)», «ST PAD MINSA (…)», «DIRIS LIMA ESTE (…)»; `entidadDestinoCodigo` es el `codigo` de la entidad del catálogo a la que apunta: `sis`, `st-pad-minsa` para ST PAD MINSA (código de destino especial: no es una entidad del catálogo; el generador lo admite aparte), `diris-le`/`diris-ln`/`diris-lc`/`diris-ls`, o `null` si el destino no es una entidad, como en el MINSA); es `null` si la fuente no trae destino para esa entidad (no se inventa). `aplicaAlTitular` es `true` cuando el texto menciona la entidad **y** el cargo máximo (`titular` detectado) y hay destino; `false` si solo se mencionó la entidad (el destino se informa igual) o no hay destino. Una entidad sin contactos en los directorios (`SIN_CONTACTOS`: FISSAL, INEN, H. de Huaycán, HEJCU, HJATCH, HONADOMANI SB) sigue reportando el hueco, pero trae destino. `nombreMencionado` es solo informativo (una acusación sin comprobar): no suma ni decide. `faltantes` (`AUTOR_O_CARGO`, `ENTIDAD`, `PRUEBAS`) sale de la sección 3c del plan de cierre y solo se calcula si se propone corrupción.
- **Patrones de cobro (v1.2):** además de las frases fijas, `lexico-cobro.ts` combina piezas: verbo de cobro (pide, cobra, exige, solicita, condiciona, "me sacaron"...) × objeto (plata, dinero, monto, cuota, propina, "algo", gaseosa, "un billete"...) × complemento ("por/para" atender, firmar, aprobar, dar la cita/cama, operar, acelerar, "para que...", "para no..."), en primera, segunda y tercera persona. Con servicio nombrado pesa como señal fuerte; sin servicio, como media. También: "cobra por las camas" (cobrar por algo que no se vende), recibir sobres, porcentajes o dinero de proveedores, "se quedan con", "se los echó al bolsillo", "bajo la mesa", "mordida", "caerle con un detallito", "ponerse con", "le pagan para que firme", colar y pasar por encima de la cola, apropiación de medicinas, insumos, combustible y vales (equipos y ambulancias solo suman un poco), nepotismo (colocar a un pariente) y el negocio de un pariente. Las plantillas usan **clases de palabras** (`@verbo_cobro`, `@complemento`... en `clases-lexico.ts`) y el normalizador deja `monto` donde había un importe ("50 soles"), que las frases que no lo nombran saltan. Estos patrones son **negables**: "no me pidió plata", "nadie me cobró", "no nos pidieron un sol", "sin cobro" no cuentan (y restan, como negativa decisiva); "tarifa oficial" y "me dieron boleta" siguen restando. Las frases de una misma familia que se pisan cuentan una sola vez (la de más puntos).
- **Identidad (v1.3):** lo que más pesa son los nombres, la ubicación y las entidades. `identidad.puntos` suma entidad nombrada (+1, por nombre oficial, sigla, alias o alias derivado) + titular o jefatura (+1: cargo máximo detectado o una palabra de jefatura, el criterio de la zona gris) + **nombre del titular** (+2) + **ubicación** (+1), con tope 4. El **nombre del titular** del catálogo (al menos dos palabras seguidas del nombre, una de ellas apellido, sin importar el orden: «Yong Motta Eduardo») **identifica la entidad aunque el texto no la nombre** (`entidad` la devuelve; `identidad.viaEntidad` es `NOMBRE_TITULAR`); un nombre de pila suelto, dos nombres de pila o un nombre ficticio parecido no coinciden, y si el texto nombra otra entidad gana esa. La **ubicación** (tabla aproximada `ia-poc/datos/ubicaciones-entidades.json`: Huaycán, Chosica, Vitarte, Surquillo, Miraflores, Santa Anita...) suma solo si el texto no nombra ninguna entidad, no se acumula con ella, no identifica por sí sola un cargo y **no define `entidad`**; las zonas que también son el establecimiento del QR (Chosica) no suman si `establecimientoConocido` es `true`.
- **Propuesta por identidad (v1.3):** si `identidad.puntos` ≥ 2 (`PUNTOS_IDENTIDAD_PARA_OTRANS`) y hay **algún indicio** (una señal fuerte, media o débil del léxico, o un verbo de cobro que nadie niega) pero las reglas no llegaron a su umbral, se propone corrupción con `certeza: "BAJA"`, `origenPropuesta: "IDENTIDAD"` y `requiereOtrans: true`, para que la persona de OTRANS la corrija. **Sin ningún indicio la identidad sola no propone** (las quejas contra un hospital siguen yendo al establecimiento), y una negativa decisiva (boleta, recibo, tarifario, pago en caja) gana sobre esta vía.
- **Zona gris (v1.2):** si el texto nombra una **entidad del catálogo** y a su **titular o un cargo de jefatura** (director, jefe, administrador, ministro...) junto a un **verbo de cobro** que nadie niega, y las reglas no lo confirman, `requiereSegundaOpinion` es `true`. Desde la v1.3 ese mismo caso, si no hay una negativa decisiva, además se propone por identidad (certeza baja, a OTRANS) y conserva la marca de segunda opinión del modelo (ver `combinarReglasConIa` y `ia-poc/README.md`).
- **Acoso (v1.2):** un grupo pequeño de señales de acoso, hostigamiento y tocamientos ("me acosó", "me tocó la pierna", "propuestas indecentes"...) va **aparte** del puntaje de corrupción: añade `senalSensible: "ACOSO"` y `categoriaSugerida: "RECLAMO"` (decide una persona), y `escalarAOtrans: true` si el acusado es un cargo mayor (director, jefe, administrador, titular o equivalente). Hoy solo **marca**: OTRANS solo ve casos de categoría corrupción, así que falta una regla de enrutamiento para que lo vea.
- **Combinación con el modelo (v1.2):** `combinarReglasConIa(resultado, pesoIa | null)` (mismo módulo): el modelo no decide; su peso (entero de 0 a `PESO_MAXIMO_IA` = 10) se suma al puntaje y el total debe superar `UMBRAL_TOTAL_CORRUPCION` (5, a calibrar) para proponer corrupción; puede subir un caso pero nunca bajar uno que las reglas ya propusieron; sin modelo y con zona gris devuelve `revisionOtrans: true`; la confianza se deriva del acuerdo y nunca pasa de 95. Contrato del peso en `ia-poc/README.md`.
- **Evaluación:** `npx tsx ia-poc/scripts/evaluar-reglas.ts ia-poc/evaluacion/desarrollo.jsonl` (ver `ia-poc/evaluacion/README.md`). Con 100 mensajes de desarrollo, el recall de corrupción pasó de 3,3 % (v1.1) a 81,7 % (v1.2) y 83,3 % (v1.3), y la precisión de 50 % a 98 % y 96,2 % (el léxico se ajustó mirando esos mensajes: cifras optimistas); con los 200 de `prueba-t1`, sin tocarlos, el recall pasó de 17,2 % a 41,4 % (v1.2) y 44,8 % (v1.3), y la precisión de 62,5 % a 70,6 % y 72,2 %. La entidad etiquetada se detecta en 82 de 99 mensajes de desarrollo (36 con la v1.2). Detalle y falsos positivos en la nota del vault «Plan de PoC de IA», secciones 14 y 17.
- **Entidad (ambigüedades):** se buscan el nombre oficial y los alias como secuencias de palabras completas ("SIS" no calza en "crisis" ni en "sistema"). "Ministerio" suelto no es el MINSA: solo "Ministerio de Salud" o "MINSA". "DIRIS" a secas y "DIRIS LE" (el "le" es un pronombre) no eligen entidad: se usa "DIRIS Lima Este". Si el texto solo dice "Instituto Nacional de Salud del Niño" (sin Breña ni San Borja) o "Instituto Nacional de Salud Mental" sin completar, no se elige ninguna, porque el nombre del INS es el comienzo de los otros. Con varias entidades gana la primera que se menciona. Los alias a mano están en `ia-poc/datos/alias-entidades.json`. **Alias derivados (v1.3):** `aliasDerivados` de cada entidad (los genera el script, no se editan) trae el nombre sin «Hospital»/«Nacional»/«de», el apellido suelto («loayza», «ulloa», «baldizan», «fisal»), el artículo («el dos de mayo», «del heredia») y las faltas de ortografía más frecuentes (v/b, ll/y, y/i, s/z/c, h muda: «loaiza», «hermilio baldizan», «huaican»). Una palabra común o corta no elige entidad sola (sin «ate», «lima», «san», «hh», «sis» dentro de otra palabra), los topónimos son ubicación y no alias, y si dos entidades compartieran un alias derivado no se elige ninguna: queda en `ia-poc/datos/alias-ambiguos.json` junto con las ambigüedades por diseño («diris» a secas, «lima este», «instituto del niño»).
- **Regenerar el catálogo:** `node ia-poc/scripts/generar-catalogo.mjs [ruta-a-la-nota.md]` lee las secciones 1 (incluida la columna «Destino si la denuncia es contra el titular», copia de la columna homónima de la hoja `Hoja2` del Excel `LISTA ENTIDADES - denuncias contra titulares`) y 2 de la nota del vault y reescribe `catalogo-entidades.data.ts` y `ubicaciones-entidades.data.ts` (no se editan a mano; el segundo sale de `ia-poc/datos/ubicaciones-entidades.json`, escrito a mano y marcado como aproximado) y `ia-poc/datos/alias-ambiguos.json`. Un destino que no reconoce (nuevo prefijo) detiene el generador: se agrega en `DESTINOS_TITULAR` del script; un destino que no es una entidad del catálogo (hoy solo `st-pad-minsa`) se declara además en `DESTINOS_ESPECIALES`. Los nombres de titulares rotan y solo se comparan como señal informativa.
- **Léxico:** datos en `lexico.ts` y `lexico-cobro.ts`, pesos y umbrales en `src/constants/filtro-corrupcion.ts`. Es un borrador por validar con el área usuaria y mensajes reales. Al cambiar una frase, un peso o el catálogo, sube la versión (`VERSION_REGLAS_CORRUPCION`).
- **Probarlo:** `POST /filtro-corrupcion/evaluar` con `{ "texto": "...", "entidades": [...], "establecimientoConocido": false, "tieneArchivos": false, "pesoIa": 6 }` (`texto` máximo 5000; todo menos `texto` es opcional; con `pesoIa`, un número o `null` si el modelo no estuvo disponible, la respuesta agrega `combinacion: { propuestaCorrupcion, puntajeReglas, pesoIa, puntajeTotal, umbral, subidaPorIa, acuerdo, confianza, requiereOtrans, revisionOtrans, requiereRevisionHumana }`). Ejemplo: `{ "texto": "La jefa del SIS me pidió plata para atenderme" }` responde `entidad: { codigo: "sis", nombre: "Seguro Integral de Salud", tipo: "SIS" }`, `titular: { cargo: "jefa del sis", esEquivalenteDelMaximo: true, nombreCoincide: false }`, `requiereOtrans: true` y `referenciaDerivacion: { codigoEntidad: "sis", contactosDisponibles: ["OCI", "PROCURADOR"], destinoSiTitular: { texto: "ST PAD MINSA (Secretaría Técnica del Procedimiento Administrativo Disciplinario del MINSA)", entidadDestinoCodigo: "st-pad-minsa" }, aplicaAlTitular: true }`. Solo lectura: no toca la base ni guarda ni registra el texto. Piden sesión con rol `ADMINISTRADOR`, `GESTOR` u `OTRANS` (`403` para los demás). Responde `200` con el resultado de arriba.

## Análisis con IA local (PoC, `src/services/analisis-ia/`)

Módulo aparte del filtro: **reglas primero, modelo después**. No toca el registro de incidencias ni el bot, no escribe en la base y no registra textos. Todo corre en `localhost` (Ollama, modelo `qwen3.5-9b-local`): los datos no salen de la máquina.

- **`analizarMensaje(texto, contexto?, opciones?)`** (`analizar-mensaje.ts`): corre las reglas (`evaluarTextoCorrupcion`); si el texto aplica (desde 20 caracteres) consulta al modelo con la variante elegida; suma el `peso_corrupcion` al puntaje con `combinarReglasConIa`. Devuelve un paquete: `propuesta` (corrupción si la combinación lo propone; si no, acoso → Reclamo, o la categoría del modelo; **empate queja/reclamo → Reclamo con revisión humana**; OTRO si no hay datos ni modelo), `confianza` (siempre < 100, tope 95), `pesoIa`, `explicacion`, `fundamentos` (señales de las reglas y del modelo), `informacionFaltante`, `fichaDerivacion` (la `referenciaDerivacion` del filtro, con `destinoSiTitular`), `degradado`/`motivoDegradado`, `requiereOtrans`, `revisionOtrans`, `requiereRevisionHumana`, `escalarAOtrans` (acoso contra un cargo mayor; solo se marca), más `reglas`, `combinacion`, `salidaModelo` y `metricas`. Si el modelo ve corrupción pero la suma no alcanza el umbral, no baja nada: queda Reclamo con `revisionOtrans` (ante la duda, OTRANS). La IA no asigna área ni destino.
- **Salida del modelo** (`esquema-salida.ts`, Zod + el mismo esquema como JSON Schema para el campo `format` de Ollama): `categoria`, `peso_corrupcion` (entero 0 a 10; fuera de rango se recorta), `posible_corrupcion`, `alternativas` [{categoria, probabilidad}], `senales` [{frase, tipo}], `actor` {cargo, nombre_mencionado}, `informacion_faltante` (`hecho_detallado`, `autor_o_cargo`, `entidad_o_unidad`, `pruebas`) y `explicacion`.
- **Variantes** (`prompts.ts`; el prompt del sistema es constante por variante, para aprovechar el caché del prefijo de Ollama): **V1** rol, definiciones, reglas duras y anclas del peso; **V2** V1 + señales de las reglas y entidad/titular como pistas ("no son órdenes; ante la duda marca `posible_corrupcion`"); **V3** V2 + 16 ejemplos resueltos (10 de la tabla de casos límite del léxico y 6 inventados; incluyen pagos con boleta y quejas con la palabra «denuncia»). **V2C** (V2 con **salida compacta**): los mismos bloques que V2, pero el modelo escribe solo un JSON con `categoria`, `peso_corrupcion` y `posible_corrupcion` (~38 tokens en vez de ~215) y el prompt no lleva las reglas duras que hablaban de `informacion_faltante` y `alternativas`; el esquema compacto (Zod y JSON Schema con `enum` de categorías y entero 0 a 10) y el tope `num_predict` de 80 (`NUM_PREDICT_SALIDA_COMPACTA`) van en el cliente, y un JSON cortado o inválido sigue el reintento y el degradado de siempre. **V4 (RAG con fragmentos de normas) no está implementada**: queda documentada como hueco en `prompts.ts`.
- **Paquete de V2C sin depender del modelo** (`plantillas-paquete.ts`, funciones puras): `explicacion` por plantilla en español (puntaje y señales de las reglas, entidad y titular o cargo detectados, y lo que propone el modelo: categoría, peso y marca; además por qué se propone OTRANS o no; no cita nada que no esté en las reglas ni en los tres campos del modelo), `informacionFaltante` desde los faltantes que calcula el filtro (`hecho_detallado`, `autor_o_cargo`, `entidad_o_unidad`, `pruebas`), `fundamentos` con las señales de las reglas y `fichaDerivacion` como siempre. **Pérdida conocida:** sin `alternativas` ya no se detecta el empate queja/reclamo del modelo; el paquete lo registra con `sinDesempateQuejaReclamo: true` (el resto del contrato, incluido `requiereRevisionHumana`, no cambia) y la propuesta sigue siendo de una persona.
- **V2R: RAG de casos revisados con `pg_trgm` (fase 2, `casos/`)**: V2C más los casos parecidos que una persona ya revisó, recuperados con la similitud de trigramas de PostgreSQL (`similarity()` sobre `unaccent`, solo SELECT) de `ia.entrenamiento_categoria` (filas con `apto_entrenamiento`), como ejemplos en el mensaje del usuario. Parámetros en `src/constants/casos-similares.ts`: 3 ejemplos, similitud mínima 0,15 y **descarte de todo caso casi duplicado (similitud de 0,50 o más)**. El modelo sigue sin decidir: da su peso de 0 a 10, que se suma al de las reglas, y la salida es la compacta de V2C (~38 tokens). Sin recuperador (o si la base falla) corre sin ejemplos y sin degradar; el paquete trae `casosSimilares` (id, categoría y similitud, sin el texto) y `casiDuplicadosDescartados`. El endpoint `POST /ia-poc/analizar` le pasa el recuperador (solo lectura). **Resultado: «Sin mejora clara», se mantiene V2C** (ver `ia-poc/README.md` y la sección 25 de la nota del plan); V2C no cambió. Sin migración ni pgvector.
- **Trazabilidad con la norma (RAG, fase 1)** (`normas/`, funciones puras; `trazabilidadNormas` en el paquete de todas las variantes): fragmentos con texto literal de la **Directiva N° 002-2023-PCM-SIP (Anexo C, 20 supuestos: 5 faltas, 6 inconductas funcionales y 9 delitos)** y de la **ayuda memoria de OTRANS**, en `ia-poc/datos/fragmentos-normas.json` (fuente de verdad; `node ia-poc/scripts/generar-normas.mjs` genera `normas/fragmentos-normas.data.ts`, con una prueba que verifica que coinciden). El **código** (no el modelo, así que V2C sigue en ~38 tokens) busca en las frases de las señales de las reglas las plantillas de `mapa-senal-fragmento.ts` y cita hasta 3 supuestos del Anexo C (por ejemplo, cobro o coima → cohecho pasivo; contratar a un pariente → nepotismo; vender medicinas del Estado → peculado); si se propone corrupción y ninguno coincide, dice `sinSupuestoIdentificado: true`. Además cita el procedimiento de OTRANS (definición, criterios, derivación, y el requisito que falta según los faltantes del filtro) y, si se propone queja o reclamo, que OTRANS los deriva. Toda cita lleva «Referencia orientativa; la califica OTRANS.». **El cohecho activo (III-a) nunca se cita** (lo comete quien paga). **La transcripción del Anexo C se hizo a ojo desde imágenes, sin OCR, y no está cotejada con el original** (`transcripcionAnexoCCotejada: false`). `construirSenalesDeAnalisis` (`senales-analisis.ts`) arma el contenido del jsonb `incidencia_analisis.senales` (señales, faltantes, ficha y las citas por id y referencia, sin el texto de las normas ni el del ciudadano); hoy nada escribe en esa tabla. Sin migración.
- **Cliente** (`cliente-ollama.ts`): `POST /api/chat` con `stream:false`, `think:false`, `keep_alive`, `format` y las opciones de `ia-poc/modelo/parametros.json` (temperatura 0, semilla 7, contexto 4096). Tiempo máximo 120 s (`TIEMPO_MAXIMO_MODELO_MS`); **un reintento** con el mismo prompt si el JSON no valida, hay error de red o 5xx (un tiempo agotado no se reintenta). **Nunca lanza**: devuelve `{ ok: false, motivo }` y el orquestador degrada a solo reglas (`degradado: true`, y con zona gris `revisionOtrans` por defecto). Devuelve tiempos y tokens.
- **Configuración:** constantes en `src/constants/analisis-ia.ts` (URL, modelo, tiempo máximo, reintentos, variante por defecto `V2`, margen de empate queja/reclamo 0,15, piso opcional del peso cuando el modelo marca `posible_corrupcion`); todo se puede pasar por parámetros.
- **Límites:** ~10 a 15 s por mensaje con el modelo caliente (~15 tokens por segundo; la primera llamada en frío tarda ~2 minutos: `node ia-poc/scripts/precalentar.mjs`); una sola GPU, un mensaje a la vez; el modelo se equivoca (ver resultados en `ia-poc/README.md` y la nota del vault); sin RAG; los conjuntos de evaluación son sintéticos con ~60 % de corrupción.
- **Endpoint de prueba:** `POST /ia-poc/analizar`, solo `ADMINISTRADOR`, **apagado por defecto**: con `IA_POC_HABILITADA=true` existe; sin ella responde `404`. Cuerpo `{ texto (máx. 5000), variante?: "V1"|"V2"|"V3"|"V2C"|"V2R", establecimiento? }` (con `establecimiento`, el filtro lo toma como conocido); responde `200` con el paquete. `401` sin sesión, `403` para otros roles, `400` si el cuerpo no valida. No guarda nada ni registra el texto.

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
| `SESSION_IDLE_MINUTES` | `30` | Minutos sin actividad tras los cuales la sesión deja de servir |
| `SESSION_ABSOLUTE_HOURS` | `8` | Horas máximas de una sesión, aunque haya actividad |
| `PLAZO_ATENCION_DIAS` | `3` | Días que tiene un caso para atenderse, contados **desde que llega**. Pasado el plazo, el caso se archiva solo |
| `VIGENCIA_RESOLUCION_DIAS` | `3` | Días que dura una resolución antes de archivarse sola, contados **desde que se resuelve** |
| `PLAZO_AVISO_HORAS` | `24` | Horas antes de vencer el plazo de atención desde las que un caso cuenta como "por vencer" |
| `IA_POC_HABILITADA` | `false` | `true` enciende `POST /ia-poc/analizar` (PoC de IA local, solo ADMINISTRADOR); apagada, la ruta responde 404 |
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
  constants/           Mensajes de error, límites (sin números mágicos) y permisos-por-rol (vistas de cada rol)
  database/            Puerto Database, adaptador PostgreSQL (pg) y actores de auditoría
  enums/               ErrorCode, HttpStatus, RolCodigo, VistaCodigo y los de incidencias (acción, categoría, estado, plazo, tipo de área)
  errors/app-error.ts  AppError (estado HTTP, código interno y mensaje)
  middleware/          cors, rate-limit, session (attachSession, requireSession, requireVista), error-handler
  repositories/        Acceso a la base: usuario, sesion, incidencia, area y usuario-gestion (consultas parametrizadas)
  services/            auth.service (login, sesión, cierre), administrador.service, incidencia.service (casos y acciones), area.service y usuario.service (usuarios por establecimiento)
                       y filtro-corrupcion/ (filtro por reglas, función pura) y analisis-ia/ (reglas + modelo local, PoC)
  routes/              salud, auth, incidencias, áreas, usuarios, filtro-corrupcion (evaluación de prueba) e ia-poc (análisis con IA, apagado por defecto)
  scripts/             crear-admin (primer administrador)
  types/               Ampliación de Request con la sesión actual
  utils/               token-bucket, session-cookie, password-hasher (Argon2id), vistas-de-roles, acciones-permitidas,
                       gestion-de-usuarios, clave-inicial, cursor-usuarios, plazo-incidencia, historial-incidencia, reclamante
  test-utils/          Ayudas de pruebas: base de pruebas con retroceso, usuarios y casos sintéticos (no entra al build)
```

Imports con el alias `@/` (apunta a `src/`); el build lo reescribe a rutas relativas con `tsc-alias`.

## Reglas

Las reglas del backend (capas, errores, cookies, CORS, límites) están en el vault de Obsidian, `Base de dato/Plataforma de gestión/Backend de gestión - Reglas v2.md`. Resumen de las que ya cumple el código:

- Un rol de base de datos propio; declarar el actor (`set_config('app.actor', ..., true)`) en cada transacción que escriba.
- Las reglas de negocio de la incidencia las hace cumplir la base, no este código.
- La cookie de sesión solo lleva un identificador opaco, firmado, `HttpOnly`, `SameSite=Strict`; se lee siempre con `readSessionId` y el estado vive en la base para poder revocarla. Nunca viajan roles ni el id del usuario.
- No registrar DNI, nombres, tokens ni texto de incidencias en los logs: cada petición solo registra id, método, ruta **sin query**, IP, estado y duración; nunca cabeceras, cookies ni el cuerpo. Las claves (`claveInicial`, `password`), las huellas y el detalle de un error de la base (`err.detail`, que puede copiar la fila rechazada) se ocultan además en el logger.
- Ningún secreto en el repositorio: el `.env` está ignorado y solo se versiona `.env.example`.

## Pruebas

```bash
npm test             # vitest + supertest
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
```

Las pruebas contra PostgreSQL real (`*.integration.test.ts`: base de datos y autenticación de punta a punta) se omiten salvo que definas `TEST_DATABASE_URL` con una base ya migrada por el repo del bot. **No dejan datos:** cada prueba corre dentro de una transacción que se revierte al final (la base impide borrar usuarios y sesiones, por eso no se limpian a mano):

```bash
TEST_DATABASE_URL=postgresql://USUARIO:CLAVE@HOST:5432/NOMBRE_DE_LA_BASE npm test
```

Las pruebas crean sus propios establecimientos y áreas (código RENIPRESS al azar) dentro de la transacción, así que no necesitan el padrón cargado. Por seguridad, esas pruebas **se niegan a correr** si el nombre de la base no termina en `_desechable`, `_dev` o `_local` (el mensaje de error nunca incluye la clave de la URL).

Las pruebas de incidencias **crean sus propios casos y usuarios sintéticos** dentro de la transacción (con las mismas operaciones que usa la aplicación, para que la base aplique sus reglas), así que no dependen de que la base tenga datos ni se ven afectadas por los que ya tenga. Solo exigen la base armada con las migraciones del repo del bot.

## Siguientes pasos

1. **Rol de base de datos propio** con permisos mínimos (lo crea OGTI) y `sslmode` hacia su servidor.
2. **Endurecimiento posterior** (no hace falta en la primera etapa): cabecera anti-CSRF propia, cambio de contraseña, prefijo `__Host-` de la cookie, rotación del `COOKIE_SECRET` y un límite adicional por IP más correo.
3. **Disparo de los archivados** (resueltas y vencidas) con `VIGENCIA_RESOLUCION_DIAS` y `PLAZO_ATENCION_DIAS`: todavía no lo dispara este servicio.
4. Indicadores, entrenamiento de la IA y portal de carga (fases siguientes, sobre vistas SQL del repo del bot).

## Documentación relacionada

El diseño y las decisiones de la plataforma están en el vault de Obsidian, carpeta `Base de dato/Plataforma de gestión/`. El frontend hermano es `minsa-incidencias-frontend` y la base la define `minsa-citas-whatsapp-bot` (`prisma/`).
