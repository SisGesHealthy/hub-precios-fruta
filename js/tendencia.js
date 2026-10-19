// Tendencias: cómo se movió el precio de cada fruta semana a semana (incluye el histórico
// importado de Odoo) y, abajo, el precio de venta por producto.
// actual = línea verde, máximo = azul punteado, presupuesto = guía gris, kg = barras.
// Paleta validada con el validador de dataviz (claro y oscuro).
import { el, clear } from "./dom.js";
import { estado } from "./app.js";
import { calcularFilas } from "./calculo.js";
import { graficoHistoria } from "./historia.js";
import { abrirInforme } from "./informe.js";
import { semanaCorta, semanasDesde, rangoSemana, titulo, usd, pct, claseDelta } from "./util.js";

const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

const sel = { cliente: "", code: "" };

// Precio de venta de un producto×cliente en el tiempo (mismo gráfico que el detalle de Precios).
function seccionVenta(root) {
  const { filas } = calcularFilas(estado.recetas, estado.semanas, estado.aprobados, {});
  const clientes = [...new Set(filas.map((f) => f.cliente))].sort();
  if (!clientes.includes(sel.cliente)) sel.cliente = clientes.includes("PROBA UE") ? "PROBA UE" : clientes[0];
  const prods = filas.filter((f) => f.cliente === sel.cliente).sort((a, b) => b.kg_mes - a.kg_mes);
  if (!prods.some((f) => f.code === sel.code)) sel.code = prods[0]?.code;
  const f = prods.find((x) => x.code === sel.code);
  const caja = el("section", { class: "card venta" });
  const pintar = () => { root.replaceChild(seccionVenta(root), caja); };
  caja.append(
    el("div", { class: "cab" }, [
      el("div", {}, [el("h2", {}, "Precio de venta por producto"), el("p", { class: "nota" }, "Facturado en Odoo, sugerido cada semana (posible / objetivo) y pactado. $ por unidad de venta.")]),
      el("div", { class: "filtros" }, [
        el("label", { class: "f" }, [el("span", {}, "Cliente"), el("select", { onchange: (e) => { sel.cliente = e.target.value; pintar(); } },
          clientes.map((c) => el("option", { value: c, selected: c === sel.cliente }, c)))]),
        el("label", { class: "f" }, [el("span", {}, "Producto"), el("select", { onchange: (e) => { sel.code = e.target.value; pintar(); } },
          prods.map((x) => el("option", { value: x.code, selected: x.code === sel.code }, `${x.code} · ${x.producto}`)))]),
      ]),
    ]),
    f ? graficoHistoria(f, "semanal") : el("p", { class: "nota" }, "Sin productos."),
  );
  return caja;
}

export function vistaTendencia(root) {
  const sems = [...estado.semanas].reverse(); // vieja → nueva (incluye las históricas importadas)
  root.appendChild(el("div", { class: "cab" }, [
    el("div", {}, [
      el("h1", { class: "titulo" }, "Tendencia de la fruta"),
      el("p", { class: "sub" }, sems.length ? `${sems.length} semanas con precio · ${semanaCorta(sems[0].semana)} a ${semanaCorta(sems[sems.length - 1].semana)} · $/kg` : "Sin semanas cargadas"),
    ]),
    sems.length ? el("div", { class: "acciones" }, el("button", { class: "btn btn-verde", onclick: () => abrirInforme(sems) }, "Exportar informe PDF")) : null,
  ]));
  if (sems.length) {
    const cont = el("div");
    root.appendChild(cont);
    pintarFruta(cont, sems);
  }
  if (estado.recetas) root.appendChild(seccionVenta(root));
}

// ---------------------------------------------------------------- fruta ----
// Cómo se movió cada fruta: una gráfica grande de la fruta elegida (precio + kg comprados
// por semana) y una tabla de todas, ordenada por la que más se movió en el periodo.
const tf = { rango: 13, fruta: null };
const RANGOS = [[8, "8 sem"], [13, "13 sem"], [26, "26 sem"], [0, "Todo"]];

// kg comprados: viene en la nota de las semanas importadas ("7.243 kg · 2 compras")
const kgDe = (nota) => {
  const m = String(nota || "").match(/([\d.,]+)\s*kg/);
  return m ? +m[1].replace(/[.,]/g, "") : null;
};

export function serieFruta(fruta, semanasEje, porSemana) {
  return semanasEje.map((w) => {
    const v = porSemana[w]?.frutas[fruta];
    return v ? { semana: w, ...v, kg: kgDe(v.nota) } : null;
  });
}

export function resumen(fruta, serie) {
  const pts = serie.filter(Boolean);
  if (!pts.length) return null;
  const ult = pts[pts.length - 1], pri = pts[0];
  const iUlt = serie.lastIndexOf(ult);
  const hace4 = serie.slice(0, Math.max(0, iUlt - 3)).filter(Boolean).pop(); // último dato con 4+ semanas de antigüedad
  const precios = pts.map((p) => p.actual);
  const kg = pts.reduce((a, p) => a + (p.kg || 0), 0);
  return {
    fruta, serie, ult, pri,
    dRango: pts.length > 1 ? ult.actual / pri.actual - 1 : null,
    d4: hace4 ? ult.actual / hace4.actual - 1 : null,
    min: Math.min(...precios), max: Math.max(...precios),
    dPre: ult.presupuesto ? ult.actual / ult.presupuesto - 1 : null,
    compradas: pts.filter((p) => p.comprado).length, conDato: pts.length, kg,
  };
}

function pintarFruta(cont, sems) {
  clear(cont);
  const todas = semanasDesde(sems[0].semana, sems[sems.length - 1].semana); // eje continuo: las semanas sin dato quedan como hueco
  const eje = tf.rango ? todas.slice(-tf.rango) : todas;
  const porSemana = Object.fromEntries(sems.map((s) => [s.semana, s]));
  const frutas = [...new Set(sems.flatMap((s) => Object.keys(s.frutas)))];
  const filas = frutas.map((f) => resumen(f, serieFruta(f, eje, porSemana))).filter(Boolean)
    .sort((a, b) => Math.abs(b.dRango ?? 0) - Math.abs(a.dRango ?? 0));
  if (!filas.some((r) => r.fruta === tf.fruta)) tf.fruta = filas[0]?.fruta;
  const re = () => pintarFruta(cont, sems);
  const elegida = filas.find((r) => r.fruta === tf.fruta);

  cont.append(
    el("div", { class: "filtros" }, [
      el("div", { class: "f" }, [el("span", {}, "Periodo"), el("div", { class: "seg", role: "group" },
        RANGOS.map(([n, t]) => el("button", { class: n === tf.rango ? "on" : "", "aria-pressed": n === tf.rango, onclick: () => { tf.rango = n; re(); } }, t)))]),
      el("label", { class: "f" }, [el("span", {}, "Fruta"), el("select", { onchange: (e) => { tf.fruta = e.target.value; re(); } },
        filas.map((r) => el("option", { value: r.fruta, selected: r.fruta === tf.fruta }, titulo(r.fruta))))]),
    ]),
    elegida ? detalleFruta(elegida, eje) : el("p", { class: "nota" }, "Sin datos en el periodo."),
    el("section", { class: "card movimientos" }, [
      el("div", { class: "cli-cab" }, [el("h2", {}, "Cómo se movió cada fruta"),
        el("span", { class: "mini" }, `${semanaCorta(eje[0])} a ${semanaCorta(eje[eje.length - 1])} · ordenadas por el mayor cambio · clic para ver el detalle`)]),
      el("div", { class: "scroll" }, el("table", { class: "tabla" }, [
        el("thead", {}, el("tr", {}, ["Fruta", "Evolución", "Último", "vs hace 4 sem", "En el periodo", "Mín – Máx", "vs presupuesto", "Semanas compradas", "kg comprados"]
          .map((h, i) => el("th", { class: i > 1 ? "num" : "" }, h)))),
        el("tbody", {}, filas.map((r) => el("tr", { class: "fila" + (r.fruta === tf.fruta ? " elegida" : ""), onclick: () => { tf.fruta = r.fruta; re(); window.scrollTo({ top: cont.offsetTop - 70, behavior: "smooth" }); } }, [
          el("td", {}, el("b", {}, titulo(r.fruta))),
          el("td", {}, spark(r.serie)),
          el("td", { class: "num" }, [usd(r.ult.actual), el("div", { class: "mini" }, semanaCorta(r.ult.semana))]),
          el("td", { class: "num" }, el("span", { class: "delta " + claseDelta(r.d4) }, pct(r.d4))),
          el("td", { class: "num" }, [el("span", { class: "delta " + claseDelta(r.dRango) }, pct(r.dRango)), el("div", { class: "mini" }, r.conDato > 1 ? `desde ${usd(r.pri.actual)}` : "un solo dato")]),
          el("td", { class: "num" }, `${usd(r.min)} – ${usd(r.max)}`),
          el("td", { class: "num" }, el("span", { class: "delta " + claseDelta(r.dPre) }, pct(r.dPre))),
          el("td", { class: "num" }, `${r.compradas} de ${eje.length}`),
          el("td", { class: "num" }, r.kg ? Math.round(r.kg).toLocaleString("es-EC") : "—"),
        ]))),
      ])),
    ])
  );
}

// minigráfica de la tabla: solo el precio actual (sin ejes); hueco donde no hubo dato
export function spark(serie) {
  const W = 120, H = 28, pts = serie.map((p, i) => (p ? { i, v: p.actual } : null));
  const vs = pts.filter(Boolean).map((p) => p.v);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const X = (i) => 3 + (i * (W - 6)) / Math.max(1, serie.length - 1);
  const Y = (v) => H - 4 - ((v - lo) / (hi - lo || 1)) * (H - 8);
  const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "spark mini-spark", "aria-hidden": "true" });
  g.appendChild(svg("path", { class: "l-actual", d: pts.map((p, k) => (p ? `${k && pts[k - 1] ? "L" : "M"}${X(p.i)},${Y(p.v)}` : "")).join("") }));
  pts.forEach((p, k) => { if (p && (!pts[k - 1] && !pts[k + 1])) g.appendChild(svg("circle", { cx: X(p.i), cy: Y(p.v), r: 1.8, class: "p-actual" })); }); // datos sueltos
  const u = pts.filter(Boolean).pop();
  if (u) g.appendChild(svg("circle", { cx: X(u.i), cy: Y(u.v), r: 2.6, class: "p-actual" }));
  return g;
}

// gráfica grande: precio (actual, máximo, presupuesto) y, debajo con el mismo eje de semanas,
// los kg comprados (dos paneles, no doble eje: son magnitudes distintas)
export function detalleFruta(r, eje) {
  const W = 920, H1 = 240, H2 = 80, GAP = 18, P = { l: 52, r: 14, t: 14, b: 22 };
  const H = P.t + H1 + GAP + H2 + P.b;
  const serie = r.serie;
  const vals = serie.filter(Boolean).flatMap((p) => [p.actual, p.maximo, p.presupuesto]).filter((v) => v > 0);
  const lo = Math.min(...vals) * 0.96, hi = Math.max(...vals) * 1.03;
  const n = eje.length;
  const X = (i) => P.l + (n === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (n - 1));
  const Y = (v) => P.t + (1 - (v - lo) / (hi - lo || 1)) * H1;
  const kgMax = Math.max(1, ...serie.map((p) => p?.kg || 0));
  const yb0 = P.t + H1 + GAP + H2;
  const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "spark det-fruta", role: "img", "aria-label": `Precio y kg comprados de ${titulo(r.fruta)} por semana` });
  [lo, (lo + hi) / 2, hi].forEach((v) => {
    g.appendChild(svg("line", { x1: P.l, x2: W - P.r, y1: Y(v), y2: Y(v), class: "grid" }));
    const t = svg("text", { x: P.l - 6, y: Y(v) + 4, class: "ax", "text-anchor": "end" }); t.textContent = "$" + v.toFixed(2); g.appendChild(t);
  });
  const tk = svg("text", { x: P.l - 6, y: yb0 - H2 + 8, class: "ax", "text-anchor": "end" }); tk.textContent = "kg"; g.appendChild(tk);
  g.appendChild(svg("line", { x1: P.l, x2: W - P.r, y1: yb0, y2: yb0, class: "grid" }));
  const cada = Math.max(1, Math.ceil(n / 9)); // ~9 etiquetas como máximo
  eje.forEach((w, i) => {
    if (i % cada && i !== n - 1) return;
    const t = svg("text", { x: X(i), y: H - 6, class: "ax", "text-anchor": "middle" }); t.textContent = semanaCorta(w); g.appendChild(t);
  });
  const pres = r.ult.presupuesto;
  if (pres > 0) g.appendChild(svg("line", { x1: P.l, x2: W - P.r, y1: Y(pres), y2: Y(pres), class: "l-presup" }));
  // barras de kg (ancho según la cantidad de semanas, 2 px de separación)
  const ancho = Math.max(2, Math.min(26, (W - P.l - P.r) / Math.max(1, n - 1) - 2));
  serie.forEach((p, i) => {
    if (!p?.kg) return;
    const h = (p.kg / kgMax) * (H2 - 4);
    g.appendChild(svg("rect", { x: X(i) - ancho / 2, y: yb0 - h, width: ancho, height: h, rx: 2, class: "b-kg" }));
  });
  const linea = (k, cls) => g.appendChild(svg("path", { class: cls, d: serie.map((p, i) => (p ? `${i && serie[i - 1] ? "L" : "M"}${X(i)},${Y(p[k])}` : "")).join("") }));
  linea("maximo", "l-maximo");
  linea("actual", "l-actual");
  serie.forEach((p, i) => p && g.appendChild(svg("circle", { cx: X(i), cy: Y(p.actual), r: 3.5, class: p.comprado ? "p-actual" : "p-hueco" })));
  // hover por semana
  const tip = el("div", { class: "tip hidden", role: "tooltip" });
  const cross = svg("line", { y1: P.t, y2: yb0, class: "cross hidden" });
  g.appendChild(cross);
  const paso = (W - P.l - P.r) / Math.max(1, n - 1);
  eje.forEach((w, i) => {
    const p = serie[i];
    const hit = svg("rect", { x: X(i) - paso / 2, y: 0, width: paso, height: H, fill: "transparent" });
    hit.addEventListener("mouseenter", () => {
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.classList.remove("hidden");
      tip.innerHTML = `<b>${titulo(r.fruta)} · ${semanaCorta(w)}</b> <span class="mini">${rangoSemana(w)}</span><br>` + (p
        ? `Actual ${usd(p.actual)}${p.comprado ? "" : " (no se compró)"}<br>Máximo ${usd(p.maximo)}<br>Presupuesto ${usd(p.presupuesto)}${p.nota ? "<br>" + p.nota : ""}`
        : "Sin precio esta semana (no se compró)");
      tip.classList.remove("hidden");
    });
    hit.addEventListener("mousemove", (e) => { tip.style.left = e.clientX + 14 + "px"; tip.style.top = e.clientY + 14 + "px"; });
    hit.addEventListener("mouseleave", () => { cross.classList.add("hidden"); tip.classList.add("hidden"); });
    g.appendChild(hit);
  });
  return el("section", { class: "card venta det-card" }, [
    el("div", { class: "cli-cab" }, [
      el("h2", {}, titulo(r.fruta)),
      el("span", {}, [usd(r.ult.actual), " ", el("span", { class: "mini" }, `(${semanaCorta(r.ult.semana)})`), " · ",
        el("span", { class: "delta " + claseDelta(r.dRango), title: "cambio en el periodo" }, `${pct(r.dRango)} en el periodo`), " · ",
        el("span", { class: "delta " + claseDelta(r.dPre) }, `${pct(r.dPre)} vs presupuesto`)]),
    ]),
    el("div", { class: "leyenda" }, [
      el("span", {}, [el("i", { class: "sw actual" }), "Precio actual (ponderado)"]),
      el("span", {}, [el("i", { class: "sw maximo" }), "Máximo pagado / esperado"]),
      el("span", {}, [el("i", { class: "sw presup" }), "Presupuesto"]),
      el("span", {}, [el("i", { class: "sw lleno" }), "Se compró"]),
      el("span", {}, [el("i", { class: "sw hueco" }), "Solo referencia"]),
      el("span", {}, [el("i", { class: "sw kg" }), "kg comprados"]),
    ]),
    g, tip,
  ]);
}
