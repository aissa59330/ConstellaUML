# Constella — Cahier des charges & checklist de parité

> Outil de modélisation UML desktop pour Linux, inspiré de StarUML (ergonomie et fonctionnalités),
> **sans aucun code StarUML** (voir [LICENSES.md](LICENSES.md)).
> Nom de travail : **Constella** (les modèles sont des étoiles, les relations des constellations).

## État

- **Phase 0** : validée.
- **Phase 1** (noyau + diagramme de classes) : validée (vérifiée dans l'app à ta demande).
- **Phase 2** (tous les autres diagrammes UML) : validée (« continue »), retours prévus plus tard.
- **Phase 3** (génération de code, reverse engineering, ERD, SQL + modèle relationnel et arbre de requête demandés en cours de route) : livrée, en attente de ta validation. Les 14 types sont créables, éditables, sauvegardés en `.mdj` et exportés (tests de rendu par type + images dans [docs/screenshots/diagrams](docs/screenshots/diagrams)). Rien n'est encore marqué `[x]` : il faut ton essai dans l'app native.

## Sources de la phase 0

| Source | Statut |
|---|---|
| Documentation officielle https://docs.staruml.io (63 pages : guide utilisateur, 30 diagrammes, API d'extensions) | ✅ lue intégralement |
| Observation de StarUML sur le poste (computer-use) | ❌ indisponible dans la session : outil non activé. Les points marqués **(à observer)** seront vérifiés plus tard, sur l'app ou à partir de captures |

## Légende

- `[ ]` à faire · `[x]` fait, **fonctionnel et testé** (test automatisé + essai dans l'app) · `[~]` implémenté et testé en partie (tests automatisés et/ou version web), **en attente de ta validation dans l'app native** — il ne passera en `[x]` qu'après
- Une note *partiel* indique ce qui manque encore dans la ligne.
- **P1…P4** : phase cible · ⭐ : au-delà de StarUML
- Chaque ligne a un identifiant stable (`UI-012`) utilisé dans les commits et les tests.

---

## 1. Concepts fondamentaux

- [x] CORE-001 (P1) Projet = élément racine unique, stocké dans un seul fichier `.mdj`
- [x] CORE-002 (P1) Séparation **modèle / vue** : un élément du modèle peut avoir 0..n vues, dans un ou plusieurs diagrammes ; renommer un élément met à jour toutes ses vues
- [x] CORE-003 (P1) Supprimer une vue (`Suppr`) ≠ supprimer du modèle (`Ctrl+Suppr`, qui supprime aussi toutes les vues)
- [x] CORE-004 (P1) Undo/redo illimité de **toute** modification (modèle, vue, style, diagrammes)
- [x] CORE-005 (P1) Identifiants stables (`_id`) et références `{"$ref": id}` comme dans `.mdj`
- [ ] CORE-006 (P2) Profils UML (UML Standard Profile v2 applicable via Modèle ▸ Appliquer un profil)
- [ ] CORE-007 (P1) Stéréotypes (choisis depuis un profil ou saisis librement), contraintes, tags (`string`, `reference`, `boolean`, `number`, `hidden`) — *partiel* : stéréotypes libres, tags, contraintes ; manque le choix depuis un profil
- [~] CORE-008 (P1) Documentation de chaque élément (Markdown)
- [~] CORE-009 (P2) Fragments `.mfj` : export de n'importe quel élément / import sous le projet — export/import de fragment `.mfj` déjà disponibles

## 2. Gestion de projet & fichiers

- [~] FILE-001 (P1) Nouveau (`Ctrl+N`), Ouvrir (`Ctrl+O`), Enregistrer (`Ctrl+S`), Enregistrer sous (`Ctrl+Shift+S`), Fermer (avec demande d'enregistrement)
- [~] FILE-002 (P1) Lecture/écriture `.mdj` compatible StarUML (aller-retour sans perte, types inconnus conservés tels quels) — aller-retour sans perte testé ; réouverture de nos fichiers *dans StarUML* non vérifiée
- [~] FILE-003 (P1) Fichiers récents
- [~] FILE-004 (P1) Autosave + récupération après crash — récupération testée en version web
- [ ] FILE-005 (P2) Nouveau depuis un modèle : UML minimal, UML conventionnel, 4+1, Rational, Data Model, BPMN, C4, Wireframe
- [~] FILE-006 (P2) Export/import de fragment `.mfj` — export/import disponibles (P1 au lieu de P2)
- [~] FILE-007 (P1) Couleurs « variables » (`$background`, `$foreground`, `$transparent`, `$<teinte><1..12>`) + conversion à l'ouverture des anciens fichiers (garder/convertir)
- [ ] FILE-008 (P4) Export au format StarUML v7 (couleurs variables remplacées par les couleurs du thème clair)
- [ ] FILE-009 (P4) Import/Export XMI 2.1 (éléments du modèle uniquement)
- [ ] FILE-010 (P4) Import StarUML v1 (`.uml`) — *optionnel, faible priorité*
- [x] FILE-011 (P1) ⭐ Sauvegarde **diff-friendly** : JSON trié de façon déterministe, indenté, retours à la ligne stables (option activée par défaut, toujours lisible par StarUML)
- [~] FILE-012 (P1) Ouverture d'un fichier passé en argument / association MIME `.mdj` sous Linux

## 3. Export

- [~] EXP-001 (P1) Boîte « Exporter l'image » (`Ctrl+Shift+E`) : portée (diagramme courant / tous), format PNG/JPEG/SVG, fond rempli, échelle 1x/2x, marge 0–32 px, Exporter / Tout exporter (dossier) / Copier dans le presse-papiers ; options mémorisées — JPEG inclus ; export testé (PNG/SVG/JPEG encodés), boîte non testée en natif
- [x] EXP-002 (P1) PNG et SVG (phase 1), JPEG (P2)
- [~] EXP-003 (P1) Copier le diagramme en image (`Ctrl+Shift+C`) — dépend du presse-papiers d'images de WebKitGTK
- [ ] EXP-004 (P2) Imprimer en PDF : portée, orientation, format de page (A0…A10, B, C, Letter, Legal, Tabloid…), nom du diagramme en en-tête
- [ ] EXP-005 (P3) Documentation HTML (arbre du modèle, pages par élément, images des diagrammes, documentation)
- [ ] EXP-006 (P3) Documentation Markdown
- [x] EXP-007 (P1) Export avec les couleurs du thème courant (clair/sombre)

## 4. Interface

### 4.1 Fenêtre principale
- [~] UI-001 (P1) Barre de menus : Fichier, Édition, Format, Modèle, Outils, Affichage, Aide
- [x] UI-002 (P1) Barre latérale gauche : Diagrammes ouverts (*Working Diagrams*) + Toolbox (`Ctrl+1`, `Ctrl+5`)
- [x] UI-003 (P1) Zone diagramme avec **onglets** multi-diagrammes
- [x] UI-004 (P1) Navigateur à droite (`Ctrl+2`) : Model Explorer + éditeurs (`Ctrl+6`)
- [x] UI-005 (P1) Barre d'outils (`Ctrl+3`), barre d'état (`Ctrl+4`) : chemin de l'élément, résultats de validation, bouton thème, zoom
- [ ] UI-006 (P2) Panneau inférieur à onglets : Résultats de recherche, Validation, Miniatures (`Ctrl+Alt+T`), Documentation Markdown (`Ctrl+Alt+D`), Relations (`Ctrl+Alt+R`), Console de script (`Ctrl+Alt+J`) — *partiel* : seul le panneau « Résultats de recherche » existe
- [x] UI-007 (P1) **Responsive** : panneaux redimensionnables, repliables ; repli automatique sous ~1100 px, menus en débordement, utilisable à partir de 1024×600 jusqu'au 4K — testé à 1024×600, 1440×860 et ~600 px (toolbox en icônes, navigateur en surimpression)
- [~] UI-008 (P1) Disposition des panneaux mémorisée

### 4.2 Model Explorer
- [x] EXPL-001 (P1) Arbre du modèle, icônes par type, recherche intégrée
- [~] EXPL-002 (P1) Tri par ordre d'ajout / par nom ; afficher le stéréotype ; Tout déplier / Tout replier
- [~] EXPL-003 (P1) Clavier : ↑ ↓ ← → , `Entrée` = renommer sur place, `Échap` = annuler
- [~] EXPL-004 (P1) Glisser-déposer : réorganiser / déplacer dans un autre conteneur (avec contrôle de validité)
- [~] EXPL-005 (P1) Glisser un élément vers un diagramme = créer une vue
- [~] EXPL-006 (P1) Menu contextuel : Ajouter ▸ [type], Ajouter un diagramme ▸ [type], Copier/Couper/Coller, Supprimer du modèle, Monter/Descendre (`Ctrl+Shift+↑/↓`)
- [~] EXPL-007 (P1) Double-clic sur un diagramme = l'ouvrir ; « Ouvrir le sous-diagramme »
- [~] EXPL-008 (P1) Sélectionner dans l'explorateur (`Ctrl+E`) / dans le diagramme (`Ctrl+D`)

### 4.3 Éditeurs
- [x] ED-001 (P1) Éditeur de propriétés : tous les champs du métamodèle (texte, booléen, énumération, référence avec sélecteur d'élément, liste de références)
- [~] ED-002 (P1) Éditeur de style : remplissage, ligne, police, style de ligne, alignement du texte, options d'affichage
- [x] ED-003 (P1) Éditeur de documentation **Markdown** avec aperçu
- [~] ED-004 (P1) Éditeur inline d'attributs / opérations / littéraux / paramètres de template
- [ ] ED-005 (P2) Éditeur de tags (`Ctrl+T`) : attributs du stéréotype + tags libres
- [~] ED-006 (P1) Boîtes : Police, Couleur (palette de variables + `#rrggbb`), Sélecteur d'élément, Sélecteur dans une liste, Éditeur de liste d'éléments — *partiel* : police, couleur ; sélecteurs d'éléments simplifiés (liste)
- [ ] ED-007 (P2) Préférences (schémas à gauche, réinitialisation par défaut)

### 4.4 Éditeur de diagramme
- [~] DG-001 (P1) Défilement molette / Maj+molette / bouton du milieu / `Ctrl`+glisser
- [~] DG-002 (P1) Zoom `Ctrl++`, `Ctrl+-`, `Ctrl+0` (taille réelle), `Ctrl+9` (ajuster), `Ctrl`+molette ; niveau affiché dans la barre d'état — molette + Ctrl, raccourcis, barre d'état
- [~] DG-003 (P1) Minimap (`Ctrl+Alt+M`), clic pour naviguer
- [~] DG-004 (P1) Sélection : clic, Maj+clic, rectangle (+Maj), `Ctrl+A`, `Échap` = outil sélection
- [~] DG-005 (P1) Déplacement : flèches = 1 px, Maj+flèches = pas de grille
- [~] DG-006 (P1) Grille (`Ctrl+G`), magnétisme (`Ctrl+Shift+G`)
- [~] DG-007 (P1) Redimensionnement par poignées ; redimensionnement automatique (`Ctrl+Shift+R`)
- [~] DG-008 (P1) Liens : création par glisser source→cible, points intermédiaires, reconnexion des extrémités, étiquettes déplaçables — création, reconnexion des extrémités, points intermédiaires (oblique/courbe), étiquettes déplaçables ; les liens rectilignes sont routés automatiquement
- [x] DG-009 (P1) Création d'éléments depuis la Toolbox (clic-glisser pour la taille) ; création d'un Texte par double-clic sur fond vide
- [x] DG-010 (P1) **Quick-edit** au double-clic ou `Entrée` (voir §5.1) ; `Maj+Entrée` = nouvelle ligne dans les textes
- [x] DG-011 (P1) Copier/couper/coller de vues, **y compris entre diagrammes** ; copier/coller d'éléments du modèle dans l'explorateur
- [~] DG-012 (P1) Menu contextuel du diagramme (Format, Alignement, Supprimer, Supprimer du modèle, Sélectionner dans l'explorateur…) — avec **Ajouter ▸** (paramètre de template, attribut, port, opération, réception, classe…) et **Ajouter un diagramme ▸** selon l'élément cliqué
- [ ] DG-013 (P2) Glisser-déposer d'une image sur le diagramme
- [~] DG-014 (P1) Rendu fluide : 60 fps en déplacement avec 500 éléments, ouverture < 1 s pour un projet de 5 000 éléments — mesuré (version web, canvas réel) : déplacement 1 à 4 ms par image avec 500 classes et 500 associations, ouverture + mise en page de 21 000 éléments (23 Mo) en 0,3 s ; reste à confirmer dans l'app native

### 4.5 Mise en forme (menu Format)
- [~] FMT-001 (P1) Police (`Ctrl+Shift+F`), couleur de remplissage (`Ctrl+Shift+I`), couleur de ligne (`Ctrl+Shift+L`)
- [~] FMT-002 (P1) Style de ligne : Rectilinéaire (`Ctrl+L`), Oblique (`Ctrl+B`), Rectangle arrondi (`Ctrl+Alt+L`), Courbe (`Ctrl+Alt+B`)
- [~] FMT-003 (P1) Ombre (`Ctrl+Shift+H`), Hériter du style (`Ctrl+Shift+K`), Retour à la ligne (`Ctrl+Shift+W`)
- [~] FMT-004 (P1) Affichage du stéréotype : Aucun / Libellé / Décoration / Décoration+libellé / Icône / Icône+libellé (`Ctrl+Shift+0…5`)
- [~] FMT-005 (P1) Afficher : visibilité (`Ctrl+Shift+V`), espace de noms (`Ctrl+Shift+N`), propriétés/tags (`Ctrl+Shift+B`), type (`Ctrl+Shift+Y`), multiplicité (`Ctrl+Shift+M`), signature d'opération (`Ctrl+Shift+J`), nom du diagramme (`Ctrl+Shift+D`)
- [~] FMT-006 (P1) Masquer : attributs (`Ctrl+Shift+A`), opérations (`Ctrl+Shift+O`), réceptions (`Ctrl+Shift+X`), littéraux (`Ctrl+Shift+T`), colonnes (`Ctrl+Shift+U`)
- [~] FMT-007 (P1) Alignement : gauche, droite, milieu, haut, bas, centre ; premier plan / arrière-plan
- [~] FMT-008 (P1) ⭐ Distribuer horizontalement / verticalement, même largeur / hauteur / taille
- [~] FMT-009 (P1) ⭐ Reproduire la mise en forme (*format painter*)
- [ ] FMT-010 (P2) Layout automatique : Auto, Haut→Bas, Bas→Haut, Gauche→Droite, Droite→Gauche

### 4.6 Annotations (toutes les toolbox)
- [~] ANN-001 (P1) Texte, Zone de texte, Note, Lien de note, Ligne libre (style, motif, terminaisons)
- [~] ANN-002 (P1) Hyperlien (URL ou référence à un élément ; double-clic = ouvrir), affichage du nom
- [~] ANN-003 (P1) Formes : rectangle, rectangle arrondi, ellipse
- [ ] ANN-004 (P2) Image intégrée (PNG/JPEG/SVG), remplacement par double-clic

### 4.7 Recherche, navigation, validation
- [~] NAV-001 (P1) Recherche (`Ctrl+F`) : mot-clé, sensible à la casse, recherche dans la documentation ; résultats dans le panneau inférieur
- [x] NAV-002 (P1) Recherche rapide (`Ctrl+P`) d'éléments, vues et diagrammes
- [x] NAV-003 (P1) Palette de commandes (`Ctrl+Shift+P`)
- [~] NAV-004 (P1) Diagramme suivant/précédent (`Ctrl+Shift+]` / `[`), fermer (`F4`), fermer les autres (`Ctrl+F4`), tout fermer (`Maj+F4`)
- [ ] VAL-001 (P2) Validation du modèle : règles UML001–UML057 et ERD001–ERD002 (liste complète dans [docs/validation-rules.md](docs/validation-rules.md)), liste d'erreurs cliquable, compteur dans la barre d'état
- [ ] VAL-002 (P3) ⭐ Règles personnalisées fournies par les extensions

### 4.8 Thèmes, langues, personnalisation
- [x] THM-001 (P1) Thèmes clair et sombre ; diagrammes redessinés selon les variables de couleur
- [x] THM-002 (P1) Interface en français et en anglais, changement sans redémarrage
- [ ] THM-003 (P2) Raccourcis personnalisables (`~/.config/constella/keymap.json`)
- [ ] THM-004 (P2) Polices personnalisées (`~/.config/constella/fonts/<police>/font.json`)

### 4.9 Raccourcis clavier (identiques à StarUML sous Linux)
- [~] KEY-001 (P1) Tous les raccourcis listés dans [docs/keymap.md](docs/keymap.md) (69 commandes + raccourcis contextuels), testés automatiquement — tous les raccourcis des fonctions de la phase 1 vérifiés par test ; restent ceux des fonctions des phases suivantes

---

## 5. Diagrammes UML

### 5.1 Quick-edit (commun)
- [x] QE-001 (P1) Nom : `[<<stéréotype>>] [visibilité] nom` (visibilités `+ # - ~`)
- [x] QE-002 (P1) Attribut : `[<<st>>] [vis] nom [: type] [[multiplicité]] [= défaut]` — ex. `+nom: String [0..1] = "x"`
- [x] QE-003 (P1) Opération : `[<<st>>] [vis] nom [(params)] [: retour]`
- [ ] QE-004 (P1) Paramètre de template : `[<<st>>] [vis] nom [: type] [= défaut]`
- [~] QE-005 (P1) Dans le quick-edit : ajouter un attribut (`Ctrl+Entrée`), une opération (`Ctrl+Shift+Entrée`), supprimer (`Ctrl+Suppr`), monter/descendre (`Ctrl+↑/↓`) — ajout testé ; suppression et réordonnancement à valider
- [~] QE-006 (P1) Quick-edit des extrémités d'association (nom, multiplicité, navigabilité, agrégation)
- [~] QE-007 (P1) Barre d'édition rapide (comme StarUML) : bouton **Visibilité** (public / protected / private / package) à gauche ; à droite, ajouter attribut / opération / réception / paramètre de template / littéral, et créer une superclasse, une sous-classe, une interface fournie ou requise, une classe associée, agrégée ou composée (placée sans chevauchement, nom directement en saisie) ; sur un attribut ou une opération : ajouter, monter, descendre, supprimer

### 5.2 Classes (P1)
- [x] CLS-001 Classe, Interface (boîte et « lollipop »), Signal, DataType, PrimitiveType, Enumeration (+ littéraux) — interface aussi en « lollipop » (affichage icône)
- [ ] CLS-002 Attributs, opérations, paramètres, réceptions, paramètres de template, substitution de template, template binding — *partiel* : attributs, opérations, paramètres, réceptions, paramètres de template (affichage) ; manquent substitution et template binding
- [ ] CLS-003 Généralisation, Association (navigabilité, ordre des extrémités, propriété *ownership*, agrégation, composition), association n-aire, Dépendance, Réalisation d'interface, Classe d'association — *partiel* : généralisation, association (navigabilité, agrégation, composition), dépendance, réalisation, réalisation d'interface ; manquent association n-aire, classe d'association, ordre des extrémités
- [~] CLS-004 Propriétés : abstrait, feuille, final, actif, statique, `isID`, `isReadOnly`, `isOrdered`, `isUnique`, `isDerived`, agrégation, défaut, `direction`, `isQuery`, `concurrency`, etc.
- [ ] CLS-005 Frame (cadre de diagramme), Contraintes et Tags affichés — *partiel* : tags affichés ; manquent Frame et affichage des contraintes
- [ ] CLS-006 Compartiments masquables, affichage abrégé, interface requise/fournie (socket/lollipop) — *partiel* : compartiments masquables, lollipop ; manque socket (interface requise)

### 5.3 Paquetages (P2)
- [~] PKG-001 Package, Model, Subsystem, Containment, Dépendance/Import/Merge

### 5.4 Objets (P2)
- [ ] OBJ-001 Object, Slot, Artifact Instance, Component Instance, Node Instance, Link, Link Object — *partiel* : tout sauf Link Object

### 5.5 Structure composite (P2)
- [~] CMP-001 Collaboration, Port, Part, Connector, Collaboration Use, Role Binding

### 5.6 Composants (P2)
- [ ] COM-001 Component, Artifact, Component Realization, interfaces fournies/requises, ports — *partiel* : tout sauf l'interface requise (socket)

### 5.7 Déploiement (P2)
- [~] DEP-001 Node, Deployment, Communication Path, instances

### 5.8 Cas d'utilisation (P2)
- [~] UC-001 Subject (système), Actor, Use Case, Extension Point, Include, Extend, Association, Généralisation

### 5.9 Séquence (P2)
- [~] SEQ-001 Lifeline, Message (`messageSort` : synchrone, asynchrone, signal, réponse, création, destruction), numéros de séquence, activations
- [~] SEQ-002 Endpoint (messages trouvés/perdus), Gate, State Invariant, Continuation
- [~] SEQ-003 Combined Fragment (`alt`, `opt`, `loop`, `par`, `break`, `critical`, `neg`, `assert`, `strict`, `seq`, `ignore`, `consider`) avec opérandes et gardes
- [~] SEQ-004 Interaction Use (`ref`)
- [ ] SEQ-005 Déplacement vertical cohérent des messages, réordonnancement automatique — *partiel* : messages déplaçables verticalement, numérotés selon leur ordre ; pas encore de renumérotation automatique au déplacement

### 5.10 Communication (P2)
- [~] CMU-001 Lifeline, Connector, Message (numérotés, flèches de direction)

### 5.11 Timing (P2)
- [ ] TIM-001 Lifeline, State/Condition, Time Segment, Time Tick, Time Constraint, Duration Constraint, Message — *partiel* : lifeline avec états et chronologie (`état@t; …`) et axe gradué ; modèle simplifié, pas encore compatible avec le timing de StarUML ; manquent contraintes et messages

### 5.12 Vue d'ensemble des interactions (P2)
- [~] IOV-001 Interaction Use, Interaction inline, Initial, Final, Fork, Join, Merge, Decision, Control Flow

### 5.13 Activités (P2)
- [~] ACT-001 Action, Trigger, nœuds initial/final d'activité/final de flux, Fork, Join, Merge, Decision
- [ ] ACT-002 **Swimlanes** (partitions verticales et horizontales), Interruptible Activity Region, Structured Activity Node — *partiel* : partitions verticales seulement
- [~] ACT-003 Input/Output Pin, Send Signal, Accept Signal, Accept Time Event, Object Node, Central Buffer, Datastore, Activity Parameter Node
- [~] ACT-004 Expansion Region + Input/Output Expansion Node
- [~] ACT-005 Control Flow, Object Flow, Exception Handler, Activity Interrupt

### 5.14 Machine à états (P2)
- [ ] STM-001 State (simple, composite, orthogonal/régions, sous-machine), Internal Activity (entry/do/exit), Internal Transition — *partiel* : états simples et composites (imbrication), entry/do/exit ; manquent régions orthogonales dessinées, sous-machine, transitions internes
- [~] STM-002 Pseudo-états : Initial, Choice, Join, Fork, Junction, Shallow/Deep History, Entry/Exit Point, Terminate ; Final State ; Connection Point Reference
- [~] STM-003 Transition (trigger [garde] / effet) — saisie rapide `déclencheur [garde] / effet`

### 5.15 Profils (P2)
- [ ] PRF-001 Profile, MetaClass, Stereotype (icône, script d'icône), Extension — *partiel* : tout sauf icône et script d'icône du stéréotype

### 5.16 Flux d'informations (P2)
- [~] INF-001 Information Item, Information Flow

---

## 6. Diagrammes SysML (P4)

- [ ] SYS-001 Exigences : Requirement (id, texte), Copy, DeriveReqt, Verify, Satisfy, Refine, Trace, Containment
- [ ] SYS-002 BDD : Block, Value Type, Interface Block, Constraint Block, Port, Object, Connector
- [ ] SYS-003 IBD : Part, Reference, Value, Port, Connector
- [ ] SYS-004 Paramétrique : Constraint Property, Constraint Parameter

## 7. Autres diagrammes

- [~] ERD-001 (P3) **ERD/MCD** : Data Model, Entity, Column (PK, FK, référence, type, longueur, nullable, unique), Relationship (cardinalités, notation pied-de-corbeau)
- [ ] ERD-002 (P3) ⭐ Vue MCD Merise (associations porteuses, cardinalités `0,n`/`1,1`) et passage MCD → MLD → MPD — *partiel* : passage ERD ⇄ modèle relationnel (MLD) et MLD → SQL (MPD) ; manque la vue Merise à associations porteuses
- [~] REL-001 (P3) ⭐ **Modèle relationnel** (MLD) : tables sur une ligne, clé primaire soulignée, clé étrangère `*`, types entre parenthèses, flèches `FK(colonnes)` ; création automatique de la colonne FK ; conversion depuis/vers l'ERD en gardant les positions
- [~] RA-001 (P3) ⭐ **Arbre de requête** (algèbre relationnelle) : relations, opérateurs (SELECT, WHERE, JOIN…, notation SQL ou σ π ⋈), flux ; génération de l'arbre depuis une requête SELECT (jointures, alias, GROUP BY, HAVING, ORDER BY, LIMIT, UNION…)
- [ ] DRW-001 (P4) ⭐ Dessin libre façon draw.io : bibliothèque de formes génériques, connecteurs, texte libre
- [ ] FLC-001 (P4) **Flowchart** : Process, Terminator, Decision, Delay, Predefined/Alternate Process, Data, Document, Multi-Document, Preparation, Display, Manual Input/Operation, Card, Punched Tape, Connector, Off-Page Connector, Or, Summing Junction, Collate, Sort, Merge, Extract, Stored Data, Database, Direct Access Storage, Internal Storage, Flow
- [ ] DFD-001 (P4) **DFD** : External Entity, Process, Datastore, Data Flow
- [ ] BPMN-001 (P4) **BPMN** : Process, Pool, Lane, activités (Task typées, Sub-Process), Events (start/intermédiaire/frontière/fin, avec types), Gateways, Data Objects, Data Association, Message, Message Flow, Choreography Task, Conversation, Conversation Link, Text Annotation, Association, Group
- [ ] C4-001 (P4) **C4** : Person, Software System, Container, Component (externes ou non), Relationship ; niveaux Context/Container/Component
- [ ] MM-001 (P4) **Mindmap** : Node, Edge, ajout rapide d'enfants/frères au clavier
- [ ] WF-001 (P4) **Wireframes** : Frame (desktop/mobile/tablette), Button, Text, Radio, Checkbox, Switch, Link, Tab, Tab List, Input, Dropdown, Panel, Image, Separator, Avatar, Slider
- [ ] CLD-001 (P4) *Optionnel* — Architecture AWS / Azure / GCP : cadre générique (groupes, services, connecteurs). Les icônes officielles des fournisseurs ne seront intégrées que si leur licence le permet.

---

## 8. Génération de code & reverse engineering (P3)

Boîte unifiée par langage, avec un onglet Générer et un onglet Reverse : paquetage de base, dossier, options (indentation, commentaires de documentation, associations pour les champs…), journal, annulation, dossiers mémorisés.

| Id | Langage | Génération | Reverse |
|---|---|---|---|
| CG-JAVA | Java (sortie non compilée : pas de `javac` sur la machine) | [~] | [~] |
| CG-CS | C# (sortie non compilée : pas de compilateur C#) | [~] | — |
| CG-CPP | C++ (.h/.cpp), compilé par `g++` dans les tests | [~] | — |
| CG-PY | Python, importé et exécuté dans les tests | [~] | [~] |
| CG-TS | TypeScript, vérifié par `tsc --strict` | [~] | [~] |
| CG-PHP | PHP, vérifié par `php -l` | [~] | [~] |
| CG-SQL | SQL DDL (MySQL/MariaDB, PostgreSQL, SQLite) depuis l'ERD, exécuté dans SQLite par les tests | [~] | [~] |

- [~] RE-001 Le reverse crée diagrammes de hiérarchie de types, de structure de paquetages et d'ERD (options) — un diagramme de classes par paquetage (super-types au-dessus), un diagramme de paquetages, ERD + MLD pour le SQL
- [~] RE-002 Tolérance aux erreurs de syntaxe (le reste du fichier est analysé)
- [ ] RE-003 Import d'un schéma depuis une connexion **MariaDB/MySQL** active (hôte, port, base) → ERD — pas encore fait (l'import d'un script SQL / d'un `mysqldump` est disponible)
- [ ] CG-100 (P4) ⭐ Export d'un diagramme de classes vers un **squelette de projet** (Maven/Gradle, npm/tsconfig, pyproject, composer…) : arborescence + fichiers
- [ ] CG-101 (P4) Génération par templates (équivalent de la commande `ejs`)

## 9. Extensions & automatisation (P4)

- [ ] EXT-001 Gestionnaire d'extensions : installées / registre, installer depuis une URL GitHub ou un `.zip`, mise à jour, désinstallation
- [ ] EXT-002 Extensions dans `~/.config/constella/extensions/user/<ext>/` : `package.json`, `main.js`, `menus/`, `keymaps/`, `toolbox/`, `preferences/`, `quickedits/`, `metamodel.json`
- [ ] EXT-003 API de plugins **documentée** (`docs/plugin-api.md`) : commandes, menus, raccourcis, toolbox, barre d'outils, accès et modification des éléments (via les opérations, donc annulables), sélection, événements, préférences, dialogues, toasts, nouveaux types de diagramme et de vue, générateurs, règles de validation
- [ ] EXT-004 Console de script (`Ctrl+Alt+J`) : exécution, historique, `$_`, autocomplétion
- [ ] EXT-005 Requêtes de sélection d'éléments (`@UMLClass`, `Package::Classe`, filtres)
- [ ] EXT-006 Couche de compatibilité *best effort* avec l'API `app.*` des extensions StarUML open source
- [ ] CLI-001 Ligne de commande : `constella image|pdf|html|exec|gen <fichier.mdj>` (sans interface graphique)

## 10. Au-delà de StarUML ⭐ (P4)

- [ ] PLUS-001 Import **Mermaid** : classes, séquence, états, flowchart, ER, exigences, mindmap
- [ ] PLUS-002 Export **Mermaid** pour les mêmes types de diagrammes
- [ ] PLUS-003 Import/export **PlantUML** (classes, séquence, cas d'utilisation, activités, états, composants)
- [ ] PLUS-004 **Comparaison de deux versions** d'un modèle (fichiers ou révisions git) : éléments ajoutés, supprimés et modifiés, diff des propriétés, mise en évidence sur les diagrammes
- [ ] PLUS-005 Squelette de projet (voir CG-100)
- [ ] PLUS-006 Sauvegarde diff-friendly (voir FILE-011)
- [ ] PLUS-007 Fusion à trois voies de `.mdj` (driver de merge git) — *optionnel*

## 11. Qualité & livraison

- [x] QA-001 Tests unitaires : métamodèle, opérations/undo, sérialisation `.mdj` (aller-retour sur des fichiers réels), quick-edit, générateurs, parseurs (Vitest)
- [ ] QA-002 Corpus de fichiers `.mdj` de référence (exemples open source + fichiers générés), avec un test de non-régression par fichier — *partiel* : 1 fichier de référence
- [ ] QA-003 Tests E2E de l'interface (Playwright sur le frontend, `tauri-driver` pour les tests de fumée)
- [ ] QA-004 Benchmarks de performance (DG-014) dans la CI — *partiel* : `scripts/bench.ts` et un test de non-régression (mise en page d'un déplacement sur 500 classes) ; pas encore de CI
- [ ] PKG-L1 (P4) AppImage
- [ ] PKG-L2 (P4) `.deb`
- [ ] PKG-L3 (P4) `.rpm`
- [ ] PKG-L4 (P4) Entrée de menu `.desktop`, icônes, association MIME `.mdj` / `.mfj`

---

### Hors périmètre (décision à valider)
- Gestion des licences et de l'activation de StarUML : sans objet.
- Intégration IA via MCP : possible plus tard sous forme d'extension (P4+), non prioritaire.
- Langages de génération que StarUML couvre en plus (C, JavaScript, Rust, Go, Ruby, Kotlin, Dart, Swift) : hors demande initiale, mais l'architecture des générateurs les permettra. **À confirmer.**
