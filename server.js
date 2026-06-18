/* =========================================================================
   Mini-serveur — Lettres & Idées (littérature & philosophie)
   - Sert les fichiers statiques (index.html, js, css, data, models)
   - Expose /api/ask : pont vers l'API Claude (la clé reste ici, côté serveur)
   - Mémorise les échanges dans data/notes.json (enrichit le musée au fil du temps)

   Lancement :
     ANTHROPIC_API_KEY=sk-ant-... node server.js
   puis ouvre http://localhost:8080

   Node 18+ requis (fetch intégré). Aucune dépendance à installer.
   ========================================================================= */

import { createServer } from "node:http";
import { readFile, appendFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = process.env.PORT || 8080;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-sonnet-4-6";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
};

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/ask") return handleAsk(req, res);
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n  📚🦉  Lettres & Idées (littérature & philosophie)`);
  console.log(`     → http://localhost:${PORT}\n`);
  console.log(API_KEY
    ? `  Guide IA actif (modèle : ${MODEL})\n`
    : `  ⚠️  ANTHROPIC_API_KEY absente : la visite marche, mais le guide IA répondra hors ligne.\n     Relance avec :  ANTHROPIC_API_KEY=sk-ant-... node server.js\n`);
});

/* ---------- fichiers statiques ---------- */
async function serveStatic(req, res) {
  let path = decodeURIComponent(req.url.split("?")[0]);
  if (path === "/") path = "/index.html";
  const full = normalize(join(ROOT, path));
  if (!full.startsWith(ROOT)) { res.writeHead(403).end("Forbidden"); return; }
  try {
    const data = await readFile(full);
    res.writeHead(200, {
      "content-type": MIME[extname(full)] || "application/octet-stream",
      "cache-control": "no-store, no-cache, must-revalidate",
    });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

/* ---------- pont vers Claude ---------- */
async function handleAsk(req, res) {
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", async () => {
    try {
      const { floorName, epoque, salle, work, question, history = [] } = JSON.parse(body || "{}");
      if (!API_KEY) { res.writeHead(503).end("no_api_key"); return; }

      const ctxLines = [
        `Période : ${floorName} (${epoque}).`,
        salle ? `Salle : ${salle.nom}${salle.type === "artiste" ? " (consacrée à cet artiste)" : " (salle thématique)"}. ${salle.presentation}` : "",
        work ? `Œuvre en lecture : « ${work.titre} » — ${work.artiste}, ${work.annee}. ${work.note}` : "",
      ].filter(Boolean).join("\n");

      const system =
        "Tu es un guide d'histoire de la littérature et de la philosophie, chaleureux et précis : " +
        "tu expliques ce que chaque auteur ou penseur cherchait à faire et à dire, ce que son œuvre apporte, sans jargon. " +
        "Réponds en français, de façon concise (3 à 6 phrases), concrète et vivante. " +
        "Appuie-toi sur le contexte de la salle ci-dessous ; si on te demande autre chose, réponds quand même utilement.\n\n" +
        ctxLines;

      const messages = [
        ...history.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text })),
        { role: "user", content: question },
      ];

      const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 600, system, messages }),
      });
      const data = await apiRes.json();
      if (!apiRes.ok) { res.writeHead(502).end(JSON.stringify(data)); return; }

      const answer = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();

      // mémorise l'échange (enrichit le musée)
      const entry = { floor: floorName, salle: salle?.nom, oeuvre: work?.titre || null, question, answer };
      appendFile(join(ROOT, "data", "notes.json"), JSON.stringify(entry) + "\n").catch(() => {});

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ answer }));
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
}
