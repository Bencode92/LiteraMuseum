# Tests

Tests de bout en bout : l'application est chargée dans un DOM simulé (jsdom),
on navigue et on clique réellement, le Worker est remplacé par un faux qui
renvoie des réponses au format exact que produit le vrai.

Ce ne sont pas des tests unitaires : ils vérifient ce que l'utilisateur voit
et ce qui est réellement enregistré ou publié.

## Lancer

```sh
npm install      # jsdom, uniquement pour les tests
npm test
```

## Ce qu'ils couvrent

- `citations.test.mjs` — reprise des citations déjà saisies lors du passage à la
  publication GitHub, publication dans un fichier distinct de la collection de
  départ, et **non-résurrection après suppression** (la fusion avec la version
  publiée réintroduisait un élément supprimé qui n'avait pas été republié).

## Pourquoi ce dossier existe

Ces tests ont attrapé des régressions qu'aucune relecture n'avait vues :
une section entière de fiche avalée par le parseur, une fiche tronquée sans
aucun message, un mémo qui affichait son propre titre, et la résurrection
ci-dessus. Ils vivaient dans un dossier temporaire et ont été perdus une fois :
d'où leur place ici.
