/* Lectures et concepts : création, mode rappel, discussion, rattachements
   croisés avec le corpus, publication automatique. */
import { demarrer, pause, verificateur } from "./_harness.mjs";

const t = verificateur("carnet");
const a = await demarrer();

t.section("Onglets");
const onglets = a.tous(".tab").map(b => b.textContent);
t.check("les cinq onglets du carnet sont présents",
  ["Mes lectures", "Concepts", "Vocabulaire", "Citations"].every(o => onglets.includes(o)), onglets.join(" | "));

t.section("Concepts — fiche livrée avec le dépôt");
await a.aller("#/concepts");
t.check("le déterminisme est listé", a.texte().includes("déterminisme"), a.texte().slice(0, 140));
const idCon = a.w.document.querySelector("[data-nav^='#/concepts/c/']").dataset.nav;
await a.aller(idCon);
t.check("8 sections rendues", a.tous(".cit-sec").length === 8, a.tous(".cit-sec").length + " sections");
t.check("les positions en présence sont en liste", a.tous(".cit-sec ul li").length >= 4);
t.check("renvois cliquables vers les chapitres du cours", a.tous(".chip[data-nav^='#/c/']").length === 7,
  a.tous(".chip[data-nav^='#/c/']").length + " renvois");

t.section("Concepts — la discussion nourrit la fiche");
a.$("cz_q").value = "et la responsabilité ?";
a.clic("czAsk");
await pause(150);
t.check("appel en mode concept/chat", a.ia.appels.some(c => c.mode === "concept" && c.action === "chat"));
t.check("la fiche sert de contexte", (a.ia.appels.findLast(c => c.action === "chat") || {}).fiche?.length > 100);
t.check("deux messages affichés", a.tous("#czChat .msg").length === 2, a.tous("#czChat .msg").length + "");
t.check("discussion enregistrée", (a.lu("concepts:list")[0].chat || []).length === 2);
a.clic("czRedo");
await pause(200);
t.check("l'historique est transmis à la réécriture",
  (a.ia.appels.findLast(c => c.mode === "concept" && c.action === "fiche") || {}).history?.length === 2);

t.section("Lectures — création en mode rappel");
await a.aller("#/lectures");
t.check("case « lu il y a longtemps » présente", !!a.$("lec_rappel"));
const TITRE = "Zzz Livre de test (philo)";   // titre improbable : le dépôt contient de vraies lectures
a.$("lec_titre").value = TITRE;
a.$("lec_auteur").value = "Tolstoï";
a.$("lec_rappel").checked = true;
a.choisir("lec_dom", "philo");
a.choisir("lec_note", "4");
a.clic("lecGo");
await pause(220);
const lec = a.lu("lectures:list")[0];
t.check("lecture enregistrée", lec?.titre === TITRE, lec?.titre);
t.check("rappel:true transmis au Worker",
  (a.ia.appels.findLast(c => c.mode === "lecture" && c.action !== "chat") || {}).rappel === true);
t.check("chapitre déduit de la fiche", lec?.chapitre === 10, "chapitre=" + lec?.chapitre);
t.check("liste des chapitres envoyée à l'IA",
  (a.ia.appels.find(c => c.mode === "lecture") || {}).chapitres?.includes("10 — Les maîtres du soupçon"));
t.check("redirigé vers la fiche", a.w.location.hash.startsWith("#/lectures/l/"), a.w.location.hash);
t.check("lien vers le chapitre du cours", !!a.w.document.querySelector(".dossier-link[data-nav^='#/c/']"));

t.section("Lectures — idées ajoutées au fil de l'eau");
a.$("lz_add").value = "la scène du rideau";
a.clic("lzAdd"); await pause(60);
a.$("lz_add").value = "Guérassim, le seul honnête";
a.clic("lzAdd"); await pause(60);
const idees = a.lu("lectures:list").find(x => x.titre === TITRE).idees;
t.check("deux idées empilées, une par ligne", idees.split("\n").length === 2, JSON.stringify(idees));
t.check("puces ajoutées automatiquement", idees.split("\n").every(l => l.startsWith("— ")));
t.check("champ vidé après ajout", a.$("lz_add").value === "");

t.section("Lectures — discuter du livre");
a.$("lc_q").value = "pourquoi Guérassim est-il si parfait ?";
a.clic("lcAsk");
await pause(150);
t.check("appel en mode lecture/chat", a.ia.appels.some(c => c.mode === "lecture" && c.action === "chat"));
t.check("la fiche ET les notes servent de contexte", (() => {
  const c = a.ia.appels.findLast(x => x.mode === "lecture" && x.action === "chat");
  return !!c?.fiche && c.notes.includes("rideau");
})());
t.check("discussion enregistrée sur le livre", (a.lu("lectures:list").find(x => x.titre === TITRE).chat || []).length === 2);

t.section("Fiche coupée par le plafond de tokens");
a.ia.tronquer = true;
a.clic("lzRedo");
await pause(220);
t.check("fiche marquée tronquée", a.lu("lectures:list").find(x => x.titre === TITRE).tronque === true);
t.check("avertissement affiché", a.texte().includes("Fiche incomplète"), a.texte().slice(0, 120));
a.ia.tronquer = false;

t.section("Renvoi croisé depuis la page de chapitre");
a.w.document.querySelector(".dom[data-domain='philo']").dispatchEvent(new a.w.MouseEvent("click", { bubbles: true }));
await a.aller("#/c/9");   // philo, chapitre 10
t.check("on est sur le bon chapitre", a.texte().includes("Les maîtres du soupçon"), a.texte().slice(0, 70));
t.check("bloc « Ton carnet » présent", a.texte().includes("Ton carnet sur ce chapitre"), a.texte().slice(0, 200));
t.check("la lecture y apparaît", a.texte().includes(TITRE), a.texte().slice(0, 160));
a.w.document.querySelector(".dom[data-domain='litt']").dispatchEvent(new a.w.MouseEvent("click", { bubbles: true }));
await a.aller("#/c/9");
t.check("la lecture philo ne fuit pas côté littérature",
  a.texte().length > 50 && !a.texte().includes(TITRE),
  a.texte().length ? a.texte().slice(0, 110) : "PAGE VIDE — erreurs : " + JSON.stringify(a.ia.erreurs.slice(-2)));

t.section("Publication automatique");
a.ia.appels.length = 0;
await a.aller("#/lectures/l/" + a.lu("lectures:list").find(x => x.titre === TITRE).id);
a.$("lz_add").value = "une réflexion tardive";
a.clic("lzAdd");
t.check("rien n'est publié immédiatement (les écritures sont regroupées)",
  !a.ia.appels.some(c => c.mode === "commit"));
await pause(4600);
const pub = a.ia.appels.filter(c => c.mode === "commit" && c.path === "data/lectures.json");
t.check("publication déclenchée", pub.length === 1, pub.length + " commit(s)");
t.check("l'idée ajoutée est dans le contenu publié", pub[0]?.content.includes("réflexion tardive"));
t.check("la discussion aussi", pub[0]?.content.includes("Guérassim"));

t.section("Suppression : pas de résurrection");
const cible = a.lu("lectures:list").find(x => x.titre === TITRE).id;
a.clic("lzDel");
await pause(4600);
t.check("suppression publiée", !JSON.parse(a.ia.distant["data/lectures.json"] || "[]").some(x => x.id === cible));
await a.aller("#/concepts"); await a.aller("#/lectures");
t.check("la lecture supprimée ne revient pas", !a.lu("lectures:list").some(x => x.id === cible));

t.bilan();
