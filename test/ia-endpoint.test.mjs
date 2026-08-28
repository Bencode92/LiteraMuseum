/* Réglage de l'IA : doit fonctionner sur un navigateur neuf, et ne jamais
   dépendre en silence d'une URL enregistrée localement. */
import { demarrer, pause, verificateur } from "./_harness.mjs";

const t = verificateur("endpoint IA");

t.section("Navigateur neuf, aucun réglage enregistré");
const a = await demarrer();   // volontairement sans ai:url
await a.aller("#/vocabulaire");
t.check("l'IA est annoncée prête", a.texte().includes("IA : ✅ prête"), a.texte().slice(0, 120));
t.check("le service réellement appelé est affiché",
  a.texte().includes("benmuseum-guide.benoit-comas.workers.dev"), a.texte().slice(0, 160));
t.check("indiqué comme réglage par défaut du site", a.texte().includes("réglage par défaut du site"));
a.$("voc_mot").value = "test";
a.clic("vocGo"); await pause(140);
t.check("un mot peut être défini sans rien configurer", a.lu("vocab:list").some(v => v.mot === "test"));

t.section("Un réglage local périmé reste visible");
const b = await demarrer({ localStorage: { "ai:url": "https://ancienne-url.example.com" } });
await b.aller("#/vocabulaire");
t.check("l'URL enregistrée est affichée à l'écran",
  b.texte().includes("ancienne-url.example.com"), b.texte().slice(0, 160));
t.check("signalée comme propre à ce navigateur", b.texte().includes("réglage propre à ce navigateur"));

t.bilan();
