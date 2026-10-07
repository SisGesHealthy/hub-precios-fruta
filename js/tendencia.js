// Tendencia por fruta: un mini-gráfico por fruta (mismas escalas de tiempo),
// actual = línea verde, máximo esperado = azul punteado, presupuesto = guía gris.
// Paleta validada con el validador de dataviz (claro y oscuro).
import { el, clear } from "./dom.js";
import { estado } from "./app.js";
import { semanaCorta, titulo, usd, pct, claseDelta } from "./util.js";

const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

export function vistaTendencia(root) {
  const sems = [...estado.semanas].reverse(); // vieja → nueva
  root.appendChild(el("div", { class: "cab" }, el("div", {}, [
    el("h1", { class: "titulo" }, "Tendencia de la fruta"),
    el("p", { class: "sub" }, `${sems.length} semanas cargadas · $/kg`),
  ])));
  if (!sems.length) return root.appendChild(el("div", { class: "vacio" }, "Sin semanas cargadas."));
  root.appendChild(el("div", { class: "leyenda" }, [
    el("span", {}, [el("i", { class: "sw actual" }), "Actual"]),
    el("span", {}, [el("i", { class: "sw maximo" }), "Máximo esperado"]),
    el("span", {}, [el("i", { class: "sw presup" }), "Presupuesto"]),
    el("span", {}, [el("i", { class: "sw lleno" }), "Semana comprada"]),
    el("span", {}, [el("i", { class: "sw hueco" }), "No se compró"]),
  ]));
  const frutas = Object.keys(sems[sems.length - 1].frutas).sort();
  const tip = el("div", { class: "tip hidden", role: "tooltip" });
  const grid = el("div", { class: "multiples" });
  for (const f of frutas) grid.appendChild(mini(f, sems, tip));
  root.append(grid, tip);
}

function mini(fruta, sems, tip) {
  const W = 300, H = 120, P = { l: 40, r: 10, t: 10, b: 20 };
  const pts = sems.map((s) => s.frutas[fruta] || null);
  const vals = pts.filter(Boolean).flatMap((v) => [v.actual, v.maximo, v.presupuesto]);
  const lo = Math.min(...vals) * 0.95, hi = Math.max(...vals) * 1.03;
  const x = (i) => P.l + (sems.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (sems.length - 1));
  const y = (v) => P.t + (1 - (v - lo) / (hi - lo || 1)) * (H - P.t - P.b);
  const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "spark", role: "img", "aria-label": `Precio de ${titulo(fruta)} por semana` });

  // eje: 3 marcas recesivas
  [lo, (lo + hi) / 2, hi].forEach((v) => {
    s.appendChild(svg("line", { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: "grid" }));
    const t = svg("text", { x: P.l - 6, y: y(v) + 4, class: "ax", "text-anchor": "end" });
    t.textContent = v.toFixed(2);
    s.appendChild(t);
  });
  [0, sems.length - 1].forEach((i) => {
    const t = svg("text", { x: x(i), y: H - 4, class: "ax", "text-anchor": i ? "end" : "start" });
    t.textContent = semanaCorta(sems[i].semana);
    s.appendChild(t);
  });
  const ultimo = pts[pts.length - 1];
  if (ultimo) s.appendChild(svg("line", { x1: P.l, x2: W - P.r, y1: y(ultimo.presupuesto), y2: y(ultimo.presupuesto), class: "l-presup" }));
  const linea = (campo, cls) => {
    const d = pts.map((p, i) => (p ? `${i && pts[i - 1] ? "L" : "M"}${x(i)},${y(p[campo])}` : "")).join("");
    s.appendChild(svg("path", { d, class: cls }));
  };
  linea("maximo", "l-maximo");
  linea("actual", "l-actual");
  // punto lleno = esa semana sí se compró; hueco = solo precio de referencia
  pts.forEach((p, i) => p && s.appendChild(svg("circle", { cx: x(i), cy: y(p.actual), r: i === pts.length - 1 ? 4 : 3, class: p.comprado ? "p-actual" : "p-hueco" })));

  // capa de hover: una franja por semana (objetivo más grande que el punto)
  const cross = svg("line", { y1: P.t, y2: H - P.b, class: "cross hidden" });
  s.appendChild(cross);
  pts.forEach((p, i) => {
    if (!p) return;
    const ancho = (W - P.l - P.r) / Math.max(1, sems.length - 1);
    const r = svg("rect", { x: x(i) - ancho / 2, y: 0, width: ancho, height: H, fill: "transparent" });
    r.addEventListener("mouseenter", (e) => {
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.classList.remove("hidden");
      tip.innerHTML = `<b>${titulo(fruta)} · ${semanaCorta(sems[i].semana)}</b><br>Actual ${usd(p.actual)}${p.comprado ? " · comprada" : " · no se compró"}<br>Máximo ${usd(p.maximo)}<br>Presupuesto ${usd(p.presupuesto)}`;
      tip.classList.remove("hidden");
    });
    r.addEventListener("mousemove", (e) => { tip.style.left = e.clientX + 14 + "px"; tip.style.top = e.clientY + 14 + "px"; });
    r.addEventListener("mouseleave", () => { cross.classList.add("hidden"); tip.classList.add("hidden"); });
    s.appendChild(r);
  });

  const prev = pts.length > 1 ? pts[pts.length - 2] : null;
  const dSem = ultimo && prev ? ultimo.actual / prev.actual - 1 : null;
  const dPre = ultimo ? ultimo.actual / ultimo.presupuesto - 1 : null;
  return el("figure", { class: "card mult" }, [
    el("figcaption", {}, [el("b", {}, titulo(fruta)), el("span", {}, [usd(ultimo?.actual), " ",
      el("span", { class: "delta " + claseDelta(dSem), title: "vs semana anterior" }, pct(dSem)), " · ",
      el("span", { class: "delta " + claseDelta(dPre), title: "vs presupuesto" }, `${pct(dPre)} presup.`)])]),
    s,
  ]);
}
