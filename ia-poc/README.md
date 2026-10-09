# PoC local de IA

Prueba de concepto para clasificar incidencias con **reglas primero** (filtro de corrupción `reglas-corrupcion-v1.3`) y un **modelo local** como segunda opinión. No es producción ni se conecta al registro de incidencias. Plan completo en el vault: «Plan de PoC de IA - Reglas primero, modelo después y derivación a OTRANS».

## Modelo

- `modelo/Modelfile`: Qwen3.5 9B (Q4_K_M) importado a Ollama desde un GGUF local. Hay que poner la ruta real en `RUTA_AL_GGUF`.
- `modelo/parametros.json`: parámetros fijos de todas las pruebas (temperatura 0, semilla 7, contexto 4096, razonamiento desactivado, `keep_alive` de 30 minutos).
- `scripts/precalentar.mjs` (se corre con `node ia-poc/scripts/precalentar.mjs`) carga el modelo antes de una demostración.

## Catálogo de entidades

- `datos/alias-entidades.json`: alias y nombres cortos escritos a mano («el Ulloa», «el Dos de Mayo», «las Neoplásicas», «el Honadomani»...), las listas que gobiernan la derivación (`derivacion.palabrasComunes`, `soloConArticulo`, `omitirDerivacion`) y las ambigüedades conocidas (`ambiguosConocidos`). Los nombres oficiales y las siglas salen de la nota del vault.
- **Alias derivados (v1.3):** el generador deriva de cada hospital e instituto, sin frase por frase, el nombre sin «Hospital»/«Nacional»/«de», sus apellidos, el artículo («el»/«la»/«del»/«al», solo para lo que es fecha o apellido común: «el dos de mayo», «del heredia») y las faltas de ortografía de un cambio por palabra (v/b, ll/y, y/i, s/z/c, h muda): «loaiza», «hermilio baldizan», «huaican». De la sigla solo quita la letra doble («fissal» → «fisal»). Se guardan en `aliasDerivados` de cada entidad. Una palabra común o corta no elige entidad sola, un topónimo es ubicación y no alias, y los alias derivados que nombrarían a dos entidades se descartan y quedan en `datos/alias-ambiguos.json` (con las ambigüedades por diseño: «diris» a secas, «lima este», «instituto del niño»).
- `datos/ubicaciones-entidades.json`: zonas asociadas a una entidad (Huaycán → Hospital de Huaycán, Chosica → Hospital José Agurto Tello, Vitarte, Surquillo → INEN, Miraflores → HEJCU, Santa Anita → Hermilio Valdizán...). Escrito a mano y **aproximado**; las zonas omitidas por ambiguas (Ate, Breña, Lima, Lurigancho...) están en `omitidas` con su motivo. «Chosica» es también el centro de salud del QR: con `establecimientoConocido` no se suma.
- `scripts/generar-catalogo.mjs` (se corre con `node ia-poc/scripts/generar-catalogo.mjs`) lee las secciones 1 y 2 de la nota «Catálogo de entidades y titulares - Denuncias de corrupción», mezcla los alias, deriva los alias derivados y genera (con el campo `destinoSiTitular` de cada entidad, que sale de la columna «Destino si la denuncia es contra el titular» de la sección 1; esa columna es copia de la hoja `Hoja2` del Excel `LISTA ENTIDADES - denuncias contra titulares`, así que para cambiar un destino se corrige en la nota y se vuelve a correr el script; si el destino es de un tipo nuevo, el script se detiene y hay que agregarlo en `DESTINOS_TITULAR`) `src/services/filtro-corrupcion/catalogo-entidades.data.ts`. También genera `ubicaciones-entidades.data.ts` (desde `datos/ubicaciones-entidades.json`) y `datos/alias-ambiguos.json`; es reproducible: sin cambios en la nota ni en los datos a mano, vuelve a escribir los mismos archivos.

## Hardware medido

RTX 3050 de 6 GB: el modelo se reparte 71 % GPU y 29 % CPU. Unos 15 tokens por segundo; de 4 a 8 segundos por caso con el modelo caliente y salida JSON corta; unos 2 minutos la primera vez en frío.

## Evaluación

`evaluacion/` tiene los conjuntos de mensajes etiquetados (JSON Lines: `desarrollo.jsonl` para ajustar el léxico y `prueba-t1.jsonl` solo para medir) y los resultados por versión de reglas (`resultados/`); se corre con `npx tsx ia-poc/scripts/evaluar-reglas.ts <archivo.jsonl>` (ver `evaluacion/README.md`; con `--sin-textos` imprime y guarda solo ids, para medir un conjunto sin leerlo). Formato por línea: `id`, `texto`, `establecimiento`, `renipress`, `anonimo`, `cargo_mencionado`, `nombre_mencionado`, `categoria_esperada`, `destino_esperado`, `dificultad`, `estilo`. Las categorías son las 4 de `catalogo.categoria_incidencia`.

## Contrato del peso del modelo (`peso_corrupcion`)

El modelo **no decide** la categoría: da un peso que se **suma** al puntaje de las reglas (`combinarReglasConIa` en `src/services/filtro-corrupcion/combinar-reglas-con-ia.ts`).

**Qué debe entregar el modelo.** En el esquema JSON de salida del prompt, un campo `peso_corrupcion`:

```json
{ "peso_corrupcion": 7 }
```

- Entero de **0 a 10** (`PESO_MAXIMO_IA`, en `src/constants/filtro-corrupcion.ts`). 0: nada sugiere corrupción; 5: hay indicios; 10: el texto describe con claridad cobro, soborno, apropiación o nepotismo por parte de un servidor público.
- Si el modelo no responde, responde algo que no es un número o la salida no valida contra el esquema, se pasa `null` (modelo no disponible). No se inventa un 0.
- Un número fuera de rango se recorta a 0 o a 10 y un decimal se redondea al entero más cercano; `NaN` cuenta como `null`.
- La explicación del modelo no entra a la combinación (solo se muestra a quien revisa).

**Cómo se combina.**

| Regla | Detalle |
|---|---|
| Total | `puntajeTotal = puntaje de las reglas + peso del modelo` (0 si es `null`). |
| Subir | Si las reglas no proponían corrupción y el total **supera** `UMBRAL_TOTAL_CORRUPCION` (valor inicial 5, a calibrar en F4), se propone corrupción y va a OTRANS (`subidaPorIa: true`). |
| Nunca bajar | Si las reglas ya proponían corrupción, la propuesta se mantiene con cualquier peso, también 0. |
| Sin modelo | Con `null` solo valen las reglas. Si las reglas dejaron una duda (`requiereSegundaOpinion`, la zona gris), la salida marca `revisionOtrans: true` por defecto (ante la duda, OTRANS). |
| Confianza | Se deriva del **acuerdo**, no del número que escribe el modelo; se devuelve como porcentaje con dos decimales y **nunca pasa de 95**. Coinciden con señales fuertes: 80 a 95. Coinciden con señales débiles: 65 a 80. Solo uno ve corrupción (o sin modelo): 45 a 65. Discrepan: 30 a 50 y revisión humana marcada. Son las bandas de la sección 6 del plan; se calibran con el set de evaluación. |
| Revisión | Corrupción propuesta siempre pasa por una persona (`requiereRevisionHumana`). |

**Por la ruta de prueba.** `POST /filtro-corrupcion/evaluar` acepta además `pesoIa` (número o `null`) y, si llega, agrega `combinacion` con `propuestaCorrupcion`, `puntajeReglas`, `pesoIa` (ya recortado), `puntajeTotal`, `umbral`, `subidaPorIa`, `acuerdo`, `confianza`, `requiereOtrans`, `revisionOtrans` y `requiereRevisionHumana`. Sin `pesoIa` la respuesta es la de siempre (más los campos aditivos de la v1.2 y la v1.3: `origenPropuesta` e `identidad`).

**Propuestas por identidad (v1.3).** Una propuesta con `origenPropuesta: "IDENTIDAD"` (certeza `BAJA`) ya cuenta como propuesta de las reglas: el modelo no la baja. Con peso bajo (0 a 2) la combinación marca `DISCREPAN` y revisión humana, que es justo lo que se quiere: OTRANS la corrige. Si el modelo no está disponible, sigue el camino de siempre (`revisionOtrans`).
