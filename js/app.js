// Arranque, barra superior y rutas: #/cargar (Compras), #/precios (Gerencia), #/tendencia.
import { CONFIG } from "./config.js";
import { el, clear } from "./dom.js";
import { datos } from "./datos.js";
import { vistaCargar } from "./cargar.js";
import { vistaPrecios } from "./precios.js";
import { vistaTendencia } from "./tendencia.js";
import { costosOdoo } from "./calculo.js";

const vista = document.getElementById("vista");
export const estado = { usuario: null, semanas: [], recetas: null, aprobados: {} };

const RUTAS = {
  cargar: { t: "Cargar semana", f: vistaCargar },
  precios: { t: "Precios por cliente", f: vistaPrecios },
  tendencia: { t: "Tendencias", f: vistaTendencia },
};
const DEMO_USUARIOS = [
  ["Compras", "compras@healthyfood.com.ec"],
  ["Gerencia", "gerencia@healthyfood.com.ec"],
  ["Agrícola", "agricola@healthyfood.com.ec"],
  ["Sistemas de Gestión", "sistemasdegestion@healthyfood.com.ec"],
];

export const esAgricola = () => (CONFIG.roles.agricola || []).includes(estado.usuario?.correo);
export const esCompras = () => [...CONFIG.roles.compras, ...CONFIG.roles.admin].includes(estado.usuario?.correo);
export const puedeAprobar = () =>
  CONFIG.useMock || [...CONFIG.roles.gerencia, ...CONFIG.roles.admin].includes(estado.usuario?.correo);

export async function recargar() {
  const [{ semanas, presupuesto, agro }, aprobados] = await Promise.all([datos.todo(104), datos.aprobados()]); // 2 años de historial
  estado.semanasCrudas = semanas;
  estado.agro = agro || {};
  estado.presupuestoGuardado = presupuesto;
  estado.aprobados = aprobados;
  aplicarPresupuesto();
}

// El presupuesto es UNO por fruta (no por semana): el guardado en el editor de presupuesto;
// si una fruta no tiene, el último que traía una semana cargada; si tampoco, su costo de Odoo.
// Se aplica a todas las semanas, así el cálculo y los "vs presupuesto" usan el mismo número.
// Semanas históricas (importadas de Odoo) = solo tendencia de la fruta, no precios de venta.
export function aplicarPresupuesto() {
  const ef = { ...costosOdoo(estado.recetas) };
  for (const s of [...(estado.semanasCrudas || [])].reverse()) // de la más vieja a la más nueva: gana la última
    for (const [f, v] of Object.entries(s.frutas)) if (v.presupuesto > 0) ef[f] = v.presupuesto;
  Object.assign(ef, estado.presupuestoGuardado || {});
  estado.presupuesto = ef;
  estado.semanas = (estado.semanasCrudas || []).map((s) => ({
    ...s,
    historico: /^historico/i.test(s.cargado_por || ""),
    // datos agronómicos: los de las filas AGRO|semana (los registra Agrícola o Compras) mandan
    frutas: Object.fromEntries(Object.entries(s.frutas).map(([f, v]) => [f, { ...v, presupuesto: ef[f] ?? v.presupuesto, ...(estado.agro?.[s.semana]?.[f] || {}) }])),
  }));
}

// Versión publicada (version.json). Si la app abierta es más vieja (caché del navegador o
// del service worker), borra la caché y recarga UNA vez. Subir este número en cada publicación.
const VERSION = 18;
async function asegurarVersion() {
  if (CONFIG.useMock && location.hostname === "localhost") return;
  try {
    const v = (await (await fetch("version.json", { cache: "no-store" })).json()).version;
    const k = "hub-precios-fruta:recargado";
    if (v > VERSION && sessionStorage.getItem(k) !== String(v)) {
      sessionStorage.setItem(k, String(v));
      if ("caches" in window) for (const c of await caches.keys()) await caches.delete(c);
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
      await Promise.all(regs.map((r) => r.unregister()));
      location.reload();
      return true;
    }
  } catch {}
}

async function main() {
  if (await asegurarVersion()) return;
  if (CONFIG.useMock) {
    const c = localStorage.getItem("hub-precios-fruta:demoUser") || DEMO_USUARIOS[0][1];
    const u = DEMO_USUARIOS.find((x) => x[1] === c) || DEMO_USUARIOS[0];
    estado.usuario = { nombre: u[0], correo: u[1] };
  } else {
    const auth = await import("./auth.js");
    const acc = await auth.initAuth();
    if (!acc) return pantallaLogin(auth);
    try {
      if (!(await auth.asegurarToken())) return;
    } catch (e) {
      return pantallaLogin(auth, e.message);
    }
    estado.usuario = { nombre: acc.name, correo: acc.username.toLowerCase() };
  }
  vista.appendChild(el("div", { class: "cargando" }, "Cargando precios y recetas…"));
  try {
    await datos.preparar();
    await recargar();
    // Los datos de Odoo (recetas.json) solo hacen falta para "Precios por cliente". Si esta
    // cuenta no los puede leer (no existe el archivo o no tiene permiso en la biblioteca de
    // documentos: SharePoint responde 404 en ambos casos), la app entra igual: Cargar semana
    // y la tendencia de la fruta funcionan, y Precios por cliente muestra el aviso.
    try {
      estado.recetas = await datos.recetas();
      estado.faltanRecetas = false;
    } catch (e) {
      if (e.status !== 404 && e.status !== 403) throw e;
      estado.recetas = { productos: {}, ventas: [], generado: "—" };
      estado.faltanRecetas = true;
    }
    aplicarPresupuesto(); // ahora sí con el costo de Odoo como respaldo
  } catch (e) {
    clear(vista);
    vista.appendChild(el("div", { class: "login" }, [
      el("h1", {}, "No se pudieron leer los datos"),
      el("p", {}, ["Sesión: ", el("b", {}, estado.usuario.correo)]),
      el("div", { class: "aviso err", style: "text-align:left;word-break:break-word" }, e.message),
      el("p", { class: "nota" }, "Si esa no es tu cuenta (los hubs comparten la sesión del navegador), cámbiala:"),
      CONFIG.useMock ? null : el("button", { class: "btn btn-verde", onclick: async () => (await import("./auth.js")).logout() }, "Cambiar de cuenta"),
    ]));
    return;
  }
  pintarBarra();
  window.addEventListener("hashchange", rutear);
  if (!location.hash) location.hash = esCompras() || esAgricola() ? "#/cargar" : "#/precios";
  else rutear();
  if ("serviceWorker" in navigator && !CONFIG.useMock) navigator.serviceWorker.register("sw.js").catch(() => {});
}

// Aviso cuando la cuenta no puede leer recetas.json (lo usa "Precios por cliente").
export function avisoSinRecetas() {
  const admin = CONFIG.roles.admin.includes(estado.usuario.correo);
  return el("div", { class: "login sin-recetas" }, [
    el("h1", {}, "No se pueden leer los datos de Odoo"),
    el("p", {}, ["Esta pantalla necesita el archivo recetas.json (recetas y precios por cliente), en ",
      el("i", {}, "EspacioColaborativo › Documentos compartidos › PreciosFruta"), ". Con la cuenta ", el("b", {}, estado.usuario.correo),
      " no se encuentra: o no existe, o esta cuenta no tiene permiso de lectura en esa biblioteca."]),
    el("p", { class: "nota" }, "«Cargar semana» y «Tendencias» funcionan igual sin este archivo."),
    admin ? el("label", { class: "btn btn-verde" }, ["Subir recetas.json", el("input", { type: "file", accept: ".json", class: "hidden",
      onchange: async (e) => {
        const txt = await e.target.files[0].text();
        try {
          JSON.parse(txt);
          await datos.subirRecetas(txt);
          location.reload();
        } catch (err) {
          alert("No se pudo subir: " + err.message);
        }
      } })]) : el("p", { class: "nota" }, "Pide a sistemasdegestion@healthyfood.com.ec que dé permiso de lectura a esta cuenta en la carpeta PreciosFruta."),
  ]);
}

function pantallaLogin(auth, error) {
  clear(vista);
  vista.appendChild(
    el("div", { class: "login" }, [
      el("img", { src: "icons/logo.png", class: "login-logo", alt: "Healthy Food" }),
      el("h1", {}, "Precios de Fruta"),
      error ? el("div", { class: "aviso" }, error) : null,
      el("p", {}, "Inicia sesión con tu cuenta Microsoft de Healthy Food."),
      el("button", { class: "btn btn-verde", onclick: () => auth.login() }, "Iniciar sesión"),
    ])
  );
}

function pintarBarra() {
  const barra = document.getElementById("barra");
  clear(barra);
  const nav = el("nav", { class: "tabs" }, Object.entries(RUTAS).map(([k, r]) => el("a", { href: `#/${k}`, "data-ruta": k }, r.t)));
  let usuario;
  if (CONFIG.useMock) {
    usuario = el("select", { class: "demo-user", title: "Modo demo: elegir usuario",
      onchange: (e) => { localStorage.setItem("hub-precios-fruta:demoUser", e.target.value); location.reload(); } },
      DEMO_USUARIOS.map(([n, c]) => el("option", { value: c, selected: c === estado.usuario.correo }, `Demo · ${n}`)));
  } else {
    usuario = el("span", { class: "barra-user" }, estado.usuario.nombre);
  }
  barra.append(
    el("div", { class: "barra-marca" }, [el("img", { src: "icons/logo.png", alt: "" }), el("span", {}, "Precios de Fruta")]),
    nav,
    el("div", { class: "barra-der" }, [usuario])
  );
}

function rutear() {
  const k = (location.hash.match(/^#\/(\w+)/) || [])[1] || "precios";
  const r = RUTAS[k] || RUTAS.precios;
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("activo", a.dataset.ruta === k));
  clear(vista);
  r.f(vista);
  window.scrollTo(0, 0);
}

main();
