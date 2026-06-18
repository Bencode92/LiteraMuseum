/* =========================================================================
   LETTRES & IDÉES — Cloudflare Worker : proxy vers l'API Claude
   La clé ANTHROPIC_API_KEY reste ici (secret Cloudflare), jamais dans le navigateur.
   Le site (GitHub Pages) appelle ce Worker pour : la discussion (guide) et l'enrichissement.

   Déploiement : voir worker/README.md
   ========================================================================= */

const DEFAULT_MODEL = "claude-sonnet-4-6";

// origines autorisées à appeler le Worker (ton site + le local pour tester)
const ALLOWED = [
  "https://bencode92.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

function corsHeaders(origin) {
  const allow = ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request.headers.get("Origin") || "");
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ error: "POST uniquement" }, 405, cors);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "Clé absente (configurer le secret ANTHROPIC_API_KEY)" }, 500, cors);

    let b;
    try { b = await request.json(); } catch { return json({ error: "JSON invalide" }, 400, cors); }
    const { mode } = b;

    let system, messages, maxTokens = 700;

    if (mode === "quiz") {
      // QCM généré à partir du contenu d'une fiche / section
      const n = Math.min(Math.max(parseInt(b.n) || 4, 2), 10);
      system =
        "Tu es un professeur de littérature et de philosophie. À partir du CONTENU fourni, rédige " + n + " questions de QCM en français, " +
        "VARIÉES, couvrant plusieurs angles : le CONTEXTE (le mouvement ou le courant, l'époque, le pourquoi), " +
        "les AUTEURS/PENSEURS (qui ils sont, leur rôle, leur vie), les ŒUVRES (intrigue, thèmes, thèses, passages marquants), " +
        "l'ATTRIBUTION (« Qui a écrit telle œuvre ? », « De quel auteur/penseur est… ? ») " +
        "et la COMPRÉHENSION (« Pourquoi… ? », « Qu'est-ce que cette œuvre change ? », l'enjeu, le problème résolu). " +
        "Mélange les niveaux (faciles et plus fins). Questions claires et non ambiguës, portant uniquement sur des faits présents dans le contenu. " +
        "Chaque question a 4 options dont UNE seule correcte, et une courte explication. " +
        "Réponds UNIQUEMENT par un JSON valide, sans aucun texte autour, de la forme exacte : " +
        '{"questions":[{"q":"…","options":["…","…","…","…"],"answer":0,"explication":"…"}]} ' +
        "où answer est l'index (0-3) de la bonne option.";
      messages = [{ role: "user", content: "CONTENU :\n" + (b.contenu || "") }];
      maxTokens = 1400;
    } else if (mode === "enrich") {
      // studyforge : comparer un texte à la fiche et signaler ce qui est nouveau / à corriger
      system =
        "Tu es un vérificateur de contenu en littérature et philosophie. On te donne le CONTENU EXISTANT d'une fiche, puis un TEXTE proposé par l'utilisateur. " +
        "Réponds en français, en 3 sections courtes :\n" +
        "✅ NOUVEAU (faits exacts absents de la fiche, à ajouter)\n" +
        "↺ DÉJÀ COUVERT (ce qui répète la fiche)\n" +
        "⚠️ À VÉRIFIER (ce qui semble douteux ou faux).\n" +
        "Sois concis et factuel.";
      messages = [{ role: "user", content: `CONTENU EXISTANT :\n${b.fiche || ""}\n\nTEXTE PROPOSÉ :\n${b.texte || ""}` }];
      maxTokens = 800;
    } else {
      // discussion : le guide du musée (esprit Gombrich)
      const ctx = [
        b.floorName ? `Période / chapitre : ${b.floorName}${b.epoque ? ` (${b.epoque})` : ""}.` : "",
        b.salle ? `Sujet : ${b.salle.nom}. ${b.salle.presentation || ""}` : "",
        b.work ? `Œuvre en lecture : « ${b.work.titre} » — ${b.work.artiste}, ${b.work.annee}. ${b.work.note || ""}` : "",
      ].filter(Boolean).join("\n");
      system =
        "Tu es un guide d'histoire de la littérature et de la philosophie, chaleureux et précis : tu expliques ce que chaque auteur ou penseur cherchait à faire et à dire, ce que son œuvre apporte, sans jargon. " +
        "Réponds en français, de façon concise (3 à 6 phrases), concrète et vivante. Appuie-toi sur le contexte ci-dessous ; si on te demande autre chose, réponds quand même utilement.\n\n" + ctx;
      const history = Array.isArray(b.history) ? b.history : [];
      messages = [
        ...history.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text })),
        { role: "user", content: b.question || "" },
      ];
    }

    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: env.MODEL || DEFAULT_MODEL, max_tokens: maxTokens, system, messages }),
      });
      const data = await r.json();
      if (!r.ok) return json({ error: data }, 502, cors);
      const answer = (data.content || []).filter(x => x.type === "text").map(x => x.text).join("\n").trim();
      return json({ answer }, 200, cors);
    } catch (e) {
      return json({ error: String(e) }, 500, cors);
    }
  },
};
