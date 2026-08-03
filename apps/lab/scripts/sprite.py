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
    im = entourer(quantifier(durcir(reduire(recadrer(detourer(Image.open(entree))), hauteur)), couleurs))
    im.save(sortie)
    print(f"{sortie}  {im.width}x{im.height}")
