"""Reporte une SURFACE générée sur la GÉOMÉTRIE d'un tileset Tiny Swords existant.

Le problème que ce script résout : le tileset du jeu est un bloc autotile 4x4 dont les
bords doivent se raccorder au pixel près, sur des cases de 64 px exactes (voir
`packages/hd2d/src/terrain/atlas.ts`, `mesh.ts`). Un modèle de diffusion ne sait pas
produire ça — il ne connaît ni la découpe en tuiles, ni la contrainte de raccord. La
stratégie est donc de ne JAMAIS lui faire dessiner la structure : on part du tileset
d'origine, qui sert de MASQUE, et on n'y remplace que le remplissage.

Deux modes, choisis par capture (voir le rapport de la Task 2) :

  generated  substitue le remplissage par une image générée (`--surface`), rendue
             raccordable par tuilage sans couture (`rendre_tuilable`).
  retint     repli procédural : re-teinte l'image d'origine vers une teinte fixe
             (blanc-bleuté), sans dépendre d'aucune génération. C'est le filet de
             sécurité si le rendu généré ne convainc pas — une décision prévue, pas un
             échec (voir le spec de l'île de neige).

Ce que le script préserve TOUJOURS de l'original, dans les deux modes :
  - l'alpha (la découpe exacte des tuiles) ;
  - les lignes de PAROI (`--wall-row` et au-delà) : la roche des falaises est déjà
    grise-bleutée dans le Free Pack, elle passe pour de la roche gelée sans y toucher ;
  - en mode `generated`, un LISERÉ de quelques pixels autour de chaque bord exposé (le
    contour sombre + le halo qui font le raccord visuel entre variantes d'autotile) —
    seul l'INTÉRIEUR de chaque tuile (le remplissage) devient la texture générée.

Aucune dépendance à numpy/scipy : le studio ne les installe pas, et une image de
tileset (576x384) est assez petite pour des boucles Python pures, comme `sprite.py`
le fait déjà pour les sprites.
"""

import argparse
import colorsys
from PIL import Image, ImageChops, ImageFilter


# --- rendre une image générée tuilable sans couture ------------------------------------------


def rendre_tuilable(im: Image.Image, taille: int, recadrage: float = 2 / 3) -> Image.Image:
    """Réduit `im` à `taille`x`taille` (densité de pixel du jeu, comme `sprite.py`) puis la
    rend tuilable : un modèle de diffusion ne connaît pas la contrainte de raccord, donc son
    bord droit ne prolonge jamais son bord gauche. La technique classique : décaler l'image
    d'une demi-tuile (les anciennes coutures se retrouvent au CENTRE, en croix) puis estomper
    cette croix par un flou. Une texture de neige/glace est du bruit sans motif directionnel
    fort : un flou local suffit à noyer la coupure, pas besoin d'un raccord "content-aware".

    Le lanceur `sprite` du studio pose ses générations sur un fond sombre, en carte à coins
    arrondis (voir `theme.json`, "video game sprite on a dark navy background") : les bords
    de l'image portent donc ce fond, jamais de la texture. On recadre d'abord sur le centre —
    sans ça, le décalage ramènerait ce fond sombre en croix noire au milieu du carreau, très
    exactement l'artefact que la première génération a produit ici.
    """
    im = im.convert("RGB")
    w, h = im.size
    cx, cy = w // 2, h // 2
    s = int(min(w, h) * recadrage / 2)
    im = im.crop((cx - s, cy - s, cx + s, cy + s))
    im = im.resize((taille, taille), Image.BOX)
    decale = ImageChops.offset(im, taille // 2, taille // 2)
    flou = decale.filter(ImageFilter.GaussianBlur(radius=max(1.0, taille / 16)))

    # Masque en croix : plein poids sur les deux lignes de couture (au centre après
    # décalage), qui s'annule à `bande` pixels de distance.
    bande = max(2, taille // 8)
    masque = Image.new("L", (taille, taille), 0)
    px = masque.load()
    c = taille // 2
    for y in range(taille):
        for x in range(taille):
            d = min(abs(x - c), abs(y - c))
            px[x, y] = max(0, round(255 * (1 - d / bande)))
    return Image.composite(flou, decale, masque)


def tuile_plein_cadre(im: Image.Image, largeur: int, hauteur: int) -> Image.Image:
    """Pave une image `largeur`x`hauteur` en répétant `im` (déjà tuilable) alignée sur la
    grille — chaque tuile du tileset commence donc à la MÊME phase (0,0), garantissant qu'une
    variante d'autotile répétée sur plusieurs cases (le cas fréquent : une case "totalement
    entourée" n'a aucune bordure) montre exactement le même motif, donc aucune couture."""
    taille = im.width
    fond = Image.new("RGB", (largeur, hauteur))
    for y in range(0, hauteur, taille):
        for x in range(0, largeur, taille):
            fond.paste(im, (x, y))
    return fond


# --- masque de structure : distance au bord exposé (érosion) ---------------------------------


def carte_distance(alpha: Image.Image, iterations: int) -> Image.Image:
    """Distance (en pas d'érosion 3x3, plafonnée à `iterations`) de chaque pixel opaque au
    bord ouvert le plus proche. Uniquement des opérations image (pas de boucle Python par
    pixel) : `MinFilter` érode le masque binaire d'un pixel par passe, et un pixel qui vient
    de "mourir" à la passe i avait une distance de i-1 — on l'écrit une seule fois, la
    première fois qu'il disparaît, avec `ImageChops.lighter` (idempotent : il ne peut
    disparaître qu'une fois)."""
    binaire = alpha.point(lambda v: 255 if v > 0 else 0)
    acc = Image.new("L", binaire.size, 0)
    courant = binaire
    for i in range(1, iterations + 1):
        erode = courant.filter(ImageFilter.MinFilter(3))
        morts = ImageChops.subtract(courant, erode)  # 255 là où on vient de mourir
        couche = morts.point(lambda v: (i - 1) if v else 0)
        acc = ImageChops.lighter(acc, couche)
        courant = erode
    # Ce qui survit à toutes les passes est à distance >= iterations (profond intérieur).
    survivants = courant.point(lambda v: iterations if v else 0)
    return ImageChops.lighter(acc, survivants)


# --- mode "generated" -------------------------------------------------------------------------


def composer_genere(
    base: Image.Image,
    surface_brute: Image.Image,
    tile: int,
    liseré: int,
    plume: int,
    ligne_paroi: int,
) -> Image.Image:
    """`base` = tileset d'origine (masque de structure). `surface_brute` = image générée par
    le studio. Le remplissage (l'intérieur de chaque tuile, hors liseré et hors parois)
    devient la texture générée ; tout le reste — alpha, liseré, parois — reste EXACTEMENT
    celui de l'original, pixel pour pixel, ce qui est ce qui garantit les raccords."""
    base = base.convert("RGBA")
    largeur, hauteur = base.size
    alpha = base.split()[3]

    swatch = rendre_tuilable(surface_brute, tile)
    genere_plein = tuile_plein_cadre(swatch, largeur, hauteur)

    # Poids de substitution : 0 sur le liseré (garde l'original), 255 en plein intérieur,
    # avec une plume de transition entre les deux pour qu'aucune limite nette ne se voie.
    dist = carte_distance(alpha, liseré + plume)
    poids = dist.point(lambda v: max(0, min(255, round((v - liseré) / plume * 255))))

    # Les lignes de paroi restent 100% originales ("parois... viennent de lui") : la roche du
    # Free Pack est déjà grise-bleutée, elle passe pour de la roche gelée sans y toucher, et
    # ne pas la reconstruire évite un risque de raccord supplémentaire sur la bande la plus
    # visible (les falaises).
    y_paroi = ligne_paroi * tile
    if y_paroi < hauteur:
        noir = Image.new("L", (largeur, hauteur - y_paroi), 0)
        poids.paste(noir, (0, y_paroi))

    rgb_original = base.convert("RGB")
    rgb_final = Image.composite(genere_plein, rgb_original, poids)

    sortie = Image.new("RGBA", (largeur, hauteur))
    sortie.paste(rgb_final, (0, 0))
    sortie.putalpha(alpha)
    return sortie


# --- mode "retint" (repli) ---------------------------------------------------------------------


def composer_reteinte(
    base: Image.Image, teinte: float, saturation: float, gamma: float
) -> Image.Image:
    """Repli procédural : re-teinte l'image ENTIÈRE (remplissage ET parois) vers une teinte
    fixe blanc-bleuté, en ne gardant de l'original que sa LUMINANCE — donc sa forme, son
    ombrage, ses bordures. Aucune génération : c'est le filet de sécurité si le rendu généré
    ne convainc pas (voir le spec de l'île de neige, "Repli tileset")."""
    base = base.convert("RGBA")
    l_canal = base.convert("L")

    table_r, table_g, table_b = [], [], []
    for v in range(256):
        l = (v / 255) ** gamma
        r, g, b = colorsys.hls_to_rgb(teinte / 360, l, saturation)
        table_r.append(round(r * 255))
        table_g.append(round(g * 255))
        table_b.append(round(b * 255))

    r = l_canal.point(table_r)
    g = l_canal.point(table_g)
    b = l_canal.point(table_b)
    sortie = Image.merge("RGB", (r, g, b)).convert("RGBA")
    sortie.putalpha(base.split()[3])
    return sortie


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", required=True, help="tileset Tiny Swords d'origine (masque)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--mode", choices=["generated", "retint"], required=True)
    ap.add_argument("--tile", type=int, default=64, help="taille d'une tuile, en px")
    ap.add_argument("--wall-row", type=int, default=4, help="première ligne de paroi")
    # mode generated
    ap.add_argument("--surface", help="image générée par le studio (mode generated)")
    ap.add_argument("--border", type=int, default=3, help="liseré gardé de l'original, en px")
    ap.add_argument("--feather", type=int, default=3, help="largeur de la plume de transition")
    # mode retint
    ap.add_argument("--hue", type=float, default=205, help="teinte cible, en degrés (0-360)")
    ap.add_argument("--sat", type=float, default=0.18, help="saturation cible (0-1)")
    ap.add_argument("--gamma", type=float, default=0.85, help="exposant appliqué à la luminance")
    args = ap.parse_args()

    base_im = Image.open(args.base)
    if args.mode == "generated":
        if not args.surface:
            ap.error("--surface est requis en mode generated")
        surface_im = Image.open(args.surface)
        resultat = composer_genere(
            base_im, surface_im, args.tile, args.border, args.feather, args.wall_row
        )
    else:
        resultat = composer_reteinte(base_im, args.hue, args.sat, args.gamma)

    resultat.save(args.out)
    print(f"{args.out}  {resultat.width}x{resultat.height}  mode={args.mode}")
