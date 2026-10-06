// Capa de datos: la misma interfaz en modo demo (localStorage) y en SharePoint.
//
//   semanas(n)                 → [{semana, cargado_por, fecha, frutas:{FRUTA:{presupuesto,actual,maximo,nota}}}] (nueva primero)
//   guardarSemana(sem, frutas, usuario)
//   recetas()                  → {generado, productos:{code:{...}}, ventas:[...]}
//   aprobados()                → {"code|cliente_id": {Semana, PrecioU, PrecioKg, RefFrutas, ...}} (último por fila)
//   aprobar(filas, semana, refFrutas, usuario)
//   preparar()                 → crea las listas si no existen (solo SharePoint)
//   subirRecetas(texto)        → sube recetas.json (respaldo mientras el proceso del lunes no tenga permisos)

import { CONFIG } from "./config.js";

const agrupar = (items) => {
  const por = {};
  for (const f of items) {
    const s = (por[f.Title] ||= { semana: f.Title, frutas: {}, cargado_por: f.CargadoPor || "", fecha: f.Modified || "" });
    if ((f.Modified || "") > s.fecha) s.fecha = f.Modified;
    s.frutas[f.Fruta] = { presupuesto: +f.Presupuesto, actual: +f.Actual, maximo: +f.Maximo, nota: f.Nota || "" };
  }
  return Object.values(por).sort((a, b) => (a.semana < b.semana ? 1 : -1));
};
const ultimoAprobado = (items) => {
  const out = {};
  for (const f of items) {
    const k = `${f.Producto}|${f.ClienteId}`;
    if (!out[k] || f.Semana >= out[k].Semana) out[k] = f;
  }
  return out;
};

// ------------------------------------------------------------------ demo ----
const LS = "hub-precios-fruta:demo:";
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(LS + k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch {} };

const demo = {
  async preparar() {},
  async subirRecetas() {},
  async semanas(n = 12) {
    let items = lsGet("semanal", null);
    if (!items) {
      const r = await fetch("data/semanas_demo.json");
      items = r.ok ? await r.json() : [];
      lsSet("semanal", items);
    }
    return agrupar(items).slice(0, n);
  },
  async guardarSemana(semana, frutas, usuario) {
    const ahora = new Date().toISOString();
    const items = lsGet("semanal", []).filter((i) => i.Title !== semana);
    for (const [f, v] of Object.entries(frutas))
      items.push({ Title: semana, Fruta: f, Presupuesto: v.presupuesto, Actual: v.actual, Maximo: v.maximo, Nota: v.nota || "", CargadoPor: usuario, Modified: ahora });
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
  async aprobados() { return ultimoAprobado(lsGet("aprobados", [])); },
  async aprobar(filas, semana, refFrutas, usuario) {
    const items = lsGet("aprobados", []);
    for (const f of filas) items.push(itemAprobado(f, semana, refFrutas, usuario));
    lsSet("aprobados", items);
  },
};

function itemAprobado(f, semana, refFrutas, usuario) {
  return {
    Title: `${f.code}|${f.cliente_id}`, Producto: f.code, Cliente: f.cliente, ClienteId: f.cliente_id, Semana: semana,
    PrecioU: f.precioU, PrecioKg: f.precioKg, Estado: "Aplicado", AprobadoPor: usuario, RefFrutas: JSON.stringify(refFrutas),
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
const crear = (k, item) => spFetch(`${lista(k)}/items`, { method: "POST", headers: { "Content-Type": NM }, body: JSON.stringify(item) });

// Columnas de las listas (nombre interno = nombre visible, sin espacios). Igual que
// sharepoint.crear_listas() en Python.
const ESQUEMA = {
  semanal: [["Fruta", "Text"], ["Presupuesto", "Number"], ["Actual", "Number"], ["Maximo", "Number"], ["CargadoPor", "Text"], ["Nota", "Text"]],
  aprobados: [["Producto", "Text"], ["Cliente", "Text"], ["ClienteId", "Number"], ["Semana", "Text"], ["PrecioU", "Number"], ["PrecioKg", "Number"],
    ["Estado", "Text"], ["AprobadoPor", "Text"], ["RefFrutas", "Note"]],
};
const post = (url, body) => spFetch(url, { method: "POST", headers: { "Content-Type": NM }, body: JSON.stringify(body) });

// Biblioteca "Documentos" del sitio (URL "Documentos compartidos"): es la "drive"
// predeterminada que usa Graph en Python (sharepoint.subir_archivo).
const carpetaDatos = async () => CONFIG.sp.carpetaDatos;

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
  async semanas(n = 12) { return agrupar(await leerTodo("semanal")).slice(0, n); },
  async guardarSemana(semana, frutas, usuario) {
    // reemplaza la semana completa (si Compras corrige, no quedan filas viejas)
    const viejos = (await leerTodo("semanal")).filter((i) => i.Title === semana);
    await Promise.all(viejos.map((i) => spFetch(`${lista("semanal")}/items(${i.ID})`, { method: "POST", headers: { "X-HTTP-Method": "DELETE", "IF-MATCH": "*" } })));
    await Promise.all(Object.entries(frutas).map(([f, v]) =>
      crear("semanal", { Title: semana, Fruta: f, Presupuesto: v.presupuesto, Actual: v.actual, Maximo: v.maximo, Nota: v.nota || "", CargadoPor: usuario })));
  },
  async recetas() {
    const r = await spFetch(`${SITE}/_api/web/GetFileByServerRelativeUrl('${encodeURIComponent((await carpetaDatos()) + "/recetas.json")}')/$value`);
    return r.json();
  },
  async aprobados() { return ultimoAprobado(await leerTodo("aprobados")); },
  async aprobar(filas, semana, refFrutas, usuario) {
    await Promise.all(filas.map((f) => crear("aprobados", itemAprobado(f, semana, refFrutas, usuario))));
  },
};

export const datos = CONFIG.useMock ? demo : sp;
