// Configuración de Hub Precios Fruta.
//
// Compras carga el precio semanal de la fruta (viernes); la app calcula a qué
// precio hay que llevar a cada cliente para sostener el margen de aportación,
// y el lunes 06:30 un proceso en GitHub Actions (guardian_inventario /
// precios-fruta/tarea_semanal.py) envía el correo a Gerencia.
//
// useMock: true  → modo demo: datos en el navegador, recetas de ejemplo
//                  (data/recetas.json si existe en local, si no las anónimas).
// useMock: false → SharePoint real con el registro "Hub Precios Fruta" de Entra.
// ?demo en la URL → modo demo (datos de ejemplo en este navegador).

const CLIENT_ID = "d3efea61-7b3c-44d3-80bc-9c871b1dc0ac"; // registro "Hub Precios Fruta" en Entra

export const CONFIG = {
  useMock: new URLSearchParams(location.search).has("demo"),

  msal: {
    clientId: CLIENT_ID,
    authority: "https://login.microsoftonline.com/8f9b210d-f5e5-404f-9fed-a0a827154105",
    redirectUri: window.location.origin + window.location.pathname,
  },

  sp: {
    host: "https://marcalman.sharepoint.com",
    sitePath: "/sites/EspacioColaborativo",
    listas: {
      semanal: "Lists/PreciosFrutaSemanal", // una fila por fruta por semana
      aprobados: "Lists/PreciosClienteAprobados", // precios aprobados por producto×cliente
    },
    // recetas.json vive en <biblioteca predeterminada>/PreciosFruta/; la sube el proceso
    // del lunes (extraer_recetas.py --sharepoint) o, de respaldo, Sistemas desde la app.
    carpetaDatos: "/sites/EspacioColaborativo/Documentos compartidos/PreciosFruta",
  },

  // Quién ve qué al entrar (todos pueden ver todo; esto solo elige la pantalla inicial
  // y quién puede guardar).
  roles: {
    compras: ["compras@healthyfood.com.ec"],
    gerencia: ["jmgonzalez@healthyfood.com.ec"],
    admin: ["sistemasdegestion@healthyfood.com.ec"],
  },

  // Frutas del reporte semanal de Compras (nombre = producto en Odoo) → códigos de
  // Odoo que mueven. Igual que MAPEO en precios-fruta/config.py. factor = kg de fruta
  // por kg del ingrediente (pulpas intermedias, rendimiento de su lista de materiales).
  // opcional = sale en la plantilla, se llena solo si su precio se movió; vacía →
  // el ingrediente queda a su costo de Odoo.
  mapeo: {
    MP00003: { fruta: "GUAYABA" },
    MP00243: { fruta: "LULO ENTERO" },
    MP00014: { fruta: "MARACUYA" },
    MPI014: { fruta: "MARACUYA", factor: 3.448, intermedio: true },
    MP00016: { fruta: "MORA DE CASTILLA" },
    MP00242: { fruta: "MORA CATEGORIA 1" },
    MP00036: { fruta: "MORA TIPO B" },
    MP00028: { fruta: "MOTA GUANABANA" },
    MP00019: { fruta: "NARANJILLA" },
    MP00212: { fruta: "NARANJILLA" }, // naranjilla de jugo: misma fruta
    MP00027: { fruta: "TAMARINDO" },
    MP00241: { fruta: "TOMATE DE ARBOL 4CM" },
    MP00012: { fruta: "TOMATE DE ARBOL EXPORTACION" },
    MP00232: { fruta: "MANGO" },
    MPI002: { fruta: "MANGO", factor: 1.47, intermedio: true },
    MP00235: { fruta: "MORA DESPITONADA" },
    MP00022: { fruta: "PIÑA", opcional: true },
    MP00023: { fruta: "PIÑA PELADA", opcional: true },
    MP00020: { fruta: "PAPAYA", opcional: true },
    MP00007: { fruta: "FRUTILLA", opcional: true },
    MP00221: { fruta: "FRUTILLA DESPITONADA PARA PICAR", opcional: true },
    MP00154: { fruta: "FRUTILLA DESPITONADA PARA TOPPING", opcional: true },
    MP00005: { fruta: "COCO", opcional: true },
    MP00034: { fruta: "ARANDANO", opcional: true },
    MP00030: { fruta: "LIMON MEYER", opcional: true },
    MP00024: { fruta: "CONCENTRADO DE GUAYABA", opcional: true },
    MP00025: { fruta: "CONCENTRADO DE MANGO", opcional: true },
    MP00039: { fruta: "PULPA MANGO ASEPTICO", opcional: true },
  },

  // igual que PARAMS en precios-fruta/config.py
  params: { modo: "semanal", umbral_cambio: 0.01, mp_pvp_politica: 0.55, solo_empresas: true, min_kg_mes: 50, tolerancia_precio: 0.02 },
  // Alerta al cargar: cambio de una semana a otra mayor a esto pide confirmar (¿error de tipeo?)
  saltoSospechoso: 0.3,
};
