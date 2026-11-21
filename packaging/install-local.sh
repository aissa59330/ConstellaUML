#!/usr/bin/env bash
# Installs the release build of ConstellaUML for the current user (~/.local):
# binary, icons, menu entry and the .mdj / .mfj file types. Inside a
# distrobox, the menu entry starts the app through the container so the host
# launcher can show it.
# Usage: packaging/install-local.sh            (after `npx tauri build --no-bundle`)
#        packaging/install-local.sh --uninstall
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$HOME/.local/bin"
APP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor"
MIME_DIR="$HOME/.local/share/mime"
DESKTOP="$APP_DIR/io.constella.app.desktop"

refresh() {
  update-desktop-database "$APP_DIR" 2>/dev/null || true
  update-mime-database "$MIME_DIR" 2>/dev/null || true
  gtk-update-icon-cache -q -t "$ICON_DIR" 2>/dev/null || true
}

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$BIN_DIR/constella" "$DESKTOP" "$MIME_DIR/packages/constella.xml"
  for s in 32 64 128 256 512; do rm -f "$ICON_DIR/${s}x${s}/apps/constella.png"; done
  rm -f "$ICON_DIR/scalable/apps/constella.svg"
  refresh
  echo "ConstellaUML désinstallé."
  exit 0
fi

BIN="$ROOT/src-tauri/target/release/constella"
[[ -x "$BIN" ]] || { echo "Binaire introuvable : lance d'abord « npx tauri build --no-bundle »." >&2; exit 1; }

install -Dm755 "$BIN" "$BIN_DIR/constella"
install -Dm644 "$ROOT/src-tauri/icons/32x32.png" "$ICON_DIR/32x32/apps/constella.png"
install -Dm644 "$ROOT/src-tauri/icons/64x64.png" "$ICON_DIR/64x64/apps/constella.png"
install -Dm644 "$ROOT/src-tauri/icons/128x128.png" "$ICON_DIR/128x128/apps/constella.png"
install -Dm644 "$ROOT/src-tauri/icons/128x128@2x.png" "$ICON_DIR/256x256/apps/constella.png"
install -Dm644 "$ROOT/src-tauri/icons/icon.png" "$ICON_DIR/512x512/apps/constella.png"
install -Dm644 "$ROOT/assets/logo/constella.svg" "$ICON_DIR/scalable/apps/constella.svg"

# File types: .mdj (project) and .mfj (fragment).
install -Dm644 /dev/stdin "$MIME_DIR/packages/constella.xml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-constella-mdj">
    <comment>Projet UML (ConstellaUML)</comment>
    <glob pattern="*.mdj"/>
    <icon name="constella"/>
  </mime-type>
  <mime-type type="application/x-constella-mfj">
    <comment>Fragment de modèle UML</comment>
    <glob pattern="*.mfj"/>
    <icon name="constella"/>
  </mime-type>
</mime-info>
XML

EXEC="$BIN_DIR/constella"
NAME="ConstellaUML"
if [[ -n "${CONTAINER_ID:-}" && -e /run/.containerenv ]]; then
  # Inside a distrobox: the host launcher starts the app in this container, where its
  # libraries live (distrobox-enter is a host command, absent from the container).
  EXEC="/usr/bin/distrobox-enter -n $CONTAINER_ID -- $BIN_DIR/constella"
fi

# Absolute icon path: some launchers (and the host side of a distrobox) do not
# look up icon names in ~/.local/share/icons.
install -Dm644 /dev/stdin "$DESKTOP" <<DESKTOP
[Desktop Entry]
Type=Application
Name=$NAME
GenericName=Modeleur UML
Comment=Diagrammes UML, entité-relation, génération de code - créé par Aïssa Ouameur
Exec=$EXEC %f
Icon=$ICON_DIR/512x512/apps/constella.png
Terminal=false
Categories=Development;Graphics;Education;
Keywords=UML;diagramme;modélisation;ERD;SQL;
MimeType=application/x-constella-mdj;application/x-constella-mfj;
StartupNotify=true
StartupWMClass=constella
DESKTOP

refresh
echo "ConstellaUML installé : $BIN_DIR/constella"
echo "Entrée de menu : $DESKTOP"
