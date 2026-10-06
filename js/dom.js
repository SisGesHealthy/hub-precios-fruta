// Helper para construir DOM sin plantillas ni frameworks (igual que los otros hubs).
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  }
  return node;
}

export const clear = (node) => (node.innerHTML = "");

export function toast(msg, tipo = "ok") {
  const t = el("div", { class: `toast ${tipo}`, role: "status" }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("fuera"), 3200);
  setTimeout(() => t.remove(), 3700);
}
