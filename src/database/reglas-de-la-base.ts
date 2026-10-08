import { ErrorCode } from "@/enums/error-code.enum.js";
import { HttpStatus } from "@/enums/http-status.enum.js";
import { AppError } from "@/errors/app-error.js";

const CHECK_VIOLATION = "23514";
const MENSAJE_REGLA_DESCONOCIDA = "El cambio no cumple una regla del caso.";

interface ReglaDeLaBase {
  fragmento: string;
  mensaje: string;
  /** Un dato que quien lo envía puede corregir es un 422; un choque con el estado del caso, un 409. */
  corregible?: boolean;
}

const REGLAS_CONOCIDAS: readonly ReglaDeLaBase[] = [
  { fragmento: "la categoria ya se corrigio una vez", mensaje: "La categoría ya se corrigió una vez." },
  { fragmento: "ya se confirmo y no se puede corregir", mensaje: "La categoría ya se confirmó y no se puede corregir." },
  { fragmento: "la confirmacion se registra una sola vez", mensaje: "La categoría ya se confirmó." },
  { fragmento: "una categoria corregida no se puede confirmar", mensaje: "La categoría ya se corrigió y no se puede confirmar." },
  { fragmento: "no hay categoria de la IA que confirmar", mensaje: "El caso todavía no tiene una categoría de la IA que confirmar." },
  { fragmento: "la resolucion solo se registra una vez", mensaje: "El caso ya tiene una resolución." },
  { fragmento: "transicion de estado no permitida", mensaje: "El caso no puede pasar a ese estado desde el que tiene ahora." },
  { fragmento: "exigen un area de destino", mensaje: "El caso necesita un área de destino para derivarlo o tomarlo.", corregible: true },
  {
    fragmento: "solo se reasigna mientras el caso esta CLASIFICADO o DERIVADO",
    mensaje: "El área de destino solo se cambia mientras el caso está clasificado o derivado.",
  },
  { fragmento: "el area de destino esta desactivada", mensaje: "El área de destino está desactivada.", corregible: true },
  {
    fragmento: "un caso sensible solo se deriva a un area que reciba casos sensibles",
    mensaje: "Una denuncia por corrupción solo se deriva a la oficina de transparencia (OTRANS), no a un establecimiento.",
    corregible: true,
  },
  {
    fragmento: "esta en un area que no recibe casos sensibles",
    mensaje: "Una denuncia por corrupción no puede quedar en el área de un establecimiento.",
  },
  { fragmento: "el establecimiento de origen no se puede modificar", mensaje: "El establecimiento de origen del caso no se puede cambiar." },
  {
    fragmento: "el establecimiento de origen no existe o esta desactivado",
    mensaje: "El establecimiento de origen no existe o está desactivado.",
    corregible: true,
  },
  { fragmento: "archivar un caso exige un motivo de archivo", mensaje: "Para archivar el caso hay que indicar el motivo." },
  { fragmento: "el motivo de archivo solo se indica al archivar", mensaje: "El motivo de archivo solo se indica al archivar el caso." },
  { fragmento: "por datos insuficientes solo se archiva desde", mensaje: "Por datos insuficientes solo se archiva un caso registrado o clasificado." },
  { fragmento: "un caso abierto solo se archiva por vencimiento", mensaje: "Un caso abierto solo se archiva cuando vence su plazo de atención." },
  { fragmento: "el motivo de archivo no corresponde", mensaje: "El motivo de archivo no corresponde al estado del caso." },
  {
    fragmento: "las fechas y actores de derivacion, toma y archivado",
    mensaje: "Las fechas y los responsables de la derivación, la toma y el archivo los llena el sistema.",
  },
  {
    fragmento: "el tipo de area del rol no coincide con el area del usuario",
    mensaje: "El rol no corresponde al tipo de área del usuario.",
    corregible: true,
  },
  {
    fragmento: "el tipo de area no coincide con el de los roles del usuario",
    mensaje: "El área no corresponde a los roles del usuario.",
    corregible: true,
  },
  { fragmento: "el rol esta desactivado y no se puede asignar", mensaje: "El rol está desactivado y no se puede asignar.", corregible: true },
];

/**
 * Las reglas del caso viven en la base y la protegen aunque dos personas actúen a la vez. Cuando un disparador
 * rechaza el cambio, devuelve un 409 (o un 422 si el dato lo puede corregir quien lo envía) con un mensaje claro en
 * español y sin repetir el texto técnico. Cualquier otro error se devuelve igual.
 */
export function traducirErrorDeBase(error: unknown): unknown {
  if (error instanceof AppError) return error;
  if (!(error instanceof Error) || (error as { code?: unknown }).code !== CHECK_VIOLATION) return error;
  const regla = REGLAS_CONOCIDAS.find(({ fragmento }) => error.message.includes(fragmento));
  if (regla?.corregible) return new AppError(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.UNPROCESSABLE, regla.mensaje);
  return new AppError(HttpStatus.CONFLICT, ErrorCode.CONFLICT, regla?.mensaje ?? MENSAJE_REGLA_DESCONOCIDA);
}
