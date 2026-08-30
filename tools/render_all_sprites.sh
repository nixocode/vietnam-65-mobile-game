#!/usr/bin/env bash
# Rebuild sprite atlases.
#
# Deliberately gentle: renders ONE unit at a time at low sample counts, at low
# CPU priority, with a breather between units. A full 11-unit rebuild is ~1300
# renders and will heat any laptop — this keeps the machine usable while it runs.
#
#   bash tools/render_all_sprites.sh            # everything
#   bash tools/render_all_sprites.sh rifleman   # just one unit
set -u
cd "$(dirname "$0")/.."
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
# rpgman was missing from this list, so a "rebuild everything" run silently left
# it on whatever frame counts it was last rendered with while the other eleven
# moved on. Twelve units have atlases; twelve belong here.
UNITS=${@:-"rifleman arvn m60 engineer recon sniper guerrilla nva rpd sapper marksman rpgman"}

for u in $UNITS; do
  echo "--- $u"
  nice -n 10 "$BLENDER" -b --python tools/render_model_sprites.py -- \
    --model auto --unit "$u" --builtin --res 256 --samples 16 2>&1 \
    | grep -E "^DONE|Error:"
  nice -n 10 python3 tools/outline_sprites.py "assets/sprites3d/$u"
  sleep 2          # let the fans catch up
done
nice -n 10 python3 tools/pack_sprites3d.py
echo FULLDONE
