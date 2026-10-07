// Todas las filas producto×cliente — espejo de reporte.calcular_filas() en Python.
import { CONFIG } from "./config.js";
import { calcular, escenarios, frutasDeReceta } from "./motor.js";

// Contra qué se sostiene el margen — igual que reporte.referencia() en Python:
// 1. precio pactado en la app · 2. si el precio al cliente cambió desde su primera
// factura del año, el MP/PVP real de los últimos 3 meses · 3. si no, la fruta de presupuesto.
export function referencia(v, ap, p) {
  if (ap?.RefFrutas) return { tipo: "pactado", etiqueta: "pactado " + ap.Semana.replace(/^\d+-/, ""), venta: { ref_frutas: JSON.parse(ap.RefFrutas), pvp_base_kg: +ap.PrecioKg } };
  const ini = v.pvp_inicio_kg, hist = v.mp_pvp_hist;
  if (ini && Math.abs(v.pvp_kg / ini - 1) > (p.tolerancia_precio ?? 0.02)) {
    if (hist > 0.1 && hist < 1.2)
      return { tipo: "historico", etiqueta: `margen 3 meses (precio cambió desde ${v.pvp_inicio_fecha.slice(5)})`, venta: { mp_pvp_ref: hist } };
    return { tipo: "presupuesto", etiqueta: "presupuesto (precio cambió, sin historia)", venta: {} };
  }
  return { tipo: "presupuesto", etiqueta: "presupuesto", venta: {} };
}

// Un mismo cliente de Odoo que en la práctica son dos (PROBA LLC: lo de 250 g es
// PROBA USA, el resto PROBA UE). Reglas en CONFIG.divisionesCliente.
export function nombreCliente(cliente, producto) {
  for (const d of CONFIG.divisionesCliente || [])
    if (cliente.toUpperCase().includes(d.cliente) && (!d.patron || new RegExp(d.patron, "i").test(producto))) return d.nombre;
  return cliente;
}

// Pactados por fila: {"code|cliente_id": [items ordenados por semana]}
export function pactadosPorFila(items) {
  const out = {};
  for (const f of items) (out[`${f.Producto}|${f.ClienteId}`] ||= []).push(f);
  for (const k in out) out[k].sort((a, b) => (a.Semana === b.Semana ? (a.Created || "").localeCompare(b.Created || "") : a.Semana < b.Semana ? -1 : 1));
  return out;
}

// semanas: la más nueva primero (las de la semana elegida hacia atrás).
// pactados: lista completa; solo cuentan los registrados en semanas <= la elegida.
export function calcularFilas(recetas, semanas, pactados, params) {
  const p = { ...CONFIG.params, ...params };
  const esc = escenarios(semanas, p.modo);
  const hasta = semanas[0]?.semana || "9999";
  const porFila = pactadosPorFila((pactados || []).filter((x) => x.Semana <= hasta));
  const filas = [];
  for (const v0 of recetas.ventas) {
    const rec = recetas.productos[v0.code];
    if (!rec) continue;
    const personal = v0.empresa === false || (CONFIG.clientesPersonal || []).includes(v0.cliente.toUpperCase());
    if ((p.solo_empresas && personal) || v0.kg_mes < (p.min_kg_mes || 0)) continue;
    const v = { ...v0, cliente: nombreCliente(v0.cliente, rec.name) };
    const frutas = frutasDeReceta(rec, CONFIG.mapeo);
    const historia = porFila[`${v.code}|${v.cliente_id}`] || [];
    const ap = historia[historia.length - 1];
    const ref = referencia(v, ap, p);
    const venta = { pvp_kg: v.pvp_kg, peso_kg: rec.peso_kg, kg_mes: v.kg_mes, ...ref.venta };
    let r = calcular(rec, venta, esc, CONFIG.mapeo, p);
    if (!r) continue;
    // Producto sin ninguna fruta cargada esta semana: se muestra, pero sin sugerir cambio
    const sinFruta = !frutas.some((f) => f in esc.actual);
    if (sinFruta)
      r = { ...r, posibleKg: r.pvpKg, objetivoKg: r.pvpKg, posibleU: r.pvpU, objetivoU: r.pvpU, dPos: 0, dObj: 0, accion: "MANTENER", impactoMes: 0, sobrePolitica: false };
    filas.push({ ...v, producto: rec.name, peso_kg: rec.peso_kg, frutas, receta: rec, pactado: ap || null, pactados: historia, sinFruta,
      ref: sinFruta ? "sin fruta cargada esta semana" : ref.etiqueta, ref_tipo: ref.tipo, ...r });
  }
  return { esc, filas };
}

// Posible/objetivo de UNA fila en cada semana cargada (para el historial del producto):
// cada punto se calcula con la fruta de esa semana y lo pactado hasta esa semana.
export function historiaFila(recetas, semanasTodas, pactados, params, code, clienteId) {
  const asc = [...semanasTodas].sort((a, b) => (a.semana < b.semana ? -1 : 1));
  const out = [];
  asc.forEach((s, i) => {
    const hastaAqui = asc.slice(0, i + 1).reverse();
    const { filas } = calcularFilas({ ...recetas, ventas: recetas.ventas.filter((v) => v.code === code && v.cliente_id === clienteId) },
      hastaAqui, pactados, { ...params, solo_empresas: false, min_kg_mes: 0 });
    if (filas[0] && !filas[0].sinFruta) out.push({ semana: s.semana, posibleU: filas[0].posibleU, objetivoU: filas[0].objetivoU });
  });
  return out;
}
