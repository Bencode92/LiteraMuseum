/* Citations : reprise des citations déjà saisies lors du passage à la publication
   GitHub, réécriture d'une saisie bâclée, et non-résurrection après suppression. */
import { demarrer, pause, verificateur } from "./_harness.mjs";

const t = verificateur("citations");
// une citation déjà saisie, dans l'ancien format, avant toute migration
const a = await demarrer({
  localStorage: {
    "citations:list": JSON.stringify([{
      id: "1750000000000", auteur: "Pascal", oeuvre: "Pensées",
      citation: "Le coeur a ses raisons.", analyse: "🔑 SENS\nAncienne analyse.", ts: "2026-06-20",
    }]),
  },
});

t.section("Les citations déjà saisies sont reprises");
await a.aller("#/citations");
t.check("l'ancienne citation est toujours là", a.texte().includes("Le coeur a ses raisons"), a.texte().slice(0, 180));
t.check("son analyse d'origine est conservée", a.lu("citations:list")[0].analyse.includes("Ancienne analyse"));
t.check("la barre de publication est apparue", !!a.$("citPull") && !!a.$("citPush") && !!a.$("citPushAuto"));

t.section("Une saisie bâclée est rétablie");
a.$("cit_auteur").value = "Sartre";
a.$("cit_texte").value = "lhomme est condanné a etre libre";
a.clic("citGo");
await pause(200);
const neuve = a.lu("citations:list").find(c => c.auteur === "Sartre");
t.check("citation rétablie et enregistrée",
  neuve.citation === "L'homme est condamne a etre libre.", JSON.stringify(neuve.citation));
t.check("guillemets retirés de la version propre", !/[«»]/.test(neuve.citation));
t.check("saisie d'origine conservée", neuve.saisie === "lhomme est condanné a etre libre", JSON.stringify(neuve.saisie));
t.check("le champ affiche la version corrigée", a.$("cit_texte").value === neuve.citation);
t.check("la carte rappelle ce qui avait été tapé", a.texte().includes("tu avais écrit"), a.texte().slice(0, 200));
t.check("la section 📜 est rendue", !!a.w.document.querySelector(".cit-sec.source"));

t.section("Publication sur GitHub");
await pause(4600);
const pub = a.ia.appels.filter(c => c.mode === "commit" && c.path === "data/citations-perso.json");
t.check("publication automatique déclenchée", pub.length >= 1, pub.length + " commit(s)");
t.check("la collection de départ n'est pas écrasée", !a.ia.distant["data/citations.json"]);
const publie = JSON.parse(a.ia.distant["data/citations-perso.json"] || "[]");
t.check("les deux citations sont publiées", publie.length === 2, JSON.stringify(publie.map(c => c.auteur)));
t.check("l'ancienne aussi, pas seulement la neuve", publie.some(c => c.citation.includes("Le coeur a ses raisons")));

t.section("Suppression : pas de résurrection");
a.w.document.querySelector(`[data-citdel="${neuve.id}"]`).dispatchEvent(new a.w.MouseEvent("click", { bubbles: true }));
await pause(4600);
t.check("suppression publiée",
  !JSON.parse(a.ia.distant["data/citations-perso.json"]).some(c => c.id === neuve.id));
await a.aller("#/lectures"); await a.aller("#/citations");   // rechargement : fusion avec le distant
t.check("la citation supprimée ne revient pas", !a.lu("citations:list").some(c => c.id === neuve.id),
  JSON.stringify(a.lu("citations:list").map(c => c.auteur)));

t.bilan();
