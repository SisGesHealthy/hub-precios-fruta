// Precios por cliente: vigente → posible (piso para sostener el margen) →
// objetivo (a lo que se apunta, cubre el máximo esperado). Gerencia aprueba aquí
// el precio que se aplicó con cada cliente; esa aprobación se vuelve la nueva
// referencia de la fila (para no volver a cobrar el mismo alza la semana siguiente).
import { CONFIG } from "./config.js";
import { el, clear, toast } from "./dom.js";
import { datos } from "./datos.js";
import { estado, recargar, puedeAprobar } from "./app.js";
import { calcularFilas } from "./calculo.js";
import { precioIngrediente } from "./motor.js";
import { semanaObjetivo, rangoSemana, semanaCorta, titulo, usd, pct, num, claseDelta } from "./util.js";

const ui = { modo: CONFIG.params.modo, cliente: "", accion: "", q: "", personal: false, abierto: null, sel: new Set() };

export function vistaPrecios(root) {
  if (!estado.semanas.length) {
    root.appendChild(el("div", { class: "vacio" }, ["Todavía no hay precios de fruta cargados. ", el("a", { href: "#/cargar", class: "link" }, "Cargar la primera semana →")]));
    return;
  }
  const cont = el("div");
  root.appendChild(cont);
  pintar(cont);
}

function pintar(cont) {
  clear(cont);
  const s0 = estado.semanas[0];
  const obj = semanaObjetivo().semana;
  const { esc, filas: todas } = calcularFilas(estado.recetas, estado.semanas, estado.aprobados, {
    modo: ui.modo, solo_empresas: !ui.personal, min_kg_mes: ui.personal ? 0 : CONFIG.params.min_kg_mes ?? 50,
  });
  const q = ui.q.toLowerCase();
  const filas = todas.filter((f) => (!ui.cliente || f.cliente === ui.cliente) && (!ui.accion || f.accion === ui.accion) &&
    (!q || (f.producto + " " + f.code + " " + f.frutas.join(" ")).toLowerCase().includes(q)));
  const subir = filas.filter((f) => f.accion === "SUBIR");
  const riesgo = subir.reduce((a, f) => a + f.impactoMes, 0);
  const re = () => pintar(cont);

  cont.append(
    el("div", { class: "cab" }, [
      el("div", {}, [
        el("h1", { class: "titulo" }, "Precio a comunicar por cliente"),
        el("p", { class: "sub" }, [`Fruta de ${semanaCorta(s0.semana)} (${rangoSemana(s0.semana)})`,
          s0.semana !== obj ? el("span", { class: "chip pend" }, ` aún no se carga ${semanaCorta(obj)}`) : null,
          estado.recetas.demo ? el("span", { class: "chip pend" }, "datos de ejemplo") : null]),
      ]),
      el("div", { class: "acciones" }, [
        el("span", { class: "mini", title: "Recetas y precio vigente por cliente (última factura)" }, `Datos de Odoo al ${estado.recetas.generado}`),
        CONFIG.roles.admin.includes(estado.usuario.correo) && !CONFIG.useMock
          ? el("label", { class: "btn btn-sec", title: "Subir recetas.json generado con precios-fruta/extraer_recetas.py" }, ["Actualizar datos de Odoo",
              el("input", { type: "file", accept: ".json", class: "hidden", onchange: actualizarRecetas })])
          : null,
        el("button", { class: "btn btn-sec", onclick: () => exportar(filas) }, "Descargar Excel"),
      ]),
    ]),
    el("div", { class: "filtros" }, [
      seg("Ajuste", [["semanal", "Semanal"], ["quincenal", "Quincenal"]], ui.modo, (v) => { ui.modo = v; re(); }),
      sel("Cliente", ["", ...[...new Set(todas.map((f) => f.cliente))].sort()], ui.cliente, (v) => { ui.cliente = v; re(); }, "Todos"),
      sel("Acción", ["", "SUBIR", "BAJAR", "MANTENER"], ui.accion, (v) => { ui.accion = v; re(); }, "Todas"),
      el("label", { class: "f" }, [el("span", {}, "Buscar"), el("input", { type: "search", value: ui.q, placeholder: "producto o fruta",
        oninput: (e) => { ui.q = e.target.value; clearTimeout(ui.t); ui.t = setTimeout(() => { re(); cont.querySelector("input[type=search]")?.focus(); }, 250); } })]),
      el("label", { class: "f chk" }, [el("input", { type: "checkbox", checked: ui.personal, onchange: (e) => { ui.personal = e.target.checked; re(); } }), "incluir personal y volumen bajo"]),
    ]),
    el("div", { class: "kpis" }, [
      kpi("A subir", `${subir.length}`, `de ${filas.length} producto·cliente`),
      kpi("Margen en juego / mes", usd(riesgo, 0), "si nadie ajusta precio", riesgo > 0 ? "rojo" : ""),
      kpi("Pueden bajar", `${filas.filter((f) => f.accion === "BAJAR").length}`, "fruta por debajo de la referencia"),
      kpi("Sobre política MP/PVP", `${filas.filter((f) => f.sobrePolitica).length}`, `aun ajustando (> ${(CONFIG.params.mp_pvp_politica * 100).toFixed(0)}%)`),
    ]),
    el("p", { class: "nota" }, [el("b", {}, "Posible"), " = mínimo para sostener el margen de aportación con el precio actual de la fruta. ",
      el("b", {}, "Objetivo"), ` = a lo que se apunta: cubre el máximo esperado por Compras${ui.modo === "quincenal" ? " en las dos últimas semanas" : ""}. Precios por unidad de venta.`])
  );

  const porCli = {};
  for (const f of filas) (porCli[f.cliente] ||= []).push(f);
  const clientes = Object.entries(porCli).sort((a, b) => b[1].reduce((s, f) => s + Math.abs(f.impactoMes), 0) - a[1].reduce((s, f) => s + Math.abs(f.impactoMes), 0));
  if (!clientes.length) cont.appendChild(el("div", { class: "vacio chico" }, "Ningún producto con esos filtros."));

  for (const [cli, fs] of clientes) {
    const imp = fs.reduce((s, f) => s + f.impactoMes, 0);
    const tbody = el("tbody");
    fs.sort((a, b) => b.impactoMes - a.impactoMes).forEach((f) => {
      const k = `${f.code}|${f.cliente_id}`;
      const tr = el("tr", { class: "fila " + f.accion.toLowerCase(), onclick: (e) => { if (e.target.type === "checkbox") return; ui.abierto = ui.abierto === k ? null : k; re(); } }, [
        el("td", {}, puedeAprobar() ? el("input", { type: "checkbox", "aria-label": "Seleccionar", checked: ui.sel.has(k), onchange: (e) => { e.target.checked ? ui.sel.add(k) : ui.sel.delete(k); barraSel(); } }) : null),
        el("td", {}, [el("div", { class: "prod" }, [f.producto, f.sobrePolitica ? el("span", { class: "pol", title: "MP/PVP sobre política aun con el ajuste" }, " ● política") : null]),
          el("div", { class: "mini" }, `${f.code} · ${f.frutas.map(titulo).join(", ")} · ref. ${f.ref}`)]),
        el("td", { class: "num" }, [usd(f.pvpU), el("div", { class: "mini" }, f.pvp_fecha)]),
        el("td", { class: "num" }, [el("b", {}, usd(f.posibleU)), el("div", { class: "delta " + claseDelta(f.dPos) }, pct(f.dPos))]),
        el("td", { class: "num" }, [el("b", {}, usd(f.objetivoU)), el("div", { class: "delta " + claseDelta(f.dObj) }, pct(f.dObj))]),
        el("td", { class: "num" }, [pct(f.margen, false), el("div", { class: "mini" }, `sin ajuste ${pct(1 - f.mpPvpSinCambio, false)}`)]),
        el("td", { class: "num" }, num(f.kg_mes)),
        el("td", { class: "num" }, usd(f.impactoMes, 0)),
      ]);
      tbody.appendChild(tr);
      if (ui.abierto === k) tbody.appendChild(el("tr", { class: "detalle" }, el("td", { colspan: 8 }, detalle(f, esc))));
    });
    cont.appendChild(el("section", { class: "card cliente" }, [
      el("div", { class: "cli-cab" }, [el("h2", {}, cli), el("span", { class: "mini" }, `${fs[0].canal.toLowerCase()} · ${fs.length} productos · margen en juego ${usd(imp, 0)}/mes`)]),
      el("div", { class: "scroll" }, el("table", { class: "tabla" }, [
        el("thead", {}, el("tr", {}, ["", "Producto", "Vigente", "Posible", "Objetivo", "Margen aport.", "kg/mes", "$/mes en juego"].map((h, i) => el("th", { class: i > 1 ? "num" : "" }, h)))),
        tbody,
      ])),
    ]));
  }

  const barra = el("div", { class: "barra-sel hidden" });
  cont.appendChild(barra);
  function barraSel() {
    const elegidas = todas.filter((f) => ui.sel.has(`${f.code}|${f.cliente_id}`));
    barra.classList.toggle("hidden", !elegidas.length);
    clear(barra);
    barra.append(
      el("span", {}, `${elegidas.length} seleccionados · registrar precio aplicado con el cliente:`),
      el("button", { class: "btn btn-sec", onclick: () => aprobar(elegidas, "posible", esc) }, "Al posible"),
      el("button", { class: "btn btn-verde", onclick: () => aprobar(elegidas, "objetivo", esc) }, "Al objetivo"),
      el("button", { class: "btn-x", title: "Limpiar selección", onclick: () => { ui.sel.clear(); re(); } }, "×")
    );
  }
  barraSel();

  async function aprobar(fs, cual, esc) {
    if (!confirm(`¿Registrar ${fs.length} precios al ${cual}? Desde ahora esos clientes se miden contra esta semana.`)) return;
    const ref = cual === "posible" ? esc.actual : esc.maximo;
    const reg = fs.map((f) => ({ ...f, precioU: cual === "posible" ? f.posibleU : f.objetivoU, precioKg: cual === "posible" ? f.posibleKg : f.objetivoKg }));
    try {
      await datos.aprobar(reg, s0.semana, ref, estado.usuario.correo);
      await recargar();
      ui.sel.clear();
      toast(`${fs.length} precios registrados`);
      re();
    } catch (e) {
      toast("No se pudo registrar: " + e.message, "err");
    }
  }
}


function detalle(f, esc) {
  const ref = f.aprobado?.RefFrutas ? JSON.parse(f.aprobado.RefFrutas) : esc.presupuesto;
  const filas = f.receta.ingredientes.map((ing) => {
    const m = CONFIG.mapeo[ing.code];
    const p = (fr) => precioIngrediente(ing, CONFIG.mapeo, fr, esc.presupuesto);
    return el("tr", { class: m ? "" : "dim" }, [
      el("td", {}, [ing.name, el("div", { class: "mini" }, ing.code + (m ? ` → ${titulo(m.fruta)}${m.factor ? ` ×${m.factor}` : ""}` : " · sin precio semanal, costo Odoo"))]),
      el("td", { class: "num" }, ing.kg_x_kg.toFixed(3)),
      el("td", { class: "num" }, usd(p(ref), 3)), el("td", { class: "num" }, usd(p(esc.actual), 3)), el("td", { class: "num" }, usd(p(esc.maximo), 3)),
    ]);
  });
  return el("div", { class: "det" }, [
    el("table", { class: "tabla mini-tabla" }, [
      el("thead", {}, el("tr", {}, ["Ingrediente por kg de producto", "kg/kg", "Referencia", "Actual", "Máximo"].map((h, i) => el("th", { class: i ? "num" : "" }, h)))),
      el("tbody", {}, [...filas,
        el("tr", { class: "dim" }, [el("td", {}, "Otros MP (concentrados, aditivos, empaque)"), el("td"), ...[0, 0, 0].map(() => el("td", { class: "num" }, usd(f.receta.otros_mp_kg, 3)))]),
        el("tr", { class: "tot" }, [el("td", {}, "Costo MP por kg"), el("td"), el("td", { class: "num" }, usd(f.costoRef, 3)), el("td", { class: "num" }, usd(f.costoAct, 3)), el("td", { class: "num" }, usd(f.costoMax, 3))]),
        el("tr", { class: "tot" }, [el("td", {}, "Precio por kg (mismo MP/PVP)"), el("td"), el("td", { class: "num" }, usd(f.pvpKg, 3)), el("td", { class: "num" }, usd(f.posibleKg, 3)), el("td", { class: "num" }, usd(f.objetivoKg, 3))]),
      ]),
    ]),
    el("p", { class: "mini" }, `Receta real de ${f.receta.n_ordenes} órdenes de producción desde ${estado.recetas.desde_recetas || "abril"}. Unidad de venta = ${f.peso_kg} kg. MP/PVP que se sostiene: ${pct(1 - f.margen, false)} (referencia: ${f.ref}).`),
    el("p", { class: "mini" }, [
      `Precio al cliente: primera factura del año ${usd(f.pvp_inicio_kg * f.peso_kg)} (${f.pvp_inicio_fecha || "—"}) → vigente ${usd(f.pvpU)}. `,
      f.mp_pvp_hist ? `MP/PVP real últimos 3 meses: ${pct(f.mp_pvp_hist, false)} (margen ${pct(1 - f.mp_pvp_hist, false)}, ${f.n_ordenes_hist} órdenes).` : "Sin órdenes en los últimos 3 meses para medir el margen real.",
    ]),
  ]);
}

// Sin proceso automático (no hay permisos de aplicación), Sistemas corre
// extraer_recetas.py en su equipo y sube aquí el recetas.json resultante.
async function actualizarRecetas(e) {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const txt = await f.text();
    const d = JSON.parse(txt);
    if (!d.productos || !d.ventas) throw new Error("no es un recetas.json válido");
    await datos.subirRecetas(txt);
    toast(`Datos de Odoo actualizados (${d.generado})`);
    setTimeout(() => location.reload(), 900);
  } catch (err) {
    toast("No se pudo actualizar: " + err.message, "err");
  }
}

function kpi(t, v, s, cls = "") {
  return el("div", { class: "kpi" }, [el("span", {}, t), el("b", { class: cls }, v), el("small", {}, s)]);
}
function sel(t, ops, val, on, todos) {
  return el("label", { class: "f" }, [el("span", {}, t), el("select", { onchange: (e) => on(e.target.value) },
    ops.map((o) => el("option", { value: o, selected: o === val }, o || todos)))]);
}
function seg(t, ops, val, on) {
  return el("div", { class: "f" }, [el("span", {}, t), el("div", { class: "seg", role: "group" },
    ops.map(([v, l]) => el("button", { class: v === val ? "on" : "", "aria-pressed": v === val, onclick: () => on(v) }, l)))]);
}

function exportar(filas) {
  const s = estado.semanas[0].semana;
  const rows = filas.map((f) => ({
    Cliente: f.cliente, Canal: f.canal, Código: f.code, Producto: f.producto, Frutas: f.frutas.join(", "), Acción: f.accion,
    "Vigente $/u": f.pvpU, "Posible $/u": f.posibleU, "Δ posible": +f.dPos.toFixed(4), "Objetivo $/u": f.objetivoU, "Δ objetivo": +f.dObj.toFixed(4),
    "Margen aportación": +f.margen.toFixed(4), "kg/mes": f.kg_mes, "$/mes en juego": Math.round(f.impactoMes), "Última factura": f.pvp_fecha, Referencia: f.ref,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Precios por cliente");
  XLSX.writeFile(wb, `Precios_Fruta_${s}_${ui.modo}.xlsx`);
}
