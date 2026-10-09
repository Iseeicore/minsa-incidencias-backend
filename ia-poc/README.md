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

## Evaluar con el modelo real

`scripts/evaluar-con-modelo.ts` corre reglas + modelo (a través de `analizarMensaje`, la misma ruta que usará el producto) sobre un conjunto etiquetado. Los datos nunca salen de localhost.

```
node ia-poc/scripts/precalentar.mjs        # una vez; sin esto la primera llamada tarda ~2 minutos
npx tsx ia-poc/scripts/evaluar-con-modelo.ts --variante=V2 --conjunto=ia-poc/evaluacion/desarrollo-v2.jsonl --limite=100 --estratificado --max-minutos=35
```

- `--variante=V1|V2|V3|V2C` (V1: prompt completo; V2: V1 + señales y entidad de las reglas como pistas; V3: V2 + ejemplos resueltos; **V2C**: V2 con salida compacta, ver abajo; V4, RAG, es un hueco documentado en `src/services/analisis-ia/prompts.ts`).
- `--limite=N` toma los primeros N; con `--estratificado` toma una muestra reproducible repartida por `tipo_caso` y categoría.
- Se consulta de a un mensaje (una sola GPU), con el modelo caliente y ~10 a 15 s por caso (~300 tokens de salida a ~15 tokens por segundo: lo que domina es lo que el modelo escribe). Una corrida de 100 mensajes tarda unos 20 a 25 minutos: lánzala en segundo plano con un registro (`> corrida.log 2>&1`) y revisa el avance.
- **Reanudable:** cada respuesta válida se guarda en `evaluacion/cache/modelo-<variante>-<conjunto>.jsonl` (no se versiona: deriva de los textos). Si se corta, se repite el mismo comando y solo consulta lo que falta. Si cambias el prompt, **borra la caché de esa variante**. `--solo-cache` recalcula las métricas sin llamar al modelo.
- `--max-minutos=N` corta la corrida y reporta lo medido hasta ahí.
- **Resultado sin textos:** `evaluacion/resultados/modelo-<variante>-<conjunto>.json`.

**Cómo leer el resultado.** `corrupcion.soloReglas` frente a `corrupcion.reglasMasIa`: VP, FN, FP, recall y precisión. `recuperadasPorElModelo` son corrupciones que las reglas perdían y la suma con el peso del modelo sí propone; `falsosPositivosNuevos` son los no-corrupción que el modelo hace subir a OTRANS. `tasaFalsosPositivosSobreNegativos` (FP / negativos) importa más que la precisión: los conjuntos tienen ~60 % de corrupción y la realidad será mucho menor, así que la precisión se ve optimista. `porTipoDeCaso` desglosa recall y FP (mira `enganosa` y `corrup_dudosa`). `corrupcionQueSigueAlEstablecimiento` son las corrupciones que la propuesta final no manda a OTRANS (el error que no se puede permitir); `conRevisionOtrans` cuántas de ellas igual quedan marcadas para OTRANS. `categoriasDelModelo` trae la exactitud y la matriz de confusión (filas: esperada; columnas: la del modelo). `quejaFrenteAReclamo` mide el acuerdo solo entre queja y reclamo, del modelo y de la propuesta final (los empates se proponen como Reclamo). `distribucionPesoPorCategoriaEsperada` es el histograma del peso de 0 a 10. `sensibilidadAlPisoDePosibleCorrupcion` recalcula, sin llamar al modelo, qué pasaría si `posible_corrupcion` subiera el peso a un mínimo.

**Resultados (reglas v1.3 + `qwen3.5-9b-local`, piso 6, 2026-10-08).** Muestra estratificada de 100 mensajes de `desarrollo-v2` (60 corrupción, 40 negativos) y de 120 de `prueba-v2` (72 corrupción, 48 negativos; medida una sola vez con V2 ya congelada). Una respuesta de cada conjunto no se consulta porque el texto tiene menos de 20 caracteres.

| Conjunto | Variante | Recall solo reglas → reglas + IA | Precisión solo reglas → reglas + IA | Recuperadas | FP nuevos | FP / negativos | JSON válido | Latencia media / p90 | Categorías del modelo |
|---|---|---|---|---|---|---|---|---|---|
| desarrollo-v2 (100) | V1 | 55,0 % → 98,3 % | 91,7 % → 93,7 % | 26 de 27 | 1 | 7,5 % → 10,0 % | 99/99 | 12,9 s / 15,8 s | 89,9 % |
| desarrollo-v2 (100) | **V2** | 55,0 % → 96,7 % | 91,7 % → 95,1 % | 25 de 27 | 0 | 7,5 % → 7,5 % | 99/99 | 15,1 s / 17,8 s | 89,9 % |
| desarrollo-v2 (100) | V3 | 55,0 % → 100 % | 91,7 % → 92,3 % | 27 de 27 | 2 | 7,5 % → 12,5 % | 99/99 | 15,5 s / 18,0 s | 87,9 % |
| **prueba-v2 (120)** | **V2** | 63,9 % → **100 %** | 92,0 % → 93,5 % | 26 de 26 | 1 | 8,3 % → 10,4 % | 119/119 | 16,3 s / 19,6 s | 89,1 % |

- **Sin el piso** (el peso crudo del modelo, que escribe 3 a 6 aunque acierte la categoría) el recall en desarrollo-v2 era solo 75 %: el modelo marca `categoria` DENUNCIA_CORRUPCION en 58 de 60 corrupciones, pero con pesos conservadores que, sumados a pocas señales de las reglas, no superan el umbral 5. El piso 6 para `posible_corrupcion` (`PISO_PESO_POSIBLE_CORRUPCION_POR_DEFECTO`) se eligió **mirando solo desarrollo-v2** (con 5: 93 %; con 6: 97 %; mismos FP). En prueba-v2, sin piso el recall habría sido 86 % (62 de 72) y con 6 fue 100 %.
- **Elección de variante:** V1 y V2 empatan en corrupción; V3 acierta una más pero introduce más falsos positivos (`enganosa` 4 de 10) y baja la exactitud de categorías. Con la prevalencia real, muy inferior al ~60 % de estos conjuntos, pesan más los FP que dos casos de recall: se congeló V2. Las diferencias entre variantes (2 a 3 casos) están dentro del ruido.
- **FP por tipo de caso (prueba-v2):** `enganosa` 1 → 2 de 12, `reclamo` 3 → 3 de 12, `queja` y `otro` 0. El FP que el modelo agrega es un solo mensaje (D2-0209).
- **Queja frente a reclamo** (solo el modelo, entre los esperados queja o reclamo): 91,2 % en prueba-v2 y 86,7 % en desarrollo-v2 (V2); la propuesta final 93,5 % y 85,2 %. El modelo confunde sobre todo reclamo → queja y `otro` (7 de 11 bien en prueba-v2; el resto cae en queja o reclamo).
- **Dónde falla el modelo:** en desarrollo-v2 dos corrupciones (D2-0327, D2-0949) no suben (el modelo las clasificó como otra categoría y las reglas no las veían); 10 mensajes de desarrollo-v2 y 13 de prueba-v2 (V2) tienen categoría distinta de la etiqueta, casi todos entre queja, reclamo y otro. Ids en `resultados/modelo-V2-*.json` (`idsConDesacuerdo`).
- **Límites de la medición:** muestras de 100 y 120, intervalos de confianza amplios (± 8 a 10 puntos); conjuntos sintéticos con ~60 % de corrupción, así que la precisión se ve optimista; el piso se calibró en el mismo conjunto de desarrollo; el rendimiento real con mensajes de ciudadanos no se midió.

**Protocolo.** Los prompts se ajustan solo mirando `desarrollo-v2`; `prueba-v2` se mide una sola vez con la mejor variante ya congelada; `reserva-v2` se guarda para la medición final de todo el sistema; `prueba-t1` está contaminada en parte. Los ejemplos de V3 salen solo de la tabla de casos límite del léxico o son inventados.

## V2C: salida compacta y comparación por pares

**Qué es.** V2 con la salida compacta: el modelo escribe solo `categoria`, `peso_corrupcion` y `posible_corrupcion` (~38 tokens, ~3 s) en lugar de ~215 tokens (~15 s). El prompt es el de V2 sin las reglas duras que hablaban de `informacion_faltante` y `alternativas` (renumeradas) y, desde la iteración 1, con una regla más (cobrar por un servicio gratuito o dar algo a cambio de atención, un resultado o un trámite es posible corrupción aunque falten datos). El cliente pide el esquema compacto con `num_predict` 80; un JSON cortado o inválido sigue el reintento y el degradado de siempre. V1, V2 y V3 no cambian (hay una prueba con sus hashes).

**Paquete sin depender del modelo** (`src/services/analisis-ia/plantillas-paquete.ts`): la explicación sale de una plantilla con el puntaje y las señales de las reglas, la entidad y el titular o cargo detectados, y la categoría, el peso y la marca del modelo, más por qué se propone OTRANS o no; la información faltante, de los faltantes del filtro; los fundamentos, de las señales de las reglas; la ficha de derivación, como siempre. **Pérdida conocida:** sin `alternativas` no se detecta el empate queja/reclamo del modelo; el paquete trae `sinDesempateQuejaReclamo: true` y sigue con revisión humana donde ya la tenía.

**Cómo medir y comparar** (una sola GPU, de a un mensaje; la primera línea de cada caché se excluye de las latencias):

```
node ia-poc/scripts/precalentar.mjs
npx tsx ia-poc/scripts/precalentar-variante.ts --variante=V2C      # calienta el prefijo del prompt, sin guardar nada
npx tsx ia-poc/scripts/evaluar-con-modelo.ts --variante=V2C --conjunto=ia-poc/evaluacion/desarrollo-v2.jsonl
npx tsx ia-poc/scripts/evaluar-con-modelo.ts --variante=V2C --conjunto=ia-poc/evaluacion/prueba-v2.jsonl --ids-de=V2   # mismos ids que V2
npx tsx ia-poc/scripts/comparar-variantes.ts --a=V2 --b=V2C --conjunto=ia-poc/evaluacion/desarrollo-v2.jsonl
npx tsx ia-poc/scripts/comparar-variantes.ts --a=V2 --b=V2C --conjunto=ia-poc/evaluacion/prueba-v2.jsonl --universo-b=ids-de-a --desarrollo=ia-poc/evaluacion/resultados/iter1-comparacion-V2-V2C-desarrollo-v2.json
```

`comparar-variantes.ts` no llama al modelo: lee las cachés por variante e id y compara solo los ids presentes en ambas (los criterios absolutos de B usan todo lo que B midió con `--universo-b=conjunto`, o los ids de A con `ids-de-a`). Informa recall y precisión con reglas + modelo (con piso), tasa de FP sobre negativos, exactitud de las 4 categorías, acuerdo queja/reclamo, JSON al primer intento, latencia media y p90, intervalos de Wilson al 95 %, pares discordantes (id, tipo de caso y lado, sin textos) y el veredicto que codifica **exactamente** Q1 a Q5, S1 y S2 de la sección 21 de la nota del vault (`src/services/analisis-ia/comparacion-variantes.ts`, con pruebas). Con `--desarrollo=` agrega el veredicto final que exige cada criterio en los dos conjuntos. Resultados sin textos en `resultados/comparacion-<A>-<B>-<conjunto>.json`; las cifras de cada iteración del prompt están en `resultados/iter0-*` y `resultados/iter1-*`.

**Resultado (V2 frente a V2C, 2026-10-09).** Veredicto final: **Viable con reservas**. Desarrollo-v2 (303, iteración 1): recall reglas + modelo 97,3 % (IC 93,8 a 98,8), FP 7,5 %, JSON al primer intento 100 %, latencia media 3,14 s, p90 3,76 s, 4,7 veces más rápida que V2; solo falla Q4 por 0,12 puntos (acuerdo queja/reclamo 84,88 % frente a 85 %, un mensaje). Prueba-v2 (119 ids de V2, una sola corrida): cumple todo (recall 100 %, FP 8,5 % frente a 10,6 % de V2, latencia 3,07 s, p90 3,56 s). Detalle y límites en la sección 22 de la nota del vault.

## Normas para la trazabilidad (RAG fase 1)

`datos/fragmentos-normas.json` (versión `normas-v1`) tiene 29 fragmentos con texto literal: los 20 supuestos del Anexo C de la Directiva N° 002-2023-PCM-SIP y 9 de la ayuda memoria de OTRANS (definición de denuncia por acto de corrupción, criterios de evaluación, los cuatro requisitos del hecho denunciado, derivación a la STPAD, el OCI o la PP, derivación de quejas y reclamos, y la definición de reclamo de SUSALUD). `scripts/generar-normas.mjs` valida el JSON (ids únicos, fuente y tipo conocidos, texto no vacío) y genera `src/services/analisis-ia/normas/fragmentos-normas.data.ts`; correrlo después de editar el JSON.

- **El Anexo C está transcrito a ojo** desde dos imágenes EMF del Word, sin OCR, y **no se ha cotejado con el documento oficial**: el JSON lo dice (`transcripcionAnexoCCotejada: false`) y el paquete lo repite. Los fragmentos de la ayuda memoria salen del texto del Word, con sus erratas («JAFAS», «fe los servicios»).
- `citaAutomatica: false` en el cohecho activo (III-a): no se cita contra quien cuenta que pagó una coima.
- El mapa señal → supuesto está en `src/services/analisis-ia/normas/mapa-senal-fragmento.ts`; se corrige como datos. Sin regla por ahora: II-b, III-a y III-g.
- Cobertura de referencia (reglas solas, sin modelo, `desarrollo-v2`): de 109 corrupciones que las reglas proponen, 89 reciben al menos un supuesto y 20 dicen «no se encontró». El mapa no se ajustó mirando esos datos; no mide si la cita es la que OTRANS aplicaría.

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
