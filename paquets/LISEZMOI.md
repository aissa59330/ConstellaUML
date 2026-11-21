# Installer Constella

Créé par Aïssa Ouameur. Licence GPL-3.0 ou ultérieure.

> Ces paquets ont été compilés sur Debian 12 : le `.deb` demande **Ubuntu 24.04 ou plus récent**. Pour Ubuntu 22.04, prends ceux de la page **Releases** du dépôt (compilés sur Ubuntu 22.04). Tous les fichiers sont dans ce dossier ; `SHA256SUMS` permet de vérifier qu'ils sont intacts (`sha256sum -c SHA256SUMS`).
Ils demandent une distribution récente (glibc 2.36 ou plus : Ubuntu 24.04+, Debian 12+, Arch, Fedora 38+).

## Ubuntu / Debian - `Constella_0.1.0_amd64.deb`

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
- **Paquet pacman** : dans ce dossier (le `.deb` et le `PKGBUILD` sont côte à côte) :
  ```bash
  makepkg -si
  ```

## Fedora / openSUSE - `Constella-0.1.0-1.x86_64.rpm`

```bash
sudo dnf install ./Constella-0.1.0-1.x86_64.rpm
```
