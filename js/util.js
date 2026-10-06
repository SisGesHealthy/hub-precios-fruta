// Utilidades compartidas: semanas, formatos, normalización de nombres de fruta.

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function isoSemana(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dia = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dia);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return [t.getUTCFullYear(), Math.ceil(((t - y0) / 86400000 + 1) / 7)];
}

// Igual que reporte.semana_objetivo(): de viernes a domingo se carga la semana
// que empieza el lunes siguiente; de lunes a jueves, la semana en curso.
export function semanaObjetivo(hoy = new Date()) {
  const dow = (hoy.getDay() + 6) % 7; // 0 = lunes
  const lunes = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - dow + (dow >= 4 ? 7 : 0));
  const [y, w] = isoSemana(lunes);
  return { semana: `${y}-S${String(w).padStart(2, "0")}`, lunes };
}

export function lunesDeSemana(sem) {
  const [y, w] = sem.split("-S").map(Number);
  const ene4 = new Date(y, 0, 4);
  // lunes de la semana 1 puede caer en diciembre del año anterior: se cuenta en días desde el 4 de enero
  return new Date(y, 0, 4 - ((ene4.getDay() + 6) % 7) + (w - 1) * 7);
}

export function rangoSemana(sem) {
  const l = lunesDeSemana(sem);
  const d = new Date(l.getFullYear(), l.getMonth(), l.getDate() + 6);
  return `${l.getDate()} ${MESES[l.getMonth()]} – ${d.getDate()} ${MESES[d.getMonth()]}`;
}

export const semanaCorta = (sem) => "S" + sem.split("-S")[1];

// "TOMATE DE ÁRBOL- EXPORTACION" → "TOMATE DE ARBOL EXPORTACION" (misma regla que el Excel de prueba)
// La Ñ se conserva (PIÑA es el nombre en Odoo); solo se quitan tildes.
export const normFruta = (s) =>
  String(s || "").toUpperCase().replace(/Ñ/g, "\0").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\0/g, "Ñ")
    .replace(/[-–]/g, " ").replace(/\s+/g, " ").trim();

export const titulo = (s) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
export const usd = (x, d = 2) => (x == null || isNaN(x) ? "—" : "$" + x.toLocaleString("es-EC", { minimumFractionDigits: d, maximumFractionDigits: d }));
export const pct = (x, signo = true) => (x == null || !isFinite(x) ? "—" : (signo && x > 0 ? "+" : "") + (x * 100).toFixed(1) + "%");
export const num = (x) => (x == null ? "—" : Math.round(x).toLocaleString("es-EC"));
// Número escrito a mano: acepta coma o punto decimal.
export const leerNum = (s) => {
  const v = parseFloat(String(s ?? "").trim().replace(/\s/g, "").replace(",", "."));
  return isFinite(v) ? v : null;
};
export const claseDelta = (d) => (d == null ? "" : d >= 0.05 ? "sube-fuerte" : d >= 0.01 ? "sube" : d <= -0.01 ? "baja" : "igual");
