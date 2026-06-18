# 📚🦉 Lettres & Idées — littérature & philosophie

Une **seule app** pour apprendre l'histoire de la **littérature** et de la **philosophie**,
dans le navigateur. Un bouton dans l'en-tête bascule entre les deux domaines ; tout le reste
(frise, fiches, dossiers, quiz, guide IA, favoris, session) suit le domaine actif.

```
DOMAINE (📚 Littérature  /  🦉 Philosophie)
  └─ ÉPOQUE / COURANT (l'esprit, la grande question)
       └─ AUTEURS / PENSEURS (roster à cocher : ★ majeurs · ○ secondaires)
            └─ ŒUVRE  →  image + explication + contexte + éléments à retenir
```

Mode **Réviser** (quiz visuel + QCM IA), **Dossiers** approfondis, **Favoris**,
**Session du jour** (répétition espacée), **guide IA**.

> Jumeau de [BENMUSEUM](https://github.com/Bencode92/BENMUSEUM) (histoire de l'art), même moteur.
> Tout le contenu vit dans `data/litterature.json` et `data/philosophie.json`.
> Les images sont chargées depuis Wikipédia ; aucune image stockée dans le dépôt.

---

## 🚀 Lancer

Site 100 % statique : il lui faut un serveur (jamais `file://`).

```bash
cd lettres-idees
ANTHROPIC_API_KEY=sk-ant-xxxxx node server.js   # http://localhost:8080
# sans clé : la visite marche, le guide répond « hors ligne »
# ou, sans IA :  python3 -m http.server 8080
```
Modèle par défaut : `claude-sonnet-4-6` (modifiable : `MODEL=claude-opus-4-8 node server.js`).

---

## 🖼 Manifestes d'images

Le quiz visuel et les cartes de révision s'appuient sur `data/images-litt.json` et
`data/images-philo.json`. À régénérer après tout ajout de contenu :

```bash
node build-images.mjs     # reconstruit les DEUX manifestes ; liste les "wiki" sans image
```

---

## ✏️ Enrichir le contenu

Deux fichiers, même structure :

```
data/litterature.json   chapitres[] = époques/mouvements   (dossiers → data/dossiers-litt.json)
data/philosophie.json    chapitres[] = courants            (dossiers → data/dossiers-philo.json)

chapitres[] : { num, titre, portee, couleur, idee, notion,
                roster[]  {nom, niveau ★/○, detail},
                oeuvres[] {titre, wiki (article Wikipédia EN), artiste (=auteur/penseur),
                           annee, explication, contexte, elements[]},
                dossier   (optionnel) }
```

Après modif : bump `DV` en haut de `js/app.js`, puis `node build-images.mjs`.
Le choix du domaine, les favoris, les notes et la révision sont **cloisonnés par domaine**
dans le navigateur (clés `litt:*` / `philo:*`).

---

## ☁️ Déployer

- **Lecture seule** → GitHub Pages (le guide IA sera « hors ligne »).
- **Avec guide IA** → déploie le **Cloudflare Worker** de `worker/` (clé en secret),
  puis renseigne son URL via « Configurer l'IA en ligne ».

## 🧱 Pile technique
HTML / CSS / JavaScript pur · API Wikipédia (images) · API Claude (guide). Zéro build, zéro framework.
