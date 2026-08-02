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

Ce que le script préserve TOUJOURS de l'original, dans les deux modes — sa FORME, jamais sa
COULEUR :
  - l'alpha (la découpe exacte des tuiles) est copié tel quel ;
  - la forme du contour des lignes de PAROI (`--wall-row` et au-delà) et, en mode `generated`,
    du LISERÉ de quelques pixels autour de chaque bord exposé (le contour sombre + le halo qui
    font le raccord visuel entre variantes d'autotile) — mais teintée vers le blanc-bleuté, pas
    laissée telle quelle. Une relecture (Task 2, round 1) a montré que ce liseré et les pièces
    d'angle en bas des lignes de paroi (le rebord touffu du bloc "cliff-edge", la découpe en
    coin du bloc "water-edge") sont VERT olive dans le Free Pack — de l'herbe, pas de la roche —
    et que les laisser intacts peignait un liseré végétal tout autour d'une île de neige. Seul
    l'INTÉRIEUR profond de chaque tuile (le remplissage, en mode `generated`) devient la texture
    générée ; tout le reste garde son alpha et sa LUMINANCE d'origine (donc sa forme, son
    ombrage, le raccord entre variantes) mais sa teinte devient blanc-bleutée — `teindre_rgb` est
    le point commun aux deux modes.

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


# --- teinte partagée : garder la luminance (donc la forme), remplacer la couleur ---------------


def teindre_rgb(base: Image.Image, teinte: float, saturation: float, gamma: float) -> Image.Image:
    """Reteint une image vers une teinte fixe en ne gardant de l'original que sa LUMINANCE — donc
    sa forme, son ombrage, ses bordures, jamais sa couleur d'origine. Une table à 256 entrées
    (une par niveau de luminance possible) appliquée via `Image.point()` : rapide (calcul en C
    dans PIL), pas de boucle Python par pixel malgré le passage par `colorsys` (256 appels,
    pas 576*384).

    Point commun aux deux modes du script : c'est LA MÊME fonction qui fabrique le repli complet
    (`composer_reteinte`) et qui reteint le liseré/les parois conservés en mode `generated`
    (`composer_genere`) — la seule différence entre les deux usages est la région à laquelle le
    résultat s'applique, pas la transformation elle-même.
    """
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
    return Image.merge("RGB", (r, g, b))


# --- mode "generated" -------------------------------------------------------------------------


def composer_genere(
    base: Image.Image,
    surface_brute: Image.Image,
    tile: int,
    liseré: int,
    plume: int,
    ligne_paroi: int,
    teinte: float,
    saturation: float,
    gamma: float,
) -> Image.Image:
    """`base` = tileset d'origine (masque de structure). `surface_brute` = image générée par
    le studio. Le remplissage (l'intérieur profond de chaque tuile, hors liseré et hors parois)
    devient la texture générée ; le liseré et les parois gardent l'alpha et la LUMINANCE — donc
    la forme et le raccord — de l'original, mais teints vers `teinte`/`saturation` (voir
    `teindre_rgb`) plutôt que laissés dans leur couleur d'origine (round 1 de revue : ce liseré
    est vert olive dans le Free Pack, pas gris-bleuté — le laisser intact peignait une bordure
    végétale tout autour d'une île de neige)."""
    base = base.convert("RGBA")
    largeur, hauteur = base.size
    alpha = base.split()[3]

    swatch = rendre_tuilable(surface_brute, tile)
    genere_plein = tuile_plein_cadre(swatch, largeur, hauteur)

    # Poids de substitution : 0 sur le liseré (garde la base TEINTÉE, pas l'original brut), 255
    # en plein intérieur, avec une plume de transition entre les deux pour qu'aucune limite nette
    # ne se voie.
    dist = carte_distance(alpha, liseré + plume)
    poids = dist.point(lambda v: max(0, min(255, round((v - liseré) / plume * 255))))

    # Les lignes de paroi restent à poids 0 ("parois... viennent de lui" pour la FORME) : la
    # reconstruction en texture générée y ajouterait un risque de raccord supplémentaire sur la
    # bande la plus visible (les falaises). Mais "viennent de lui" ne veut dire que la forme —
    # voir `teindre_rgb` juste en dessous, qui les reteint comme le reste.
    y_paroi = ligne_paroi * tile
    if y_paroi < hauteur:
        noir = Image.new("L", (largeur, hauteur - y_paroi), 0)
        poids.paste(noir, (0, y_paroi))

    rgb_teinte = teindre_rgb(base, teinte, saturation, gamma)
    rgb_final = Image.composite(genere_plein, rgb_teinte, poids)

    sortie = Image.new("RGBA", (largeur, hauteur))
    sortie.paste(rgb_final, (0, 0))
    sortie.putalpha(alpha)
    return sortie


# --- mode "retint" (repli) ---------------------------------------------------------------------


def composer_reteinte(
    base: Image.Image, teinte: float, saturation: float, gamma: float
) -> Image.Image:
    """Repli procédural : re-teinte l'image ENTIÈRE (remplissage ET parois) vers une teinte
    fixe blanc-bleuté — `teindre_rgb` appliquée à toute l'image, sans aucune génération. C'est
    le filet de sécurité si le rendu généré ne convainc pas (voir le spec de l'île de neige,
    "Repli tileset")."""
    base = base.convert("RGBA")
    sortie = teindre_rgb(base, teinte, saturation, gamma).convert("RGBA")
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
    # teinte : le repli ENTIER en mode retint, le liseré + les parois conservés en mode generated
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
            base_im,
            surface_im,
            args.tile,
            args.border,
            args.feather,
            args.wall_row,
            args.hue,
            args.sat,
            args.gamma,
        )
    else:
        resultat = composer_reteinte(base_im, args.hue, args.sat, args.gamma)

    resultat.save(args.out)
    print(f"{args.out}  {resultat.width}x{resultat.height}  mode={args.mode}")
