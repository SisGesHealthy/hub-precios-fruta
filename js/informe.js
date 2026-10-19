// Informe PDF de Tendencias: el usuario elige frutas, periodo y contenido; se arma un
// documento A4 y se usa la impresión del navegador ("Guardar como PDF"), así las
// gráficas salen vectoriales (nítidas) y no se depende de ninguna librería.
import { el, clear, toast } from "./dom.js";
import { estado } from "./app.js";
import { resumen, serieFruta, detalleFruta, spark, chipRiesgo, bloqueAgro } from "./tendencia.js";
import { semanasDesde, semanaCorta, rangoSemana, titulo, usd, pct, claseDelta } from "./util.js";

const opc = { desde: null, hasta: null, frutas: null, umbral: 5, resumen: true, graficas: true, tabla: false,
  titulo: "Informe de precios de fruta", comentario: "" };

export function abrirInforme(sems) {
  const todas = semanasDesde(sems[0].semana, sems[sems.length - 1].semana);
  if (!todas.includes(opc.hasta)) opc.hasta = todas[todas.length - 1];
  if (!todas.includes(opc.desde)) opc.desde = todas[Math.max(0, todas.length - 13)];
  const porSemana = Object.fromEntries(sems.map((s) => [s.semana, s]));
  const nombres = [...new Set(sems.flatMap((s) => Object.keys(s.frutas)))].sort();

  const dlg = el("dialog", { class: "dlg dlg-ancho" });
  const cerrar = () => { dlg.close(); dlg.remove(); };
  const listaFrutas = el("div", { class: "inf-frutas" });
  const eje = () => todas.filter((w) => w >= opc.desde && w <= opc.hasta);
  const datos = () => nombres.map((f) => resumen(f, serieFruta(f, eje(), porSemana))).filter(Boolean)
    .sort((a, b) => Math.abs(b.dRango ?? 0) - Math.abs(a.dRango ?? 0));

  function pintarFrutas() {
    const rs = datos();
    if (!opc.frutas) opc.frutas = new Set(rs.map((r) => r.fruta));
    clear(listaFrutas);
    rs.forEach((r) => listaFrutas.appendChild(el("label", { class: "chk-fruta" }, [
      el("input", { type: "checkbox", checked: opc.frutas.has(r.fruta), onchange: (e) => { e.target.checked ? opc.frutas.add(r.fruta) : opc.frutas.delete(r.fruta); rotulo(); } }),
      el("span", {}, titulo(r.fruta)),
      el("span", { class: "delta " + claseDelta(r.dRango) }, pct(r.dRango)),
    ])));
    rotulo();
  }
  const btn = el("button", { class: "btn btn-verde" }, "");
  const rotulo = () => {
    const n = datos().filter((r) => opc.frutas?.has(r.fruta)).length;
    btn.textContent = `Generar PDF (${n} ${n === 1 ? "fruta" : "frutas"})`;
    btn.disabled = !n;
  };
  const selSemana = (k) => el("select", { onchange: (e) => { opc[k] = e.target.value; if (opc.desde > opc.hasta) [opc.desde, opc.hasta] = [opc.hasta, opc.desde]; pintarFrutas(); } },
    todas.map((w) => el("option", { value: w, selected: w === opc[k] }, `${semanaCorta(w)} · ${rangoSemana(w)}`)));
  const chk = (k, t) => el("label", { class: "f chk" }, [el("input", { type: "checkbox", checked: opc[k], onchange: (e) => (opc[k] = e.target.checked) }), t]);
  const rapido = (t, fn) => el("button", { class: "btn btn-sec btn-chico", onclick: () => { fn(); pintarFrutas(); } }, t);

  btn.onclick = () => {
    const rs = datos().filter((r) => opc.frutas.has(r.fruta));
    cerrar();
    imprimir(rs, eje());
  };
  dlg.append(
    el("h2", {}, "Exportar informe PDF"),
    el("div", { class: "filtros" }, [
      el("label", { class: "f" }, [el("span", {}, "Desde"), selSemana("desde")]),
      el("label", { class: "f" }, [el("span", {}, "Hasta"), selSemana("hasta")]),
    ]),
    el("div", { class: "inf-cab-frutas" }, [
      el("b", {}, "Frutas"),
      rapido("Todas", () => (opc.frutas = new Set(datos().map((r) => r.fruta)))),
      rapido("Ninguna", () => (opc.frutas = new Set())),
      el("span", { class: "mini" }, "o las que se movieron ≥"),
      el("input", { class: "in-pactado in-umbral", inputmode: "decimal", value: opc.umbral, "aria-label": "Umbral de cambio en %", oninput: (e) => (opc.umbral = +String(e.target.value).replace(",", ".") || 0) }),
      rapido("% aplicar", () => (opc.frutas = new Set(datos().filter((r) => Math.abs((r.dRango ?? 0) * 100) >= opc.umbral).map((r) => r.fruta)))),
    ]),
    listaFrutas,
    el("div", { class: "filtros" }, [
      el("span", { class: "f" }, [el("span", {}, "Contenido")]),
      chk("resumen", "Resumen de movimientos"),
      chk("graficas", "Gráfica por fruta (precio y kg)"),
      chk("tabla", "Tabla semana a semana"),
    ]),
    el("label", { class: "f" }, [el("span", {}, "Título"), el("input", { class: "in-texto", value: opc.titulo, oninput: (e) => (opc.titulo = e.target.value) })]),
    el("label", { class: "f" }, [el("span", {}, "Comentario (opcional, sale al inicio)"),
      el("textarea", { class: "in-texto", rows: 3, oninput: (e) => (opc.comentario = e.target.value) }, opc.comentario)]),
    el("p", { class: "nota" }, "Se abrirá la ventana de impresión: en «Destino» elige «Guardar como PDF»."),
    el("div", { class: "acciones dlg-pie" }, [el("button", { class: "btn btn-sec", onclick: cerrar }, "Cancelar"), btn])
  );
  document.body.appendChild(dlg);
  pintarFrutas();
  dlg.showModal();
}

function imprimir(rs, eje) {
  const hoy = new Date().toLocaleDateString("es-EC", { day: "numeric", month: "long", year: "numeric" });
  const conCambio = rs.filter((r) => r.dRango != null);
  const sube = conCambio.filter((r) => r.dRango >= 0.01), baja = conCambio.filter((r) => r.dRango <= -0.01);
  const mayor = [...conCambio].sort((a, b) => b.dRango - a.dRango);
  const sobrePres = rs.filter((r) => (r.dPre ?? 0) > 0.01);
  const kpi = (t, v, s) => el("div", { class: "kpi" }, [el("span", {}, t), el("b", {}, v), s ? el("small", {}, s) : null]);

  const inf = el("div", { class: "informe" }, [
    el("header", { class: "inf-cab" }, [
      el("img", { src: "icons/logo.png", alt: "Healthy Food" }),
      el("div", {}, [
        el("h1", {}, opc.titulo || "Informe de precios de fruta"),
        el("p", {}, `Periodo ${semanaCorta(eje[0])} a ${semanaCorta(eje[eje.length - 1])} (${rangoSemana(eje[0]).split(" – ")[0]} – ${rangoSemana(eje[eje.length - 1]).split(" – ")[1]}) · ${eje.length} semanas · $/kg`),
        el("p", { class: "mini" }, `Generado el ${hoy} por ${estado.usuario?.nombre || ""} · Hub Precios de Fruta`),
      ]),
    ]),
    opc.comentario ? el("p", { class: "inf-comentario" }, opc.comentario) : null,
    el("div", { class: "kpis" }, [
      kpi("Frutas en el informe", String(rs.length)),
      kpi("Subieron", String(sube.length), mayor[0] && mayor[0].dRango > 0 ? `más: ${titulo(mayor[0].fruta)} ${pct(mayor[0].dRango)}` : ""),
      kpi("Bajaron", String(baja.length), mayor.length && mayor[mayor.length - 1].dRango < 0 ? `más: ${titulo(mayor[mayor.length - 1].fruta)} ${pct(mayor[mayor.length - 1].dRango)}` : ""),
      kpi("Sobre presupuesto", String(sobrePres.length), "último precio vs presupuesto"),
      kpi("Riesgo alto o crítico", String(rs.filter((r) => /Alto|Crítico/.test(r.agro?.riesgo || "")).length), rs.filter((r) => /Alto|Crítico/.test(r.agro?.riesgo || "")).map((r) => titulo(r.fruta)).slice(0, 3).join(", ")),
    ]),
    opc.resumen ? el("section", { class: "inf-bloque" }, [
      el("h2", {}, "Resumen de movimientos"),
      el("table", { class: "tabla" }, [
        el("thead", {}, el("tr", {}, ["Fruta", "Evolución", "Último", "vs hace 4 sem", "En el periodo", "Mín – Máx", "vs presup.", "Sem. compradas", "kg", "Riesgo", "En un mes"].map((h, i) => el("th", { class: i > 1 ? "num" : "" }, h)))),
        el("tbody", {}, rs.map((r) => el("tr", {}, [
          el("td", {}, el("b", {}, titulo(r.fruta))),
          el("td", {}, spark(r.serie)),
          el("td", { class: "num" }, [usd(r.ult.actual), el("div", { class: "mini" }, semanaCorta(r.ult.semana))]),
          el("td", { class: "num" }, el("span", { class: "delta " + claseDelta(r.d4) }, pct(r.d4))),
          el("td", { class: "num" }, [el("span", { class: "delta " + claseDelta(r.dRango) }, pct(r.dRango)), r.conDato > 1 ? el("div", { class: "mini" }, `desde ${usd(r.pri.actual)}`) : null]),
          el("td", { class: "num" }, `${usd(r.min)} – ${usd(r.max)}`),
          el("td", { class: "num" }, el("span", { class: "delta " + claseDelta(r.dPre) }, pct(r.dPre))),
          el("td", { class: "num" }, `${r.compradas} de ${eje.length}`),
          el("td", { class: "num" }, r.kg ? Math.round(r.kg).toLocaleString("es-EC") : "—"),
          el("td", { class: "num" }, chipRiesgo(r.agro?.riesgo)),
          el("td", { class: "num" }, r.agro?.perspectiva || "—"),
        ]))),
      ]),
    ]) : null,
    ...(opc.graficas || opc.tabla ? rs.map((r) => el("section", { class: "inf-fruta" }, [
      opc.graficas ? detalleFruta(r, eje) : el("div", {}, [el("h2", {}, titulo(r.fruta)), bloqueAgro(r)]),
      opc.tabla ? el("table", { class: "tabla mini-tabla" }, [
        el("thead", {}, el("tr", {}, ["Semana", "Actual", "Máximo", "Presupuesto", "Se compró", "kg · compras", "Riesgo", "Clima / comentario"].map((h, i) => el("th", { class: i && i < 4 ? "num" : "" }, h)))),
        el("tbody", {}, r.serie.map((p, i) => el("tr", { class: p ? "" : "dim" }, [
          el("td", {}, `${semanaCorta(eje[i])} · ${rangoSemana(eje[i])}`),
          el("td", { class: "num" }, p ? usd(p.actual, 3) : "—"),
          el("td", { class: "num" }, p ? usd(p.maximo, 3) : "—"),
          el("td", { class: "num" }, p ? usd(p.presupuesto, 3) : "—"),
          el("td", {}, p ? (p.comprado ? "sí" : "no") : "—"),
          el("td", {}, p?.nota || ""),
          el("td", {}, p?.riesgo || ""),
          el("td", { class: "mini" }, [p?.clima?.join(", ") || "", p?.comentario ? ` — ${p.comentario}` : ""].join("")),
        ]))),
      ]) : null,
    ])) : []),
    el("p", { class: "mini inf-pie" }, "Precio actual = promedio ponderado por kg de lo recibido en la semana; máximo = precio más alto pagado o esperado; presupuesto = el definido una vez por fruta en la app. Semanas sin dato = no se compró esa fruta. Fuente: compras de Odoo (histórico) y carga semanal de Compras."),
  ]);
  document.body.appendChild(inf);
  document.body.classList.add("imprimiendo");
  const limpiar = () => { inf.remove(); document.body.classList.remove("imprimiendo"); window.removeEventListener("afterprint", limpiar); };
  window.addEventListener("afterprint", limpiar);
  // deja que el navegador dibuje antes de abrir la impresión
  setTimeout(() => { try { window.print(); } catch (e) { toast("No se pudo abrir la impresión: " + e.message, "err"); limpiar(); } }, 300);
}
