// Carga semanal de Compras (viernes). Pensada para 2 minutos: llega pre-llenada
// con la semana anterior, se puede pegar directo desde Excel (Ctrl+V sobre la
// tabla) o subir el mismo "Reporte Semanal Precio Fruta.xlsx". Muestra al
// instante qué le hacen esos precios a los clientes antes de guardar.
//
// Las filas son las frutas de CONFIG.mapeo (nombres de Odoo). Las "opcionales"
// (piña, frutilla, concentrados…) se llenan solo si su precio se movió: una fila
// sin precio actual no se guarda y ese ingrediente queda a su costo de Odoo.
//
// El PRESUPUESTO se define una sola vez (botón "Presupuesto"), no cada semana: en la
// tabla semanal se muestra de solo lectura. "Importar histórico" carga de una vez las
// semanas pasadas (Precio_Fruta_Historico.xlsx, armado desde las compras de Odoo).
import { CONFIG } from "./config.js";
import { el, clear, toast } from "./dom.js";
import { datos, columnasFaltantes } from "./datos.js";
import { estado, recargar, esCompras, esAgricola } from "./app.js";
import { calcularFilas } from "./calculo.js";
import { semanaObjetivo, semanasDesde, rangoSemana, semanaCorta, normFruta, titulo, usd, pct, leerNum, claseDelta } from "./util.js";

const FRUTAS_MAPEADAS = [...new Set(Object.values(CONFIG.mapeo).map((m) => m.fruta))];
const OPCIONALES = new Set(Object.values(CONFIG.mapeo).filter((m) => m.opcional).map((m) => m.fruta));

// Selección simple (riesgo, perspectiva) con color según el valor
function selAgro(r, campo, opciones, etiqueta) {
  const clase = () => "sel-agro " + (campo === "riesgo" ? "r-" + normFruta(r.riesgo || "").toLowerCase() : "p-" + (CONFIG.agro.perspectiva.indexOf(r.perspectiva) + 1));
  const s = el("select", { class: clase(), "aria-label": `${etiqueta} ${r.fruta}`, onchange: (e) => { r[campo] = e.target.value; s.className = clase(); } },
    [el("option", { value: "" }, "—"), ...opciones.map((o) => el("option", { value: o, selected: o === r[campo] }, o))]);
  return s;
}

// Selección múltiple de factores climáticos: un desplegable con casillas
function multiClima(r) {
  const resumen = el("summary", {});
  const pintar = () => { resumen.textContent = r.clima.length ? r.clima.join(", ") : "—"; resumen.title = r.clima.join("\n"); };
  pintar();
  return el("details", { class: "multi" }, [resumen, el("div", { class: "multi-menu" }, CONFIG.agro.clima.map((o) =>
    el("label", {}, [el("input", { type: "checkbox", checked: r.clima.includes(o), onchange: (e) => {
      r.clima = e.target.checked ? [...r.clima, o] : r.clima.filter((x) => x !== o);
      r.clima.sort((a, b) => CONFIG.agro.clima.indexOf(a) - CONFIG.agro.clima.indexOf(b));
      pintar();
    } }), o])))]);
}

export function vistaCargar(root) {
  const obj = semanaObjetivo().semana;
  let semana = obj;
  let borrador = [];

  const cab = el("div", { class: "cab" });
  const panelImpacto = el("aside", { class: "impacto" });
  const tbody = el("tbody");
  const avisos = el("div");
  const btnGuardar = el("button", { class: "btn btn-verde", onclick: guardar }, "Guardar semana");

  function anterior() {
    return estado.semanas.find((s) => s.semana < semana) || null;
  }

  // último precio conocido de cada fruta antes de esta semana (no solo de la semana anterior:
  // una fruta que no se compró la semana pasada trae el de la última vez que se compró)
  function ultimoPrecio(f) {
    return estado.semanas.find((s) => s.semana < semana && s.frutas[f])?.frutas[f] || null;
  }

  // permisos: Compras/Sistemas cargan precios y agro; Agrícola solo los datos agronómicos
  const puedePrecios = esCompras() || (CONFIG.useMock && !esAgricola()); // en demo, el usuario "Agrícola" también se comporta como Agrícola
  const puedeAgro = puedePrecios || esAgricola();

  // datos agronómicos de una fruta para esta semana: los registrados para la semana; si no hay,
  // los últimos conocidos (riesgo y clima suelen durar varias semanas)
  function agroDe(f) {
    const vacio = { riesgo: "", clima: [], comentario: "", perspectiva: "" };
    const A = estado.agro || {};
    if (A[semana]?.[f]) return { ...vacio, ...A[semana][f], clima: [...(A[semana][f].clima || [])] };
    const previa = Object.keys(A).filter((w) => w < semana && A[w][f]).sort().pop();
    if (previa) return { ...vacio, ...A[previa][f], clima: [...(A[previa][f].clima || [])] };
    const p = ultimoPrecio(f); // registros viejos con agro en la misma fila del precio
    return p ? { riesgo: p.riesgo || "", clima: [...(p.clima || [])], comentario: p.comentario || "", perspectiva: p.perspectiva || "" } : vacio;
  }

  function iniciar() {
    const actual = estado.semanas.find((s) => s.semana === semana);
    const P = estado.presupuesto || {};
    const extra = Object.keys(actual?.frutas || {}).filter((f) => !FRUTAS_MAPEADAS.includes(f));
    borrador = [...FRUTAS_MAPEADAS, ...extra].map((f) => {
      const v = actual ? actual.frutas[f] : ultimoPrecio(f);
      if (v) // semana nueva: llega con el último precio de esa fruta; Compras solo cambia lo que se movió
        // los datos agronómicos se arrastran de la última carga de esa fruta (suelen durar varias semanas)
        return { fruta: f, presupuesto: P[f] ?? v.presupuesto, actual: v.actual, maximo: v.maximo, nota: actual ? v.nota || "" : "", comprado: actual ? !!v.comprado : false, ...agroDe(f) };
      return { fruta: f, presupuesto: P[f] ?? null, actual: null, maximo: null, nota: "", comprado: false, ...agroDe(f) };
    });
    pintar();
  }

  function pintarCab() {
    clear(cab);
    const ya = estado.semanas.find((s) => s.semana === semana);
    // desde S15 (inicio de Odoo) para poder cargar el histórico de compras
    const opciones = [...new Set([obj, ...semanasDesde("2026-S15", obj), ...estado.semanas.map((x) => x.semana)])].sort().reverse();
    const i = opciones.indexOf(semana);
    const ir = (w) => { semana = w; iniciar(); };
    cab.append(
      el("div", {}, [
        el("h1", { class: "titulo" }, "Precio semanal de la fruta"),
        el("p", { class: "sub" }, [
          el("span", { class: "nav-sem" }, [
            el("button", { class: "btn-nav", title: "Semana anterior", "aria-label": "Semana anterior", disabled: i >= opciones.length - 1, onclick: () => ir(opciones[i + 1]) }, "‹"),
            el("select", { class: "sel-semana", "aria-label": "Semana", onchange: (e) => ir(e.target.value) },
              opciones.map((w) => el("option", { value: w, selected: w === semana }, `${semanaCorta(w)} · ${rangoSemana(w)}`))),
            el("button", { class: "btn-nav", title: "Semana siguiente", "aria-label": "Semana siguiente", disabled: i <= 0, onclick: () => ir(opciones[i - 1]) }, "›"),
          ]),
          ya ? el("span", { class: "chip ok" }, `Cargada por ${ya.cargado_por.split("@")[0]} · ${new Date(ya.fecha).toLocaleString("es-EC", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`)
             : el("span", { class: "chip pend" }, "Pendiente de cargar"),
        ]),
      ]),
      el("div", { class: "acciones" }, [
        el("button", { class: "btn btn-sec", onclick: editarPresupuesto, title: "El presupuesto de cada fruta se define una sola vez" }, "Presupuesto"),
        puedePrecios ? el("label", { class: "btn btn-sec", title: "Carga de una vez semanas pasadas (Precio_Fruta_Historico.xlsx)" },
          ["Importar histórico", el("input", { type: "file", accept: ".xlsx", class: "hidden", onchange: importarHistorico })]) : null,
        el("button", { class: "btn btn-sec", onclick: descargarPlantilla, title: "Excel con todas las frutas, para llenar y subir" }, "Descargar plantilla"),
        !puedePrecios ? null : el("label", { class: "btn btn-sec" }, ["Subir Excel", el("input", { type: "file", accept: ".xlsx,.xls,.csv", class: "hidden", onchange: subirExcel })]),
        !puedePrecios ? null : el("button", { class: "btn btn-sec", onclick: () => { borrador.push({ fruta: "", presupuesto: null, actual: null, maximo: null, nota: "", comprado: false, riesgo: "", clima: [], comentario: "", perspectiva: "" }); pintar(); tbody.querySelector("tr:last-child input")?.focus(); } }, "Agregar fruta"),
        btnGuardar,
      ])
    );
    btnGuardar.disabled = !puedeAgro;
    btnGuardar.textContent = puedePrecios ? "Guardar semana" : "Guardar datos agronómicos";
    btnGuardar.title = !puedeAgro ? "Solo Compras y Agrícola pueden guardar" : puedePrecios ? "" : "Agrícola registra riesgo, clima, comentario y «en un mes»; los precios los carga Compras";
  }

  function celdaNum(r, campo) {
    return el("td", { class: "num" }, el("input", {
      inputmode: "decimal", value: r[campo] ?? "", "aria-label": `${campo} ${r.fruta}`, disabled: !puedePrecios,
      oninput: (e) => { r[campo] = leerNum(e.target.value); pintarDeltas(); },
    }));
  }

  let filasTr = []; // [{tr, r}]: la tabla tiene una fila separadora, no se indexa por posición

  function pintar() {
    pintarCab();
    clear(tbody);
    filasTr = [];
    let separador = false;
    borrador.forEach((r, i) => {
      if (!separador && OPCIONALES.has(r.fruta)) {
        separador = true;
        tbody.appendChild(el("tr", { class: "sep" }, el("td", { colspan: 13 }, [el("b", {}, "Otras frutas e insumos"),
          " · llenar solo si su precio cambió; vacías quedan a su costo de Odoo (el presupuesto sugerido es ese costo)"])));
      }
      const tr = el("tr", { class: OPCIONALES.has(r.fruta) ? "opc" : "" }, [
        el("td", {}, el("input", { class: "in-fruta", value: titulo(r.fruta), disabled: !puedePrecios, list: "frutas-conocidas", "aria-label": "Fruta",
          onchange: (e) => { r.fruta = normFruta(e.target.value); pintarDeltas(); } })),
        el("td", { class: "num presup", title: "Presupuesto único de la fruta (se cambia con el botón «Presupuesto»)" }, r.presupuesto != null ? usd(r.presupuesto, 3) : "—"),
        celdaNum(r, "actual"), celdaNum(r, "maximo"),
        el("td", { class: "centro" }, el("input", { type: "checkbox", class: "chk-comprado", checked: r.comprado, disabled: !puedePrecios, "aria-label": `Comprado ${r.fruta}`,
          title: "Marcar si esta fruta sí se compró esta semana", onchange: (e) => (r.comprado = e.target.checked) })),
        el("td", { class: "num d-sem" }), el("td", { class: "num d-pre" }),
        el("td", {}, selAgro(r, "riesgo", CONFIG.agro.riesgos, "Riesgo agronómico")),
        el("td", {}, multiClima(r)),
        el("td", {}, selAgro(r, "perspectiva", CONFIG.agro.perspectiva, "Cómo se ve en un mes")),
        el("td", {}, el("textarea", { class: "in-coment", rows: 1, placeholder: "—", "aria-label": `Comentario agronómico ${r.fruta}`, oninput: (e) => (r.comentario = e.target.value) }, r.comentario || "")),
        el("td", {}, el("input", { class: "in-nota", value: r.nota, placeholder: "—", "aria-label": "Nota", oninput: (e) => (r.nota = e.target.value) })),
        el("td", {}, el("button", { class: "btn-x", title: "Quitar fila", "aria-label": "Quitar fila", onclick: () => { borrador.splice(i, 1); pintar(); } }, "×")),
      ]);
      filasTr.push({ tr, r });
      tbody.appendChild(tr);
    });
    pintarDeltas();
  }

  function pintarDeltas() {
    const prev = anterior();
    const errores = [], dudas = [];
    let cargadas = 0;
    filasTr.forEach(({ tr, r }, i) => {
      const p = prev?.frutas[r.fruta];
      const dSem = p && r.actual != null ? r.actual / p.actual - 1 : null;
      const dPre = r.presupuesto && r.actual != null ? r.actual / r.presupuesto - 1 : null;
      tr.querySelector(".d-sem").replaceChildren(el("span", { class: "delta " + claseDelta(dSem) }, pct(dSem)));
      tr.querySelector(".d-pre").replaceChildren(el("span", { class: "delta " + claseDelta(dPre) }, pct(dPre)));
      let mal = false;
      const vacia = r.actual == null;
      tr.classList.toggle("vacia", vacia);
      if (vacia) {
        if (r.fruta && !OPCIONALES.has(r.fruta) && FRUTAS_MAPEADAS.includes(r.fruta)) dudas.push(`${titulo(r.fruta)} sin precio actual: queda a costo Odoo`);
      }
      else if (!r.fruta) { errores.push(`Fila ${i + 1}: falta el nombre de la fruta`); mal = true; }
      else if (!(r.actual > 0)) { errores.push(`${titulo(r.fruta)}: precio actual inválido`); mal = true; }
      else if (!(r.presupuesto > 0)) { errores.push(`${titulo(r.fruta)}: sin presupuesto (defínelo con el botón «Presupuesto»)`); mal = true; }
      else if (r.maximo != null && r.maximo < r.actual) { errores.push(`${titulo(r.fruta)}: el máximo esperado (${usd(r.maximo)}) es menor que el actual (${usd(r.actual)})`); mal = true; }
      if (dSem != null && Math.abs(dSem) > CONFIG.saltoSospechoso) dudas.push(`${titulo(r.fruta)} cambia ${pct(dSem)} contra la semana anterior`);
      if (r.fruta && !FRUTAS_MAPEADAS.includes(r.fruta)) dudas.push(`${titulo(r.fruta)} no está ligada a ningún código de Odoo: no mueve ninguna receta`);
      tr.classList.toggle("fila-error", mal);
      if (!vacia && !mal) cargadas++;
    });
    const nombres = borrador.filter((r) => r.actual != null).map((r) => r.fruta).filter(Boolean);
    const rep = nombres.filter((n, i) => nombres.indexOf(n) !== i);
    if (rep.length) errores.push("Fruta repetida: " + [...new Set(rep)].map(titulo).join(", "));
    clear(avisos);
    if (errores.length) avisos.appendChild(el("div", { class: "aviso err" }, errores.join(" · ")));
    if (dudas.length) avisos.appendChild(el("div", { class: "aviso" }, "Revisar: " + dudas.join(" · ")));
    btnGuardar.dataset.errores = errores.length;
    pintarImpacto(errores.length === 0 && cargadas > 0);
  }

  function semanaBorrador() {
    const frutas = {};
    // solo las filas con precio actual; sin máximo esperado → el mismo actual
    for (const r of borrador)
      if (r.fruta && r.actual != null) frutas[r.fruta] = { presupuesto: r.presupuesto, actual: r.actual, maximo: r.maximo ?? r.actual, nota: r.nota, comprado: !!r.comprado,
        riesgo: r.riesgo || "", clima: r.clima || [], comentario: (r.comentario || "").trim(), perspectiva: r.perspectiva || "" };
    return { semana, frutas };
  }

  function pintarImpacto(valido) {
    clear(panelImpacto);
    panelImpacto.appendChild(el("h2", {}, "Lo que esto significa para los clientes"));
    if (!valido) return panelImpacto.appendChild(el("p", { class: "nota" }, "Completa los precios para ver el efecto."));
    const sems = [semanaBorrador(), ...estado.semanas.filter((s) => s.semana < semana)];
    const { filas } = calcularFilas(estado.recetas, sems, estado.aprobados, {});
    const subir = filas.filter((f) => f.accion === "SUBIR");
    const riesgo = subir.reduce((a, f) => a + f.impactoMes, 0);
    panelImpacto.append(
      el("div", { class: "kpis" }, [
        el("div", { class: "kpi" }, [el("span", {}, "Precios a subir"), el("b", {}, `${subir.length} de ${filas.length}`)]),
        el("div", { class: "kpi" }, [el("span", {}, "Margen en juego / mes"), el("b", { class: riesgo > 0 ? "rojo" : "" }, usd(riesgo, 0))]),
      ]),
      el("p", { class: "nota" }, "Mayor efecto (precio por unidad, vigente → posible):"),
      el("ul", { class: "top" }, subir.sort((a, b) => b.impactoMes - a.impactoMes).slice(0, 6).map((f) =>
        el("li", {}, [el("span", {}, `${f.cliente.split(" ").slice(0, 2).join(" ")} · ${f.producto}`), el("b", {}, `${usd(f.pvpU)} → ${usd(f.posibleU)} `), el("span", { class: "delta " + claseDelta(f.dPos) }, pct(f.dPos))]))),
      el("a", { href: "#/precios", class: "link" }, "Ver todos los precios →")
    );
  }

  // Ctrl+V o Excel: columnas por encabezado (FRUTA, PRESUPUESTO, ACTUAL, MÁXIMO), así
  // una celda vacía no corre los valores. Sin encabezado: Fruta | Presupuesto | Actual | Máximo.
  function aplicarFilas(rows) {
    let col = { fruta: 0, presupuesto: 1, actual: 2, maximo: 3 };
    let n = 0;
    for (const row of rows) {
      const cab = row.map((c) => normFruta(c));
      if (cab.includes("FRUTA")) {
        const busca = (rx) => cab.findIndex((c) => rx.test(c) && !c.includes("VARIACION"));
        col = { fruta: cab.indexOf("FRUTA"), presupuesto: busca(/PRESUP/), actual: busca(/ACTUAL/), maximo: busca(/MAXIMO/), comprado: busca(/COMPRAD/),
          riesgo: busca(/RIESGO/), clima: busca(/CLIMA/), comentario: busca(/COMENTARIO/), perspectiva: busca(/PERSPECTIVA|UN MES|1 MES/) };
        continue;
      }
      const nombre = normFruta(row[col.fruta]);
      const num = (k) => (col[k] >= 0 ? leerNum(row[col[k]]) : null);
      if (!nombre || num("actual") == null) continue; // fila sin precio actual = no se movió
      let r = borrador.find((b) => b.fruta === nombre);
      if (!r) borrador.push((r = { fruta: nombre, nota: "", comprado: false, riesgo: "", clima: [], comentario: "", perspectiva: "" }));
      if (r.presupuesto == null) r.presupuesto = num("presupuesto"); // el presupuesto es único: solo si la fruta no tiene
      r.actual = num("actual");
      r.maximo = num("maximo");
      if (col.comprado >= 0) r.comprado = /^(SI|SÍ|X|1|TRUE|VERDADERO)$/i.test(String(row[col.comprado] ?? "").trim());
      const txt = (k) => (col[k] >= 0 ? String(row[col[k]] ?? "").trim() : "");
      const opcion = (val, lista) => lista.find((o) => normFruta(o).startsWith(normFruta(val).split(" ")[0])) || "";
      if (txt("riesgo")) r.riesgo = opcion(txt("riesgo"), CONFIG.agro.riesgos);
      if (txt("perspectiva")) r.perspectiva = opcion(txt("perspectiva"), CONFIG.agro.perspectiva);
      if (txt("clima")) r.clima = txt("clima").split(/[;,]/).map((x) => CONFIG.agro.clima.find((o) => normFruta(o).startsWith(normFruta(x).slice(0, 6))) ).filter(Boolean);
      if (txt("comentario")) r.comentario = txt("comentario");
      n++;
    }
    pintar();
    toast(n ? `${n} frutas tomadas del Excel` : "No se reconocieron filas (Fruta, Presupuesto, Actual, Máximo)", n ? "ok" : "err");
  }

  function onPaste(e) {
    const txt = e.clipboardData.getData("text");
    if (!txt.includes("\t")) return; // un solo valor: pegado normal en la celda
    e.preventDefault();
    aplicarFilas(txt.split(/\r?\n/).map((l) => l.split("\t")));
  }

  async function subirExcel(e) {
    const f = e.target.files[0];
    if (!f) return;
    const wb = XLSX.read(await f.arrayBuffer());
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
    aplicarFilas(rows);
    e.target.value = "";
  }

  // Misma forma que el Excel de Compras + todas las frutas de Odoo y su código.
  function descargarPlantilla() {
    const filas = [["FRUTA", "Precio Presupuesto", "PRECIO ACTUAL", "PRECIO MAXIMO ESPERADO", "COMPRADO (SI/NO)", "% VARIACION ACTUAL", "% VARIACION MAXIMO", "CODIGO ODOO", "TIPO",
      "RIESGO AGRONOMICO", "FACTORES CLIMATICOS (separar con ;)", "PERSPECTIVA 1 MES", "COMENTARIO AGRONOMICO"]];
    const codigos = {};
    for (const [c, m] of Object.entries(CONFIG.mapeo)) (codigos[m.fruta] ||= []).push(c);
    borrador.forEach((r) => filas.push([r.fruta, r.presupuesto ?? "", r.actual ?? "", r.maximo ?? "", r.comprado ? "SI" : "", "", "", (codigos[r.fruta] || []).join(", "),
      OPCIONALES.has(r.fruta) ? "opcional: llenar solo si cambió" : "semanal", r.riesgo || "", (r.clima || []).join("; "), r.perspectiva || "", r.comentario || ""]));
    const ws = XLSX.utils.aoa_to_sheet(filas);
    for (let i = 2; i <= filas.length; i++) {
      ws["F" + i] = { t: "n", f: `IF(AND(B${i}>0,C${i}<>""),(C${i}-B${i})/B${i},"")`, z: "0.0%" };
      ws["G" + i] = { t: "n", f: `IF(AND(B${i}>0,D${i}<>""),(D${i}-B${i})/B${i},"")`, z: "0.0%" };
    }
    ws["!cols"] = [{ wch: 34 }, { wch: 18 }, { wch: 15 }, { wch: 24 }, { wch: 17 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 30 }, { wch: 18 }, { wch: 40 }, { wch: 18 }, { wch: 50 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reporte semanal");
    XLSX.writeFile(wb, `Precio_Fruta_${semanaCorta(semana)}.xlsx`);
  }

  // ---------------- presupuesto único ----------------
  function editarPresupuesto() {
    const P = estado.presupuesto || {};
    const frutas = [...new Set([...FRUTAS_MAPEADAS, ...Object.keys(P)])];
    const vals = Object.fromEntries(frutas.map((f) => [f, P[f] ?? null]));
    const guardado = estado.presupuestoGuardado || {};
    const puede = esCompras() || CONFIG.useMock;
    const dlg = el("dialog", { class: "dlg" });
    const cerrar = () => { dlg.close(); dlg.remove(); };
    dlg.append(
      el("h2", {}, "Presupuesto por fruta ($/kg)"),
      el("p", { class: "nota" }, "Se define una sola vez y vale para todas las semanas: es la base de los «vs presupuesto» y del margen que se sostiene. Las frutas sin presupuesto guardado muestran su costo actual de Odoo o el último que traía una semana."),
      el("div", { class: "scroll dlg-cuerpo" }, el("table", { class: "tabla" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, "Fruta"), el("th", { class: "num" }, "Presupuesto"), el("th", {}, "")])),
        el("tbody", {}, frutas.map((f) => el("tr", {}, [
          el("td", {}, titulo(f)),
          el("td", { class: "num" }, el("input", { inputmode: "decimal", class: "in-pactado", value: vals[f] ?? "", disabled: !puede, "aria-label": `Presupuesto ${f}`,
            oninput: (e) => (vals[f] = leerNum(e.target.value)) })),
          el("td", { class: "mini" }, guardado[f] != null ? "guardado" : "sugerido"),
        ]))),
      ])),
      el("div", { class: "acciones dlg-pie" }, [
        el("button", { class: "btn btn-sec", onclick: cerrar }, "Cancelar"),
        puede ? el("button", { class: "btn btn-verde", onclick: async (e) => {
          const mapa = Object.fromEntries(Object.entries(vals).filter(([, v]) => v > 0));
          e.target.disabled = true; e.target.textContent = "Guardando…";
          try {
            await datos.guardarPresupuesto(mapa, estado.usuario.correo);
            await recargar();
            cerrar(); iniciar();
            toast("Presupuesto guardado");
          } catch (err) { toast("No se pudo guardar: " + err.message, "err"); e.target.disabled = false; e.target.textContent = "Guardar presupuesto"; }
        } }, "Guardar presupuesto") : null,
      ])
    );
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // ---------------- importar histórico ----------------
  // Precio_Fruta_Historico.xlsx: una hoja por semana (S15, S16…) con FRUTA, PRECIO ACTUAL,
  // PRECIO MAXIMO ESPERADO, COMPRADO, KG COMPRADOS, N° COMPRAS. Por defecto se marcan las
  // semanas que aún no están en la app, menos las dos más recientes del archivo (esas las carga Compras).
  async function importarHistorico(e) {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const wb = XLSX.read(await f.arrayBuffer());
    const det = wb.Sheets["Detalle compras"] ? XLSX.utils.sheet_to_json(wb.Sheets["Detalle compras"], { header: 1 })[1]?.[0] : null;
    const anio = String(det || "").match(/^(\d{4})-S/)?.[1] || String(new Date().getFullYear());
    const semanasArch = wb.SheetNames.filter((n) => /^S\d{1,2}$/.test(n)).map((n) => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" });
      const cab = rows[0].map((c) => normFruta(c));
      const col = (rx) => cab.findIndex((c) => rx.test(c));
      const c = { f: col(/^FRUTA/), a: col(/ACTUAL/), m: col(/MAXIMO/), co: col(/COMPRAD/), kg: col(/^KG/), n: col(/COMPRAS$/) };
      const frutas = {};
      for (const r of rows.slice(1)) {
        const fr = normFruta(r[c.f]); const a = leerNum(r[c.a]);
        if (!fr || a == null) continue;
        const kg = leerNum(r[c.kg]), nc = leerNum(r[c.n]);
        frutas[fr] = { actual: a, maximo: leerNum(r[c.m]) ?? a, presupuesto: null, comprado: c.co < 0 || /^S/i.test(String(r[c.co])), riesgo: "", clima: [], comentario: "", perspectiva: "",
          nota: kg != null ? `${Math.round(kg).toLocaleString("es-EC")} kg${nc ? " · " + nc + (nc === 1 ? " compra" : " compras") : ""}` : "" };
      }
      return { semana: `${anio}-S${n.slice(1).padStart(2, "0")}`, frutas };
    }).filter((s) => Object.keys(s.frutas).length).sort((a, b) => (a.semana < b.semana ? -1 : 1));
    if (!semanasArch.length) return toast("El archivo no tiene hojas de semana (S15, S16…)", "err");
    const ya = new Set(estado.semanasCrudas.map((s) => s.semana));
    const recientes = new Set(semanasArch.slice(-2).map((s) => s.semana));
    const marcadas = new Set(semanasArch.filter((s) => !ya.has(s.semana) && !recientes.has(s.semana)).map((s) => s.semana));
    const dlg = el("dialog", { class: "dlg" });
    const cerrar = () => { dlg.close(); dlg.remove(); };
    const btn = el("button", { class: "btn btn-verde" }, "");
    const rotulo = () => (btn.textContent = `Importar ${marcadas.size} semanas`);
    rotulo();
    btn.onclick = async () => {
      const elegidas = semanasArch.filter((s) => marcadas.has(s.semana));
      if (!elegidas.length) return;
      btn.disabled = true;
      try {
        await datos.importarSemanas(elegidas, "historico Odoo (Precio_Fruta_Historico.xlsx)", (h, t) => (btn.textContent = `Importando… ${h} de ${t}`));
        await recargar();
        cerrar(); iniciar();
        toast(`${elegidas.length} semanas importadas`);
      } catch (err) { toast("No se pudo importar: " + err.message, "err"); btn.disabled = false; rotulo(); }
    };
    dlg.append(
      el("h2", {}, "Importar histórico de precios de fruta"),
      el("p", { class: "nota" }, "Las semanas importadas sirven para ver cómo se movió el precio de la fruta (Tendencias). No se usan para sugerir precios de venta. Las que ya están en la app vienen desmarcadas y no se reemplazan."),
      el("div", { class: "scroll dlg-cuerpo" }, el("table", { class: "tabla" }, [
        el("thead", {}, el("tr", {}, ["", "Semana", "Frutas", ""].map((h) => el("th", {}, h)))),
        el("tbody", {}, semanasArch.map((s) => el("tr", {}, [
          el("td", {}, el("input", { type: "checkbox", checked: marcadas.has(s.semana), disabled: ya.has(s.semana), "aria-label": s.semana,
            onchange: (e) => { e.target.checked ? marcadas.add(s.semana) : marcadas.delete(s.semana); rotulo(); } })),
          el("td", {}, `${semanaCorta(s.semana)} · ${rangoSemana(s.semana)}`),
          el("td", { class: "num" }, String(Object.keys(s.frutas).length)),
          el("td", { class: "mini" }, ya.has(s.semana) ? "ya cargada" : recientes.has(s.semana) ? "reciente: la carga Compras" : ""),
        ]))),
      ])),
      el("div", { class: "acciones dlg-pie" }, [el("button", { class: "btn btn-sec", onclick: cerrar }, "Cancelar"), btn])
    );
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  // datos agronómicos de todas las filas que tengan algo (con o sin precio esta semana)
  function agroBorrador() {
    const out = {};
    for (const r of borrador)
      if (r.fruta && (r.riesgo || r.perspectiva || (r.clima || []).length || (r.comentario || "").trim()))
        out[r.fruta] = { riesgo: r.riesgo || "", clima: r.clima || [], comentario: (r.comentario || "").trim(), perspectiva: r.perspectiva || "" };
    return out;
  }

  async function guardar() {
    const etiqueta = btnGuardar.textContent;
    if (!puedePrecios) { // Agrícola: solo lo agronómico, sin tocar precios
      btnGuardar.disabled = true; btnGuardar.textContent = "Guardando…";
      try {
        await datos.guardarAgro(semana, agroBorrador(), estado.usuario.correo);
        await recargar();
        const falta = columnasFaltantes();
        toast(falta.length ? `Guardado sin: ${falta.join(", ")} (faltan esas columnas en SharePoint, avisa a Sistemas)` : `Datos agronómicos de ${semanaCorta(semana)} guardados`, falta.length ? "err" : "ok");
        pintarCab();
      } catch (err) { toast("No se pudo guardar: " + err.message, "err"); }
      finally { btnGuardar.disabled = false; btnGuardar.textContent = etiqueta; }
      return;
    }
    if (+btnGuardar.dataset.errores) return toast("Corrige los errores marcados antes de guardar", "err");
    const s = semanaBorrador();
    if (!Object.keys(s.frutas).length) return;
    if (avisos.querySelector(".aviso:not(.err)") && !confirm("Hay cambios para revisar (marcados en amarillo). ¿Guardar igual?")) return;
    btnGuardar.disabled = true;
    btnGuardar.textContent = "Guardando…";
    try {
      await datos.guardarSemana(semana, s.frutas, estado.usuario.correo);
      await datos.guardarAgro(semana, agroBorrador(), estado.usuario.correo);
      await recargar();
      const falta = columnasFaltantes();
      toast(falta.length ? `Semana ${semanaCorta(semana)} guardada, pero sin: ${falta.join(", ")} (faltan esas columnas en SharePoint, avisa a Sistemas)`
        : `Semana ${semanaCorta(semana)} guardada. Ya la ve Gerencia en Precios por cliente.`, falta.length ? "err" : "ok");
      pintarCab();
    } catch (err) {
      toast("No se pudo guardar: " + err.message, "err");
    } finally {
      btnGuardar.disabled = false;
      btnGuardar.textContent = "Guardar semana";
    }
  }

  const tabla = el("table", { class: "tabla tabla-carga", onpaste: onPaste }, [
    el("thead", {}, el("tr", {}, ["Fruta", "Presupuesto", "Actual", "Máx. esperado", "Comprado", "vs sem. ant.", "vs presup.", "Riesgo agronómico", "Factores climáticos", "En un mes", "Comentario agronómico", "Nota", ""].map((h, i) =>
      el("th", { class: i === 4 ? "centro" : i > 0 && i < 7 ? "num" : "" }, h)))),
    tbody,
  ]);
  root.append(
    cab,
    el("p", { class: "nota" }, "Precios en $/kg. Copia el rango de tu Excel con su fila de encabezados y pégalo con Ctrl+V sobre la tabla, o súbelo con «Subir Excel». Si el máximo esperado queda vacío se toma el actual. Marca «Comprado» en las frutas que sí se compraron esta semana."),
    !puedePrecios && puedeAgro ? el("div", { class: "aviso" }, "Puedes registrar riesgo agronómico, factores climáticos, «en un mes» y comentario de cada fruta. Los precios los carga Compras y aquí se ven de solo lectura.") : null,
    avisos,
    el("div", { class: "grid-carga" }, [panelImpacto, el("div", { class: "card scroll" }, tabla)]),
    el("datalist", { id: "frutas-conocidas" }, FRUTAS_MAPEADAS.map((f) => el("option", { value: titulo(f) })))
  );
  iniciar();
}
