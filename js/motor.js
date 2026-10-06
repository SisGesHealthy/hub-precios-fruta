// Motor de precios por comportamiento de la fruta — funciones puras.
//
// La MISMA fórmula vive en guardian-healthyfood/precios-fruta/motor.py (el
// correo del lunes a Gerencia). Si cambias algo aquí, cámbialo allá: el test
// tests/test_paridad.py corre ambos motores sobre el mismo caso y exige que
// den lo mismo.
//
// Idea central — sostener el MARGEN DE APORTACIÓN (1 − MP/PVP):
//   el precio de venta se mueve en la misma proporción que el costo de MP.
//
//   costo_ref  = MP/kg con la fruta al precio con el que se fijó el precio
//                vigente del cliente (presupuesto, o la semana de la última
//                aprobación aplicada)
//   posible    = pvp_base × costo(fruta ACTUAL)  / costo_ref
//   objetivo   = pvp_base × costo(fruta MÁXIMA)  / costo_ref
//   (pvp_base = precio aprobado en esa referencia, o el vigente si no hay)
//
// "Posible" es el piso para no perder margen con lo que la fruta cuesta hoy;
// "objetivo" es a lo que se apunta en la negociación, cubriendo el máximo que
// Compras espera para el periodo. Solo sube la parte de fruta de la receta:
// concentrados, aditivos y empaque quedan a su costo de Odoo.

// Precio de un ingrediente en un escenario. `frutas` = {FRUTA: precio_kg}.
// Mapeo directo (fruta fresca): factor 1, residual 0 → precio de la semana.
// Mapeo de pulpa intermedia (ej. MPI002 = 1.47 kg de mango por kg): el costo
// de Odoo se parte en fruta (factor × presupuesto) + resto del proceso.
export function precioIngrediente(ing, mapeo, frutas, presupuesto) {
  const m = mapeo[ing.code];
  if (!m || frutas[m.fruta] == null) return ing.precio_odoo;
  const factor = m.factor || 1;
  const residual = factor === 1 && !m.intermedio ? 0 : Math.max(0, ing.precio_odoo - factor * (presupuesto[m.fruta] ?? 0));
  return residual + factor * frutas[m.fruta];
}

export function costoMp(receta, mapeo, frutas, presupuesto) {
  let c = receta.otros_mp_kg || 0;
  for (const ing of receta.ingredientes) c += ing.kg_x_kg * precioIngrediente(ing, mapeo, frutas, presupuesto);
  return c;
}

// Frutas de la receta que tienen precio semanal (para mostrar el "porqué").
export function frutasDeReceta(receta, mapeo) {
  const s = new Set();
  for (const ing of receta.ingredientes) if (mapeo[ing.code]) s.add(mapeo[ing.code].fruta);
  return [...s];
}

// Escenarios a partir de las semanas cargadas (la más reciente primero).
// Semanal: actual y máximo de la última semana. Quincenal: promedio del
// actual de las 2 últimas y el mayor de los máximos (el precio va a quedar
// fijo dos semanas, así que el objetivo cubre lo peor de ambas).
export function escenarios(semanas, modo) {
  const [s0, s1] = semanas;
  const presupuesto = {}, actual = {}, maximo = {};
  for (const [f, v] of Object.entries(s0?.frutas || {})) {
    presupuesto[f] = v.presupuesto;
    const prev = modo === "quincenal" && s1?.frutas?.[f] ? s1.frutas[f] : null;
    actual[f] = prev ? (v.actual + prev.actual) / 2 : v.actual;
    maximo[f] = prev ? Math.max(v.maximo, prev.maximo) : v.maximo;
  }
  return { presupuesto, actual, maximo };
}

const r2 = (x) => Math.round(x * 100) / 100;

// venta: {pvp_kg, peso_kg, kg_mes, ref_frutas?, pvp_base_kg?}
//   pvp_kg      = precio vigente (última factura): contra él se mide el Δ.
//   ref_frutas  = precios de fruta con los que se fijó el precio base (sin
//                 aprobación previa → presupuesto).
//   pvp_base_kg = precio aprobado en esa referencia (si no hay, el vigente). Así,
//                 si Gerencia aprobó $18.09 pero el cliente sigue facturado a
//                 $16.20, la fila sigue mostrando el alza pendiente.
//   mp_pvp_ref  = MP/PVP a sostener tomado de la historia (últimos 3 meses), para
//                 cuando el precio ya cambió desde el presupuesto: entonces
//                 posible = costo(actual) / mp_pvp_ref.
export function calcular(receta, venta, esc, mapeo, params) {
  const ref = venta.ref_frutas || esc.presupuesto;
  const costoRef = costoMp(receta, mapeo, ref, esc.presupuesto);
  const costoAct = costoMp(receta, mapeo, esc.actual, esc.presupuesto);
  const costoMax = costoMp(receta, mapeo, esc.maximo, esc.presupuesto);
  const pvp = venta.pvp_kg;
  if (!(pvp > 0) || !(costoRef > 0)) return null;

  // k = $ de precio por cada $ de costo MP (1 ÷ MP/PVP que se sostiene)
  const k = venta.mp_pvp_ref > 0 ? 1 / venta.mp_pvp_ref : (venta.pvp_base_kg > 0 ? venta.pvp_base_kg : pvp) / costoRef;
  const posibleKg = k * costoAct;
  const objetivoKg = Math.max(posibleKg, k * costoMax);
  const peso = venta.peso_kg || 1;
  const dPos = posibleKg / pvp - 1;
  const dObj = objetivoKg / pvp - 1;
  const u = params.umbral_cambio ?? 0.01;
  const accion = dPos >= u ? "SUBIR" : dObj <= -u ? "BAJAR" : "MANTENER";

  return {
    costoRef, costoAct, costoMax,
    margen: 1 - 1 / k, // margen de aportación que se sostiene
    mpPvpSinCambio: costoAct / pvp, // lo que pasa si NO se ajusta
    pvpKg: pvp, posibleKg, objetivoKg,
    pvpU: r2(pvp * peso), posibleU: r2(posibleKg * peso), objetivoU: r2(objetivoKg * peso),
    dPos, dObj, accion,
    // $ de margen que se pierden al mes si el cliente se queda en el precio vigente
    impactoMes: (posibleKg - pvp) * (venta.kg_mes || 0),
    sobrePolitica: params.mp_pvp_politica ? costoAct / posibleKg > params.mp_pvp_politica : false,
  };
}
