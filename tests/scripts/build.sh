#!/bin/bash
# Wing Launch macOS 打包：.app（arm64 + x64）与 .dmg
set -e
cd "$(dirname "$0")/.."

VERSION=$(node -e "console.log(require('./package.json').version)")
OUT="release"
APP_NAME="Wing Launch"

echo "== 1/4 生成图标"
node tests/scripts/make-icon.mjs
ICONS_DIR="resources/icons/icon.iconset"
mkdir -p "$ICONS_DIR"
SRC="resources/icons/icon_1024.png"
for size in 16 32 64 128 256 512 1024; do
  sips -z $size $size "$SRC" --out "$ICONS_DIR/icon_${size}x${size}.png" >/dev/null
done
# @2x 命名
sips -z 32 32 "$SRC" --out "$ICONS_DIR/icon_16x16@2x.png" >/dev/null
sips -z 64 64 "$SRC" --out "$ICONS_DIR/icon_32x32@2x.png" >/dev/null
sips -z 256 256 "$SRC" --out "$ICONS_DIR/icon_128x128@2x.png" >/dev/null
sips -z 512 512 "$SRC" --out "$ICONS_DIR/icon_256x256@2x.png" >/dev/null
sips -z 1024 1024 "$SRC" --out "$ICONS_DIR/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$ICONS_DIR" -o resources/icons/icon.icns
echo "图标就绪: resources/icons/icon.icns"

echo "== 2/4 打包 arm64 .app"
npx @electron/packager . "$APP_NAME" \
  --platform=darwin --arch=arm64 \
  --out="$OUT" --icon=resources/icons/icon.icns \
  --app-bundle-id=cn.blockbox.launcher \
  --app-version="$VERSION" \
  --app-copyright="Copyright 2026 Wing Launch" \
  --overwrite --prune=true \
  --ignore="^/release" --ignore="^/tests" --ignore="^/test" --ignore="^/docs" --ignore="^/\.zcode" \
  --ignore="^/resources/icons/icon\.iconset"

echo "== 3/4 打包 x64 .app（Intel）"
npx @electron/packager . "$APP_NAME" \
  --platform=darwin --arch=x64 \
  --out="$OUT" --icon=resources/icons/icon.icns \
  --app-bundle-id=cn.blockbox.launcher \
  --app-version="$VERSION" \
  --app-copyright="Copyright 2026 Wing Launch" \
  --overwrite --prune=true \
  --ignore="^/release" --ignore="^/tests" --ignore="^/test" --ignore="^/docs" --ignore="^/\.zcode" \
  --ignore="^/resources/icons/icon\.iconset"

echo "== 4/4 生成 DMG"
for arch in arm64 x64; do
  APP_DIR=$(ls -d "$OUT/$APP_NAME-darwin-$arch"/*.app)
  DMG="$OUT/Wing-Launch-$VERSION-$arch.dmg"
  hdiutil create -volname "Wing Launch" -srcfolder "$(dirname "$APP_DIR")" -ov -format UDZO "$DMG" >/dev/null
  echo "DMG: $DMG"
done

echo "== 完成"
ls -la "$OUT"/*.dmg
