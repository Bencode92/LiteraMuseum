/* =========================================================================
   Worker UNIFIÉ — sert BENMUSEUM (art) ET LiteraMuseum (littérature/philo).
   Tous les tokens restent secrets côté Cloudflare (jamais dans le navigateur).

   Secrets / variables :
     - ANTHROPIC_API_KEY : clé Claude (discussion / quiz / enrichissement / fiche)
     - GITHUB_TOKEN      : jeton GitHub (Contents read/write sur tes repos)
     - EDIT_PASSWORD ou EDIT_TOKEN : mot de passe d'édition (un seul des deux suffit)
     - GH_OWNER / GH_REPO / GH_BRANCH : cible du mode "commit" (LiteraMuseum)

   Modes :
     - discussion (défaut), quiz, enrich, fiche      → Claude
     - save   : ajoute une entrée à data/community.json de BENMUSEUM (couche partagée)
     - commit : écrit un fichier data/*.json complet (LiteraMuseum — Atelier)
   ========================================================================= */

const DEFAULT_MODEL = "claude-sonnet-4-6";

// Couche communautaire de BENMUSEUM (mode "save")
const COMM_REPO = "Bencode92/BENMUSEUM";
const COMM_PATH = "data/community.json";
const COMM_BRANCH = "main";

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

// base64 UTF-8 (les fiches contiennent des accents)
const b64encode = str => btoa(unescape(encodeURIComponent(str)));
const b64decode = b64 => decodeURIComponent(escape(atob((b64 || "").replace(/\n/g, ""))));

// token GitHub : on prend la variable existante quel que soit son nom
function ghToken(env) {
  return env.GITHUB_TOKEN || env.GH_TOKEN || env.GITHUB_PAT || env.GH_PAT ||
    env.GITHUB_API_TOKEN || env.GITHUB || env.TOKEN_GITHUB || env.PAT || null;
}
const ghHeaders = token => ({
  Authorization: "Bearer " + token, Accept: "application/vnd.github+json",
  "User-Agent": "lettres-idees-worker", "X-GitHub-Api-Version": "2022-11-28",
});
// mot de passe d'édition : un seul secret (EDIT_TOKEN ou EDIT_PASSWORD), envoyé en editToken ou password
function editSecret(env) { return env.EDIT_TOKEN || env.EDIT_PASSWORD || null; }
function editGiven(b) { return b.editToken || b.password || null; }

/* ---------- BENMUSEUM : append dans community.json ---------- */
async function ghGetComm(token) {
  const r = await fetch(`https://api.github.com/repos/${COMM_REPO}/contents/${COMM_PATH}?ref=${COMM_BRANCH}`, { headers: ghHeaders(token) });
  if (r.status === 404) return { list: [], sha: null };
  if (!r.ok) throw new Error("GitHub GET " + r.status);
  const j = await r.json();
  let list = []; try { list = JSON.parse(b64decode(j.content)); } catch { list = []; }
  return { list: Array.isArray(list) ? list : [], sha: j.sha };
}
async function handleSave(b, env, cors) {
  const token = ghToken(env);
  if (!token) return json({ error: "GITHUB_TOKEN absent (secret Worker)" }, 500, cors);
  const secret = editSecret(env);
  if (secret && editGiven(b) !== secret) return json({ error: "Phrase de passe incorrecte" }, 403, cors);
  const entry = b.entry;
  if (!entry || !entry.scope || !entry.type) return json({ error: "Entrée invalide" }, 400, cors);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { list, sha } = await ghGetComm(token);
      list.push({ ...entry, ts: new Date().toISOString().slice(0, 10) });
      const body = { message: `community: +${entry.type} (${entry.scope})`, content: b64encode(JSON.stringify(list, null, 2) + "\n"), branch: COMM_BRANCH };
      if (sha) body.sha = sha;
      const r = await fetch(`https://api.github.com/repos/${COMM_REPO}/contents/${COMM_PATH}`, {
        method: "PUT", headers: { ...ghHeaders(token), "content-type": "application/json" }, body: JSON.stringify(body),
      });
      if (r.ok) return json({ ok: true, count: list.length }, 200, cors);
      if (r.status === 409 && attempt === 0) continue;
      return json({ error: "GitHub " + r.status + " " + (await r.text()).slice(0, 200) }, 502, cors);
    }
    return json({ error: "Conflit d'écriture, réessaie" }, 409, cors);
  } catch (e) { return json({ error: String(e) }, 500, cors); }
}

/* ---------- LiteraMuseum : commit d'un fichier data/*.json complet (Atelier) ---------- */
async function handleCommit(b, env, cors) {
  const token = ghToken(env);
  if (!token) return json({ error: "Aucun token GitHub trouvé dans les variables du Worker." }, 500, cors);
  // mot de passe OPTIONNEL : exigé seulement si un secret EDIT_TOKEN/EDIT_PASSWORD est défini
  const secret = editSecret(env);
  if (secret && editGiven(b) !== secret) return json({ error: "Mot de passe d'édition invalide." }, 403, cors);
  const owner = env.GH_OWNER, repo = env.GH_REPO, branch = env.GH_BRANCH || "main";
  if (!owner || !repo) return json({ error: "GH_OWNER / GH_REPO manquants sur le Worker." }, 500, cors);
  const path = String(b.path || "");
  if (!/^data\/[A-Za-z0-9_-]+\.json$/.test(path)) return json({ error: "Chemin refusé (autorisé : data/<nom>.json)." }, 400, cors);
  if (typeof b.content !== "string" || !b.content.trim()) return json({ error: "Contenu vide." }, 400, cors);
  try { JSON.parse(b.content); } catch { return json({ error: "Le contenu n'est pas un JSON valide." }, 400, cors); }
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  try {
    let sha; const cur = await fetch(`${api}?ref=${branch}`, { headers: ghHeaders(token) });
    if (cur.ok) sha = (await cur.json()).sha;
    const put = await fetch(api, {
      method: "PUT", headers: { ...ghHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ message: b.message || ("Atelier : maj " + path), content: b64encode(b.content), branch, sha }),
    });
    const data = await put.json();
    if (!put.ok) return json({ error: data.message || "Échec du commit GitHub.", detail: data }, 502, cors);
    return json({ ok: true, commit: data.commit && data.commit.html_url, path }, 200, cors);
  } catch (e) { return json({ error: String(e) }, 500, cors); }
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request.headers.get("Origin") || "");
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ error: "POST uniquement" }, 405, cors);

    let b;
    try { b = await request.json(); } catch { return json({ error: "JSON invalide" }, 400, cors); }
    const { mode } = b;

    // écritures GitHub (n'utilisent pas Claude)
    if (mode === "save") return handleSave(b, env, cors);
    if (mode === "commit") return handleCommit(b, env, cors);

    if (!env.ANTHROPIC_API_KEY) return json({ error: "Clé absente (configurer le secret ANTHROPIC_API_KEY)" }, 500, cors);

    let system, messages, maxTokens = 700;

    if (mode === "quiz") {
      const n = Math.min(Math.max(parseInt(b.n) || 4, 2), 10);
      system =
        "Tu es un professeur de culture générale (histoire de l'art, littérature, philosophie) ; adapte-toi au CONTENU fourni. À partir de ce CONTENU, rédige " + n + " questions de QCM en français, " +
        "VARIÉES, couvrant plusieurs angles : le CONTEXTE (le mouvement, le courant ou l'époque, le pourquoi), " +
        "les AUTEURS, ARTISTES ou PENSEURS (qui ils sont, leur rôle, leur vie), les ŒUVRES (intrigue, thèmes, thèses, détails à repérer), " +
        "l'ATTRIBUTION (« Qui a écrit / peint telle œuvre ? », « De qui est… ? ») " +
        "et la COMPRÉHENSION (« Pourquoi… ? », « Qu'est-ce que cette œuvre change ? », l'enjeu, le problème résolu). " +
        "Mélange les niveaux. Questions claires et non ambiguës, portant uniquement sur des faits présents dans le contenu. " +
        "Chaque question a 4 options dont UNE seule correcte, et une courte explication. " +
        "Réponds UNIQUEMENT par un JSON valide, sans aucun texte autour, de la forme exacte : " +
        '{"questions":[{"q":"…","options":["…","…","…","…"],"answer":0,"explication":"…"}]} ' +
        "où answer est l'index (0-3) de la bonne option.";
      messages = [{ role: "user", content: "CONTENU :\n" + (b.contenu || "") }];
      maxTokens = 1400;
    } else if (mode === "enrich") {
      system =
        "Tu es un vérificateur de contenu (histoire de l'art, littérature, philosophie). On te donne le CONTENU EXISTANT d'une fiche, puis un TEXTE proposé par l'utilisateur. " +
        "Réponds en français, en 3 sections courtes :\n✅ NOUVEAU (faits exacts absents de la fiche)\n↺ DÉJÀ COUVERT\n⚠️ À VÉRIFIER (douteux ou faux).\nSois concis et factuel.";
      messages = [{ role: "user", content: `CONTENU EXISTANT :\n${b.fiche || ""}\n\nTEXTE PROPOSÉ :\n${b.texte || ""}` }];
      maxTokens = 800;
    } else if (mode === "fiche") {
      system =
        "Tu es un spécialiste de culture (histoire de l'art, littérature, philosophie). On te donne le titre d'une œuvre, son auteur et le domaine. " +
        "Rédige une fiche en français, factuelle et vivante, SANS rien inventer. " +
        "Réponds UNIQUEMENT par un JSON valide, sans texte autour, de la forme EXACTE : " +
        '{"titre":"…","artiste":"…","annee":"…","wiki":"…","explication":"…","contexte":"…","elements":["…","…","…"]} ' +
        "où explication = 2-3 phrases ; contexte = 1-2 phrases ; elements = 3 points à retenir ; " +
        "wiki = le TITRE EXACT d'un article Wikipédia ANGLAIS qui a une image (l'œuvre de préférence, sinon l'auteur).";
      messages = [{ role: "user", content: `Domaine : ${b.domaine || "littérature"}.\nŒuvre : « ${b.titre || ""} » — ${b.artiste || ""}${b.annee ? ", " + b.annee : ""}.${b.hint ? "\nIndication : " + b.hint : ""}` }];
      maxTokens = 900;
    } else {
      const ctx = [
        b.floorName ? `Période / chapitre : ${b.floorName}${b.epoque ? ` (${b.epoque})` : ""}.` : "",
        b.salle ? `Sujet : ${b.salle.nom}. ${b.salle.presentation || ""}` : "",
        b.work ? `Œuvre : « ${b.work.titre} » — ${b.work.artiste}, ${b.work.annee}. ${b.work.note || ""}` : "",
      ].filter(Boolean).join("\n");
      system =
        "Tu es un guide culturel chaleureux et précis (histoire de l'art, littérature, philosophie) ; adapte-toi au contexte fourni. Tu expliques ce que chaque artiste, auteur ou penseur cherchait à faire et à dire, ce que son œuvre apporte, sans jargon. " +
        "Réponds en français, de façon concise (3 à 6 phrases), concrète et vivante. Appuie-toi sur le contexte ci-dessous.\n\n" + ctx;
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
