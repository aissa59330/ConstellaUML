# Constella — Architecture

## 1. Vue d'ensemble

```
┌──────────────────────────── Tauri 2 (processus Rust) ─────────────────────────────┐
│ fs, dialogues natifs, autosave atomique, fichiers récents, CLI, connexion MariaDB │
│ (sqlx), watcher d'extensions, menu natif (optionnel)                              │
└───────────────▲───────────────────────────────────────────────────────────────────┘
                │ invoke() / events (IPC typé, généré par tauri-specta)
┌───────────────┴──────────────── WebView (TypeScript, Vite) ───────────────────────┐
│  ui/        Shell UI : menus, panneaux, toolbox, explorer, éditeurs, dialogues    │
│    │  (Solid.js : réactivité fine, sans DOM virtuel, rapide sous WebKitGTK)       │
│  editor/    Éditeur de diagramme : outils, sélection, poignées, quick-edit, routage│
│    │                                                                              │
│  render/    Rendu : interface Graphics → Canvas2D (écran) │ SVG │ PDF            │
│    │                                                                              │
│  notation/  Notations : 1 module par famille (uml/class, uml/sequence, erd, bpmn…)│
│    │        = types de vue + layout interne + dessin + outils toolbox + quickedit │
│  core/      Métamodèle, Repository, Opérations (undo/redo), Sélection, Requêtes   │
│  io/        .mdj/.mfj, XMI, Mermaid, PlantUML, export image/PDF/HTML/Markdown     │
│  codegen/   Générateurs + reverse (web-tree-sitter, node-sql-parser)              │
│  plugins/   Chargement d'extensions, API publique `constella.*`, shim `app.*`     │
└───────────────────────────────────────────────────────────────────────────────────┘
```

**Règle de dépendance** (vérifiée par `dependency-cruiser` dans la CI) :
`core` ← `notation` ← `render` ← `editor` ← `ui`. `io` et `codegen` ne dépendent que de `core` (et `render` pour l'export d'images).
`core` ne connaît **ni le DOM, ni Tauri** : il s'exécute dans Node et est testé sans navigateur.

## 2. Choix du moteur de diagrammes — décision à valider

| Critère | maxGraph | **Rendu maison sur la vue `.mdj`** (recommandé) |
|---|---|---|
| Modèle de données | son propre modèle de cellules ; il faut le synchroniser en permanence avec le modèle de vues `.mdj` | la vue `.mdj` **est** la source de vérité, sans double état |
| Undo/redo | son propre gestionnaire, en conflit avec notre système d'opérations | un seul système d'opérations pour le modèle, les vues et les styles |
| Notations complexes (séquence, swimlanes, fragments, compartiments, timing) | personnalisation lourde (shapes, edge styles, contournement des stratégies par défaut) | conçues directement autour des besoins |
| Fidélité `.mdj` (left/top/width/height, sous-vues, points de liens) | correspondance approximative | 1:1 |
| Performance sous WebKitGTK | rendu SVG DOM, lent au-delà de quelques centaines de nœuds | Canvas2D + index spatial, rafraîchissement des seules zones modifiées |
| Coût initial | faible | plus élevé (outils, poignées, routage), compensé dès la phase 2 |

**Recommandation : moteur maison**, avec des briques open source ciblées :
- **ELK.js** (EPL-2.0) pour le layout automatique (layered, 4 directions) ;
- un routage orthogonal maison (A* sur une grille de visibilité) pour les liens rectilinéaires ;
- **rbush** (MIT) comme index spatial (hit-test, rectangle de sélection, minimap).

maxGraph reste une solution de repli si tu préfères un démarrage plus rapide, au prix des points ci-dessus.

## 3. Métamodèle (`core/meta`)

- Déclaratif : `core/meta/*.meta.ts` décrit chaque type (`name`, `super`, `attributes` avec `kind` : `String | Boolean | Integer | Enum | Ref | Refs | Var | Vars | Color | Font | Points`, `container`, `default`). Le métamodèle est **réécrit par nous** à partir de la spécification UML 2.5 de l'OMG et du format de fichier observé. Aucun fichier StarUML n'est copié.
- Les noms de types (`UMLClass`, `UMLClassView`, `UMLAssociation`, `ERDEntity`…) et les noms de champs suivent le format `.mdj` pour l'interopérabilité (un format de fichier n'est pas du code).
- Hiérarchie : `Element` → `Model` (`ownedElements`) → … ; `View` → `NodeView` / `EdgeView` ; `Diagram` (`ownedViews`).
- Des classes TS générées à partir des descripteurs donnent le typage ; le registre `MetaRegistry` est extensible par les plugins (`metamodel.json`).
- **Types inconnus** : conservés sous forme d'`OpaqueElement` (JSON brut, avec les références résolues) pour un aller-retour sans perte.

## 4. Repository & opérations (undo/redo)

- `Repository` : index `id → Element`, références inverses (`relationships`, `views`), requêtes (`@UMLClass`, `Pkg::Classe`, `[name=...]`).
- **Toute** modification passe par une `Operation` = liste de `Change` primitifs :
  `Create(elem, parentRef, field, index)` · `Delete(…)` · `Set(id, field, old, new)` · `Insert/Remove(id, field, index, value)` · `Move`.
- `OperationBuilder` (`begin/…/finish`) regroupe les changements ; l'inverse se calcule automatiquement. Piles undo/redo **sans limite** (bornées par la mémoire, compactage des `Set` consécutifs sur le même champ pendant un glisser).
- Les mutations directes en dehors d'une opération sont interdites (`Object.freeze` en développement, lint).
- Événements : `operationExecuted`, `created`, `deleted`, `updated(fields)` → l'UI et le rendu s'abonnent ; marqueur « modifié » ; déclenchement de l'autosave.
- Les commandes de haut niveau (`createClassWithView`, `deleteFromModel`…) vivent dans `core/commands` et produisent une seule opération.

## 5. Rendu & édition

- `Graphics` (inspiré de Canvas2D) : `rect, roundRect, ellipse, polygon, path, text, image, clip, transform` ; implémenté par `CanvasGraphics` (écran, HiDPI), `SvgGraphics` (export, presse-papiers), `PdfGraphics` (jsPDF).
- Chaque type de vue implémente `measure(g)`, `arrange()`, `draw(g)`, `hitTest(p)` et `handles()`. Les compartiments (nom, attributs, opérations) sont des sous-vues, comme dans `.mdj`.
- Couleurs : les variables (`$blue9`) sont résolues au dessin selon le thème ; le texte est mesuré avec un cache.
- Calques : diagramme (mis en cache dans un bitmap) / sélection et poignées / aperçu de l'outil courant, pour garder 60 fps en déplacement.
- Outils (`editor/tools`) : `SelectTool`, `CreateNodeTool`, `CreateEdgeTool`, `PanTool`, `FormatPainterTool`. Le quick-edit est un overlay HTML positionné sur la vue, avec un parseur par grammaire (`notation/*/quickedit.ts`).
- Presse-papiers : format JSON interne (vues + modèles référencés) et image PNG/SVG en parallèle ; le coller dans un autre diagramme recrée les vues sur les mêmes modèles ou duplique les modèles selon le contexte.

## 6. Interface (`ui`)

- **Solid.js** (MIT) : réactivité fine et petit bundle, adapté à des panneaux très dynamiques sous WebKitGTK.
- Docking simple : sidebar gauche, navigateur droit, panneau bas ; splitters ; repli automatique selon des points de rupture (≥ 1440, 1100–1439, < 1100) ; les menus passent en débordement à moins de 900 px.
- **Design system** : tokens CSS (`--surface-*`, `--text-*`, `--accent`) avec un thème clair et un thème sombre ; police d'interface Inter (OFL), JetBrains Mono (OFL) pour le code ; icônes Lucide (ISC) et icônes UML dessinées par nous.
- i18n : `ui/i18n/{fr,en}.json`, clés typées, changement à chaud.
- Commandes : `CommandRegistry` (id → handler, libellé, `when`) partagé entre les menus, les raccourcis (`KeymapService`), la palette (`Ctrl+Shift+P`) et les plugins.

## 7. Entrées/sorties (`io`)

- `.mdj` : lecture en flux (fichiers de plusieurs Mo), résolution des `$ref` en deux passes, migration des couleurs. Écriture **déterministe** : ordre des clés fixe (`_type, _id, _parent, name`, puis l'ordre alphabétique), indentation de 2, `\n` final. Les tableaux gardent l'ordre du modèle, ce qui produit des diffs Git minimaux.
- `.mfj` : même sérialiseur, avec pour racine l'élément exporté.
- Export : PNG/JPEG via `OffscreenCanvas`, SVG via `SvgGraphics`, PDF via jsPDF, HTML/Markdown via des templates et markdown-it.
- Mermaid et PlantUML : parseurs écrits par nous (grammaires Chevrotain, Apache-2.0) vers un IR → commandes de création ; exporteurs à partir du modèle.
- Comparaison de modèles : diff structurel par `_id` (ajouts, suppressions, changements de champs), avec repli par appariement nom + type quand les `_id` diffèrent.

## 8. Génération de code et reverse (`codegen`)

- `Generator` : `(rootPackage, options) → VirtualFile[]`, écrits par Rust (création de dossiers, journal). Un module par langage, avec des templates TypeScript tagués (pas d'`eval`).
- Reverse : **web-tree-sitter** (MIT) avec les grammaires Java, Python, TypeScript et PHP (MIT) en WASM → AST → IR commun → modèle UML et diagrammes auto-disposés (ELK).
- SQL : **node-sql-parser** (Apache-2.0) pour les dialectes MariaDB, MySQL, PostgreSQL et SQLite → ERD. Connexion directe à une base MariaDB via **sqlx** (MIT/Apache-2.0) côté Rust, en lisant `information_schema`.
- Squelette de projet : `Generator` + templates de build (Maven, Gradle, npm, pyproject, composer).

## 9. Extensions (`plugins`)

- Emplacement : `~/.config/constella/extensions/{builtin,user}/<id>/` avec `package.json` (`name, version, engines.constella, main, contributes`).
- Chargement : ES module importé dans la WebView ; `activate(ctx)` / `deactivate()` ; contributions déclaratives (`menus/`, `keymaps/`, `toolbox/`, `preferences/`, `quickedits/`, `metamodel.json`).
- API `constella.*` typée et publiée (`@constella/api`, fichiers `.d.ts`) : `commands, menus, keymaps, toolbox, repository, factory, operations, selection, diagrams, notations, generators, validators, dialogs, toast, preferences, events`.
- Shim `app.*` (best effort) pour réutiliser les extensions StarUML open source.
- Les diagrammes non UML (ERD, BPMN, C4…) sont eux-mêmes des **extensions intégrées** : c'est la preuve que l'API suffit.
- Sécurité : une extension a les mêmes droits que l'application (même modèle que VS Code) ; l'installation affiche une confirmation explicite.

## 10. Côté Rust (`src-tauri`)

- Commandes : `read_file`, `write_file_atomic` (fichier temporaire + rename), `list_recent`, `autosave` (`~/.local/state/constella/autosave/`), `watch_extensions`, `db_introspect`, `write_tree` (génération de code).
- Plugins Tauri officiels : `dialog`, `fs` (périmètre limité), `clipboard-manager`, `window-state`, `single-instance`, `cli`, `updater` (désactivé par défaut).
- CLI : `constella image|pdf|html|gen|exec` lance la WebView en mode masqué et réutilise le même code TS.

## 11. Tests

- **Vitest** sur `core`, `io`, `codegen` et `notation` (sans DOM) : métamodèle, opérations et inverses (propriété : `undo(op(s)) == s`, avec fast-check), round-trip `.mdj`, grammaires de quick-edit, générateurs (snapshots), parseurs.
- Corpus `tests/fixtures/mdj/` : projets d'exemple open source (licence vérifiée) et fichiers produits par nos tests.
- E2E : Playwright sur le frontend servi par Vite (Tauri simulé), et tests de fumée `tauri-driver` sur le binaire.
- Rust : `cargo test` pour les commandes fs/autosave.

## 12. Arborescence

```
constella/
├─ src/ {core, notation, render, editor, ui, io, codegen, plugins}
├─ src-tauri/ {src, icons, tauri.conf.json}
├─ extensions/builtin/ {erd, flowchart, dfd, bpmn, c4, sysml, mindmap, wireframe}
├─ tests/ {unit, fixtures, e2e}
├─ docs/ {keymap.md, validation-rules.md, plugin-api.md, mdj-format.md}
├─ assets/logo/
├─ FEATURES.md · ARCHITECTURE.md · LICENSES.md
```

## 13. Prérequis de développement (non installés sur ce poste)

Constaté pendant la phase 0 : **Node.js, Rust/Cargo et webkit2gtk-4.1 sont absents**. Pour Arch Linux, à installer avant la phase 1 :

```bash
sudo pacman -S --needed nodejs npm rustup webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg
```

puis `rustup default stable`. Le paquet `.rpm` requiert `rpm-tools` ; l'AppImage se construit sans dépendance supplémentaire.
