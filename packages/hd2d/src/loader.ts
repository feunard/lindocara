/**
 * Téléchargement de tous les assets avec un vrai pourcentage.
 *
 * Le suivi se fait en OCTETS, pas en nombre de fichiers : deux nappes d'ambiance pèsent à elles
 * seules plus que les soixante autres fichiers réunis. Compter les fichiers ferait filer la barre
 * à 96 % en une fraction de seconde, puis la laisserait coincée là pendant tout le reste du
 * chargement — c'est exactement la barre de progression qu'on ne veut pas.
 *
 * Les en-têtes HTTP reviennent bien avant les corps : on connaît donc le total dès le départ, et le
 * pourcentage ne recule jamais.
 */
export interface FetchAllOptions {
  /** Injecté pour les tests. En production c'est le `fetch` du navigateur. */
  fetch?: typeof globalThis.fetch;
}

export async function fetchAll(
  urls: readonly string[],
  onProgress: (fraction: number) => void,
  options: FetchAllOptions = {},
): Promise<Map<string, Blob>> {
  const doFetch = options.fetch ?? globalThis.fetch;
  // Un 404/500 ne lève pas côté `fetch` — sans ce contrôle, la réponse d'erreur (souvent une page
  // HTML) devenait un `Blob` comme un autre, ressortait bien plus tard en `img.onerror` opaque, et
  // rien dans le message ne disait quelle URL ni quel statut avaient échoué.
  const reponses = await Promise.all(
    urls.map(async (u) => {
      const r = await doFetch(u);
      if (!r.ok) throw new Error(`Échec du téléchargement de ${u} : HTTP ${r.status}`);
      return r;
    }),
  );
  const total = reponses.reduce((n, r) => n + (Number(r.headers.get("content-length")) || 0), 0);
  let recus = 0;

  const lire = async (r: Response): Promise<Blob> => {
    // Sans `content-length` (compression à la volée), on ne peut pas pondérer : on lit d'un bloc
    // et le fichier ne compte que pour son arrivée.
    if (!r.body || !total) return r.blob();
    const morceaux: Uint8Array[] = [];
    const lecteur = r.body.getReader();
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      morceaux.push(value);
      recus += value.length;
      onProgress(Math.min(1, recus / total));
    }
    return new Blob(morceaux as BlobPart[]);
  };

  const blobs = await Promise.all(reponses.map(lire));
  onProgress(1);
  return new Map(urls.map((u, i) => [u, blobs[i] as Blob]));
}
