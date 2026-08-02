// Clavier AZERTY + QWERTY + flèches, plus la molette pour le zoom et le clic droit pour la
// rotation de caméra.

// ~170 px de glissé pour parcourir toute la plage de rotation.
const YAW_PER_PIXEL = -0.0021;

type Direction = "up" | "down" | "left" | "right";

const MOVE: Record<Direction, readonly string[]> = {
  up: ["KeyW", "KeyZ", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
  left: ["KeyA", "KeyQ", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
};

export interface InputHandlers {
  /** `N` : bascule jour / nuit. */
  onToggleMood?(): void;
  /** `H` : masque/affiche le bandeau d'aide. */
  onToggleHud?(): void;
}

export interface InputSample {
  /** Droite positif. */
  x: number;
  /** Vers le fond de la scène négatif (la caméra regarde -Z). */
  z: number;
  zoom: number;
  jump: boolean;
  attack: boolean;
  yaw: number;
  orbiting: boolean;
}

export interface Input {
  readonly state: { x: number; z: number; zoom: number; orbiting: boolean };
  sample(): InputSample;
}

export function createInput(canvas: HTMLCanvasElement, handlers: InputHandlers = {}): Input {
  const down = new Set<string>();
  const held = (dir: Direction) => MOVE[dir].some((code) => down.has(code));
  let jumpQueued = false;
  let attackQueued = false;

  addEventListener("keydown", (e) => {
    if (e.code === "Space") e.preventDefault(); // sinon la page défile
    if (e.repeat) return;
    down.add(e.code);
    if (e.code === "KeyN") handlers.onToggleMood?.();
    if (e.code === "KeyH") handlers.onToggleHud?.();
    if (e.code === "Space") jumpQueued = true;
    // `Digit1` est le code de la touche PHYSIQUE : la même sous l'index gauche en AZERTY comme
    // en QWERTY, sans avoir à traiter le `&` de l'un.
    if (e.code === "Digit1") attackQueued = true;
  });
  addEventListener("keyup", (e) => down.delete(e.code));
  addEventListener("blur", () => down.clear());

  const state = { x: 0, z: 0, zoom: 0, orbiting: false };

  // Glisser au bouton DROIT : rotation de la caméra. Le prix à payer, c'est le menu contextuel de
  // Chrome, qu'on supprime sur le canvas — sur macOS il s'ouvre dès l'enfoncement, donc sans ça il
  // apparaîtrait avant même le début du glissé. Il reste disponible partout ailleurs dans la page.
  let yawPixels = 0;
  let orbiting = false;
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 2) return;
    e.preventDefault();
    orbiting = true;
    state.orbiting = true;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (orbiting) yawPixels += e.movementX;
  });
  const stop = (e: PointerEvent) => {
    if (e.button === 2 || e.type === "pointercancel") orbiting = state.orbiting = false;
  };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
  // Le clic auxiliaire (milieu, droit) enclenche sinon le défilement automatique.
  canvas.addEventListener("auxclick", (e) => e.preventDefault());

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      state.zoom += e.deltaY * 0.02;
    },
    { passive: false },
  );

  return {
    state,
    sample() {
      let x = (held("right") ? 1 : 0) - (held("left") ? 1 : 0);
      let z = (held("down") ? 1 : 0) - (held("up") ? 1 : 0);
      const len = Math.hypot(x, z);
      if (len > 1) {
        x /= len;
        z /= len;
      }
      state.x = x;
      state.z = z;
      const zoom = state.zoom;
      state.zoom = 0;
      // Saut et attaque se consomment : un appui = un geste, même si la frame traîne. Maintenir
      // la touche ne les répète pas (`e.repeat` est filtré).
      const jump = jumpQueued;
      jumpQueued = false;
      const attack = attackQueued;
      attackQueued = false;
      const yaw = yawPixels * YAW_PER_PIXEL;
      yawPixels = 0;
      return { x, z, zoom, jump, attack, yaw, orbiting: state.orbiting };
    },
  };
}
