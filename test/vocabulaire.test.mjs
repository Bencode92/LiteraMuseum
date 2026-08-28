/* Vocabulaire : index alphabétique à la française, filtre, fiche d'un mot. */
import { demarrer, pause, verificateur } from "./_harness.mjs";

const t = verificateur("vocabulaire");
const a = await demarrer();
const MOTS = [["abscons", "Un discours abscons."], ["élégie", ""], ["Zeugma", ""], ["épigone", ""], ["banal", ""]];

t.section("Ajout de mots");
await a.aller("#/vocabulaire");
for (const [m, c] of MOTS) {
  a.$("voc_mot").value = m; a.$("voc_ctx").value = c;
  a.clic("vocGo"); await pause(140);
}
const miens = a.lu("vocab:list").filter(v => MOTS.some(([m]) => m === v.mot));
t.check("les 5 mots sont enregistrés", miens.length === 5, miens.length + " sur " + a.lu("vocab:list").length);
t.check("mémo extrait sans son intitulé", miens.every(v => v.memo && !/^M[ÉE]MO/i.test(v.memo)),
  JSON.stringify(miens.map(v => v.memo)));
t.check("la phrase de contexte est transmise au Worker",
  (a.ia.appels.find(c => c.mode === "mot") || {}).contexte === "Un discours abscons.");

t.section("Classement à la française");
const ordre = a.tous(".vocentree .mot").map(e => e.textContent);
const rang = m => ordre.indexOf(m);
t.check("ordre alphabétique respecté",
  rang("abscons") < rang("banal") && rang("banal") < rang("élégie") &&
  rang("élégie") < rang("épigone") && rang("épigone") < rang("Zeugma"), JSON.stringify(ordre));
const lettres = a.tous("h4.vocl").map(e => e.textContent);
t.check("les accents se rangent sous E, pas après Z",
  lettres.indexOf("E") > lettres.indexOf("B") && lettres.indexOf("E") < lettres.indexOf("Z"), JSON.stringify(lettres));
t.check("la barre A-Z n'active que les lettres présentes",
  ["A", "B", "E", "Z"].every(c => a.tous(".alphabar .al:not(.off)").some(e => e.textContent === c)) &&
  a.tous(".alphabar .al.off").length > 0);

t.section("Filtre");
a.saisir("voc_f", "zeug"); await pause(60);
t.check("insensible aux accents et à la casse", a.tous(".vocentree").length === 1, a.tous(".vocentree").length + " résultat(s)");
a.saisir("voc_f", "obscur"); await pause(60);
t.check("porte aussi sur le sens, pas seulement sur le mot", a.tous(".vocentree").length >= 5,
  a.tous(".vocentree").length + " résultat(s)");
a.clic("vocClear"); await pause(60);
t.check("le filtre se vide", a.$("voc_f").value === "" && a.tous(".vocentree").length > 5);

t.section("Fiche d'un mot");
await a.aller("#/vocabulaire/m/" + miens.find(v => v.mot === "élégie").id);
t.check("6 sections rendues", a.tous(".cit-sec").length === 6, a.tous(".cit-sec").length + " sections");
t.check("la section « pour l'employer » est mise en avant", !!a.w.document.querySelector(".cit-sec.emploi"));
t.check("3 phrases modèles réutilisables", a.tous(".cit-sec.emploi li").length === 3,
  a.tous(".cit-sec.emploi li").length + " phrases");
t.check("le markdown est rendu, pas affiché brut",
  !!a.w.document.querySelector(".cit-sec.emploi strong") && !a.texte().includes("**"));
t.check("navigation précédent / suivant", a.tous(".vocnav [data-nav]").length === 3,
  a.tous(".vocnav [data-nav]").map(e => e.textContent).join(" | "));

t.section("Rétrocompatibilité d'une fiche ancienne");
const anciennes = a.lu("vocab:list");
anciennes.push({ id: "v-ancien", mot: "concupiscence", contexte: "", source: null, ts: "2026-07-29", maj: 1,
  memo: "Désir charnel", fiche: "\u{1F524} DÉFINITION\nDésir charnel.\n\n\u{1F4A1} UN EXEMPLE\nUne phrase ancienne.\n\n\u{1F3AF} MÉMO\nDésir charnel" });
a.w.localStorage.setItem("vocab:list", JSON.stringify(anciennes));
await a.aller("#/vocabulaire/m/v-ancien");
t.check("l'ancienne section 💡 s'affiche toujours", a.tous(".cit-sec").length === 3, a.tous(".cit-sec").length + " sections");
t.check("son exemple reste lisible", a.texte().includes("Une phrase ancienne"));

t.bilan();
