"""Transforme une image générée (illustration lissée sur fond uni) en sprite
jouable : détourage du fond, recadrage serré, réduction à la densité de pixels
du jeu, puis quantification des couleurs.

La réduction est le vrai travail : le modèle produit du 768² lissé, alors que le
reste du jeu est du pixel art de 64 à 192 px. Sans elle, le coffre serait dix
fois plus détaillé que les arbres qui l'entourent.
"""

import sys
from PIL import Image


def detourer(im, tolerance=42):
    """Rend transparent le fond, par propagation depuis les BORDS.

    Un simple test de couleur sur toute l'image perce le sujet : les zones
    d'ombre d'un sprite sur fond bleu nuit sont, elles aussi, du bleu nuit. Le
    couvercle du coffre ouvert se retrouvait criblé de trous. En ne propageant
    que depuis les bords, une ombre intérieure reste intacte — et une vraie
    ouverture, comme l'arche sous le couvercle relevé, est bien évidée puisqu'
    elle communique avec l'extérieur.
    """
    im = im.convert("RGBA")
    px = im.load()
    fond = px[0, 0][:3]
    proche = lambda c: abs(c[0] - fond[0]) + abs(c[1] - fond[1]) + abs(c[2] - fond[2]) <= tolerance

    vus = bytearray(im.width * im.height)
    pile = []
    for x in range(im.width):
        pile.append((x, 0))
        pile.append((x, im.height - 1))
    for y in range(im.height):
        pile.append((0, y))
        pile.append((im.width - 1, y))

    while pile:
        x, y = pile.pop()
        if not (0 <= x < im.width and 0 <= y < im.height):
            continue
        i = y * im.width + x
        if vus[i] or not proche(px[x, y]):
            continue
        vus[i] = 1
        px[x, y] = (0, 0, 0, 0)
        pile.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return im


def couleur_de_fond(im):
    """The flat background colour, read from the top-left corner of the ORIGINAL
    image. Read it before `detourer` runs: afterwards that corner is transparent,
    and a pocket pass that sampled it there would measure its distance to black."""
    return im.convert("RGB").getpixel((0, 0))


def vider_poches(im, fond, tolerance=20):
    """Clear pockets of background that the subject ENCLOSES, so the edge flood
    above can never reach them.

    A paraglider is the case that needed this: its risers converge on the grip,
    so the sky between the outermost two is walled in by canopy above and rope
    on both sides. `detourer` leaves it filled, and the sprite ships with a
    navy blob under its wing.

    Mechanically, this is nothing more than a plain per-pixel colour test — the
    same test `detourer`'s own docstring rejects for the FIRST pass — run a
    SECOND time, after `detourer`. The walk below only visits neighbours to
    avoid re-testing a pixel twice; every pixel it ever visits already passed
    `proche()` on its own, so "the whole component qualifies" is automatically
    true and gates nothing. There is no connected-component check here.

    What makes running that same test again SAFE, despite `detourer` having
    just rejected it, is what already ran before it, not anything this pass
    does itself: by the time `vider_poches` runs, `detourer` has already
    cleared every pixel reachable from the image border. A pixel still opaque
    here therefore has NO path to the edge — it is provably enclosed by the
    subject, not merely similarly coloured. Clearing it can only remove
    enclosed background, never open a real gap in the subject — but only as
    long as this pass's `tolerance` stays STRICTLY TIGHTER than `detourer`'s.
    Raising it to or past `detourer`'s 42 would let this pass clear pixels
    `detourer` itself would have kept as part of the subject, and the
    enclosure argument stops holding: treat that as a constraint on this
    function, not a knob to tune freely. Measured on the glider: the
    background sits under 20 and the subject's own outline starts at 30 —
    nothing in between, so 20 has margin without needing to be exact.

    Opt-in (see `__main__`): the sprites already committed were produced without
    it, and their source illustrations are not in the repo, so it cannot be
    proven a no-op for them.
    """
    im = im.convert("RGBA")
    px = im.load()
    proche = lambda c: abs(c[0] - fond[0]) + abs(c[1] - fond[1]) + abs(c[2] - fond[2]) <= tolerance

    # No collect-then-clear list: nothing downstream conditions on a pocket as a whole (see the
    # docstring above — every visited pixel already qualifies on its own), so each one is cleared
    # the moment it's found. `vus` still exists, to avoid re-testing a pixel already cleared.
    vus = bytearray(im.width * im.height)
    for y0 in range(im.height):
        for x0 in range(im.width):
            i0 = y0 * im.width + x0
            if vus[i0] or px[x0, y0][3] == 0 or not proche(px[x0, y0]):
                continue
            vus[i0] = 1
            px[x0, y0] = (0, 0, 0, 0)
            pile = [(x0, y0)]
            while pile:
                x, y = pile.pop()
                for vx, vy in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if not (0 <= vx < im.width and 0 <= vy < im.height):
                        continue
                    i = vy * im.width + vx
                    if vus[i] or px[vx, vy][3] == 0 or not proche(px[vx, vy]):
                        continue
                    vus[i] = 1
                    px[vx, vy] = (0, 0, 0, 0)
                    pile.append((vx, vy))
    return im


def recadrer(im, marge=2):
    boite = im.getbbox()
    if not boite:
        return im
    x0, y0, x1, y1 = boite
    return im.crop(
        (
            max(0, x0 - marge),
            max(0, y0 - marge),
            min(im.width, x1 + marge),
            min(im.height, y1 + marge),
        )
    )


def reduire(im, hauteur):
    """Réduction en moyenne (BOX) : c'est elle qui fabrique de vrais pixels.
    NEAREST garderait l'aliasing du rendu lissé au lieu de le fondre."""
    ratio = hauteur / im.height
    return im.resize((max(1, round(im.width * ratio)), hauteur), Image.BOX)


def durcir(im, seuil=128):
    """L'alpha redevient binaire : le jeu teste alphaTest, un bord dégradé y
    produirait un halo. Les pixels écartés sont aussi vidés de leur couleur pour
    ne pas laisser de frange sombre au filtrage."""
    im = im.convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255) if a >= seuil else (0, 0, 0, 0)
    return im


def quantifier(im, couleurs=24):
    """Palette réduite : c'est ce qui donne l'aplat franc du pixel art."""
    opaque = im.convert("RGB").quantize(colors=couleurs, method=Image.MEDIANCUT)
    opaque = opaque.convert("RGBA")
    px_src, px_dst = im.load(), opaque.load()
    for y in range(im.height):
        for x in range(im.width):
            if px_src[x, y][3] == 0:
                px_dst[x, y] = (0, 0, 0, 0)
    return opaque


# Contour relevé sur les vrais assets du pack : rgb(22,28,46) sur la souche, le
# caillou et l'arbre. C'est la signature graphique de Tiny Swords ; sans lui, un
# sprite se voit tout de suite comme rapporté.
CONTOUR = (22, 28, 46, 255)


def entourer(im):
    """Ajoute un liseré d'un pixel autour de la silhouette."""
    im = im.convert("RGBA")
    large = Image.new("RGBA", (im.width + 2, im.height + 2), (0, 0, 0, 0))
    large.paste(im, (1, 1))
    src, dst = large.copy().load(), large.load()
    for y in range(large.height):
        for x in range(large.width):
            if src[x, y][3] > 0:
                continue
            voisins = (
                (x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1),
                (x + 1, y + 1), (x - 1, y - 1), (x + 1, y - 1), (x - 1, y + 1),
            )
            for vx, vy in voisins:
                if 0 <= vx < large.width and 0 <= vy < large.height and src[vx, vy][3] > 0:
                    dst[x, y] = CONTOUR
                    break
    return large


if __name__ == "__main__":
    entree, sortie, hauteur = sys.argv[1], sys.argv[2], int(sys.argv[3])
    # Le 4e argument (optionnel) ajuste la palette : la génération produit un dégradé lisse,
    # et 24 couleurs suffisent souvent à garder ce lissé même après réduction de résolution —
    # le pack d'origine peint un arbre en une dizaine de teintes plates. Sans ce levier, seule
    # option pour égaler cette densité aurait été de retoucher les pixels à la main, exactement
    # ce que ce script existe pour éviter.
    couleurs = int(sys.argv[4]) if len(sys.argv) > 4 else 24
    # The 5th argument (optional) is "poches": pass it when the subject WALLS IN some
    # background — a paraglider's risers closing off the sky between them. Off by default
    # because the sprites already committed were made without it and their source
    # illustrations are not in the repo, so it cannot be proven a no-op for them.
    # See `vider_poches`. Any other value is a typo, not a silent no-op: reject it.
    if len(sys.argv) > 5 and sys.argv[5] != "poches":
        raise SystemExit(f'unrecognised 5th argument: {sys.argv[5]!r} (only "poches" is accepted)')
    poches = len(sys.argv) > 5
    source = Image.open(entree)
    fond = couleur_de_fond(source)
    detoure = detourer(source)
    if poches:
        detoure = vider_poches(detoure, fond)
    im = entourer(quantifier(durcir(reduire(recadrer(detoure), hauteur)), couleurs))
    im.save(sortie)
    print(f"{sortie}  {im.width}x{im.height}")
