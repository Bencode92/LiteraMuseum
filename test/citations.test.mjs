/* Citations : reprise des citations déjà saisies + publication + non-résurrection après suppression */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");   // le dépôt, quel que soit l'endroit où il est cloné
const dom = new JSDOM(readFileSync(ROOT + "/index.html", "utf8"), { url: "http://localhost:8080/", pretendToBeVisual: true });
const w = dom.window;
const AI = { calls: [], distant: {} };
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (opts && opts.method === "POST") {
    const b = JSON.parse(opts.body); AI.calls.push(b);
    if (b.mode === "commit") { AI.distant[b.path] = b.content; return { ok: true, json: async () => ({ ok: true }) }; }
    return { ok: true, json: async () => ({ answer: "📜 LA CITATION\nUne citation propre.\n\n🔑 SENS\nDu sens.", stop: "end_turn" }) };
  }
  const path = u.replace("http://localhost:8080/", "").split("?")[0];
  if (AI.distant[path]) return { ok: true, json: async () => JSON.parse(AI.distant[path]) };  // ce qui a été publié
  try { return { ok: true, json: async () => JSON.parse(readFileSync(ROOT + "/" + path, "utf8")) }; }
  catch { return { ok: false, status: 404, json: async () => ({}) }; }
};
for (const k of ["document","location","localStorage","addEventListener","MutationObserver","getComputedStyle","requestAnimationFrame","history"])
  globalThis[k] = k === "addEventListener" ? w[k].bind(w) : w[k];
globalThis.window = w;
globalThis.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
globalThis.scrollTo = () => {}; globalThis.confirm = () => true;
w.Element.prototype.scrollIntoView = function () {};

// UNE CITATION DÉJÀ SAISIE, dans l'ancien format, avant toute migration
w.localStorage.setItem("citations:list", JSON.stringify([
  { id: "1750000000000", auteur: "Pascal", oeuvre: "Pensées", citation: "Le coeur a ses raisons.", analyse: "🔑 SENS\nAncienne analyse.", ts: "2026-06-20" },
]));

await import(pathToFileURL(ROOT + "/js/app.js").href);
const $ = id => w.document.getElementById(id);
const txt = () => $("view").textContent.replace(/\s+/g, " ");
const go = async h => { w.location.hash = h; await new Promise(r => setTimeout(r, 80)); };
let ko = 0;
const check = (l, c, x = "") => { console.log((c ? "  ✅ " : "  ❌ ") + l + (c ? "" : "  → " + x)); if (!c) ko++; };
await new Promise(r => setTimeout(r, 500));

console.log("\n── Les citations déjà saisies sont reprises");
await go("#/citations");
check("l'ancienne citation est toujours là", txt().includes("Le coeur a ses raisons"), txt().slice(0, 200));
check("son analyse d'origine est conservée",
  JSON.parse(w.localStorage.getItem("citations:list"))[0].analyse.includes("Ancienne analyse"));
check("la barre de publication est apparue", !!$("citPull") && !!$("citPush") && !!$("citPushAuto"));

console.log("\n── Une nouvelle citation part sur GitHub");
$("cit_auteur").value = "Sartre"; $("cit_texte").value = "lenfer cest les autres";
$("citGo").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 4600));
const pub = AI.calls.filter(c => c.mode === "commit" && c.path === "data/citations-perso.json");
check("publication automatique déclenchée", pub.length >= 1, pub.length + " commit(s)");
check("fichier distinct de la collection de départ", !AI.distant["data/citations.json"]);
const publie = JSON.parse(AI.distant["data/citations-perso.json"] || "[]");
check("les deux citations sont publiées", publie.length === 2, JSON.stringify(publie.map(c => c.citation)));
check("l'ancienne aussi, pas seulement la neuve", publie.some(c => c.citation.includes("Le coeur a ses raisons")));

console.log("\n── Suppression : l'élément ne doit pas ressusciter");
const cible = JSON.parse(w.localStorage.getItem("citations:list")).find(c => c.auteur === "Sartre");
w.document.querySelector(`[data-citdel="${cible.id}"]`).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
await new Promise(r => setTimeout(r, 4600));
check("suppression publiée", JSON.parse(AI.distant["data/citations-perso.json"]).length === 1,
  JSON.stringify(JSON.parse(AI.distant["data/citations-perso.json"]).map(c => c.auteur)));
await go("#/lectures"); await go("#/citations");   // rechargement : la fusion avec le distant a lieu
check("la citation supprimée ne revient pas après synchro",
  !JSON.parse(w.localStorage.getItem("citations:list")).some(c => c.auteur === "Sartre"),
  JSON.stringify(JSON.parse(w.localStorage.getItem("citations:list")).map(c => c.auteur)));
process.exit(ko ? 1 : 0);
