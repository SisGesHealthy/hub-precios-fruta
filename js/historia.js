// Gráfico de historial de precio de venta de UN producto×cliente: lo facturado en
// Odoo (escalón: cada precio vale hasta la siguiente factura), el posible y el
// objetivo de cada semana cargada y los precios pactados. Una sola escala: $ por
// unidad de venta. Paleta validada (dataviz): posible verde, objetivo azul
// punteado, pactado naranja con forma de rombo, facturado en tinta neutra.
import { el } from "./dom.js";
import { estado } from "./app.js";
import { historiaFila } from "./calculo.js";
import { semanaCorta, usd, lunesDeSemana } from "./util.js";

const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
export function graficoHistoria(f, modo) {
  const t = (d) => new Date(d.length === 10 ? d + "T12:00:00" : d).getTime();
  const tSem = (w) => lunesDeSemana(w).getTime() + 3 * 86400000; // mitad de la semana
  const fact = (f.historial || (f.manual ? [] : [[f.pvp_fecha, f.pvp_kg]])).map(([d, kg]) => ({ x: t(d), y: kg * f.peso_kg, d }));
  const sug = historiaFila(estado.recetas, estado.semanas, estado.aprobados, { modo }, f.code, f.cliente_id).map((x) => ({ ...x, x: tSem(x.semana) }));
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

