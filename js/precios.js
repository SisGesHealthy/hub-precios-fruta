// Precios por cliente: vigente → posible (piso para sostener el margen) →
// objetivo (a lo que se apunta, cubre el máximo esperado). Gerencia registra aquí
// el precio PACTADO con cada cliente; ese pactado se vuelve la nueva referencia de
// la fila (para no volver a cobrar la misma alza la semana siguiente) y queda en el
// historial del producto. Se puede navegar a cualquier semana cargada.
import { CONFIG } from "./config.js";
import { el, clear, toast } from "./dom.js";
import { datos } from "./datos.js";
import { estado, recargar, puedeAprobar } from "./app.js";
import { calcularFilas, historiaFila } from "./calculo.js";
import { precioIngrediente } from "./motor.js";
import { semanaObjetivo, rangoSemana, semanaCorta, titulo, usd, pct, num, claseDelta, leerNum, lunesDeSemana } from "./util.js";

const ui = { modo: CONFIG.params.modo, cliente: "", accion: "", q: "", personal: false, abierto: null, sel: new Set(), semana: null };

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
  const lista = estado.semanas.map((s) => s.semana); // nueva primero
  if (!lista.includes(ui.semana)) ui.semana = lista[0];
  const idx = lista.indexOf(ui.semana);
  const semanasHasta = estado.semanas.slice(idx); // la elegida y las anteriores
  const s0 = semanasHasta[0];
  const obj = semanaObjetivo().semana;
  const { esc, filas: todas } = calcularFilas(estado.recetas, semanasHasta, estado.aprobados, { modo: ui.modo, solo_empresas: !ui.personal });
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
        el("p", { class: "sub" }, [
          el("span", { class: "nav-sem" }, [
            el("button", { class: "btn-nav", title: "Semana anterior", "aria-label": "Semana anterior", disabled: idx >= lista.length - 1, onclick: () => { ui.semana = lista[idx + 1]; re(); } }, "‹"),
            el("select", { class: "sel-semana", "aria-label": "Semana", onchange: (e) => { ui.semana = e.target.value; re(); } },
              lista.map((w) => el("option", { value: w, selected: w === ui.semana }, `Fruta de ${semanaCorta(w)} · ${rangoSemana(w)}`))),
            el("button", { class: "btn-nav", title: "Semana siguiente", "aria-label": "Semana siguiente", disabled: idx <= 0, onclick: () => { ui.semana = lista[idx - 1]; re(); } }, "›"),
          ]),
          idx > 0 ? el("span", { class: "chip pend" }, "viendo una semana pasada") : null,
          idx === 0 && s0.semana !== obj ? el("span", { class: "chip pend" }, `aún no se carga ${semanaCorta(obj)}`) : null,
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
      el("label", { class: "f chk" }, [el("input", { type: "checkbox", checked: ui.personal, onchange: (e) => { ui.personal = e.target.checked; re(); } }), "incluir ventas al personal"]),
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
        el("td", { class: "num" }, [usd(f.pvpU), el("div", { class: "mini" }, f.pvp_fecha),
          f.pactado ? el("div", { class: "mini pactado", title: "Último precio pactado registrado" }, `pactado ${usd(+f.pactado.PrecioU)} · ${semanaCorta(f.pactado.Semana)}`) : null]),
        el("td", { class: "num" }, [el("b", {}, usd(f.posibleU)), el("div", { class: "delta " + claseDelta(f.dPos) }, pct(f.dPos))]),
        el("td", { class: "num" }, [el("b", {}, usd(f.objetivoU)), el("div", { class: "delta " + claseDelta(f.dObj) }, pct(f.dObj))]),
        el("td", { class: "num" }, [pct(f.margen, false), el("div", { class: "mini" }, `sin ajuste ${pct(1 - f.mpPvpSinCambio, false)}`)]),
        el("td", { class: "num" }, num(f.kg_mes)),
        el("td", { class: "num" }, usd(f.impactoMes, 0)),
      ]);
      tbody.appendChild(tr);
      if (ui.abierto === k) tbody.appendChild(el("tr", { class: "detalle" }, el("td", { colspan: 8 }, detalle(f, esc, s0.semana, re))));
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
      el("span", {}, `${elegidas.length} seleccionados · registrar como pactado (${semanaCorta(s0.semana)}):`),
      el("button", { class: "btn btn-sec", onclick: () => aprobar(elegidas, "posible") }, "El posible"),
      el("button", { class: "btn btn-verde", onclick: () => aprobar(elegidas, "objetivo") }, "El objetivo"),
      el("button", { class: "btn-x", title: "Limpiar selección", onclick: () => { ui.sel.clear(); re(); } }, "×")
    );
  }
  barraSel();

  async function aprobar(fs, cual) {
    if (!confirm(`¿Registrar ${fs.length} precios pactados al ${cual}? Desde ahora esos clientes se miden contra la fruta de ${semanaCorta(s0.semana)}.`)) return;
    const reg = fs.map((f) => ({ ...f, precioU: cual === "posible" ? f.posibleU : f.objetivoU }));
    ui.sel.clear();
    await pactar(reg, s0.semana, esc, re);
  }
}

// Registra precios pactados. La referencia de fruta es el precio ACTUAL de la semana
// del pacto: desde ahí, el posible de esa fila = pactado × costo(fruta nueva) ÷ costo(fruta del pacto).
async function pactar(filas, semana, esc, re) {
  const reg = filas.map((f) => ({ code: f.code, cliente: f.cliente, cliente_id: f.cliente_id, precioU: f.precioU, precioKg: f.precioU / f.peso_kg }));
  try {
    await datos.aprobar(reg, semana, esc.actual, estado.usuario.correo);
    await recargar();
    toast(reg.length === 1 ? "Precio pactado registrado" : `${reg.length} precios pactados registrados`);
    re();
  } catch (e) {
    toast("No se pudo registrar: " + e.message, "err");
  }
}


function detalle(f, esc, semana, re) {
  const ref = f.pactado?.RefFrutas ? JSON.parse(f.pactado.RefFrutas) : esc.presupuesto;
  const filas = f.receta.ingredientes.map((ing) => {
    const m = CONFIG.mapeo[ing.code];
    const p = (fr) => precioIngrediente(ing, CONFIG.mapeo, fr, esc.presupuesto);
    return el("tr", { class: m ? "" : "dim" }, [
      el("td", {}, [ing.name, el("div", { class: "mini" }, ing.code + (m ? ` → ${titulo(m.fruta)}${m.factor ? ` ×${m.factor}` : ""}` : " · sin precio semanal, costo Odoo"))]),
      el("td", { class: "num" }, ing.kg_x_kg.toFixed(3)),
      el("td", { class: "num" }, usd(p(ref), 3)), el("td", { class: "num" }, usd(p(esc.actual), 3)), el("td", { class: "num" }, usd(p(esc.maximo), 3)),
    ]);
  });
  const inPactado = el("input", { inputmode: "decimal", class: "in-pactado", value: f.posibleU.toFixed(2), "aria-label": "Precio pactado por unidad" });
  const pactos = [...f.pactados].reverse();
  return el("div", { class: "det" }, [
    el("div", { class: "det-grid" }, [
      el("div", {}, [el("h3", {}, "Historial de precio de este producto"), graficoHistoria(f)]),
      el("div", { class: "pacto" }, [
        el("h3", {}, "Precio pactado con el cliente"),
        puedeAprobar() ? el("div", { class: "pacto-form" }, [
          el("label", {}, ["$ por unidad", inPactado]),
          el("button", { class: "btn btn-verde", onclick: async () => {
            const v = leerNum(inPactado.value);
            if (!(v > 0)) return toast("Escribe el precio pactado", "err");
            if (!confirm(`¿Registrar ${usd(v)} como precio pactado de ${f.producto} con ${f.cliente} (${semanaCorta(semana)})?`)) return;
            await pactar([{ ...f, precioU: v }], semana, esc, re);
          } }, `Registrar (${semanaCorta(semana)})`),
        ]) : null,
        el("p", { class: "mini" }, `Sugerido: posible ${usd(f.posibleU)} · objetivo ${usd(f.objetivoU)}. Registra el que el cliente confirmó.`),
        pactos.length ? el("table", { class: "tabla mini-tabla" }, [
          el("thead", {}, el("tr", {}, ["Semana", "Pactado", "Registró"].map((h, i) => el("th", { class: i === 1 ? "num" : "" }, h)))),
          el("tbody", {}, pactos.map((x) => el("tr", {}, [el("td", {}, semanaCorta(x.Semana)), el("td", { class: "num" }, usd(+x.PrecioU)), el("td", { class: "mini" }, (x.AprobadoPor || "").split("@")[0])]))),
        ]) : el("p", { class: "mini" }, "Aún no hay precios pactados para este producto y cliente."),
      ]),
    ]),
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

// Historial: lo facturado en Odoo (cada factura), lo sugerido cada semana cargada
// (posible y objetivo) y lo pactado. Una sola escala: $ por unidad de venta.
const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
function graficoHistoria(f) {
  const t = (d) => new Date(d.length === 10 ? d + "T12:00:00" : d).getTime();
  const tSem = (w) => lunesDeSemana(w).getTime() + 3 * 86400000; // mitad de la semana
  const fact = (f.historial || [[f.pvp_fecha, f.pvp_kg]]).map(([d, kg]) => ({ x: t(d), y: kg * f.peso_kg, d }));
  const sug = historiaFila(estado.recetas, estado.semanas, estado.aprobados, { modo: ui.modo }, f.code, f.cliente_id).map((x) => ({ ...x, x: tSem(x.semana) }));
  const pac = f.pactados.map((x) => ({ x: tSem(x.Semana), y: +x.PrecioU, semana: x.Semana }));
  const xs = [...fact, ...sug, ...pac].map((p) => p.x);
  const ys = [...fact.map((p) => p.y), ...sug.flatMap((x) => [x.posibleU, x.objetivoU]), ...pac.map((p) => p.y)];
  if (!xs.length) return el("p", { class: "mini" }, "Sin datos.");
  const W = 560, H = 210, P = { l: 52, r: 12, t: 12, b: 26 };
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x1 - x0 < 14 * 86400000) { x0 -= 7 * 86400000; x1 += 7 * 86400000; }
  const lo = Math.min(...ys) * 0.96, hi = Math.max(...ys) * 1.03;
  const X = (v) => P.l + ((v - x0) / (x1 - x0)) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - (v - lo) / (hi - lo || 1)) * (H - P.t - P.b);
  const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "spark hist", role: "img", "aria-label": `Historial de precio de ${f.producto}` });
  [lo, (lo + hi) / 2, hi].forEach((v) => {
    g.appendChild(svg("line", { x1: P.l, x2: W - P.r, y1: Y(v), y2: Y(v), class: "grid" }));
    const tx = svg("text", { x: P.l - 6, y: Y(v) + 4, class: "ax", "text-anchor": "end" });
    tx.textContent = "$" + v.toFixed(2);
    g.appendChild(tx);
  });
  const fmtF = (ms) => new Date(ms).toLocaleDateString("es-EC", { day: "numeric", month: "short" });
  [[x0, "start"], [x1, "end"]].forEach(([v, a]) => {
    const tx = svg("text", { x: X(v), y: H - 6, class: "ax", "text-anchor": a });
    tx.textContent = fmtF(v);
    g.appendChild(tx);
  });
  // facturado: escalón (cada precio vale hasta la siguiente factura)
  if (fact.length) {
    let d = `M${X(fact[0].x)},${Y(fact[0].y)}`;
    fact.slice(1).forEach((p) => (d += `H${X(p.x)}V${Y(p.y)}`));
    g.appendChild(svg("path", { d: d + `H${X(x1)}`, class: "l-fact" }));
  }
  const linea = (pts, k, cls) => { if (pts.length > 1) g.appendChild(svg("path", { d: pts.map((p, i) => `${i ? "L" : "M"}${X(p.x)},${Y(p[k])}`).join(""), class: cls })); };
  linea(sug, "objetivoU", "l-maximo");
  linea(sug, "posibleU", "l-actual");
  const tip = el("div", { class: "tip hidden", role: "tooltip" });
  const marca = (cx, cy, cls, texto, rombo) => {
    g.appendChild(rombo ? svg("path", { d: `M${cx},${cy - 6}L${cx + 6},${cy}L${cx},${cy + 6}L${cx - 6},${cy}Z`, class: cls }) : svg("circle", { cx, cy, r: 4, class: cls }));
    const hit = svg("circle", { cx, cy, r: 10, fill: "transparent" });
    hit.addEventListener("mouseenter", () => { tip.innerHTML = texto; tip.classList.remove("hidden"); });
    hit.addEventListener("mousemove", (e) => { tip.style.left = e.clientX + 14 + "px"; tip.style.top = e.clientY + 14 + "px"; });
    hit.addEventListener("mouseleave", () => tip.classList.add("hidden"));
    g.appendChild(hit);
  };
  fact.forEach((p) => marca(X(p.x), Y(p.y), "p-fact", `<b>Facturado</b> ${p.d}<br>${usd(p.y)} por unidad`));
  sug.forEach((p) => {
    marca(X(p.x), Y(p.objetivoU), "p-maximo", `<b>${semanaCorta(p.semana)}</b><br>Objetivo ${usd(p.objetivoU)}<br>Posible ${usd(p.posibleU)}`);
    marca(X(p.x), Y(p.posibleU), "p-actual", `<b>${semanaCorta(p.semana)}</b><br>Posible ${usd(p.posibleU)}<br>Objetivo ${usd(p.objetivoU)}`);
  });
  pac.forEach((p) => marca(X(p.x), Y(p.y), "p-pactado", `<b>Pactado ${semanaCorta(p.semana)}</b><br>${usd(p.y)} por unidad`, true));
  return el("div", {}, [
    el("div", { class: "leyenda" }, [
      el("span", {}, [el("i", { class: "sw fact" }), "Facturado (Odoo)"]),
      el("span", {}, [el("i", { class: "sw actual" }), "Posible"]),
      el("span", {}, [el("i", { class: "sw maximo" }), "Objetivo"]),
      el("span", {}, [el("i", { class: "sw pactado" }), "Pactado"]),
    ]),
    g, tip,
  ]);
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
  const s = ui.semana;
  const rows = filas.map((f) => ({
    Cliente: f.cliente, Canal: f.canal, Código: f.code, Producto: f.producto, Frutas: f.frutas.join(", "), Acción: f.accion,
    "Vigente $/u": f.pvpU, "Posible $/u": f.posibleU, "Δ posible": +f.dPos.toFixed(4), "Objetivo $/u": f.objetivoU, "Δ objetivo": +f.dObj.toFixed(4),
    "Pactado $/u": f.pactado ? +f.pactado.PrecioU : "", "Pactado semana": f.pactado ? f.pactado.Semana : "",
    "Margen aportación": +f.margen.toFixed(4), "kg/mes": f.kg_mes, "$/mes en juego": Math.round(f.impactoMes), "Última factura": f.pvp_fecha, Referencia: f.ref,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Precios por cliente");
  XLSX.writeFile(wb, `Precios_Fruta_${s}_${ui.modo}.xlsx`);
}
