#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
app_name="irwin"
version="$(node -p "require('./package.json').version")"
test -x "release/linux-unpacked/$app_name"
stage="$(mktemp -d /tmp/irwin-deb-XXXXXX)"
mkdir -p "$stage/opt/$app_name" "$stage/usr/bin" "$stage/usr/share/applications" "$stage/usr/share/icons/hicolor/512x512/apps" "$stage/DEBIAN"
cp -a release/linux-unpacked/. "$stage/opt/$app_name/"
chmod 755 "$stage/opt/$app_name/$app_name" "$stage/opt/$app_name/resources/tools/mongodump" "$stage/opt/$app_name/resources/tools/mongorestore"
chmod 4755 "$stage/opt/$app_name/chrome-sandbox"
cp build/icon.png "$stage/usr/share/icons/hicolor/512x512/apps/$app_name.png"
cat > "$stage/usr/bin/$app_name" <<'EOF'
#!/bin/sh
app_name="irwin"
exec "/opt/$app_name/$app_name" "$@"
EOF
chmod 755 "$stage/usr/bin/$app_name"
cat > "$stage/usr/share/applications/$app_name.desktop" <<EOF
[Desktop Entry]
Name=Irwin
Comment=Irwin MongoDB desktop workspace
Exec=$app_name %U
Terminal=false
Type=Application
Icon=$app_name
Categories=Development;Database;
StartupWMClass=$app_name
EOF
cat > "$stage/DEBIAN/control" <<'EOF'
Package: irwin
Version: VERSION_PLACEHOLDER
Section: devel
Priority: optional
Architecture: amd64
Maintainer: Wilbert Yang <zxpiayru@gmail.com>
Depends: libgtk-3-0 | libgtk-3-0t64, libnss3, libxss1, libxtst6, libatspi2.0-0 | libatspi2.0-0t64, libdrm2, libgbm1, libasound2 | libasound2t64
Description: Irwin MongoDB desktop workspace
 Native mongosh, BSON-aware document editing and streaming transfers.
EOF
sed -i "s/VERSION_PLACEHOLDER/$version/" "$stage/DEBIAN/control"
dpkg-deb --root-owner-group -Zgzip -z6 --build "$stage" "release/Irwin-${version}-linux-x64.deb"
case "$stage" in /tmp/irwin-deb-*) rm -rf -- "$stage" ;; esac
