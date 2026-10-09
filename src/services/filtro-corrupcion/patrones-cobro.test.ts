import { describe, expect, it } from "vitest";
import { CertezaCorrupcion as C } from "@/enums/filtro-corrupcion.enum.js";
import { evaluarTextoCorrupcion } from "@/services/filtro-corrupcion/evaluar-texto-corrupcion.js";

const propone = (texto: string): boolean => evaluarTextoCorrupcion(texto).propuestaCorrupcion;

describe("patrones de cobro: los tres casos del hallazgo (plan de PoC, sección 12)", () => {
  it("el jefe del FISSAL le pide plata a los proveedores para firmar los pagos: corrupción, con la entidad", () => {
    const resultado = evaluarTextoCorrupcion("El jefe del FISSAL le pide plata a los proveedores para firmar los pagos");
    expect(resultado.propuestaCorrupcion).toBe(true);
    expect(resultado.certeza).toBe(C.ALTA);
    expect(resultado.entidad?.codigo).toBe("fissal");
    expect(resultado.senales.map(({ frase }) => frase)).toContain("pide plata a los proveedores para firmar");
  });

  it("el director del hospital de Huaycán cobra por las camas: corrupción, con el titular", () => {
    const resultado = evaluarTextoCorrupcion("El director del hospital de Huaycan cobra por las camas");
    expect(resultado.propuestaCorrupcion).toBe(true);
    expect(resultado.entidad?.codigo).toBe("hh");
    expect(resultado.titular?.cargo).toBe("director del hospital");
  });

  it("la contra-prueba (demora e información en el INEN) no es corrupción", () => {
    const resultado = evaluarTextoCorrupcion("Mi mama espero tres horas en el INEN y nadie le dio informacion");
    expect(resultado.propuestaCorrupcion).toBe(false);
    expect(resultado.requiereSegundaOpinion).toBe(false);
  });
});

describe("patrones de cobro: verbo × objeto × complemento", () => {
  it.each([
    ["primera persona", "Me pidieron plata para atenderme en la emergencia"],
    ["segunda persona", "te piden dinero para darte la cita en el hospital"],
    ["tercera persona", "El administrador exige plata para aprobar los expedientes del hospital"],
    ["pasado", "Ayer el cajero cobró un pago extra para entregar los resultados"],
    ["con un monto como objeto", "me pidio 300 soles para adelantar la quimio de mi mama"],
    ["objeto disfrazado", "me pidieron una propina para operar a mi papa en el hospital"],
    ["objeto sin nombre con servicio", "el medico me pidio algo para darme la cama en observacion"],
    ["sin tildes ni signos", "el jefe cobro plata para firmar los pagos aqui en el hospital"],
    ["mayúsculas", "EL TECNICO PIDIO DINERO PARA PASAR A MI PAPA A EMERGENCIA"],
    ["jerga", "me quisieron sacar plata en el modulo del hospital"],
  ])("%s: propone corrupción", (_caso, texto) => {
    expect(propone(texto)).toBe(true);
  });

  it("con servicio nombrado pesa más que sin él (fuerte frente a media)", () => {
    const conServicio = evaluarTextoCorrupcion("el cajero pidio plata para firmar los pagos del hospital");
    const sinServicio = evaluarTextoCorrupcion("el cajero pidio plata en el hospital ayer por la tarde");
    expect(conServicio.puntaje).toBeGreaterThan(sinServicio.puntaje);
    expect(sinServicio.propuestaCorrupcion).toBe(true);
    expect(sinServicio.certeza).toBe(C.MEDIA);
  });

  it("el cobro por un bien vendible no necesita objeto de dinero", () => {
    expect(propone("En el hospital cobran por las camas de observacion todos los dias")).toBe(true);
    expect(propone("En el hospital venden los turnos de traumatologia desde temprano")).toBe(true);
    expect(propone("Un enfermero me vendio la medicina del seguro por fuera del hospital")).toBe(true);
  });

  it("'pide' o 'exige' con un papel o un trámite no es cobro", () => {
    expect(propone("Me pidieron mi DNI y mi carnet del SIS para la cita de mañana")).toBe(false);
    expect(propone("Me pidieron que firme el consentimiento para atender a mi hijo")).toBe(false);
    expect(propone("Me pidieron un sobre manila para guardar los papeles en la cita")).toBe(false);
  });
});

describe("patrones de cobro: otras formas", () => {
  it.each([
    ["recibe sobres de los proveedores", "El jefe de logistica recibe sobres con plata de los proveedores del hospital"],
    ["recibió un porcentaje", "La directora recibio un porcentaje de la empresa que gano la compra del hospital"],
    ["se queda con una parte", "El encargado obliga a poner plata y se queda con una parte de lo que juntan"],
    ["se embolsa", "El chofer de la ambulancia se embolsa lo que cobra a los familiares"],
    ["se los echó al bolsillo", "La cajera cobro de mas y se los echo al bolsillo, la boleta salio por menos"],
    ["arreglar con un billete", "Para el pase de cama hay que arreglar con un billete a alguien de admision"],
    ["por debajo de la mesa y bajo la mesa", "En el hospital todo se arregla bajo la mesa con el jefe de turno"],
    ["mordida", "Hay que darle su mordida al encargado de compras del hospital"],
    ["caerle con un detallito", "Para que te atiendan rapido hay que caerle con un detallito a alguien de adentro"],
    ["ponerse con", "Si quieres la cama tienes que ponerte con una platita para el hospital"],
    ["le pagan para que firme", "Las empresas le pagan al jefe para que firme las ordenes de compra del hospital"],
    ["cuelan en la cola", "Los de admision cuelan a sus conocidos en la cola de emergencia del hospital"],
    ["monto por fuera", "Me cobraron 80 soles por fuera para el informe del hospital sin pasar por caja"],
    ["si le dejaba", "Dijo que mi cobertura salia antes si le dejaba 500 soles por fuera"],
    ["la gaseosa", "El de seguridad dijo que para la gaseosa lo dejaba pasar al hospital sin cola"],
  ])("%s", (_caso, texto) => {
    expect(propone(texto)).toBe(true);
  });

  it("apropiación: medicinas, insumos, combustible y vales fuertes; equipos y ambulancias, más débiles", () => {
    const fuerte = evaluarTextoCorrupcion("Se llevaron las medicinas del almacen del hospital en cajas");
    const ambiguo = evaluarTextoCorrupcion("Se llevo los equipos donados del laboratorio del hospital en una camioneta");
    expect(fuerte.propuestaCorrupcion).toBe(true);
    expect(ambiguo.propuestaCorrupcion).toBe(true);
    expect(fuerte.puntaje).toBeGreaterThan(ambiguo.puntaje);
    expect(propone("La directora autorizo combustible de mas para camionetas que usan sus allegados")).toBe(true);
  });

  it("nepotismo y conflicto de intereses: contratar o poner a un pariente, y el negocio de un pariente", () => {
    expect(propone("El director metio a su sobrino en seguridad sin concurso ni examen")).toBe(true);
    expect(propone("El director contrato a puro familiar para vigilancia y jardineria")).toBe(true);
    expect(propone("Firmo la compra con la constructora de su concuñado para el puesto de salud")).toBe(true);
    expect(propone("La doctora dejo entrar una empresa de ambulancias privadas de su primo")).toBe(true);
  });

  it("terceros: a los proveedores, a las empresas o a los pacientes", () => {
    expect(propone("El director le cobra a los proveedores 100 soles por factura para dejarlos entrar")).toBe(true);
    expect(propone("El jefe de compras le pide plata a las empresas que quieren vender al hospital")).toBe(true);
    expect(propone("Piden dinero a los pacientes por fuera para operar en el hospital")).toBe(true);
  });
});

describe("patrones de cobro: negaciones y lo que no es cobro", () => {
  it.each([
    "La enfermera no me pidio plata, solo fue grosera con mi mama en el hospital",
    "NADIE ME PIDIO PLATA, solo me gritaron en la puerta del hospital",
    "Fue puro maltrato, no nos pidieron un sol en todo el hospital",
    "No me condiciono ningun pago, solo me trato mal en el hospital",
    "Quiero denunciar corrupcion en el INEN pero no me pidio dinero ni favor, fue falta de respeto",
    "Ni me cobraron ni me pidieron nada en el hospital, solo esperé tres horas",
  ])("negado: %s", (texto) => {
    expect(propone(texto)).toBe(false);
  });

  it("la negación solo afecta a la frase que sigue: 'no sé' no anula un cobro más adelante", () => {
    expect(propone("no se el nombre pero me pidieron plata para atenderme en el hospital")).toBe(true);
  });

  it("los pagos legítimos restan: boleta, caja, tarifa oficial", () => {
    expect(propone("El doctor cobro 20 soles por la consulta y me dieron boleta")).toBe(false);
    expect(propone("Me cobraron 10 soles en el hospital y es la tarifa oficial")).toBe(false);
    expect(propone("Me pidieron 15 soles por la copia pero pague en caja y tengo recibo")).toBe(false);
  });

  it("un 'no me dieron boleta' invierte la señal y deja de restar", () => {
    const resultado = evaluarTextoCorrupcion("Me cobraron 50 soles por la consulta y no me dieron boleta");
    expect(resultado.propuestaCorrupcion).toBe(true);
    expect(resultado.puntaje).toBeGreaterThanOrEqual(2);
  });

  it("falsos positivos de palabra: 'colar', 'sacar' y 'pasar' sueltos no son cobro", () => {
    expect(propone("Mi abuela se coló en la fila de los vacunados y la sacaron del hospital")).toBe(false);
    expect(propone("Tuve que pasar por encima del charco para entrar al hospital esta mañana")).toBe(false);
    expect(propone("Quiero sacar una cita para el control de mi hijo en el hospital")).toBe(false);
    expect(propone("El pasajero cobró su pasaje y se bajó frente al hospital de la zona")).toBe(false);
  });

  it("palabras que engañan: denuncia, abuso, cobro y pago sueltos no cuentan", () => {
    expect(propone("Quiero poner una denuncia por el abuso del cobro de un pago en el hospital")).toBe(false);
  });

  it("las 11 filas de la tabla de casos límite del léxico siguen igual", () => {
    const filas: [string, boolean, C][] = [
      ["El director no me quiso atender", false, C.BAJA],
      ["Me cobraron 50 soles sin recibo para darme la cita", true, C.ALTA],
      ["Pagué 20 soles en caja y me dieron boleta", false, C.BAJA],
      ["No hay medicinas en la farmacia", false, C.BAJA],
      ["La enfermera vende las medicinas del SIS", true, C.ALTA],
      ["Mi médico me derivó a su clínica particular", true, C.MEDIA],
      ["Contrataron a la sobrina del director", true, C.ALTA],
      ["Me robaron el celular en emergencia", false, C.BAJA],
      ["Quiero denunciar el mal trato", false, C.BAJA],
      ["El jefe de logística favoreció a una empresa", true, C.ALTA],
      ["Falta disciplinaria o ética sin beneficio indebido", false, C.BAJA],
    ];
    for (const [texto, propuesta, certeza] of filas) {
      const resultado = evaluarTextoCorrupcion(texto);
      expect([texto, resultado.propuestaCorrupcion, resultado.certeza]).toEqual([texto, propuesta, certeza]);
    }
  });
});

describe("destino especial st-pad-minsa", () => {
  it("las denuncias contra el titular del INEN apuntan al ST PAD MINSA con su código propio", () => {
    const resultado = evaluarTextoCorrupcion("En el INEN el jefe institucional recibe coimas para dar citas de quimioterapia");
    expect(resultado.referenciaDerivacion?.destinoSiTitular?.entidadDestinoCodigo).toBe("st-pad-minsa");
    expect(resultado.referenciaDerivacion?.aplicaAlTitular).toBe(true);
  });
});
