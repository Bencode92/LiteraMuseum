/* Socle commun aux tests : charge l'application dans un DOM simulé, remplace le
   réseau (fichiers du dépôt) et le Worker (faux, au format exact du vrai). */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* Réponses du faux Worker, au format que produit réellement le vrai :
   intitulé de section SEUL sur sa ligne, corps à la ligne suivante. */
const S = (...l) => l.join("\n");
export const REPONSES = {
  lecture: S("\u{1F4D6} EN DEUX PHRASES", "Un roman court.", "",
             "\u{1F9ED} LE CONTEXTE", "L'apres-guerre.", "",
             "\u{1F300} CE QUE LE LIVRE CHANGE", "Une voix blanche.", "",
             "\u{1F9E0} LES IDEES CLES", "- L'absurde", "- La revolte", "",
             "\u{1F4AC} TES IDEES", "Tu as touche l'absurde.", "",
             "\u{1F517} A RAPPROCHER DE", "Kafka.", "",
             "\u{1F3AF} A RETENIR", "Une phrase.", "",
             "\u{1F4DA} RATTACHEMENT", "10 · Les maitres du soupcon"),
  concept: S("\u{1F511} DEFINITION", "Une these.", "",
             "\u{1F9ED} D'OU CA VIENT", "Les Grecs.", "",
             "\u{1F94A} LES POSITIONS EN PRESENCE", "- Les durs", "- Les compatibilistes", "",
             "\u{1F4A1} L'IMAGE POUR COMPRENDRE", "Un film rejoue.", "",
             "\u{1F9E0} LES ENJEUX", "La responsabilite.", "",
             "\u{1F4DA} OU LE TRAVAILLER", "Spinoza.", "Chapitres : 6, 10", "",
             "\u{1F50D} TROIS QUESTIONS", "- Une", "- Deux", "",
             "\u{1F3AF} A RETENIR", "Une phrase."),
  mot: S("\u{1F524} DEFINITION", "Adjectif : difficile a comprendre.", "",
         "\u{1F9EC} ORIGINE", "Du latin abscondere.", "",
         "\u{1F4D0} DANS TA PHRASE", "Sens pejoratif.", "",
         "\u{1F500} A NE PAS CONFONDRE", "- obscur : moins savant", "",
         "\u{1F4DD} POUR L'EMPLOYER", "**Constructions :** un raisonnement abscons",
         "- Une phrase courante.", "- Une phrase d'analyse.", "- Une phrase litteraire.", "",
         "\u{1F3AF} MEMO", "Obscur a force d'etre savant"),
  citation: S("\u{1F4DC} LA CITATION", "« L'homme est condamne a etre libre. »",
              "Note : accents corriges.", "",
              "\u{1F511} SENS", "La liberte n'est pas un choix.", "",
              "\u{1F3AF} A RETENIR", "La liberte comme fardeau."),
};

export async function demarrer({ localStorage: seed = {} } = {}) {
  const dom = new JSDOM(readFileSync(join(ROOT, "index.html"), "utf8"),
    { url: "http://localhost:8080/", pretendToBeVisual: true });
  const w = dom.window;
  const ia = { appels: [], distant: {}, tronquer: false, erreurs: [] };
  // une erreur pendant un rendu laissait la page vide sans que le test le dise
  w.addEventListener("error", e => ia.erreurs.push(String((e.error && e.error.stack) || e.message)));
  process.on("unhandledRejection", e => ia.erreurs.push("promesse rejetée : " + String((e && e.stack) || e)));

  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (opts && opts.method === "POST") {
      const b = JSON.parse(opts.body);
      ia.appels.push(b);
      if (b.mode === "commit") { ia.distant[b.path] = b.content; return { ok: true, json: async () => ({ ok: true }) }; }
      const rep = b.action === "chat" ? "Reponse a : " + b.question : (REPONSES[b.mode] || "reponse");
      return { ok: true, json: async () => ({ answer: rep, stop: ia.tronquer ? "max_tokens" : "end_turn" }) };
    }
    const path = u.replace("http://localhost:8080/", "").split("?")[0];
    if (ia.distant[path]) return { ok: true, json: async () => JSON.parse(ia.distant[path]) };
    try { return { ok: true, json: async () => JSON.parse(readFileSync(join(ROOT, path), "utf8")) }; }
    catch { return { ok: false, status: 404, json: async () => ({}) }; }
  };
  for (const k of ["document", "location", "localStorage", "addEventListener",
                   "MutationObserver", "getComputedStyle", "requestAnimationFrame", "history"])
    globalThis[k] = k === "addEventListener" ? w[k].bind(w) : w[k];
  globalThis.window = w;
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.scrollTo = () => {};
  globalThis.confirm = () => true;
  w.Element.prototype.scrollIntoView = function () {};   // non implémenté par jsdom
  for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, v);

  await import(pathToFileURL(join(ROOT, "js/app.js")).href + "?t=" + Math.random());
  await pause(450);   // chargement des données + première synchro

  const $ = id => w.document.getElementById(id);
  return {
    w, ia, $,
    texte: () => $("view").textContent.replace(/\s+/g, " ").trim(),
    aller: async h => { w.location.hash = h; await pause(80); },
    clic: id => { const e = $(id); if (!e) throw new Error("élément absent : " + id); e.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); },
    choisir: (id, v) => { const e = $(id); e.value = v; e.dispatchEvent(new w.Event("change", { bubbles: true })); },
    saisir: (id, v) => { const e = $(id); e.value = v; e.dispatchEvent(new w.Event("input", { bubbles: true })); },
    lu: cle => JSON.parse(w.localStorage.getItem(cle) || "[]"),
    tous: sel => [...w.document.querySelectorAll(sel)],
  };
}

export const pause = ms => new Promise(r => setTimeout(r, ms));

export function verificateur(titre) {
  let ok = 0, ko = 0;
  return {
    section: t => console.log(`\n── ${t}`),
    check(l, c, x = "") { c ? ok++ : ko++; console.log((c ? "  ✅ " : "  ❌ ") + l + (c ? "" : "  → " + x)); },
    bilan() {
      console.log(`\n${ko ? "❌" : "✅"} ${titre} : ${ok} vérifications OK, ${ko} en échec`);
      process.exit(ko ? 1 : 0);
    },
  };
}
