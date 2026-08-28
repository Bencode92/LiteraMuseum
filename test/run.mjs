/* Lance chaque *.test.mjs dans son propre processus et agrège les résultats.
   (Volontairement sans `node --test` : nos tests sont des scénarios de bout en
   bout qui pilotent un DOM, pas des cas unitaires.) */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ici = dirname(fileURLToPath(import.meta.url));
const fichiers = readdirSync(ici).filter(f => f.endsWith(".test.mjs")).sort();
if (!fichiers.length) { console.error("Aucun fichier *.test.mjs dans test/"); process.exit(1); }

let echecs = 0;
for (const f of fichiers) {
  console.log(`\n══ ${f}`);
  const r = spawnSync(process.execPath, [join(ici, f)], { stdio: "inherit" });
  if (r.status !== 0) { echecs++; console.error(`   ✗ ${f} a échoué`); }
}
console.log(`\n${echecs ? "❌" : "✅"} ${fichiers.length - echecs}/${fichiers.length} fichier(s) de test au vert`);
process.exit(echecs ? 1 : 0);
