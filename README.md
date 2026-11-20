# Constella

*Créé par **Aïssa Ouameur**.*

Modeleur UML desktop pour Linux, inspiré de StarUML (sans son code) : Tauri 2 + TypeScript + Solid.js, rendu de diagrammes maison (Canvas / SVG), format `.mdj` compatible.

- Fonctionnalités et avancement : [FEATURES.md](FEATURES.md)
- Architecture : [ARCHITECTURE.md](ARCHITECTURE.md)
- Licences : [LICENSES.md](LICENSES.md)

## Développement

```bash
export PATH=~/.local/node/bin:~/.cargo/bin:$PATH
npm install
npm test               # tests unitaires
npm run check          # types + règles de couches
npm run tauri dev      # application avec rechargement à chaud
```

## Binaire

```bash
npx tauri build --no-bundle
./src-tauri/target/release/constella examples/bibliotheque.mdj
```

Les paquets AppImage / .deb / .rpm arrivent en phase 4.
