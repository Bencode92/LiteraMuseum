/* =========================================================================
   LETTRES & IDÉES — Cloudflare Worker
   1) Proxy vers l'API Claude (clé ANTHROPIC_API_KEY en secret) :
      modes discussion (guide), enrich, quiz, fiche (rédaction IA d'une fiche).
   2) Atelier : mode "commit" → écrit un fichier data/*.json dans le repo GitHub
      (token GITHUB_TOKEN en secret), protégé par un mot de passe EDIT_TOKEN.
   Aucun token n'est jamais exposé au navigateur.

   Secrets/variables (voir worker/README.md) :
     ANTHROPIC_API_KEY (secret) · MODEL (var, optionnel)
     GITHUB_TOKEN (secret, write contents) · EDIT_TOKEN (secret, mot de passe d'édition)
     GH_OWNER (var, ex. Bencode92) · GH_REPO (var, ex. LiteraMuseum) · GH_BRANCH (var, défaut main)
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
// base64 d'une chaîne UTF-8 (accents) pour l'API GitHub
function b64utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ""; for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}
const GH_HEADERS = token => ({
  "Authorization": "Bearer " + token,
  "User-Agent": "lettres-idees-worker",
  "Accept": "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

// ATELIER : commit d'un fichier data/*.json dans le repo GitHub
async function handleCommit(b, env, cors) {
  if (!env.GITHUB_TOKEN || !env.EDIT_TOKEN)
    return json({ error: "Atelier non configuré (secrets GITHUB_TOKEN / EDIT_TOKEN manquants sur le Worker)." }, 500, cors);
  if (!b.editToken || b.editToken !== env.EDIT_TOKEN)
    return json({ error: "Mot de passe d'édition invalide." }, 403, cors);
  const owner = env.GH_OWNER, repo = env.GH_REPO, branch = env.GH_BRANCH || "main";
  if (!owner || !repo) return json({ error: "GH_OWNER / GH_REPO manquants sur le Worker." }, 500, cors);
  const path = String(b.path || "");
  if (!/^data\/[A-Za-z0-9_-]+\.json$/.test(path))
    return json({ error: "Chemin refusé (autorisé : data/<nom>.json)." }, 400, cors);
  if (typeof b.content !== "string" || !b.content.trim())
    return json({ error: "Contenu vide." }, 400, cors);
  try { JSON.parse(b.content); } catch { return json({ error: "Le contenu n'est pas un JSON valide." }, 400, cors); }
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  try {
    // SHA actuel (pour mise à jour) ; absent = création de fichier
    let sha;
    const cur = await fetch(`${api}?ref=${branch}`, { headers: GH_HEADERS(env.GITHUB_TOKEN) });
    if (cur.ok) sha = (await cur.json()).sha;
    const put = await fetch(api, {
      method: "PUT", headers: { ...GH_HEADERS(env.GITHUB_TOKEN), "content-type": "application/json" },
      body: JSON.stringify({ message: b.message || ("Atelier : maj " + path), content: b64utf8(b.content), branch, sha }),
    });
    const data = await put.json();
    if (!put.ok) return json({ error: data.message || "Échec du commit GitHub.", detail: data }, 502, cors);
    return json({ ok: true, commit: data.commit && data.commit.html_url, path }, 200, cors);
  } catch (e) {
    return json({ error: String(e) }, 500, cors);
  }
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request.headers.get("Origin") || "");
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ error: "POST uniquement" }, 405, cors);

    let b;
    try { b = await request.json(); } catch { return json({ error: "JSON invalide" }, 400, cors); }
    const { mode } = b;

    // Atelier : écriture dans le repo (n'utilise pas Claude)
    if (mode === "commit") return handleCommit(b, env, cors);

    if (!env.ANTHROPIC_API_KEY) return json({ error: "Clé absente (configurer le secret ANTHROPIC_API_KEY)" }, 500, cors);

    let system, messages, maxTokens = 700;

    if (mode === "quiz") {
      // QCM généré à partir du contenu d'une fiche / section
      const n = Math.min(Math.max(parseInt(b.n) || 4, 2), 10);
      system =
        "Tu es un professeur de culture générale (histoire de l'art, littérature, philosophie) ; adapte-toi au CONTENU fourni. À partir de ce CONTENU, rédige " + n + " questions de QCM en français, " +
        "VARIÉES, couvrant plusieurs angles : le CONTEXTE (le mouvement, le courant ou l'époque, le pourquoi), " +
        "les AUTEURS, ARTISTES ou PENSEURS (qui ils sont, leur rôle, leur vie), les ŒUVRES (intrigue, thèmes, thèses, détails à repérer), " +
        "l'ATTRIBUTION (« Qui a écrit / peint telle œuvre ? », « De qui est… ? ») " +
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
        "Tu es un vérificateur de contenu (histoire de l'art, littérature, philosophie). On te donne le CONTENU EXISTANT d'une fiche, puis un TEXTE proposé par l'utilisateur. " +
        "Réponds en français, en 3 sections courtes :\n" +
        "✅ NOUVEAU (faits exacts absents de la fiche, à ajouter)\n" +
        "↺ DÉJÀ COUVERT (ce qui répète la fiche)\n" +
        "⚠️ À VÉRIFIER (ce qui semble douteux ou faux).\n" +
        "Sois concis et factuel.";
      messages = [{ role: "user", content: `CONTENU EXISTANT :\n${b.fiche || ""}\n\nTEXTE PROPOSÉ :\n${b.texte || ""}` }];
      maxTokens = 800;
    } else if (mode === "fiche") {
      // Atelier : rédiger une fiche d'œuvre au format JSON strict
      system =
        "Tu es un spécialiste de littérature et de philosophie. On te donne le titre d'une œuvre, son auteur et le domaine. " +
        "Rédige une fiche en français, factuelle et vivante, SANS rien inventer. " +
        "Réponds UNIQUEMENT par un JSON valide, sans texte autour, de la forme EXACTE : " +
        '{"titre":"…","artiste":"…","annee":"…","wiki":"…","explication":"…","contexte":"…","elements":["…","…","…"]} ' +
        "où : explication = 2-3 phrases (de quoi il s'agit, pourquoi c'est marquant) ; contexte = 1-2 phrases (cadre historique/littéraire) ; " +
        "elements = 3 points à retenir ; wiki = le TITRE EXACT d'un article Wikipédia ANGLAIS qui possède une image " +
        "(l'œuvre de préférence, ex. \"Madame Bovary\", sinon l'auteur, ex. \"Victor Hugo\").";
      messages = [{ role: "user", content: `Domaine : ${b.domaine || "littérature"}.\nŒuvre : « ${b.titre || ""} » — ${b.artiste || ""}${b.annee ? ", " + b.annee : ""}.${b.hint ? "\nIndication : " + b.hint : ""}` }];
      maxTokens = 900;
    } else {
      // discussion : le guide du musée (esprit Gombrich)
      const ctx = [
        b.floorName ? `Période / chapitre : ${b.floorName}${b.epoque ? ` (${b.epoque})` : ""}.` : "",
        b.salle ? `Sujet : ${b.salle.nom}. ${b.salle.presentation || ""}` : "",
        b.work ? `Œuvre en lecture : « ${b.work.titre} » — ${b.work.artiste}, ${b.work.annee}. ${b.work.note || ""}` : "",
      ].filter(Boolean).join("\n");
      system =
        "Tu es un guide culturel chaleureux et précis (histoire de l'art, littérature, philosophie) ; adapte-toi au contexte fourni. Tu expliques ce que chaque artiste, auteur ou penseur cherchait à faire et à dire, ce que son œuvre apporte, sans jargon. " +
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
