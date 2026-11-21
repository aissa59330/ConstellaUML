# Licences

## Règle du projet
- ConstellaUML ne contient **aucun code, ressource ni fichier provenant d'un logiciel tiers propriétaire** : métamodèle, icônes et templates sont écrits pour le projet.
- Le format de fichier `.mdj` est implémenté pour l'**interopérabilité** (noms de types et de champs nécessaires pour lire et écrire les projets).
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
| *(phase 3)* Parseurs de reverse engineering, générateurs, écrivain ZIP | code écrit pour le projet — aucune dépendance ajoutée (tree-sitter, Chevrotain et node-sql-parser restent non utilisés) | — | — |
| tsx | exécution du script de rendu des démos (`scripts/render-demos.ts`) | MIT | ☑ |
| librsvg (`rsvg-convert`, outil système, non embarqué) | conversion SVG → PNG des captures de doc | LGPL-2.1+ | ☑ |
| fast-check, Playwright | tests (à venir) | MIT / Apache-2.0 | ☐ |
| maxGraph *(repli seulement)* | moteur de graphes | Apache-2.0 | ☐ |

## Auteur
- ConstellaUML est créé par **Aïssa Ouameur** (© 2026) et distribué sous **GPL-3.0 ou ultérieure** (fichier `LICENSE`). Toutes les dépendances ci-dessus (MIT, Apache-2.0, ISC, LGPL, SIL OFL) sont compatibles avec la GPL-3.0.

## Ressources propres
- Logo et icônes ConstellaUML : créés pour ce projet (voir `assets/logo/`, `src/ui/icons.tsx`).
- `tests/fixtures/mdj/library.mdj` : écrit pour ce projet, avec la structure du format `.mdj`.
