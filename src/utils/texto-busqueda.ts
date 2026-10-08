/** Para que `%`, `_` y `\` del texto buscado se tomen literales dentro de un `LIKE ... ESCAPE '\'`. */
export const escaparComodines = (texto: string): string => texto.replace(/[\\%_]/g, (caracter) => `\\${caracter}`);
