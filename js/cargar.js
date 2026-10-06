// Carga semanal de Compras (viernes). Pensada para 2 minutos: llega pre-llenada
// con la semana anterior, se puede pegar directo desde Excel (Ctrl+V sobre la
// tabla) o subir el mismo "Reporte Semanal Precio Fruta.xlsx". Muestra al
// instante qué le hacen esos precios a los clientes antes de guardar.
//
// Las filas son las frutas de CONFIG.mapeo (nombres de Odoo). Las "opcionales"
// (piña, frutilla, concentrados…) se llenan solo si su precio se movió: una fila
// sin precio actual no se guarda y ese ingrediente queda a su costo de Odoo.
import { CONFIG } from "./config.js";
import { el, clear, toast } from "./dom.js";
import { datos } from "./datos.js";
import { estado, recargar, esCompras } from "./app.js";
import { calcularFilas } from "./calculo.js";
import { semanaObjetivo, rangoSemana, semanaCorta, normFruta, titulo, usd, pct, leerNum, claseDelta } from "./util.js";

const FRUTAS_MAPEADAS = [...new Set(Object.values(CONFIG.mapeo).map((m) => m.fruta))];
const OPCIONALES = new Set(Object.values(CONFIG.mapeo).filter((m) => m.opcional).map((m) => m.fruta));

// Costo actual de Odoo de cada fruta (del ingrediente de fruta fresca en las recetas):
// presupuesto sugerido para las opcionales que nunca se han cargado.
function costosOdoo() {
  const out = {};
  for (const p of Object.values(estado.recetas.productos))
    for (const i of p.ingredientes) {
      const m = CONFIG.mapeo[i.code];
      if (m && !m.intermedio && out[m.fruta] == null && i.precio_odoo > 0) out[m.fruta] = i.precio_odoo;
    }
  return out;
}

export function vistaCargar(root) {
  const obj = semanaObjetivo().semana;
  const existentes = estado.semanas.map((s) => s.semana);
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

  function iniciar() {
    const actual = estado.semanas.find((s) => s.semana === semana);
    const base = actual || anterior();
    const odoo = costosOdoo();
    const extra = Object.keys(base?.frutas || {}).filter((f) => !FRUTAS_MAPEADAS.includes(f));
    borrador = [...FRUTAS_MAPEADAS, ...extra].map((f) => {
      const v = base?.frutas[f];
      if (v) // semana nueva: llega con los valores de la anterior, Compras solo cambia lo que se movió
        return { fruta: f, presupuesto: v.presupuesto, actual: v.actual, maximo: v.maximo, nota: actual ? v.nota || "" : "" };
      return { fruta: f, presupuesto: odoo[f] != null ? Math.round(odoo[f] * 1000) / 1000 : null, actual: null, maximo: null, nota: "" };
    });
    pintar();
  }

  function pintarCab() {
    clear(cab);
    const ya = estado.semanas.find((s) => s.semana === semana);
    const opciones = [...new Set([obj, ...existentes])].sort().reverse();
    cab.append(
      el("div", {}, [
        el("h1", { class: "titulo" }, "Precio semanal de la fruta"),
        el("p", { class: "sub" }, [
          "Semana ",
          el("select", { class: "sel-semana", onchange: (e) => { semana = e.target.value; iniciar(); } },
            opciones.map((s) => el("option", { value: s, selected: s === semana }, `${semanaCorta(s)} · ${rangoSemana(s)}`))),
          " · ",
          ya ? el("span", { class: "chip ok" }, `Cargada por ${ya.cargado_por.split("@")[0]} · ${new Date(ya.fecha).toLocaleString("es-EC", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`)
             : el("span", { class: "chip pend" }, "Pendiente · el lunes 06:30 sale el correo a Gerencia"),
        ]),
      ]),
      el("div", { class: "acciones" }, [
        el("button", { class: "btn btn-sec", onclick: descargarPlantilla, title: "Excel con todas las frutas, para llenar y subir" }, "Descargar plantilla"),
        el("label", { class: "btn btn-sec" }, ["Subir Excel", el("input", { type: "file", accept: ".xlsx,.xls,.csv", class: "hidden", onchange: subirExcel })]),
        el("button", { class: "btn btn-sec", onclick: () => { borrador.push({ fruta: "", presupuesto: null, actual: null, maximo: null, nota: "" }); pintar(); tbody.querySelector("tr:last-child input")?.focus(); } }, "Agregar fruta"),
        btnGuardar,
      ])
    );
    btnGuardar.disabled = !esCompras() && !CONFIG.useMock;
    btnGuardar.title = btnGuardar.disabled ? "Solo Compras puede guardar" : "";
  }

  function celdaNum(r, campo) {
    return el("td", { class: "num" }, el("input", {
      inputmode: "decimal", value: r[campo] ?? "", "aria-label": `${campo} ${r.fruta}`,
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
        tbody.appendChild(el("tr", { class: "sep" }, el("td", { colspan: 8 }, [el("b", {}, "Otras frutas e insumos"),
          " · llenar solo si su precio cambió; vacías quedan a su costo de Odoo (el presupuesto sugerido es ese costo)"])));
      }
      const tr = el("tr", { class: OPCIONALES.has(r.fruta) ? "opc" : "" }, [
        el("td", {}, el("input", { class: "in-fruta", value: titulo(r.fruta), list: "frutas-conocidas", "aria-label": "Fruta",
          onchange: (e) => { r.fruta = normFruta(e.target.value); pintarDeltas(); } })),
        celdaNum(r, "presupuesto"), celdaNum(r, "actual"), celdaNum(r, "maximo"),
        el("td", { class: "num d-sem" }), el("td", { class: "num d-pre" }),
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
      else if (!(r.presupuesto > 0) || !(r.actual > 0)) { errores.push(`${titulo(r.fruta)}: falta el presupuesto`); mal = true; }
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
      if (r.fruta && r.actual != null) frutas[r.fruta] = { presupuesto: r.presupuesto, actual: r.actual, maximo: r.maximo ?? r.actual, nota: r.nota };
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
        col = { fruta: cab.indexOf("FRUTA"), presupuesto: busca(/PRESUP/), actual: busca(/ACTUAL/), maximo: busca(/MAXIMO/) };
        continue;
      }
      const nombre = normFruta(row[col.fruta]);
      const num = (k) => (col[k] >= 0 ? leerNum(row[col[k]]) : null);
      if (!nombre || num("actual") == null) continue; // fila sin precio actual = no se movió
      let r = borrador.find((b) => b.fruta === nombre);
      if (!r) borrador.push((r = { fruta: nombre, nota: "" }));
      r.presupuesto = num("presupuesto") ?? r.presupuesto;
      r.actual = num("actual");
      r.maximo = num("maximo");
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
    const filas = [["FRUTA", "Precio Presupuesto", "PRECIO ACTUAL", "PRECIO MAXIMO ESPERADO", "", "% VARIACION ACTUAL", "% VARIACION MAXIMO", "CODIGO ODOO", "TIPO"]];
    const codigos = {};
    for (const [c, m] of Object.entries(CONFIG.mapeo)) (codigos[m.fruta] ||= []).push(c);
    borrador.forEach((r) => filas.push([r.fruta, r.presupuesto ?? "", r.actual ?? "", r.maximo ?? "", "", "", "", (codigos[r.fruta] || []).join(", "),
      OPCIONALES.has(r.fruta) ? "opcional: llenar solo si cambió" : "semanal"]));
    const ws = XLSX.utils.aoa_to_sheet(filas);
    for (let i = 2; i <= filas.length; i++) {
      ws["F" + i] = { t: "n", f: `IF(AND(B${i}>0,C${i}<>""),(C${i}-B${i})/B${i},"")`, z: "0.0%" };
      ws["G" + i] = { t: "n", f: `IF(AND(B${i}>0,D${i}<>""),(D${i}-B${i})/B${i},"")`, z: "0.0%" };
    }
    ws["!cols"] = [{ wch: 34 }, { wch: 18 }, { wch: 15 }, { wch: 24 }, { wch: 3 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reporte semanal");
    XLSX.writeFile(wb, `Precio_Fruta_${semanaCorta(semana)}.xlsx`);
  }

  async function guardar() {
    if (+btnGuardar.dataset.errores) return toast("Corrige los errores marcados antes de guardar", "err");
    const s = semanaBorrador();
    if (!Object.keys(s.frutas).length) return;
    if (avisos.querySelector(".aviso:not(.err)") && !confirm("Hay cambios para revisar (marcados en amarillo). ¿Guardar igual?")) return;
    btnGuardar.disabled = true;
    btnGuardar.textContent = "Guardando…";
    try {
      await datos.guardarSemana(semana, s.frutas, estado.usuario.correo);
      await recargar();
      toast(`Semana ${semanaCorta(semana)} guardada. Gerencia la recibe el lunes 06:30.`);
      pintarCab();
    } catch (err) {
      toast("No se pudo guardar: " + err.message, "err");
    } finally {
      btnGuardar.disabled = false;
      btnGuardar.textContent = "Guardar semana";
    }
  }

  const tabla = el("table", { class: "tabla tabla-carga", onpaste: onPaste }, [
    el("thead", {}, el("tr", {}, ["Fruta", "Presupuesto", "Actual", "Máx. esperado", "vs sem. ant.", "vs presup.", "Nota", ""].map((h, i) =>
      el("th", { class: i > 0 && i < 6 ? "num" : "" }, h)))),
    tbody,
  ]);
  root.append(
    cab,
    el("p", { class: "nota" }, "Precios en $/kg. Copia el rango de tu Excel con su fila de encabezados y pégalo con Ctrl+V sobre la tabla, o súbelo con «Subir Excel». Si el máximo esperado queda vacío se toma el actual."),
    avisos,
    el("div", { class: "grid-carga" }, [el("div", { class: "card scroll" }, tabla), panelImpacto]),
    el("datalist", { id: "frutas-conocidas" }, FRUTAS_MAPEADAS.map((f) => el("option", { value: titulo(f) })))
  );
  iniciar();
}
