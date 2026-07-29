/* =========================================================================
   Worker UNIFIÉ — sert BENMUSEUM (art) ET LiteraMuseum (littérature/philo).
   Tous les tokens restent secrets côté Cloudflare (jamais dans le navigateur).

   Secrets / variables :
     - ANTHROPIC_API_KEY : clé Claude (discussion / quiz / enrichissement / fiche)
     - GITHUB_TOKEN      : jeton GitHub (Contents read/write sur tes repos)
     - EDIT_PASSWORD ou EDIT_TOKEN : mot de passe d'édition (un seul des deux suffit)
     - GH_OWNER / GH_REPO / GH_BRANCH : cible du mode "commit" (LiteraMuseum)

   Modes :
     - discussion (défaut), quiz, enrich, fiche, citation → Claude
     - lecture  : action "fiche" (fiche de lecture, option "rappel") ou "chat" (discuter du livre) → Claude
     - mot      : définition d'un mot de vocabulaire (avec sa phrase de contexte) → Claude
     - concept  : action "fiche" (rédige/réécrit une fiche concept) ou "chat" (discussion) → Claude
     - save   : ajoute une entrée à data/community.json de BENMUSEUM (couche partagée)
     - commit : écrit un fichier data/*.json complet (LiteraMuseum — Atelier, Lectures, Concepts)
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
    } else if (mode === "citation") {
      system =
        "Tu es un professeur de lettres et de philosophie, chaleureux et précis. On te donne une CITATION, son AUTEUR (philosophe, écrivain ou artiste) et parfois l'ŒUVRE dont elle est tirée. " +
        "Explique-la à un élève de classe préparatoire, en français, SANS jargon, de façon vivante et concrète. " +
        "Structure ta réponse en sections courtes, séparées par une ligne vide, avec EXACTEMENT ces intitulés :\n" +
        "🔑 SENS — en 2 ou 3 phrases, ce que la citation veut dire.\n" +
        "🔁 AUTREMENT DIT — reformule la citation en UNE phrase simple, comme si tu l'expliquais à un ami.\n" +
        "🧠 ANALYSE — le concept ou l'idée en jeu, sa place dans la pensée de l'auteur, ce qu'elle affirme ou conteste (3 à 5 phrases).\n" +
        "💡 EXEMPLE — une situation concrète, une image ou un exemple de la vie qui illustre l'idée.\n" +
        "🎯 À RETENIR — une phrase-clé à mémoriser, et si pertinent un angle de dissertation.\n" +
        "N'invente RIEN sur la source : si tu n'es pas sûr de l'attribution exacte ou de l'œuvre, dis-le honnêtement.";
      messages = [{ role: "user", content:
        `Domaine : ${b.domaine || "philosophie"}.\n` +
        `Auteur : ${b.auteur || "(inconnu)"}.\n` +
        (b.oeuvre ? `Œuvre : « ${b.oeuvre} ».\n` : "") +
        `Citation : « ${b.citation || ""} »` }];
      maxTokens = 900;
    } else if (mode === "lecture" && b.action === "chat") {
      // discuter DU LIVRE : la fiche et les notes du lecteur servent de contexte
      system =
        "Tu es un professeur de lettres et de philosophie, chaleureux et précis, qui discute d'un LIVRE avec un lecteur qui l'a lu. " +
        "Réponds en français, sans jargon inutile, de façon concrète : appuie-toi sur des scènes, des personnages, des passages précis plutôt que sur des généralités. " +
        "Sois concis (4 à 8 phrases), va au fond de la question posée plutôt que de tout survoler. " +
        "Prends au sérieux les objections et les désaccords du lecteur : discute-les vraiment, quitte à lui donner tort avec des raisons. " +
        "Tu peux dire que tu n'es pas sûr d'un point, et tu n'inventes jamais un détail du livre. " +
        "Voici le livre, la fiche déjà rédigée et les notes personnelles du lecteur :\n\n" +
        `LIVRE : « ${b.titre || "(sans titre)"} »` + (b.auteur ? ` — ${b.auteur}` : "") + (b.annee ? `, ${b.annee}` : "") + "\n\n" +
        `FICHE ACTUELLE :\n${b.fiche || "(pas encore de fiche)"}\n\n` +
        `NOTES DU LECTEUR :\n${(b.notes || "").trim() || "(aucune)"}`;
      {
        const history = Array.isArray(b.history) ? b.history : [];
        messages = [
          ...history.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text })),
          { role: "user", content: b.question || "" },
        ];
      }
      maxTokens = 900;
    } else if (mode === "lecture") {
      // mode « rappel » : le livre a été lu il y a longtemps et oublié — on le fait revenir
      const rappel = !!b.rappel;
      system =
        "Tu es un professeur de lettres et de philosophie qui aide un lecteur à garder trace de ses lectures. On te donne un LIVRE (titre, auteur, année) et, souvent, les NOTES PERSONNELLES du lecteur — ce qui l'a marqué, écrit vite et sans mise en forme. " +
        "Rédige sa fiche de lecture en français, vivante et concrète, SANS jargon. N'invente RIEN sur le livre : si tu n'es pas sûr d'un fait, dis-le. " +
        (rappel
          ? "IMPORTANT : ce lecteur a lu ce livre il y a longtemps et ne s'en souvient plus. Ton but premier est de le lui FAIRE REVENIR : sois concret, nomme les personnages, raconte ce qui se passe. Ne crains pas de dévoiler la fin — ce n'est pas une critique sans divulgâchis, c'est un rappel de mémoire. "
          : "") +
        "Structure ta réponse en sections, dans cet ordre. Écris chaque intitulé SEUL sur sa ligne, exactement comme ci-dessous (emoji compris), puis son contenu à partir de la ligne suivante. " +
        "Ne recopie JAMAIS les consignes de contenu dans ta réponse : elles sont pour toi, pas pour le lecteur.\n\n" +
        "📖 EN DEUX PHRASES\n" +
        (rappel ? "🎬 LE DÉROULÉ\n👤 QUI EST QUI\n📌 LES MOMENTS QUI RESTENT\n" : "") +
        "🧭 LE CONTEXTE\n🌀 CE QUE LE LIVRE CHANGE\n🧠 LES IDÉES CLÉS\n💬 TES IDÉES\n🔗 À RAPPROCHER DE\n🎯 À RETENIR\n📚 RATTACHEMENT\n\n" +
        "Contenu attendu dans chaque section :\n" +
        "• 📖 : de quoi ça parle et ce que c'est (roman, essai, traité…).\n" +
        (rappel
          ? "• 🎬 : le déroulé complet de l'œuvre, du début à la fin, en 8 à 12 phrases. Suis l'ordre du livre, nomme les personnages, dis ce qui arrive — fin comprise. Pour un essai ou un traité, suis le fil de l'argumentation partie par partie.\n" +
            "• 👤 : les personnages qui comptent, un par ligne commençant par un tiret : le nom, qui il est, son rôle dans l'histoire. Pour un essai, remplace par les notions ou les figures centrales.\n" +
            "• 📌 : 3 à 5 scènes ou passages que tout lecteur retient, un par ligne commençant par un tiret, décrits assez concrètement pour rallumer le souvenir (le lieu, le geste, la phrase).\n"
          : "") +
        "• 🧭 : le sol — l'époque, le mouvement, ce qui précède et rend ce livre possible (3 à 4 phrases).\n" +
        "• 🌀 : la bascule — le geste de rupture, ce que ce livre fait que personne ne faisait avant, pourquoi il compte (3 à 5 phrases).\n" +
        "• 🧠 : 3 à 5 idées ou thèses, chacune en une phrase, une par ligne, chaque ligne commençant par un tiret.\n" +
        "• 💬 : reprends les NOTES du lecteur — reformule-les proprement, nomme le concept ou le procédé qu'il a touché sans le savoir, et relie-les au livre. " +
        (rappel
          ? "Si les notes sont vides, n'invente rien à sa place : écris une seule ligne l'invitant à noter ce qui lui revient maintenant que le livre lui a été rappelé, et suggère deux ou trois pistes précises sur lesquelles sa mémoire pourrait s'accrocher.\n"
          : "Si les notes sont vides, écris « (rien noté pour l'instant) ».\n") +
        "• 🔗 : 2 ou 3 autres œuvres ou auteurs à lire dans la foulée, et pourquoi.\n" +
        "• 🎯 : une seule phrase-clé à mémoriser.\n" +
        "• 📚 : une seule ligne, commençant par le numéro du chapitre le plus pertinent de la LISTE DE CHAPITRES fournie, puis son titre — par exemple « 10 · Existentialisme et absurde ». Si aucun ne convient, écris « 0 · aucun ».";
      {
        const disc = Array.isArray(b.history) && b.history.length
          ? b.history.map(m => (m.role === "assistant" ? "PROF" : "LECTEUR") + " : " + m.text).join("\n\n")
          : "";
        messages = [{ role: "user", content:
          `Domaine : ${b.domaine === "philo" ? "philosophie" : "littérature"}.\n` +
          `Livre : « ${b.titre || "(sans titre)"} »` + (b.auteur ? ` — ${b.auteur}` : "") + (b.annee ? `, ${b.annee}` : "") + ".\n" +
          `NOTES DU LECTEUR :\n${(b.notes || "").trim() || "(aucune)"}\n` +
          (disc ? `\nDISCUSSION À INTÉGRER — ce que le lecteur a compris, contesté ou creusé en discutant ; la section 💬 TES IDÉES doit en tenir compte :\n${disc}\n` : "") +
          `\nLISTE DE CHAPITRES :\n${b.chapitres || "(aucune)"}` }];
      }
      maxTokens = rappel ? 4000 : 2200;   // le mode rappel ajoute 3 sections : 1600 tronquait la fiche
    } else if (mode === "mot") {
      // carnet de vocabulaire : un mot croisé en lisant, expliqué pour être relu vite
      system =
        "Tu es un professeur de lettres, précis et pédagogue. On te donne un MOT que le lecteur a rencontré dans une lecture et n'a pas compris, parfois avec la PHRASE où il l'a croisé. " +
        "Explique-le en français, clairement, sans le remplacer par un mot tout aussi difficile. Si le mot a plusieurs sens, donne d'abord celui qui convient au contexte fourni. " +
        "Si le mot n'existe pas ou que tu n'en es pas sûr, dis-le franchement plutôt que d'inventer une définition. " +
        "Structure ta réponse en sections. Écris chaque intitulé SEUL sur sa ligne, exactement comme ci-dessous (emoji compris), puis son contenu à partir de la ligne suivante. " +
        "Ne recopie JAMAIS les consignes de contenu dans ta réponse.\n\n" +
        "🔤 DÉFINITION\n🧬 ORIGINE\n📐 DANS TA PHRASE\n🔀 À NE PAS CONFONDRE\n💡 UN EXEMPLE\n🎯 MÉMO\n\n" +
        "Contenu attendu dans chaque section :\n" +
        "• 🔤 : le sens, en 1 ou 2 phrases simples. Précise la nature du mot (nom, adjectif, verbe…) et son registre s'il est soutenu, technique, vieilli ou familier.\n" +
        "• 🧬 : l'étymologie en une phrase — la langue d'origine et le sens premier, quand ça éclaire vraiment le mot d'aujourd'hui.\n" +
        "• 📐 : ce que le mot veut dire PRÉCISÉMENT dans la phrase fournie, et ce que l'auteur gagne à l'employer plutôt qu'un synonyme courant. Si aucune phrase n'est fournie, écris « (pas de contexte fourni) ».\n" +
        "• 🔀 : 1 à 3 mots proches avec lesquels on le confond (paronymes ou quasi-synonymes), un par ligne commençant par un tiret, en disant la différence en quelques mots.\n" +
        "• 💡 : une seule phrase d'exemple, courante et parlante, qui emploie le mot correctement.\n" +
        "• 🎯 : une formule de MOINS DE 12 MOTS, à relire d'un coup d'œil pour se rappeler le sens. Pas de phrase complète, juste l'essentiel.";
      messages = [{ role: "user", content:
        `Mot : « ${b.mot || ""} »\n` +
        (b.contexte ? `Phrase où il l'a croisé : « ${b.contexte} »\n` : "") +
        (b.source ? `Rencontré dans : ${b.source}\n` : "") }];
      maxTokens = 900;
    } else if (mode === "concept") {
      if (b.action === "chat") {
        system =
          "Tu es un professeur de philosophie et de lettres, chaleureux et précis, qui discute d'un CONCEPT avec un élève de classe préparatoire. " +
          "Réponds en français, sans jargon inutile, de façon concrète : chaque idée abstraite doit être éclairée par une image ou un exemple. " +
          "Sois concis (4 à 8 phrases), va au fond de la question posée plutôt que de tout survoler, et n'hésite pas à distinguer les positions en présence quand elles s'opposent. " +
          "Tu peux dire que tu n'es pas sûr. Voici l'état actuel de la fiche de l'élève sur ce concept :\n\n" +
          `CONCEPT : ${b.nom || "(sans nom)"}\n\nFICHE ACTUELLE :\n${b.fiche || "(fiche encore vide)"}`;
        const history = Array.isArray(b.history) ? b.history : [];
        messages = [
          ...history.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text })),
          { role: "user", content: b.question || "" },
        ];
        maxTokens = 900;
      } else {
        system =
          "Tu es un professeur de philosophie et de lettres. On te donne un CONCEPT à approfondir pour un élève de classe préparatoire. " +
          "Si une FICHE EXISTANTE et une DISCUSSION te sont fournies, tu ne repars pas de zéro : tu réécris la fiche en y intégrant ce qui s'est dit, en gardant ce qui était juste. " +
          "Écris en français, sans jargon : chaque idée abstraite doit être rendue intelligible par une image, une métaphore ou un exemple concret. N'invente aucune référence dont tu n'es pas sûr. " +
          "Structure ta réponse en huit sections, dans cet ordre. Écris chaque intitulé SEUL sur sa ligne, exactement comme ci-dessous (emoji compris), puis son contenu à partir de la ligne suivante. " +
          "Ne recopie JAMAIS les consignes de contenu dans ta réponse : elles sont pour toi, pas pour l'élève.\n\n" +
          "🔑 DÉFINITION\n🧭 D'OÙ ÇA VIENT\n🥊 LES POSITIONS EN PRÉSENCE\n💡 L'IMAGE POUR COMPRENDRE\n🧠 LES ENJEUX\n📚 OÙ LE TRAVAILLER\n🔍 TROIS QUESTIONS\n🎯 À RETENIR\n\n" +
          "Contenu attendu dans chaque section :\n" +
          "• 🔑 : ce que le concept veut dire, en 2 ou 3 phrases, sans présupposer le vocabulaire. Distingue-le des notions voisines avec lesquelles on le confond.\n" +
          "• 🧭 : la généalogie — quel problème le concept vient résoudre, chez qui il apparaît, comment il se déplace au fil du temps.\n" +
          "• 🥊 : les thèses qui s'affrontent — qui défend quoi, et contre qui. Une ligne par position, chaque ligne commençant par un tiret, avec le nom de l'auteur.\n" +
          "• 💡 : une situation concrète ou une expérience de pensée qui rend le concept évident.\n" +
          "• 🧠 : ce qui se joue vraiment — ce que ça change si le concept est vrai ou faux, ses conséquences morales, politiques ou scientifiques.\n" +
          "• 📚 : les auteurs et les œuvres à lire pour ce concept ; puis, en toute dernière ligne de la section, les numéros des chapitres concernés de la LISTE DE CHAPITRES fournie, sous la forme exacte « Chapitres : 6, 10 ».\n" +
          "• 🔍 : trois questions ouvertes pour aller plus loin, une par ligne commençant par un tiret, dont au moins une qui pourrait être un sujet de dissertation.\n" +
          "• 🎯 : une seule phrase-clé à mémoriser.";
        const disc = Array.isArray(b.history) && b.history.length
          ? b.history.map(m => (m.role === "assistant" ? "PROF" : "ÉLÈVE") + " : " + m.text).join("\n\n")
          : "";
        messages = [{ role: "user", content:
          `Domaine : ${b.domaine === "litt" ? "littérature" : "philosophie"}.\n` +
          `CONCEPT : ${b.nom || ""}\n` +
          (b.consigne ? `CE QUE L'ÉLÈVE VEUT CREUSER : ${b.consigne}\n` : "") +
          (b.fiche ? `\nFICHE EXISTANTE :\n${b.fiche}\n` : "") +
          (disc ? `\nDISCUSSION À INTÉGRER :\n${disc}\n` : "") +
          `\nLISTE DE CHAPITRES :\n${b.chapitres || "(aucune)"}` }];
        maxTokens = 2600;
      }
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
      // stop : le client doit pouvoir detecter une reponse coupee ("max_tokens") au lieu de l'afficher telle quelle
      return json({ answer, stop: data.stop_reason }, 200, cors);
    } catch (e) {
      return json({ error: String(e) }, 500, cors);
    }
  },
};
