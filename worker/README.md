# Guide IA en ligne — Cloudflare Worker

Ce Worker garde ta **clé Claude** en secret et permet au site déployé (GitHub Pages)
d'utiliser le guide IA **partout**, pas seulement en local.

## Déploiement (2 façons)

### A. En ligne de commande (Wrangler) — recommandé
```bash
# 1. installer l'outil Cloudflare (une fois)
npm install -g wrangler

# 2. se connecter à ton compte Cloudflare (ouvre le navigateur)
wrangler login

# 3. depuis le dossier worker/
cd worker
wrangler deploy

# 4. enregistrer la clé Claude comme SECRET (jamais dans le code)
wrangler secret put ANTHROPIC_API_KEY
#   → colle ta clé sk-ant-... quand c'est demandé
```
Wrangler affiche alors l'URL publique, du type :
`https://benmuseum-guide.<ton-sous-domaine>.workers.dev`

### B. Depuis le tableau de bord Cloudflare (sans terminal)
1. dash.cloudflare.com → **Workers & Pages** → **Create** → **Create Worker**.
2. Colle le contenu de `worker.js`, **Deploy**.
3. Onglet **Settings → Variables → Add variable** :
   - **Secret** : `ANTHROPIC_API_KEY` = ta clé `sk-ant-...`
   - (optionnel) Variable : `MODEL` = `claude-sonnet-4-6`
4. Récupère l'URL `https://....workers.dev`.

## Brancher le site
Dans le site en ligne, ouvre une fiche d'œuvre → **« Configurer l'IA en ligne »**
sous le guide → colle l'URL de ton Worker. (Stocké dans ton navigateur.)
À partir de là, le guide répond partout, et le bouton « + Ajouter aux notes »
verse ses réponses dans tes fiches.

## Sécurité
- La clé reste **côté Cloudflare** ; le navigateur ne la voit jamais.
- Le Worker n'accepte que les origines listées dans `ALLOWED` (ton site + localhost).
  Mets-y ton domaine exact si tu changes d'URL.

## Modes
- **discussion** (défaut) : `{ floorName, epoque, salle, work, question, history }`
- **enrichissement** : `{ mode: "enrich", fiche, texte }` → compare un texte à la fiche
  et renvoie ✅ nouveau / ↺ déjà couvert / ⚠️ à vérifier (à la studyforge).
