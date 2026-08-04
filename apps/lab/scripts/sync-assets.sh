#!/usr/bin/env bash
# Extrait des packs Tiny Swords (Pixel Frog) les seules textures utilisées par le labo,
# et les range dans public/tex/ avec des noms propres (sans espaces, servables par Vite).
# Relancer après toute mise à jour d'un pack. Rien ne se copie à la main dans public/ :
# ajouter un asset = ajouter une ligne ici.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
# Les trois packs Tiny Swords vivent une seule fois au dépôt, dans le catalogue —
# le labo ne les recopie pas dans ses propres `assets/`.
CATALOG="$REPO/packages/catalog/assets"
SRC="$CATALOG/Tiny Swords (Update 010)"
FREE="$CATALOG/Tiny Swords (Free Pack)"
ENEMY="$CATALOG/Tiny Swords (Enemy Pack)/Enemy Pack"
# Le pack SFX (371 Mo) est hors dépôt : pointer LAB_SFX_PACK dessus pour relancer ce script.
SFX="${LAB_SFX_PACK:?le pack SFX (371 Mo) est hors dépôt — pointer LAB_SFX_PACK dessus}/OGG Files"
OUT="$ROOT/public/tex"
mkdir -p "$OUT"

# --- sol : un tileset complet par palier ---------------------------------
# Le Free Pack fournit le même jeu en cinq teintes, herbe ET parois. Chaque
# palier prend la sienne : l'altitude se lit à la couleur, pas à une correction
# appliquée après coup.
cp "$FREE/Terrain/Tileset/Tilemap_color1.png"                  "$OUT/tileset-lvl0.png"
cp "$FREE/Terrain/Tileset/Tilemap_color3.png"                  "$OUT/tileset-lvl1.png"
cp "$FREE/Terrain/Tileset/Tilemap_color4.png"                  "$OUT/tileset-lvl2.png"
# Le sable n'existe que dans l'Update 010 : bloc 4x4 en colonnes 5-8.
cp "$SRC/Terrain/Ground/Tilemap_Flat.png"                      "$OUT/tileset-sand.png"

# --- sprites (feuilles complètes) ---
cp "$SRC/Terrain/Water/Water.png"                              "$OUT/water.png"
cp "$SRC/Terrain/Water/Foam/Foam.png"                          "$OUT/foam.png"
cp "$SRC/Factions/Knights/Troops/Warrior/Blue/Warrior_Blue.png" "$OUT/warrior.png"
cp "$SRC/Resources/Trees/Tree.png"                             "$OUT/tree.png"
cp "$SRC/Effects/Fire/Fire.png"                                "$OUT/fire.png"
cp "$SRC/Resources/Sheep/HappySheep_All.png"                   "$OUT/sheep.png"
cp "$SRC/Effects/Explosion/Explosions.png"                     "$OUT/explosion.png"
cp "$FREE/Particle FX/Water Splash.png"                        "$OUT/splash.png"
cp "$SRC/Terrain/Water/Rocks/Rocks_01.png"                     "$OUT/rocks.png"
# Grota, le panda : le seul PNJ de la scène. L'Enemy Pack le livre en 256 px,
# et son portrait est l'avatar 12 — c'est bien le même chapeau de paille.
cp "$ENEMY/Enemies/Panda/Panda_Idle.png"                       "$OUT/panda.png"

# --- décor animé du Free Pack : nuages et buissons ---
for i in 1 2 3 4; do
  cp "$FREE/Terrain/Decorations/Clouds/Clouds_0$i.png" "$OUT/cloud-$i.png"
  cp "$FREE/Terrain/Decorations/Bushes/Bushe$i.png"    "$OUT/bush-$i.png"
done

# --- sprites générés (voir assets/generated/PROVENANCE.md) ---
cp "$ROOT/assets/generated/chest-closed.png" "$OUT/chest-closed.png"
cp "$ROOT/assets/generated/chest-open.png"   "$OUT/chest-open.png"
cp "$ROOT/assets/generated/campfire-base.png" "$OUT/campfire-base.png"
cp "$ROOT/assets/generated/glider.png"        "$OUT/glider.png"
for f in house-front house-side house-roof interior-floor interior-wall \
         rug bed table cupboard hearth sakura; do
  cp "$ROOT/assets/generated/$f.png" "$OUT/$f.png"
done

# --- décor au sol ---
for i in 01 02 03 04 05 06; do
  cp "$SRC/Deco/$i.png" "$OUT/deco-$i.png"
done

# --- curseurs --------------------------------------------------------------
# Doublés au plus proche voisin, et déclarés en `2x` dans la CSS. Un curseur
# CSS est rendu à sa taille intrinsèque en pixels CSS : livré en 64, il serait
# ré-échantillonné en douceur sur un écran Retina et le pixel art baverait.
# Livré en 128 annoncé 2x, il tombe pile sur un écran dense, et sur un écran
# simple le navigateur le réduit d'un facteur 2 — ce qui, sur une image
# doublée au plus proche voisin, rend exactement les pixels d'origine.
UI="$ROOT/public/ui"
mkdir -p "$UI"
if command -v ffmpeg >/dev/null; then
  ffmpeg -hide_banner -loglevel error -y -i "$SRC/UI/Pointers/01.png" \
    -vf "scale=iw*2:ih*2:flags=neighbor" "$UI/cursor.png"
  ffmpeg -hide_banner -loglevel error -y \
    -i "$FREE/UI Elements/UI Elements/Cursors/Cursor_02.png" \
    -vf "scale=iw*2:ih*2:flags=neighbor" "$UI/cursor-hand.png"
  # Le portrait de Grota, recadré sur sa vignette (le PNG est un 256 aux trois
  # quarts vide) : dans le dialogue, c'est une image DOM, pas une texture.
  ffmpeg -hide_banner -loglevel error -y \
    -i "$ENEMY/Enemy Avatars/Enemy Avatars_12.png" \
    -vf "crop=156:148:45:45" "$UI/grota.png"
else
  echo "! ffmpeg absent : public/ui/*.png n'est pas régénéré" >&2
fi

# --- sons (pack Free Fantasy SFX de TomMusic) -----------------------------
# On prend les variantes "Chain" pour le héros : il porte une armure, et le
# cliquetis fait la moitié du travail.
SND="$ROOT/public/sfx"
mkdir -p "$SND"
for i in 1 2 3 4 5; do
  cp "$SFX/SFX/Footsteps/Dirt/Dirt Chain Run $i.ogg" "$SND/step-grass-$i.ogg"
  cp "$SFX/SFX/Footsteps/Dirt/Dirt Run $i.ogg"       "$SND/step-sand-$i.ogg"
done
for i in 1 2 3 4; do
  cp "$SFX/SFX/Footsteps/Water/Water Chain Walk $i.ogg" "$SND/swim-$i.ogg"
done
cp "$SFX/SFX/Footsteps/Dirt/Dirt Chain Jump.ogg"   "$SND/jump.ogg"
cp "$SFX/SFX/Footsteps/Dirt/Dirt Chain Land.ogg"   "$SND/land.ogg"
cp "$SFX/SFX/Footsteps/Water/Water Chain Jump.ogg" "$SND/water-in.ogg"
cp "$SFX/SFX/Footsteps/Water/Water Chain Land.ogg" "$SND/water-out.ogg"
for i in 1 2; do
  cp "$SFX/SFX/Doors Gates and Chests/Chest Open $i.ogg"  "$SND/chest-$i.ogg"
  cp "$SFX/SFX/Doors Gates and Chests/Chest Close $i.ogg" "$SND/chest-close-$i.ogg"
  cp "$SFX/SFX/Doors Gates and Chests/Door Open $i.ogg"   "$SND/door-open-$i.ogg"
  cp "$SFX/SFX/Doors Gates and Chests/Door Close $i.ogg"  "$SND/door-close-$i.ogg"
done
# Validation d'une réplique : un « toc » de bois. Le pack n'a aucun son
# d'interface, mais il a des pas — et un pas sur planche, détaché de la marche,
# n'est plus qu'un bloc de bois frappé. C'est le son de validation des jeux à
# dialogues, et il va bien à un panda en chapeau de paille. On prend les
# variantes SANS chaîne : le cliquetis d'armure du héros n'a rien à faire là.
for i in 1 2 3; do
  cp "$SFX/SFX/Footsteps/Wood/Wood Walk $i.ogg" "$SND/next-$i.ogg"
done
# Le sifflement de lame seul : le héros frappe dans le vide, rien n'est touché.
# Ces trois-là n'ont AUCUN transitoire d'attaque — ils enflent jusqu'à une crête,
# et c'est cette crête que l'oreille prend pour le coup. Les deux premiers
# culminent à 170 ms, le troisième à 284 ms : joué tel quel, un coup sur trois
# traînait d'un dixième de seconde de plus que les autres. On lui rogne donc le
# début de sa montée pour que les trois culminent au même endroit — `hero.ts`
# n'a ainsi qu'une seule avance à appliquer, et non une par échantillon.
ATK="$SFX/SFX/Attacks/Sword Attacks Hits and Blocks"
for i in 1 2 3; do
  cp "$ATK/Sword Attack $i.ogg" "$SND/attack-$i.ogg"
done
if command -v ffmpeg >/dev/null; then
  # `-strict -2` : l'encodeur Vorbis natif est marqué expérimental. Il fait
  # l'affaire sur 0.4 s de bruit, et garde le dossier homogène — cette machine
  # n'a pas libvorbis, et livrer ce seul fichier en Opus serait un piège.
  ffmpeg -hide_banner -loglevel error -y -i "$ATK/Sword Attack 3.ogg" \
    -af "atrim=0.115,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.012" \
    -c:a vorbis -strict -2 "$SND/attack-3.ogg"
else
  echo "! ffmpeg absent : attack-3.ogg garde sa montée trop longue" >&2
fi
for i in 1 2 3; do
  cp "$SFX/SFX/Spells/Spell Impact $i.ogg" "$SND/pop-$i.ogg"
done
# Les nappes de fond sont les quatre plus gros fichiers du projet : 10,8 Mo à
# elles seules, contre 900 ko pour toutes les textures réunies. Le pack les
# livre en Vorbis à très haut débit, ce qui n'a aucun sens pour du bruit de
# fond — on les repasse en Opus 96k, soit sept fois moins. Le reste des effets
# est court et reste tel quel : les réencoder ne gagnerait rien.
#
# Une réserve honnête : Opus complète la dernière trame, ce qui peut ajouter
# jusqu'à 20 ms de silence en fin de fichier. Sur une boucle tonale ça
# s'entendrait ; sur du vent, des vagues et une flamme, non.
for paire in "BGS Loops/Forest Day/Forest Day:amb-day" \
             "BGS Loops/Forest Night/Forest Night:amb-night" \
             "BGS Loops/Sea/Sea:amb-sea" \
             "SFX/Torch/Torch Loop:fire"; do
  src="${paire%:*}"
  dst="${paire##*:}"
  if command -v ffmpeg >/dev/null; then
    ffmpeg -hide_banner -loglevel error -y -i "$SFX/$src.ogg" \
      -c:a libopus -b:a 96k "$SND/$dst.ogg"
  else
    cp "$SFX/$src.ogg" "$SND/$dst.ogg"
  fi
done

# --- bêlements (prises maison) ---------------------------------------------
# Le pack n'a pas de mouton. Ces quatre-là sont des prises rangées brutes dans
# assets/sounds/, toutes rendues sur exactement 2.04 s : un bêlement, puis une
# longue queue de réverbe qui ne sert à rien. Aucune ne commence ni ne finit au
# même endroit, les bornes sont donc mesurées une par une. Deux pièges :
#   - la n°3 démarre EN PLEIN son (premier échantillon à -0.128, la moitié de sa
#     crête dans les dix premières millisecondes). Sans fondu d'entrée, elle
#     claque à chaque clic ;
#   - toutes crêtent vers -8 dBFS. On les remonte à -3, pas plus : `jouer()`
#     tire un gain aléatoire qui monte jusqu'à x1.15, et 0 dB écrêterait.
# Opus mono comme les voix de Grota : l'encodeur Vorbis natif de ffmpeg ne sait
# faire que du stéréo, et un bêlement n'a rien à y gagner.
if command -v ffmpeg >/dev/null; then
  #                 n  début   fin  fondu-in fondu-out
  for spec in "1 0.060 1.020 0.005 0.200" \
              "2 0.140 1.420 0.005 0.200" \
              "3 0.000 1.960 0.010 0.140" \
              "4 0.090 1.640 0.005 0.140"; do
    set -- $spec
    BRUT=$(ls "$ROOT/assets/sounds/A_single_sheep_bleat_#$1-"*.mp3)
    TMP="$(mktemp -t bleat).wav"
    SORTIE=$(awk -v a="$2" -v b="$3" -v f="$5" 'BEGIN{printf "%.3f", b - a - f}')
    ffmpeg -hide_banner -loglevel error -y -i "$BRUT" -ac 1 \
      -af "atrim=$2:$3,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=$4,afade=t=out:st=$SORTIE:d=$5" \
      "$TMP"
    PIC=$(ffmpeg -hide_banner -nostats -i "$TMP" -af volumedetect -f null - 2>&1 \
          | sed -n 's/.*max_volume: \(-*[0-9.]*\) dB.*/\1/p')
    ffmpeg -hide_banner -loglevel error -y -i "$TMP" \
      -af "volume=$(awk -v p="$PIC" 'BEGIN{printf "%.2f", -3 - p}')dB" \
      -c:a libopus -b:a 64k "$SND/bleat-$1.ogg"
    rm -f "$TMP"
  done
else
  echo "! ffmpeg absent : public/sfx/bleat-*.ogg n'est pas régénéré" >&2
fi

# --- voix de Grota ---------------------------------------------------------
# Quatre prises, une par réplique, gardées brutes dans assets/voices/. Elles
# sont mono d'origine : Opus à 56 kbit/s suffit largement pour de la parole, et
# les 670 ko de MP3 tombent à 265.
VOIX="$ROOT/public/voice"
mkdir -p "$VOIX"
if command -v ffmpeg >/dev/null; then
  for i in 1 2 3 4; do
    ffmpeg -hide_banner -loglevel error -y -i "$ROOT/assets/voices/panda_text_$i.mp3" \
      -ac 1 -c:a libopus -b:a 56k "$VOIX/grota-$i.ogg"
  done
else
  echo "! ffmpeg absent : public/voice/*.ogg n'est pas régénéré" >&2
fi

# --- glider (generated sound) -----------------------------------------------
# Generated with studio/ (see assets/generated/PROVENANCE.md) rather than taken
# from the pack: it is the lab's only sound arriving as a WAV, hence its own
# encode. Opus mono like the bleats — a canvas snap gains nothing from stereo.
if command -v ffmpeg >/dev/null; then
  ffmpeg -hide_banner -loglevel error -y -i "$ROOT/assets/sounds/glider-open.wav" \
    -ac 1 -c:a libopus -b:a 96k "$SND/glider-open.ogg"
else
  echo "! ffmpeg missing: public/sfx/glider-open.ogg was not regenerated" >&2
fi

# --- musique ---------------------------------------------------------------
# Il n'y en a pas : les arrangements essayés étaient sous droits, ce qui va pour
# bricoler en local mais pas pour servir depuis une URL publique. Déposer des
# fichiers dans `public/music/` et les déclarer dans `audio.ts` (Task 12)
# suffira à la rallumer.

echo "✓ $(ls "$OUT" | wc -l | tr -d ' ') textures dans public/tex/, $(ls "$SND" | wc -l | tr -d ' ') sons dans public/sfx/, $(ls "$VOIX" | wc -l | tr -d ' ') voix dans public/voice/"
