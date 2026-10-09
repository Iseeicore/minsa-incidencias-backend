# Set de evaluación

Mensajes de prueba **sintéticos** (personas ficticias) en JSON Lines, generados con los prompts del vault y validados con `scripts/validar-mensajes.mjs`. Los mensajes reales, cuando existan, se anonimizan antes de guardarlos.

| Archivo | Mensajes | Uso |
|---|---|---|
| `desarrollo.jsonl` | 100 (ids `D-001` a `D-100`; 60 de corrupción, 30 de ellos contra el titular) | **Se mira** para ajustar el léxico. |
| `prueba-t1.jsonl` | 200 (ids `T1-001` a `T1-200`; 58 de corrupción) | **No se mira** para escribir patrones: solo se mide, antes y después. |
| `resultados/*.json` | Cifras de cada corrida (`<versión de reglas>-<conjunto>.json`) | Línea base y resultados por versión. |

Regla metodológica: el léxico se ajusta mirando solo `desarrollo`. `prueba-t1` solo se corre con `--sin-listas` para no leer sus mensajes.

El archivo `GeneracionV1y1.2.txt` de donde salió `desarrollo` traía los 200 mensajes de `prueba-t1` más 100 nuevos: se descartaron los 200 repetidos (`--excluir-textos-de`) para que la prueba no se cuele en desarrollo.

## Cómo se corre

```
node ia-poc/scripts/validar-mensajes.mjs ENTRADA.txt SALIDA.jsonl --reasignar-ids=D [--excluir-textos-de=OTRO.jsonl]
npx tsx ia-poc/scripts/evaluar-reglas.ts ia-poc/evaluacion/desarrollo.jsonl [--json=resultados/RESUMEN.json] [--sin-listas]
```

`evaluar-reglas.ts` corre `evaluarTextoCorrupcion` sobre cada texto (sin contexto) y reporta verdaderos positivos, falsos negativos y falsos positivos (con id y texto), recall y precisión, el desglose por dificultad, estilo y `contra_titular`, la distribución de puntajes y la zona gris. Positivo = `categoria_esperada` `DENUNCIA_CORRUPCION`; predicho = `propuestaCorrupcion`.

Formato por línea: `id`, `texto`, `establecimiento`, `renipress`, `anonimo`, `cargo_mencionado`, `nombre_mencionado`, `categoria_esperada`, `destino_esperado`, `dificultad`, `estilo` (y, en `desarrollo`, `entidad_mencionada`, `sigla`, `contra_titular`, `destino_titular_esperado`, `ubicacion_mencionada`). Las categorías son las 4 de `catalogo.categoria_incidencia`.

## Resultados (corrupción: positivo = `DENUNCIA_CORRUPCION`)

| Conjunto | Reglas | VP | FN | FP | Recall | Precisión |
|---|---|---|---|---|---|---|
| `desarrollo` (100; se mira) | v1.1 (línea base) | 2 | 58 | 2 | 3,3 % | 50,0 % |
| `desarrollo` | v1.2 | 49 | 11 | 1 | 81,7 % | 98,0 % |
| `prueba-t1` (200; no se mira) | v1.1 (línea base) | 10 | 48 | 6 | 17,2 % | 62,5 % |
| `prueba-t1` | v1.2 | 24 | 34 | 10 | 41,4 % | 70,6 % |

Las cifras de `desarrollo` son optimistas porque el léxico se ajustó mirando esos mensajes. `prueba-t1` es la medida honesta, pero ya se leyeron sus falsos positivos para informar (no para ajustar): para seguir ajustando hace falta un conjunto nuevo. Los resúmenes completos (por dificultad, estilo, `contra_titular`, listas de falsos negativos y positivos) están en `resultados/`.
