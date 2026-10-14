// Capa de datos: la misma interfaz en modo demo (localStorage) y en SharePoint.
//
//   semanas(n)                 → [{semana, cargado_por, fecha, frutas:{FRUTA:{presupuesto,actual,maximo,nota,comprado}}}] (nueva primero)
//   todo(n)                    → {semanas, presupuesto:{FRUTA: $/kg}} (presupuesto único, filas Title="PRESUPUESTO")
//   guardarSemana(sem, frutas, usuario)
//   guardarPresupuesto({FRUTA: $/kg}, usuario)  → el presupuesto se define UNA vez, no cada semana
//   importarSemanas([{semana, frutas}], usuario, avance) → histórico (CargadoPor "historico Odoo")
//   recetas()                  → {generado, productos:{code:{...}}, ventas:[...]}
//   aprobados()                → [{Producto, ClienteId, Semana, PrecioU, PrecioKg, RefFrutas, ...}] (todos: es el histórico de pactados)
//   aprobar(filas, semana, refFrutas, usuario)   filas: [{code, cliente, cliente_id, precioU, precioKg}]
//   preparar()                 → crea las listas si no existen (solo SharePoint)
//   subirRecetas(texto)        → sube recetas.json (respaldo mientras el proceso del lunes no tenga permisos)

import { CONFIG } from "./config.js";

const PRESUP = "PRESUPUESTO"; // filas especiales de la misma lista: el presupuesto único por fruta
const presupuestoDe = (items) => {
  const out = {};
  for (const f of items) if (f.Title === PRESUP && +f.Presupuesto > 0) out[f.Fruta] = +f.Presupuesto;
  return out;
};
const agrupar = (items) => {
  const por = {};
  for (const f of items) {
    if (f.Title === PRESUP) continue;
    const s = (por[f.Title] ||= { semana: f.Title, frutas: {}, cargado_por: f.CargadoPor || "", fecha: f.Modified || "" });
    if ((f.Modified || "") > s.fecha) s.fecha = f.Modified;
    s.frutas[f.Fruta] = { presupuesto: +f.Presupuesto, actual: +f.Actual, maximo: +f.Maximo, nota: f.Nota || "", comprado: !!f.Comprado };
  }
  return Object.values(por).sort((a, b) => (a.semana < b.semana ? 1 : -1));
};
const itemSemana = (semana, f, v, usuario) =>
  ({ Title: semana, Fruta: f, Presupuesto: v.presupuesto, Actual: v.actual, Maximo: v.maximo, Nota: v.nota || "", Comprado: !!v.comprado, CargadoPor: usuario });

// ------------------------------------------------------------------ demo ----
const LS = "hub-precios-fruta:demo:";
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(LS + k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch {} };

const demo = {
  async preparar() {},
  async subirRecetas() {},
  async semanas(n = 12) { return (await this.todo(n)).semanas; },
  async todo(n = 104) {
    let items = lsGet("semanal", null);
    if (!items) {
      const r = await fetch("data/semanas_demo.json");
      items = r.ok ? await r.json() : [];
      lsSet("semanal", items);
    }
    return { semanas: agrupar(items).slice(0, n), presupuesto: presupuestoDe(items) };
  },
  async guardarPresupuesto(mapa, usuario) {
    const items = lsGet("semanal", []).filter((i) => i.Title !== PRESUP);
    for (const [f, v] of Object.entries(mapa)) items.push({ Title: PRESUP, Fruta: f, Presupuesto: v, CargadoPor: usuario, Modified: new Date().toISOString() });
    lsSet("semanal", items);
  },
  async importarSemanas(semanas, usuario, avance) {
    const items = lsGet("semanal", []);
    for (const s of semanas) for (const [f, v] of Object.entries(s.frutas)) items.push({ ...itemSemana(s.semana, f, v, usuario), Modified: new Date().toISOString() });
    lsSet("semanal", items);
    avance?.(semanas.length, semanas.length);
  },
  async guardarSemana(semana, frutas, usuario) {
    const ahora = new Date().toISOString();
    const items = lsGet("semanal", []).filter((i) => i.Title !== semana);
    for (const [f, v] of Object.entries(frutas))
      items.push({ ...itemSemana(semana, f, v, usuario), Modified: ahora });
    lsSet("semanal", items);
  },
  async recetas() {
    // en local puede existir data/recetas.json (real, NO se sube al repo); en
    // GitHub Pages solo está la versión anónima.
    for (const f of ["data/recetas.json", "data/recetas_demo.json"]) {
      const r = await fetch(f).catch(() => null);
      if (r && r.ok) return r.json();
    }
    throw new Error("No hay recetas cargadas.");
  },
  async aprobados() { return lsGet("aprobados", []); },
  async aprobar(filas, semana, refFrutas, usuario) {
    const items = lsGet("aprobados", []);
    const ahora = new Date().toISOString();
    for (const f of filas) items.push({ ...itemAprobado(f, semana, refFrutas, usuario), Created: ahora });
    lsSet("aprobados", items);
  },
};

function itemAprobado(f, semana, refFrutas, usuario) {
  return {
    Title: `${f.code}|${f.cliente_id}`, Producto: f.code, Cliente: f.cliente, ClienteId: f.cliente_id, Semana: semana,
    PrecioU: f.precioU, PrecioKg: f.precioKg, Estado: "Pactado", AprobadoPor: usuario, RefFrutas: JSON.stringify(refFrutas),
  };
}

// ------------------------------------------------------------ SharePoint ----
const SITE = CONFIG.sp.host + CONFIG.sp.sitePath;
const NM = "application/json;odata=nometadata";

async function spFetch(url, opts = {}) {
  const { getAccessToken } = await import("./auth.js");
  const token = await getAccessToken();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal, headers: { Accept: NM, Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
    if (!r.ok) {
      // diagnóstico: qué llamada falló y qué permisos (scp) trae el token
      let scp = "?";
      try { scp = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).scp; } catch {}
      const ruta = decodeURIComponent(url.replace(SITE, "")).slice(0, 120);
      const e = new Error(`SharePoint ${r.status} en ${opts.method || "GET"} ${ruta} · permisos de la sesión: ${scp} · ${(await r.text()).slice(0, 160)}`);
      e.status = r.status;
      throw e;
    }
    return r;
  } finally {
    clearTimeout(t);
  }
}
const lista = (k) => `${SITE}/_api/web/GetList('${encodeURIComponent(CONFIG.sp.sitePath + "/" + CONFIG.sp.listas[k])}')`;
async function leerTodo(k) {
  let url = `${lista(k)}/items?$top=5000`;
  const out = [];
  while (url) {
    const d = await (await spFetch(url)).json();
    out.push(...d.value);
    url = d["odata.nextLink"];
  }
  return out;
}
// N peticiones a la vez (SharePoint limita si se le manda todo junto)
async function enLotes(cosas, fn, n = 6) {
  const cola = [...cosas];
  await Promise.all(Array.from({ length: n }, async () => { while (cola.length) await fn(cola.shift()); }));
}
const crear = (k, item) => spFetch(`${lista(k)}/items`, { method: "POST", headers: { "Content-Type": NM }, body: JSON.stringify(item) });

// Columnas de las listas (nombre interno = nombre visible, sin espacios). Igual que
// sharepoint.crear_listas() en Python.
const ESQUEMA = {
  semanal: [["Fruta", "Text"], ["Presupuesto", "Number"], ["Actual", "Number"], ["Maximo", "Number"], ["CargadoPor", "Text"], ["Nota", "Text"], ["Comprado", "Boolean"]],
  aprobados: [["Producto", "Text"], ["Cliente", "Text"], ["ClienteId", "Number"], ["Semana", "Text"], ["PrecioU", "Number"], ["PrecioKg", "Number"],
    ["Estado", "Text"], ["AprobadoPor", "Text"], ["RefFrutas", "Note"]],
};
const post = (url, body) => spFetch(url, { method: "POST", headers: { "Content-Type": NM }, body: JSON.stringify(body) });

// Biblioteca "Documentos" del sitio (URL "Documentos compartidos"): es la "drive"
// predeterminada que usa Graph en Python (sharepoint.subir_archivo).
const carpetaDatos = async () => CONFIG.sp.carpetaDatos;

let sinComprado = false; // la lista aún no tiene la columna Comprado
export const faltaColumnaComprado = () => sinComprado;

const sp = {
  async preparar() {
    for (const [k, campos] of Object.entries(ESQUEMA)) {
      try {
        await spFetch(lista(k) + "?$select=Id");
        continue;
      } catch (e) {
        if (e.status !== 404) throw e;
      }
      const titulo = CONFIG.sp.listas[k].split("/").pop();
      try {
        await post(`${SITE}/_api/web/lists`, { Title: titulo, BaseTemplate: 100, Description: "Hub Precios Fruta" });
      } catch (e) {
        // AllSites.Write deja escribir ítems pero no crear listas (eso es AllSites.Manage):
        // las listas se crean una sola vez desde SharePoint (ver README).
        if (e.status === 403) throw new Error(`Falta la lista "${titulo}" en EspacioColaborativo y esta app no tiene permiso para crearla. Avisa a sistemasdegestion@healthyfood.com.ec.`);
        throw e;
      }
      for (const [n, tipo] of campos)
        await post(`${lista(k)}/fields/CreateFieldAsXml`, { parameters: { SchemaXml: `<Field Type="${tipo}" DisplayName="${n}" Name="${n}" StaticName="${n}" />`, Options: 8 } });
    }
  },
  async subirRecetas(texto) {
    const dir = await carpetaDatos();
    await post(`${SITE}/_api/web/folders`, { ServerRelativeUrl: dir }).catch(() => {}); // ya existe
    await spFetch(`${SITE}/_api/web/GetFolderByServerRelativeUrl('${encodeURIComponent(dir)}')/Files/add(url='recetas.json',overwrite=true)`,
      { method: "POST", body: texto });
  },
  async semanas(n = 12) { return (await this.todo(n)).semanas; },
  async todo(n = 104) {
    const items = await leerTodo("semanal");
    return { semanas: agrupar(items).slice(0, n), presupuesto: presupuestoDe(items) };
  },
  async guardarPresupuesto(mapa, usuario) {
    // primero las filas nuevas, después se borran las viejas (si algo falla no queda sin presupuesto)
    const viejos = (await leerTodo("semanal")).filter((i) => i.Title === PRESUP);
    await enLotes(Object.entries(mapa), ([f, v]) => crear("semanal", { Title: PRESUP, Fruta: f, Presupuesto: v, CargadoPor: usuario }));
    await enLotes(viejos, (i) => spFetch(`${lista("semanal")}/items(${i.ID})`, { method: "POST", headers: { "X-HTTP-Method": "DELETE", "IF-MATCH": "*" } }));
  },
  async importarSemanas(semanas, usuario, avance) {
    const filas = semanas.flatMap((s) => Object.entries(s.frutas).map(([f, v]) => itemSemana(s.semana, f, v, usuario)));
    let hechas = 0;
    await enLotes(filas, async (x) => { await crear("semanal", x); avance?.(++hechas, filas.length); });
  },
  async guardarSemana(semana, frutas, usuario) {
    // reemplaza la semana completa (si Compras corrige, no quedan filas viejas). Primero
    // se crean las nuevas y recién después se borran las viejas: si algo falla a medias
    // no se pierde la semana.
    const viejos = (await leerTodo("semanal")).filter((i) => i.Title === semana);
    const filas = Object.entries(frutas).map(([f, v]) => itemSemana(semana, f, v, usuario));
    try {
      await crear("semanal", filas[0]);
    } catch (e) {
      // lista creada antes de existir la columna "Comprado": se guarda sin ella
      if (!/Comprado/.test(e.message)) throw e;
      filas.forEach((x) => delete x.Comprado);
      sinComprado = true;
      await crear("semanal", filas[0]);
    }
    await Promise.all(filas.slice(1).map((x) => crear("semanal", x)));
    await Promise.all(viejos.map((i) => spFetch(`${lista("semanal")}/items(${i.ID})`, { method: "POST", headers: { "X-HTTP-Method": "DELETE", "IF-MATCH": "*" } })));
  },
  async recetas() {
    const r = await spFetch(`${SITE}/_api/web/GetFileByServerRelativeUrl('${encodeURIComponent((await carpetaDatos()) + "/recetas.json")}')/$value`);
    return r.json();
  },
  async aprobados() { return leerTodo("aprobados"); },
  async aprobar(filas, semana, refFrutas, usuario) {
    await Promise.all(filas.map((f) => crear("aprobados", itemAprobado(f, semana, refFrutas, usuario))));
  },
};

export const datos = CONFIG.useMock ? demo : sp;
