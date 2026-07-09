/**
 * PixiJS rendering: a white world, black squares, nothing else.
 *
 * Pixi is used as a renderer, not as an engine — it owns no game loop and no state. The
 * server decides where things are; this draws them. That separation is what lets the
 * netcode evolve without touching the render layer.
 */

import { Application, Container, Graphics, Text } from "pixi.js";
import type { PlayerSnapshot } from "../shared/protocol.js";
import { PLAYER_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from "../shared/simulation.js";

const BACKGROUND = 0xffffff;
const SQUARE = 0x000000;
const BORDER = 0xe0e0e0;
const LABEL = 0x555555;

interface PlayerView {
  container: Container;
  label: Text;
}

export class Renderer {
  #app: Application;
  #world = new Container();
  #views = new Map<string, PlayerView>();

  private constructor(app: Application) {
    this.#app = app;
  }

  static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    const app = new Application();
    await app.init({
      canvas,
      background: BACKGROUND,
      resizeTo: window,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });

    const renderer = new Renderer(app);
    renderer.#buildWorld();
    window.addEventListener("resize", () => renderer.#fitWorld());
    return renderer;
  }

  #buildWorld(): void {
    const bounds = new Graphics()
      .rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
      .fill(BACKGROUND)
      .stroke({ width: 2, color: BORDER });

    this.#world.addChild(bounds);
    this.#app.stage.addChild(this.#world);
    this.#fitWorld();
  }

  /** Letterbox the world into the viewport so every player sees the same playing field. */
  #fitWorld(): void {
    const { width, height } = this.#app.screen;
    const scale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
    this.#world.scale.set(scale);
    this.#world.position.set(
      (width - WORLD_WIDTH * scale) / 2,
      (height - WORLD_HEIGHT * scale) / 2,
    );
  }

  #createView(player: PlayerSnapshot): PlayerView {
    const container = new Container();

    const square = new Graphics().rect(0, 0, PLAYER_SIZE, PLAYER_SIZE).fill(SQUARE);
    container.addChild(square);

    const label = new Text({
      text: player.nick,
      style: { fontFamily: "monospace", fontSize: 13, fill: LABEL },
    });
    label.anchor.set(0.5, 1);
    label.position.set(PLAYER_SIZE / 2, -4);
    container.addChild(label);

    this.#world.addChild(container);
    return { container, label };
  }

  /** Reconcile the scene graph with the players the server says exist. */
  render(players: PlayerSnapshot[]): void {
    const present = new Set<string>();

    for (const player of players) {
      present.add(player.id);

      let view = this.#views.get(player.id);
      if (!view) {
        view = this.#createView(player);
        this.#views.set(player.id, view);
      } else if (view.label.text !== player.nick) {
        view.label.text = player.nick;
      }

      view.container.position.set(player.x, player.y);
    }

    for (const [id, view] of this.#views) {
      if (present.has(id)) continue;
      view.container.destroy({ children: true });
      this.#views.delete(id);
    }
  }

  /** Drives `onFrame` once per display refresh. */
  onFrame(callback: (nowMs: number) => void): void {
    this.#app.ticker.add(() => callback(performance.now()));
  }

  destroy(): void {
    this.#app.destroy(true, { children: true });
  }
}
