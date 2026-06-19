# Worker Cloudflare — guide IA + Atelier (publication de fiches)

On **réutilise le Worker déjà déployé** `benmuseum-guide`
(`https://benmuseum-guide.benoit-comas.workers.dev/`) — ta clé Claude y est déjà.
Il fait deux choses, tous les tokens restant **secrets côté Cloudflare** :
1. **IA** : proxy vers Claude (guide, enrichissement, quiz, rédaction de fiches) — multi-domaine (art, littérature, philo).
2. **Atelier** : commit d'une fiche `data/*.json` dans le dépôt GitHub, protégé par mot de passe.

## Mettre à jour le Worker (ajoute les modes fiche + commit)

```bash
npm install -g wrangler        # si pas déjà fait
wrangler login                 # ton compte Cloudflare
cd lettres-idees/worker
wrangler deploy                # met à jour benmuseum-guide avec ce code
```

## Ajouter les 2 secrets (la clé Claude est déjà là)

```bash
# depuis lettres-idees/worker
wrangler secret put GITHUB_TOKEN   # token GitHub fine-grained (voir ci-dessous)
wrangler secret put EDIT_TOKEN     # un mot de passe que TU choisis (long, secret)
```
Les variables `GH_OWNER=Bencode92`, `GH_REPO=LiteraMuseum`, `GH_BRANCH=main` sont dans `wrangler.toml`.

## Le token GitHub (write Contents)

GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate** :
- **Resource owner** : Bencode92
- **Repository access** : *Only select repositories* → **LiteraMuseum**
- **Permissions → Repository → Contents : Read and write**
- Copie `github_pat_...` → `wrangler secret put GITHUB_TOKEN`.

## Côté site (LiteraMuseum)

L'URL du Worker est **déjà branchée par défaut** en ligne (le guide IA marche tout seul).
Onglet **Atelier** → bouton **Saisir le mot de passe d'édition** → mets le **même** que `EDIT_TOKEN`.
Ensuite : rédige une fiche (l'IA aide) → **Publier** → commit auto → Pages republie (~1 min).

> Le musée d'art (BENMUSEUM) continue d'utiliser le même Worker sans rien changer
> (les prompts sont devenus multi-domaines, les anciens modes sont inchangés).

## Sécurité
- Clé Claude + token GitHub : **jamais** dans le navigateur (secrets Cloudflare).
- Publier exige `EDIT_TOKEN` (le Worker refuse sinon). Le Worker n'écrit que `data/*.json` sur LiteraMuseum.
- Origines limitées (`ALLOWED`) à ton site + localhost.

## Modes (API)
- `{ floorName, salle, work, question, history }` → guide (discussion)
- `{ mode:"enrich", fiche, texte }` · `{ mode:"quiz", contenu, n }`
- `{ mode:"fiche", domaine, titre, artiste, annee }` → rédige une fiche (JSON)
- `{ mode:"commit", editToken, path:"data/x.json", content, message }` → commit GitHub
