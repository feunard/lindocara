import { describe, expect, it } from "vitest";

import { type Zone, zoneAt } from "../src/world/zones.js";

const DEFAUT: Zone = {
  nom: "large",
  centre: [0, 0],
  rayon: Infinity,
  musique: null,
  nappe: "jour",
  souffle: 1,
};
const POLAIRE: Zone = {
  nom: "polaire",
  centre: [0, -26],
  rayon: 12,
  musique: "neige",
  nappe: "polaire",
  souffle: 2,
};
const zones = [POLAIRE, DEFAUT] as const;

describe("zoneAt", () => {
  it("rend la zone qui contient le point", () => {
    expect(zoneAt(zones, 0, -26).nom).toBe("polaire");
    expect(zoneAt(zones, 0, 0).nom).toBe("large");
  });

  it("rend toujours une zone, jamais null", () => {
    // Un appelant qui doit tester la nullité à chaque image finit par oublier une fois.
    expect(zoneAt(zones, 999, 999).nom).toBe("large");
  });

  it("prend la PREMIÈRE zone qui contient le point, pour que l'ordre soit la priorité", () => {
    const large: Zone = { ...POLAIRE, nom: "englobante", rayon: 100 };
    expect(zoneAt([POLAIRE, large, DEFAUT], 0, -26).nom).toBe("polaire");
    expect(zoneAt([large, POLAIRE, DEFAUT], 0, -26).nom).toBe("englobante");
  });

  it("inclut le bord : à rayon exact on est dedans", () => {
    expect(zoneAt(zones, 0, -26 + 12).nom).toBe("polaire");
  });

  it("porte le taux de souffle, qui n'est pas qu'une affaire de musique", () => {
    expect(zoneAt(zones, 0, -26).souffle).toBe(2);
    expect(zoneAt(zones, 0, 0).souffle).toBe(1);
  });
});
