#!/bin/bash
# Copies this layout into the Herdr app home. Backs up anything it replaces.
# Merges the note key; it does not replace the rest of keys.json.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
herdr="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
backup="$herdr/.backup/$(date +%Y%m%d-%H%M%S)"

copy() {
  local rel="$1" dest="$herdr/$1"
  if [[ -e $dest ]]; then
    mkdir -p "$backup/$(dirname "$rel")"
    cp -a "$dest" "$backup/$rel"
  fi
  mkdir -p "$(dirname "$dest")"
  if [[ -d $here/$rel ]]; then
    mkdir -p "$dest"
    cp -a "$here/$rel/." "$dest/"
  else
    cp -p "$here/$rel" "$dest"
  fi
}

mkdir -p "$herdr/layouts" "$herdr/mods"
copy layouts/board-side.json
for mod in board-side board-side-new board-side-note board-side-history; do
  copy "mods/$mod"
done

python3 - "$herdr" "$backup" <<'PY'
import json, os, shutil, sys
path = os.path.join(sys.argv[1], "keys.json")
data = json.load(open(path)) if os.path.exists(path) else {}
if data.get("global", {}).get("ctrl-shift-m") == "board-side.note":
    sys.exit(0)
if os.path.exists(path):
    os.makedirs(sys.argv[2], exist_ok=True)
    shutil.copy2(path, os.path.join(sys.argv[2], "keys.json"))
data.setdefault("global", {})["ctrl-shift-m"] = "board-side.note"
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY

if command -v herdr-app >/dev/null 2>&1 && herdr-app status >/dev/null 2>&1 &&
    herdr-app do layout.switch '{"name":"board-side"}' >/dev/null; then
  echo "Herdr is showing the side board."
else
  echo "Start Herdr and switch to the board-side layout."
fi
[[ -d $backup ]] && echo "Replaced files were backed up to $backup"
echo "Done."
