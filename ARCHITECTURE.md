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

**Règle de dépendance** (vérifiée par `scripts/check-layers.mjs`, lancé par `npm run check`) :
`core` ← `notation` ⇄ `render` ← `editor` ← `ui`. `notation` utilise les primitives de dessin de `render/graphics.ts` et `render/colors.ts`, et `render/diagram.ts` orchestre les notations. `io` et `codegen` ne dépendent que de `core`.
`core` ne connaît **ni le DOM, ni Tauri** : il s'exécute dans Node et est testé sans navigateur.

## 2. Choix du moteur de diagrammes — décision : moteur maison (phase 1)

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

maxGraph reste une solution de repli pour un démarrage plus rapide, au prix des points ci-dessus.

## 3. Métamodèle (`core/meta`)

- Déclaratif : `core/meta/*.meta.ts` décrit chaque type (`name`, `super`, `attributes` avec `kind` : `String | Boolean | Integer | Enum | Ref | Refs | Var | Vars | Color | Font | Points`, `container`, `default`). Le métamodèle est **réécrit par nous** à partir de la spécification UML 2.5 de l'OMG et du format de fichier observé. Aucun fichier tiers n'est copié.
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

- **Solid.js 1.9** (MIT) : réactivité fine et petit bundle, adapté à des panneaux très dynamiques sous WebKitGTK.
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

## 13. Prérequis de développement

Le poste de développement est un conteneur **Debian 12** (podman/distrobox sur un hôte Arch). Installé en phase 1 :

- `sudo apt-get install build-essential pkg-config curl wget file libssl-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev rpm xdg-utils librsvg2-bin`
- Rust via rustup (`~/.cargo/bin`), Node.js 22 dans `~/.local/node` (ajouter `~/.local/node/bin` et `~/.cargo/bin` au `PATH`).

## 14. Décisions de la phase 1

- **Vues dérivées** : les compartiments, les lignes d'attributs et les étiquettes des liens (structure `.mdj`) sont recalculés par la mise en page (`arrange`), hors opérations. Seules les intentions de l'utilisateur (position, taille, style, points d'un lien oblique, position d'une étiquette) passent par des opérations.
- **Routage** : les liens rectilignes et en rectangle arrondi sont routés automatiquement ; les liens obliques et courbes conservent les points intermédiaires de l'utilisateur.
- **Couleurs** : les nouvelles vues utilisent les variables `$background` / `$foreground` ; à l'ouverture d'un ancien fichier en couleurs fixes, l'utilisateur peut les convertir.
- **Export** : le SVG passe par le même code de dessin que l'écran (`Graphics`), ce qui garantit un export identique à l'affichage.

## 15. Décisions de la phase 2 (diagrammes UML)

- **Formes déclaratives** (`src/notation/shapes.ts`) : la plupart des vues de nœuds sont décrites par un `NodeSpec` (forme, mot-clé, position du nom, compartiments, tailles min/fixes, `container`) au lieu d'un code de dessin par type. Les vues spécifiques (lifeline, fragment combiné, timing) gardent leur propre `ViewKind`.
- **Propriétaire du modèle** : `ownerFor()` range chaque nouvel élément dans la bonne liste (activité → `nodes/edges/groups`, interaction → `participants/messages/fragments`, machine à états → région). Créer un diagramme de comportement crée automatiquement son `UMLInteraction` / `UMLActivity` / `UMLStateMachine` (+ région).
- **Conteneurs** : une vue posée dans un nœud `container` y est imbriquée (`containerView`), se déplace avec lui et suit l'ordre de dessin ; le glisser-déposer peut ré-imbriquer.
- **Séquence** : les messages ont un routeur dédié (`customRouters`) : seule l'ordonnée compte, les activations sont calculées à partir des messages.
- **Zone peinte** (`setPaintedBounds`) : ce qui est dessiné hors du rectangle d'une vue (nom sous un acteur, labels de messages de communication) compte pour l'export et « ajuster ».
- **Ombres SVG** : copie décalée semi-transparente plutôt qu'un filtre `feDropShadow`, que librsvg/LibreOffice n'affichent pas.
- **Timing** : modèle simplifié (`timingStates`, `timeline` = `état@t; …`), à enrichir plus tard.

## 16. Décisions de la phase 3 (code, reverse, données)

- **Couche `codegen`** (`src/codegen/`) : ne dépend que de `core`. Les générateurs lisent une représentation commune (`model.ts` : classificateurs, champs, opérations, associations navigables → champs) puis écrivent chaque langage (`langs/*.ts`). Les corps d'opération non spécifiés lèvent une exception « non implémenté », pour que le code généré compile tel quel.
- **Reverse sans dépendance** : parseurs de déclarations écrits pour le projet (Java, TypeScript, PHP, Python, SQL DDL) sur un tokenizer tolérant commun (`core/lexer.ts`). Les corps de méthodes sont sautés, jamais analysés ; un groupe mal fermé ou une liste de paramètres cassée n'avale pas le reste du fichier. Choix fait plutôt que tree-sitter : aucune dépendance native ni WASM, et les tests valident l'aller-retour génération → reverse pour chaque langage.
- **Données** : ERD (`ERD*`, noms compatibles `.mdj`), modèle relationnel = autre notation des mêmes entités (`ERDTableView`, `ERDForeignKeyView`), arbre de requête = métamodèle `RA*` (relations, opérateurs, flux). `convertDiagram` passe d'une notation à l'autre en gardant les positions.
- **Mise en page automatique** (`notation/uml/autolayout.ts`) : couches selon l'héritage / les clés étrangères (parents au-dessus), lignes repliées au-delà de 1400 px ; la création du modèle et des diagrammes forme une seule étape d'annulation (`mergeKey`).
- **Fichiers** : `read_source_tree` (lecture d'un dossier source en ignorant `node_modules`, `.git`, `target`…, 5000 fichiers / 2 Mo max) et `write_files` (refus des chemins absolus et de `..`). Dans le navigateur : sélection de dossier et téléchargement `.zip` (écrivain ZIP intégré, sans compression).
- Les diagrammes ERD vivent pour l'instant dans `notation/erd` : ils passeront en extension intégrée quand l'API de plugins existera (phase 4).

## 17. Performances

- **Index inverse des références** (`Repository.referrers`) tenu à jour change par change (insertion, suppression, modification d'un champ référence), au lieu d'être reconstruit à chaque modification. Les sous-vues dérivées le mettent à jour via `registerDerived` / `reindexRefs`.
- **Époques de mise en page** (`layoutState` dans `notation/views.ts`) : les caches de tracés et de ports restent valides tant que seules les géométries changent (`left`, `top`, `width`, `height`, `points`). Un déplacement ne remet en page que les vues déplacées, leurs liens et les côtés de nœuds concernés (`arrangeDiagram` incrémental) ; toute autre modification ouvre une nouvelle époque et une mise en page complète. Un test vérifie que les tracés obtenus sont identiques à ceux d'une mise en page complète.
- **Dessin limité à la zone visible** (`drawDiagram(…, clip)`), **mini-carte** redessinée au plus 5 fois par seconde, **notifications de l'interface** regroupées (une mise à jour par tâche, même si une commande fait plusieurs opérations).
- `npx tsx scripts/bench.ts [n]` mesure création, mise en page, déplacement et ouverture.
