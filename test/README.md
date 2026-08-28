# Tests

Tests de bout en bout : l'application est chargée dans un DOM simulé (jsdom),
on navigue et on clique réellement, le Worker est remplacé par un faux qui
renvoie des réponses **au format exact que produit le vrai** (intitulé de
section seul sur sa ligne, corps à la ligne suivante).

Ce ne sont pas des tests unitaires : ils vérifient ce que l'utilisateur voit,
ce qui est réellement enregistré, et ce qui part sur GitHub.

## Lancer

```sh
npm install      # jsdom, uniquement pour les tests
npm test
```

## Les fichiers

| Fichier | Ce qu'il couvre |
|---|---|
| `carnet.test.mjs` | Lectures et concepts : création, mode rappel, idées ajoutées au fil de l'eau, discussion, fiche tronquée, rattachement croisé avec les chapitres, étanchéité entre littérature et philosophie, publication regroupée, suppression |
| `vocabulaire.test.mjs` | Index alphabétique **à la française** (« élégie » sous E, pas après Z), barre A-Z, filtre sur le mot et sur le sens, section « pour l'employer », rétrocompatibilité des fiches anciennes |
| `citations.test.mjs` | Reprise des citations déjà saisies, réécriture d'une saisie bâclée sans perdre l'original, publication dans un fichier distinct de la collection de départ |
| `ia-endpoint.test.mjs` | Fonctionnement sur un navigateur neuf sans aucun réglage, et visibilité d'une URL enregistrée localement |
| `_harness.mjs` | Socle commun : DOM, faux Worker, faux réseau, compteur de vérifications |

## Deux règles apprises à la dure

**Ne jamais supposer que les fichiers `data/*.json` sont vides.** Ils
contiennent de vraies lectures et de vrais mots. Un test qui compte les
entrées ou suppose qu'un chapitre n'a rien casse dès que le carnet se
remplit : filtrer sur ce que le test a lui-même créé, avec un titre improbable.

**Faire remonter les erreurs de rendu.** Une exception pendant un rendu
laissait la page vide et le test échouait sans dire pourquoi. Le socle les
collecte dans `ia.erreurs`.

## Pourquoi ce dossier existe

Ces tests ont attrapé des régressions qu'aucune relecture n'avait vues :
une section entière de fiche avalée par le parseur, une fiche tronquée sans
aucun message, un mémo qui affichait son propre titre, et un élément supprimé
qui ressuscitait à la synchronisation suivante. Ils ont vécu dans un dossier
temporaire et ont été perdus une fois : d'où leur place ici.
