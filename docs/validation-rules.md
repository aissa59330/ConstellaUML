# Règles de validation

Chaque règle a un code stable (`UML001`…) utilisé dans les messages et les tests.

| Code | S'applique à | Règle |
|---|---|---|
| UML001 | ModelElement (sauf paramètre de retour, attribut typé, relations, pseudo-états, nœuds de contrôle…) | Un nom est requis |
| UML002 | ModelElement (sauf Operation) | Nom unique dans l'espace de noms |
| UML003 | Attribute | Conflit avec un attribut hérité |
| UML004 | Operation | Signature déjà présente dans le classificateur |
| UML006 | Classifier | Un élément final/feuille ne peut pas avoir d'enfant |
| UML007 | Classifier | Généralisations en double |
| UML008 | Classifier | Généralisation circulaire |
| UML009 | Classifier | Réalisations en double |
| UML010 | Classifier | Noms de rôle en double dans les associations |
| UML011 | Interface | Attributs et opérations obligatoirement publics |
| UML012 | Association | Au plus une extrémité avec agrégation |
| UML013–015 | Artifact/Component/Node Instance | Le type doit être respectivement un artefact, un composant, un nœud |
| UML016 | MetaClass | Le nom doit exister dans le métamodèle |
| UML017 | Stereotype | Doit hériter d'un stéréotype |
| UML018 | Stereotype | Doit être contenu dans un profil |
| UML019 | Actor | Associations seulement avec des cas d'utilisation, composants ou classes |
| UML020 | UseCase | Pas d'inclusion circulaire (directe ou indirecte) |
| UML021 | Pseudostate initial | Au plus une transition sortante |
| UML022 | Pseudostate initial | Transition sortante sans déclencheur ni garde |
| UML023 | Historique (deep/shallow) | Au plus une transition sortante |
| UML024 | Join | ≥ 2 entrantes, exactement 1 sortante |
| UML025 | Fork | ≥ 2 sortantes, exactement 1 entrante |
| UML026 | Junction | ≥ 1 entrante et ≥ 1 sortante |
| UML027 | Choice | ≥ 1 entrante et ≥ 1 sortante |
| UML028 | State | Références de points de connexion réservées aux états sous-machine |
| UML029 | State | Pas à la fois sous-machine et régions |
| UML030–032 | Region | Au plus un initial, un historique profond, un historique superficiel |
| UML033–038 | FinalState | Ni transition sortante, ni région, ni sous-machine, ni entry/exit/do |
| UML039–040 | Transition | Segments de fork/join sans garde ni déclencheur |
| UML041 | Transition | Un segment de fork cible un état |
| UML042 | Transition | Un segment de join part d'un état |
| UML043 | Transition | Pas de déclencheur en sortie d'un pseudo-état (sauf initial) |
| UML044 | StateMachine | Le contexte ne peut pas être une interface |
| UML045 | DecisionNode | 1 ou 2 entrants, ≥ 1 sortant |
| UML046 | MergeNode | Exactement 1 sortant |
| UML047 | MergeNode | Flux tous objets ou tous contrôle |
| UML048 | InitialNode | Aucun flux entrant |
| UML049 | InitialNode | Seuls des flux de contrôle en sortie |
| UML050 | FinalNode | Aucun flux sortant |
| UML051 | ForkNode | Exactement 1 entrant |
| UML052 | ForkNode | Flux homogènes |
| UML053 | JoinNode | Exactement 1 sortant |
| UML054 | JoinNode | Flux homogènes |
| UML055 | ObjectNode | Uniquement des flux d'objets |
| UML056 | ControlFlow | Pas de nœud objet aux extrémités (sauf type contrôle) |
| UML057 | ObjectFlow | Pas d'action aux extrémités |
| ERD001 | Column | Une clé primaire ne peut pas être nullable |
| ERD002 | Column | Une clé étrangère référencée exige une relation entre les entités |
