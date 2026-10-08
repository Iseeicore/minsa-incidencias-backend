# PoC local de IA

Prueba de concepto para clasificar incidencias con **reglas primero** (filtro de corrupción `reglas-corrupcion-v1`) y un **modelo local** como segunda opinión. No es producción ni se conecta al registro de incidencias. Plan completo en el vault: «Plan de PoC de IA - Reglas primero, modelo después y derivación a OTRANS».

## Modelo

- `modelo/Modelfile`: Qwen3.5 9B (Q4_K_M) importado a Ollama desde un GGUF local. Hay que poner la ruta real en `RUTA_AL_GGUF`.
- `modelo/parametros.json`: parámetros fijos de todas las pruebas (temperatura 0, semilla 7, contexto 4096, razonamiento desactivado, `keep_alive` de 30 minutos).
- `scripts/precalentar.mjs` (se corre con `node ia-poc/scripts/precalentar.mjs`) carga el modelo antes de una demostración.

## Catálogo de entidades

- `datos/alias-entidades.json`: alias y nombres cortos escritos a mano (los nombres oficiales y las siglas salen de la nota del vault).
- `scripts/generar-catalogo.mjs` (se corre con `node ia-poc/scripts/generar-catalogo.mjs`) lee las secciones 1 y 2 de la nota «Catálogo de entidades y titulares - Denuncias de corrupción», mezcla los alias y genera `src/services/filtro-corrupcion/catalogo-entidades.data.ts`.

## Hardware medido

RTX 3050 de 6 GB: el modelo se reparte 71 % GPU y 29 % CPU. Unos 15 tokens por segundo; de 4 a 8 segundos por caso con el modelo caliente y salida JSON corta; unos 2 minutos la primera vez en frío.

## Evaluación

`evaluacion/` recibirá el set de mensajes etiquetados (JSON Lines) y sus resultados. Formato por línea: `id`, `texto`, `establecimiento`, `renipress`, `anonimo`, `cargo_mencionado`, `nombre_mencionado`, `categoria_esperada`, `destino_esperado`, `dificultad`, `estilo`. Las categorías son las 4 de `catalogo.categoria_incidencia`.
