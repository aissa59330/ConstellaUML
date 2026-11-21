# Installer Constella

## Windows 10 / 11

- **Installeur** `Constella_0.1.0_x64-setup.exe` : double-clic, sans droits administrateur (installation pour l'utilisateur courant). Ajoute Constella au menu Démarrer et associe les fichiers `.mdj`.
- **Paquet MSI** `Constella_0.1.0_x64_fr-FR.msi` : pour un déploiement en entreprise (installation pour tous les utilisateurs).

Windows SmartScreen peut afficher « Windows a protégé votre ordinateur » car l'installeur n'est pas signé : cliquer sur **Informations complémentaires**, puis **Exécuter quand même**.
Constella utilise WebView2, déjà présent sur Windows 10 et 11 ; s'il manque, l'installeur le télécharge.

## Linux

Paquets produits par `npx tauri build` dans `src-tauri/target/release/bundle/`.
Les paquets publiés sur GitHub sont compilés sur Ubuntu 22.04 : ils fonctionnent sur **Ubuntu 22.04 et plus récent**, Debian 12, Arch, Fedora 36+. (Compilés sur Debian 12, comme sur ma machine, ils demandent Ubuntu 24.04 ou plus.)

## Ubuntu / Debian — `Constella_0.1.0_amd64.deb`

```bash
sudo apt install ./Constella_0.1.0_amd64.deb
```

## Arch Linux

Au choix :

- **AppImage** (rien à installer) :
  ```bash
  chmod +x Constella_0.1.0_amd64.AppImage
  ./Constella_0.1.0_amd64.AppImage
  ```
  Il faut le paquet `fuse2` (`sudo pacman -S fuse2`).
- **Paquet pacman** : mettre `Constella_0.1.0_amd64.deb` à côté de `packaging/arch/PKGBUILD`, puis :
  ```bash
  makepkg -si
  ```

## Fedora / openSUSE — `Constella-0.1.0-1.x86_64.rpm`

```bash
sudo dnf install ./Constella-0.1.0-1.x86_64.rpm
```

## Sur ma propre machine (distrobox)

`packaging/install-local.sh` installe le binaire compilé dans `~/.local`, avec l'icône,
l'entrée de menu et l'ouverture des fichiers `.mdj`. Dans une distrobox, l'entrée de menu
lance l'application à travers le conteneur. `--uninstall` retire tout.
