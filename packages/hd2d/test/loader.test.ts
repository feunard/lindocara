import { describe, expect, it } from "vitest";
import { fetchAll } from "../src/loader.js";

/** Une réponse qui livre son corps en morceaux de tailles données, avec un content-length honnête. */
function stubFetch(chunks: Record<string, number[]>, { withLength = true } = {}) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const sizes = chunks[url] ?? [];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const n of sizes) controller.enqueue(new Uint8Array(n));
        controller.close();
      },
    });
    const total = sizes.reduce((a, b) => a + b, 0);
    return new Response(body, {
      headers: withLength ? { "content-length": String(total) } : {},
    });
  };
}

describe("fetchAll", () => {
  it("pèse le pourcentage en octets et non en morceaux", async () => {
    const seen: number[] = [];
    const blobs = await fetchAll(["/x"], (p) => seen.push(p), {
      fetch: stubFetch({ "/x": [200, 300, 500] }),
    });
    // Trois morceaux inégaux : un compteur de morceaux dirait 1/3, 2/3, 1.
    expect(seen).toEqual([0.2, 0.5, 1, 1]);
    expect(blobs.get("/x")?.size).toBe(1000);
  });

  it("ne recule jamais", async () => {
    const seen: number[] = [];
    await fetchAll(["/a", "/b"], (p) => seen.push(p), {
      fetch: stubFetch({ "/a": [100], "/b": [400, 500] }),
    });
    expect(seen).toEqual([...seen].sort((x, y) => x - y));
    expect(seen.at(-1)).toBe(1);
  });

  it("sans content-length, lit d'un bloc plutôt que de mentir sur le total", async () => {
    const seen: number[] = [];
    const blobs = await fetchAll(["/z"], (p) => seen.push(p), {
      fetch: stubFetch({ "/z": [64] }, { withLength: false }),
    });
    expect(blobs.get("/z")?.size).toBe(64);
    expect(seen).toEqual([1]);
  });

  // Revue finale (point F) : un 404/500 ne lève pas côté `fetch` — sans contrôle de `r.ok`, la
  // réponse d'erreur (souvent une page HTML) devenait un `Blob` comme un autre et ne ressortait
  // que bien plus tard, en `img.onerror` opaque, sans l'URL ni le statut dans le message.
  it("lève avec l'URL et le statut sur un 404, plutôt que de livrer la page d'erreur comme un blob", async () => {
    const fetch404 = async (): Promise<Response> => new Response("not found", { status: 404 });
    await expect(fetchAll(["/manquant.png"], () => {}, { fetch: fetch404 })).rejects.toThrow(
      /\/manquant\.png.*404/,
    );
  });
});
