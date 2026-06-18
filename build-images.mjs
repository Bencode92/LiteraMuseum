/* =========================================================================
   build-images.mjs — fabrique les manifestes d'images depuis Wikipédia (EN),
   pour les DEUX domaines de Lettres & Idées :
     data/litterature.json  → data/images-litt.json
     data/philosophie.json  → data/images-philo.json
   Scanne tous les champs "wiki" et résout l'image principale de l'article.

   Usage : node build-images.mjs
   Aucune dépendance (Node 18+, fetch intégré).
   ========================================================================= */
import { readFileSync, writeFileSync } from "node:fs";

const API = "https://en.wikipedia.org/w/api.php";
const SIZE = 1000;
const JOBS = [
  ["data/litterature.json", "data/images-litt.json"],
  ["data/philosophie.json", "data/images-philo.json"],
];

function collectWiki(node, out = new Set()) {
  if (Array.isArray(node)) node.forEach(n => collectWiki(n, out));
  else if (node && typeof node === "object")
    for (const [k, v] of Object.entries(node)) {
      if (k === "wiki" && typeof v === "string" && v.trim()) out.add(v.trim());
      else collectWiki(v, out);
    }
  return out;
}
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function resolveBatch(titles) {
  const url = `${API}?action=query&format=json&redirects=1&prop=pageimages` +
    `&piprop=thumbnail|original&pilicense=any&pithumbsize=${SIZE}&titles=${titles.map(encodeURIComponent).join("|")}&origin=*`;
  const j = await (await fetch(url, { headers: { "user-agent": "lettres-idees-learning/1.0" } })).json();
  const alias = {};
  (j.query?.normalized || []).forEach(n => (alias[n.from] = n.to));
  (j.query?.redirects || []).forEach(r => (alias[r.from] = r.to));
  const byTitle = {};
  Object.values(j.query?.pages || {}).forEach(p => {
    if (!p.thumbnail && !p.original) return;
    byTitle[p.title] = {
      thumb: p.thumbnail?.source || p.original?.source,
      thumb_w: p.thumbnail?.width, thumb_h: p.thumbnail?.height,
      url: p.original?.source || p.thumbnail?.source,
      w: p.original?.width, h: p.original?.height,
    };
  });
  const res = {};
  for (const t of titles) { const norm = alias[t] || t; if (byTitle[norm]) res[t] = byTitle[norm]; }
  return res;
}

for (const [dataF, outF] of JOBS) {
  const data = JSON.parse(readFileSync(dataF, "utf8"));
  const titles = [...collectWiki(data)];
  console.log(`\n📚 ${dataF} → ${titles.length} titres « wiki »…`);
  const manifest = {}, missing = [];
  for (const batch of chunk(titles, 40)) {
    try {
      const res = await resolveBatch(batch);
      Object.assign(manifest, res);
      batch.forEach(t => { if (!res[t]) missing.push(t); });
    } catch (e) { console.error("  ⚠️ batch échoué :", e.message); batch.forEach(t => missing.push(t)); }
    process.stdout.write(`  ${Object.keys(manifest).length}/${titles.length}\r`);
    await sleep(250);
  }
  writeFileSync(outF, JSON.stringify(manifest, null, 2));
  console.log(`✅ ${outF} : ${Object.keys(manifest).length} images.`);
  if (missing.length) {
    console.log(`⚠️ ${missing.length} sans image (corrige le "wiki" dans ${dataF}) :`);
    missing.forEach(m => console.log("   • " + m));
  }
}
