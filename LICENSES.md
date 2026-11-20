# Licences

## Règle du projet
- Constella ne contient **aucun code, ressource ni fichier de StarUML** (logiciel propriétaire de MKLabs) : pas d'extraction de `app.asar`, pas de copie de `metamodel.json`, d'icônes ou de templates.
- L'inspiration se limite à l'ergonomie, aux fonctionnalités et à l'**interopérabilité du format de fichier `.mdj`** (noms de types et de champs nécessaires pour lire et écrire les projets).
- Toute dépendance est ajoutée ici **avant** son intégration, avec sa licence vérifiée.

## Dépendances

☑ = intégrée, licence vérifiée dans `node_modules/*/package.json` ou `Cargo.toml` · ☐ = prévue, pas encore intégrée

| Composant | Usage | Licence | Vérifiée |
|---|---|---|---|
| Tauri 2 + plugins officiels | runtime desktop | MIT / Apache-2.0 | ☑ |
| Vite, TypeScript | build | MIT / Apache-2.0 | ☑ |
| Solid.js | UI | MIT | ☑ |
| ELK.js | layout automatique | EPL-2.0 (utilisée comme bibliothèque non modifiée) | ☐ |
| rbush | index spatial | MIT | ☐ |
| jsPDF | export PDF | MIT | ☐ |
| markdown-it | documentation Markdown | MIT | ☑ |
| Chevrotain | parseurs Mermaid/PlantUML/quick-edit | Apache-2.0 | ☐ |
| web-tree-sitter + grammaires java/python/typescript/php | reverse engineering | MIT | ☐ |
| node-sql-parser | import SQL | Apache-2.0 | ☐ |
| sqlx | introspection MariaDB | MIT / Apache-2.0 | ☐ |
| Radix Colors (`@radix-ui/colors`) | échelles des variables de couleur `$<teinte><1-12>` | MIT | ☑ |
| Lucide | icônes d'interface — finalement non utilisé : icônes dessinées pour le projet | ISC | — |
| Inter, JetBrains Mono | polices | SIL OFL 1.1 | ☐ |
| Vitest, jsdom | tests | MIT | ☑ |
| fast-check, Playwright | tests (à venir) | MIT / Apache-2.0 | ☐ |
| maxGraph *(repli seulement)* | moteur de graphes | Apache-2.0 | ☐ |
| Extensions StarUML open source (ex. générateurs) | inspiration et éventuelle réutilisation | à vérifier une par une (souvent MIT) | ☐ |

## Ressources propres
- Logo et icônes Constella : créés pour ce projet (voir `assets/logo/`, `src/ui/icons.tsx`).
- `tests/fixtures/mdj/library.mdj` : écrit pour ce projet, avec la structure du format `.mdj`.
