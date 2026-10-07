// Arranque, barra superior y rutas: #/cargar (Compras), #/precios (Gerencia), #/tendencia.
import { CONFIG } from "./config.js";
import { el, clear } from "./dom.js";
import { datos } from "./datos.js";
import { vistaCargar } from "./cargar.js";
import { vistaPrecios } from "./precios.js";
import { vistaTendencia } from "./tendencia.js";

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
  ["Sistemas de Gestión", "sistemasdegestion@healthyfood.com.ec"],
];

export const esCompras = () => [...CONFIG.roles.compras, ...CONFIG.roles.admin].includes(estado.usuario?.correo);
export const puedeAprobar = () =>
  CONFIG.useMock || [...CONFIG.roles.gerencia, ...CONFIG.roles.admin].includes(estado.usuario?.correo);

export async function recargar() {
  const [semanas, aprobados] = await Promise.all([datos.semanas(104), datos.aprobados()]); // 2 años de historial
  estado.semanas = semanas;
  estado.aprobados = aprobados;
}

// Versión publicada (version.json). Si la app abierta es más vieja (caché del navegador o
// del service worker), borra la caché y recarga UNA vez. Subir este número en cada publicación.
const VERSION = 9;
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
    estado.recetas = await datos.recetas();
  } catch (e) {
    clear(vista);
    if (e.status === 404) return pantallaSinRecetas();
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
  if (!location.hash) location.hash = esCompras() ? "#/cargar" : "#/precios";
  else rutear();
  if ("serviceWorker" in navigator && !CONFIG.useMock) navigator.serviceWorker.register("sw.js").catch(() => {});
}

// Primera vez (o si el proceso del lunes aún no corre): no hay recetas.json en SharePoint.
function pantallaSinRecetas() {
  const admin = CONFIG.roles.admin.includes(estado.usuario.correo);
  vista.appendChild(el("div", { class: "login" }, [
    el("h1", {}, "Faltan las recetas de Odoo"),
    el("p", {}, "El proceso del lunes las sube automáticamente. Mientras tanto, Sistemas puede subir el archivo recetas.json generado con extraer_recetas.py."),
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
      } })]) : el("p", { class: "nota" }, "Avisa a sistemasdegestion@healthyfood.com.ec."),
  ]));
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
