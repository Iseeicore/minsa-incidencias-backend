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
| `GESTOR` (revisa y atiende los casos de su establecimiento) | el área de su establecimiento (`EESS-<renipress>`), siempre | `INICIO`, `CASOS`, `BANDEJAS`, `DERIVACIONES` (sin `QR` ni `USUARIOS`) |
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

- **Quién ve qué** (`veTodasLasAreas` en la tabla de permisos): solo `ADMINISTRADOR` (filtra por establecimiento y elige el destino al derivar) lista todas; `GESTOR`, `OTRANS` y `ESTABLECIMIENTO` solo ven **su propia área** (una sola; ninguna si no tienen área). El gestor ya no es global. Con varios roles basta que uno lo permita.
- Cada item trae su `codigo`: es el que se envía como `areaDestino` en `POST /incidencias/:codigo/derivar` (en un establecimiento, `EESS-<codigoRenipress>`). El `id` numérico es solo informativo.

## Incidencias (casos)

Cada caso se identifica por su **código legible** (`MINSA-AAAA-NNNNNN`, columna `codigo`, lo asigna la base). El `id` interno (UUID) y el `trace_id` del chat nunca salen de la API. Todas las rutas piden sesión y la vista `CASOS`, salvo `por-vencer`, que solo pide sesión (la campana de avisos).

| Ruta | Qué hace |
|---|---|
| `GET /incidencias` | Lista con **paginación por cursor** (keyset), del caso más reciente al más antiguo (`fecha_creacion` y `id`, descendente). Query: `limite` (20 por defecto, máximo 100), `cursor` (opaco: el `siguiente` de la respuesta anterior; sin él, empieza por lo más reciente), `estado`, `motivoArchivo` (`DATOS_INSUFICIENTES`, `NO_CORRESPONDE`, `VENCIDA_SIN_ATENDER` o `RESUELTA_VIGENCIA`; con `estado=archivado` es la **bandeja de archivados**, que cada área ve solo la suya por la misma visibilidad y el mismo cursor e índices), `categoria` (o `sin-categoria`) y `texto` (código o relato, búsqueda literal, máximo 100), y `establecimiento` (código RENIPRESS del establecimiento de origen; se quitan los ceros a la izquierda y debe quedar de 1 a 8 dígitos sin cero inicial, si no responde `400`; filtra por `establecimiento_id` con el índice `ix_incidencia_paciente_origen_fecha`, se combina con los demás filtros y con el cursor, y **nunca amplía** lo que el rol ya ve: un código sin casos visibles da lista vacía). Responde `{ items, siguiente, hayMas }`: `items` con el resumen de cada caso, `siguiente` el cursor de la página que sigue (`null` en la última) y `hayMas` si queda algo. **No hay total ni número de página** (con millones de casos un `COUNT(*)` y un `OFFSET` serían lentos) ni orden elegible. Un cursor que esta API no emitió responde `400`. Como el cursor es la posición del último caso entregado, un caso nuevo no mueve ni repite las páginas ya pedidas |
| `GET /incidencias/por-vencer` | La campana: `{ total, porVencer, vencidos, casos }`. Cuenta los casos abiertos cuyo plazo de atención vence dentro de `PLAZO_AVISO_HORAS` o ya venció, **y que a esa persona le toca atender** (los que cumplen alguna regla de acción de sus roles): el gestor y cada establecimiento cuentan lo abierto de su área (clasificado, derivado o en gestión), y OTRANS la corrupción abierta de su área. **El contador baja** cuando el caso se resuelve o se archiva. El administrador cuenta todos los abiertos que ve (`avisaTodoLoAbierto` en la tabla de permisos). `casos` trae hasta 10, los más antiguos primero |
| `GET /incidencias/:codigo` | Detalle: el resumen más `resolucion`, `archivo`, `reapertura`, `descripcion`, `reclamante`, `evidencias` e `historial` |
| `POST /incidencias/:codigo/confirmar` | Confirma la categoría de la IA (una sola vez) |
| `POST /incidencias/:codigo/corregir` | Cuerpo `{ "categoria": "denuncia-corrupcion" \| "queja" \| "reclamo" \| "otro" }`. Corrige la categoría (una sola vez, y nunca después de confirmar). El gestor y el responsable del establecimiento solo pueden elegir `queja`, `reclamo` u `otro` (otra categoría responde `403`); OTRANS y el administrador, cualquiera |
| `POST /incidencias/:codigo/derivar` | Solo OTRANS y el administrador. Cuerpo opcional `{ "areaDestino": "EESS-6206" }` (código del área). Pasa a `derivado` y fija el área de destino en la misma sentencia. Sin `areaDestino`, va al área del **establecimiento de origen** del caso (una denuncia por corrupción se queda en el área de OTRANS donde ya está). Debe ser un área **activa de tipo `ESTABLECIMIENTO`** (`OTRANS` si es corrupción); si no hay destino, o el área no sirve, responde `422` con un mensaje claro y el caso no cambia |
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
| `horasDesdeLlegada`, `horasDesdeResolucion` | Horas completas, con la hora de la base |
| `plazo` | `{ tipo, estado, venceEn, horasRestantes }`. Caso abierto: `tipo: "atencion"` (`PLAZO_ATENCION_DIAS` desde que llega) y `estado` `en-plazo`, `por-vencer` (quedan `PLAZO_AVISO_HORAS` o menos) o `vencido`. Caso resuelto: `tipo: "vigencia"` (`VIGENCIA_RESOLUCION_DIAS` desde que se resuelve), `en-plazo` o `vencido`. Archivado: todo `null`. Las horas pueden ser negativas si ya venció |
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
| `GESTOR` y `ESTABLECIMIENTO` (mismas capacidades) | Queja, reclamo y otro destinados al área de **su** establecimiento (nunca corrupción) | `confirmar` y `corregir` (solo a queja, reclamo u otro) en `clasificado` sin revisar; `tomar` en `clasificado` ya revisado y en `derivado`; `resolver` en `derivado` y `en-gestion`; `archivar` en `clasificado`, `derivado` y `en-gestion`; `reabrir` en `archivado`. **No derivan** |
| `OTRANS` | Solo corrupción destinada a `OTRANS` | `confirmar` y `corregir` en `clasificado` sin revisar; `derivar` en `clasificado` ya revisado; `tomar` directo desde `clasificado` ya revisado y en `derivado`; `resolver` en `derivado` y `en-gestion`; `archivar` en `clasificado`, `derivado` y `en-gestion`; `reabrir` en `archivado` |

El `GESTOR` ya no es global: pertenece siempre a un establecimiento y solo ve su área. Quien tiene `ESTABLECIMIENTO` además gestiona los usuarios de su establecimiento (ver [Usuarios por establecimiento](#usuarios-por-establecimiento)).

**Errores.** `401` sin sesión; `403` si la persona no tiene la vista o la acción no le corresponde en el estado actual del caso (el cálculo es el mismo de `acciones`); `404` si el código no existe o la persona no lo ve; `400` si la consulta o el cuerpo no son válidos; `422` si la categoría nueva es igual a la actual, si el destino de la derivación no sirve (sin destino, área inexistente, desactivada o de un tipo que no recibe el caso; también si la base rechaza el área, p. ej. una corrupción hacia un establecimiento) o si la base rechaza un texto por corto; `409` si la base rechaza el cambio por una regla (ya se corrigió una vez, ya se confirmó, transición no permitida, establecimiento de origen inmutable, motivo de archivo, un archivado por vigencia que no se reabre), por ejemplo cuando dos personas actúan a la vez: el servicio bloquea el caso (`FOR UPDATE`) y la base sigue siendo la última barrera. El mensaje de la base nunca se repite tal cual (`src/database/reglas-de-la-base.ts` lo traduce). Las marcas `derivado_*`, `tomado_*`, `archivado_en` y `reabierto_*` las llena la base con el actor declarado: esta API no las envía.

**Cada acción firma a quien la hace.** Corre en una transacción con el actor `usuario:{correo}` y la base llena quién y cuándo (`categoria_corregida_por`, `categoria_confirmada_por`, `resuelto_por`, historial). Confirmar y corregir copian el caso a `ia.entrenamiento_categoria`; archivar a mano la marca no apta (`apto_entrenamiento = false`) y reabrir la vuelve a marcar apta. El archivado por vencimiento **no** lo dispara este servicio todavía. Pendiente: el plazo de atención de un caso reabierto cuenta desde la reapertura en la base, pero el campo `plazo` y la campana aún lo calculan desde la llegada del caso.

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
  routes/              salud, auth, incidencias, áreas y usuarios
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
