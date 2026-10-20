#!/usr/bin/env sh
#
# Tauri writes "libgtk-3-0" into the .deb's Depends field. Ubuntu 24.04 and
# Debian 13 renamed that package to libgtk-3-0t64 during the 64-bit time_t
# transition, so a deb asking for the old name flatly refuses to install there
# — and one asking for the new name refuses on Ubuntu 22.04 and Debian 12.
# Depending on "libgtk-3-0 | libgtk-3-0t64" satisfies both, but Tauri appends
# its own entry rather than letting the config replace it, so the field has to
# be rewritten after bundling.
#
# Also drops the duplicate entries Tauri leaves behind. Running it twice is
# harmless. Usage:
#
#   packaging/linux/fix-deb-depends.sh [file.deb ...]
#
# With no arguments it rewrites every deb Tauri just built.
set -eu

debs=${*:-}
if [ -z "$debs" ]; then
  debs=$(find src-tauri/target/release/bundle/deb -name '*.deb' 2>/dev/null || true)
fi
[ -n "$debs" ] || { echo "fix-deb-depends: no .deb found" >&2; exit 1; }

for deb in $debs; do
  work=$(mktemp -d)
  dpkg-deb -R "$deb" "$work"
  control="$work/DEBIAN/control"

  depends=$(awk '
    /^Depends:/ {
      sub(/^Depends:[ \t]*/, "")
      n = split($0, parts, /[ \t]*,[ \t]*/)
      for (i = 1; i <= n; i++) {
        p = parts[i]
        if (p == "libgtk-3-0") p = "libgtk-3-0 | libgtk-3-0t64"
        if (p != "" && !(p in seen)) {
          seen[p] = 1
          out = (out == "" ? p : out ", " p)
        }
      }
      print out
    }' "$control")

  if [ -n "$depends" ]; then
    awk -v d="$depends" '/^Depends:/ { print "Depends: " d; next } { print }' \
      "$control" >"$control.new"
    mv "$control.new" "$control"
    dpkg-deb --build "$work" "$deb" >/dev/null
    echo "$deb"
    echo "  Depends: $depends"
  fi

  rm -rf "$work"
done
