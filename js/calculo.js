// Todas las filas producto×cliente — espejo de reporte.calcular_filas() en Python.
import { CONFIG } from "./config.js";
import { calcular, escenarios, frutasDeReceta } from "./motor.js";

// Contra qué se sostiene el margen — igual que reporte.referencia() en Python:
// 1. precio aprobado en la app · 2. si el precio al cliente cambió desde su primera
// factura del año, el MP/PVP real de los últimos 3 meses · 3. si no, la fruta de presupuesto.
export function referencia(v, ap, p) {
  if (ap?.RefFrutas) return { tipo: "aprobado", etiqueta: "aprob. " + ap.Semana, venta: { ref_frutas: JSON.parse(ap.RefFrutas), pvp_base_kg: +ap.PrecioKg } };
  const ini = v.pvp_inicio_kg, hist = v.mp_pvp_hist;
  if (ini && Math.abs(v.pvp_kg / ini - 1) > (p.tolerancia_precio ?? 0.02)) {
    if (hist > 0.1 && hist < 1.2)
      return { tipo: "historico", etiqueta: `margen 3 meses (precio cambió desde ${v.pvp_inicio_fecha.slice(5)})`, venta: { mp_pvp_ref: hist } };
    return { tipo: "presupuesto", etiqueta: "presupuesto (precio cambió, sin historia)", venta: {} };
  }
  return { tipo: "presupuesto", etiqueta: "presupuesto", venta: {} };
}

export function calcularFilas(recetas, semanas, aprobados, params) {
  const p = { ...CONFIG.params, ...params };
  const esc = escenarios(semanas, p.modo);
  const filas = [];
  for (const v of recetas.ventas) {
    const rec = recetas.productos[v.code];
    if (!rec) continue;
    if ((p.solo_empresas && v.empresa === false) || v.kg_mes < (p.min_kg_mes || 0)) continue;
    const frutas = frutasDeReceta(rec, CONFIG.mapeo);
    if (!frutas.some((f) => f in esc.actual)) continue;
    const venta = { pvp_kg: v.pvp_kg, peso_kg: rec.peso_kg, kg_mes: v.kg_mes };
    const ap = aprobados[`${v.code}|${v.cliente_id}`];
    const ref = referencia(v, ap, p);
    Object.assign(venta, ref.venta);
    const r = calcular(rec, venta, esc, CONFIG.mapeo, p);
    if (r) filas.push({ ...v, producto: rec.name, peso_kg: rec.peso_kg, frutas, receta: rec, aprobado: ap || null, ref: ref.etiqueta, ref_tipo: ref.tipo, ...r });
  }
  return { esc, filas };
}
