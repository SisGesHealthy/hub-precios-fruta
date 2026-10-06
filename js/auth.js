// Envoltorio sobre MSAL (vendor/msal-browser.min.js). Solo con useMock false.
// Token para la API REST de SharePoint (listas + recetas.json en la biblioteca).
// Patrón de hub-recepcion: todas las apps de sisgeshealthy.github.io comparten
// localStorage, así que al arrancar se confirma el token propio (asegurarToken).

import { CONFIG } from "./config.js";

let msalInstance = null;
let account = null;
const SCOPES = [`${CONFIG.sp.host}/AllSites.Write`];

function getMsal() {
  if (!msalInstance) {
    msalInstance = new msal.PublicClientApplication({
      auth: { clientId: CONFIG.msal.clientId, authority: CONFIG.msal.authority, redirectUri: CONFIG.msal.redirectUri },
      cache: { cacheLocation: "localStorage" },
    });
  }
  return msalInstance;
}

export async function initAuth() {
  const app = getMsal();
  await app.initialize();
  const result = await app.handleRedirectPromise().catch(() => null);
  if (result && result.account) account = result.account;
  else {
    const tenant = CONFIG.msal.authority.split("/").pop();
    account = app.getActiveAccount() || app.getAllAccounts().filter((a) => a.tenantId === tenant)[0] || null;
  }
  if (account) app.setActiveAccount(account);
  return account;
}

export const login = () => getMsal().loginRedirect({ scopes: SCOPES, prompt: "select_account" });
export const logout = () => getMsal().logoutRedirect({ account });

export async function asegurarToken() {
  try {
    await getMsal().acquireTokenSilent({ scopes: SCOPES, account });
    return true;
  } catch (e) {
    const k = "hub-precios-fruta:redir";
    if (Date.now() - Number(sessionStorage.getItem(k) || 0) < 60000)
      throw new Error("No se pudo obtener el permiso de SharePoint. Cierra sesión e inicia de nuevo.");
    sessionStorage.setItem(k, String(Date.now()));
    await getMsal().acquireTokenRedirect({ scopes: SCOPES, account, loginHint: account?.username });
    return false;
  }
}

export async function getAccessToken() {
  const r = await getMsal().acquireTokenSilent({ scopes: SCOPES, account });
  return r.accessToken;
}
