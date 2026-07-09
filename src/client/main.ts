/**
 * Wires the three pieces together: prove who you are, open the socket, draw what arrives.
 */

import { trackInput } from "./input.js";
import { WorldClient } from "./net.js";
import { Renderer } from "./renderer.js";
import "./style.css";

interface Me {
  id: string;
  nick: string;
}

/** Resolve an element the page is required to contain, with a non-nullable type. */
function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`index.html is missing ${selector}`);
  return element;
}

const canvas = required<HTMLCanvasElement>("#stage");
const loginPanel = required<HTMLDivElement>("#login");
const loginForm = required<HTMLFormElement>("#login-form");
const nicknameField = required<HTMLInputElement>("#nickname");
const loginError = required<HTMLParagraphElement>("#login-error");
const statusBar = required<HTMLDivElement>("#status");

function setStatus(text: string): void {
  statusBar.textContent = text;
}

async function fetchMe(): Promise<Me | null> {
  const response = await fetch("/api/me");
  if (!response.ok) return null;
  return (await response.json()) as Me;
}

async function login(nickname: string): Promise<Me> {
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  });

  const body = (await response.json()) as Me | { error: string };
  if (!response.ok) throw new Error("error" in body ? body.error : "login failed");
  return body as Me;
}

async function play(me: Me): Promise<void> {
  loginPanel.hidden = true;
  setStatus(`connecting as ${me.nick}…`);

  const renderer = await Renderer.create(canvas);
  const client = new WorldClient();
  const input = trackInput();

  const connection = client.connect({
    onWelcome: () => setStatus(`${me.nick} — WASD or arrow keys`),
    onClose: (reason) => {
      input.stop();
      setStatus(`disconnected: ${reason}. reload to rejoin.`);
    },
  });

  renderer.onFrame((now, dt) => {
    // Predict first, then draw: your square must reflect the key you are holding this frame,
    // not the one the server last heard about.
    client.update(input.current(), dt);
    renderer.render(client.sample(now));
  });

  window.addEventListener("beforeunload", () => connection.close());

  // A handle for measuring input latency and interpolation from the outside. Dev builds only.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__lindocara = {
      all: () => client.sample(performance.now()),
      self: () => client.sample(performance.now()).find((p) => p.id === client.selfId),
    };
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";

  const nickname = nicknameField.value.trim();
  const submit = loginForm.querySelector("button");
  if (submit) submit.disabled = true;

  try {
    await play(await login(nickname));
  } catch (error) {
    loginError.textContent = error instanceof Error ? error.message : "login failed";
    if (submit) submit.disabled = false;
  }
});

// An existing signed cookie means we can skip straight into the world.
const existing = await fetchMe();
if (existing) {
  await play(existing);
} else {
  loginPanel.hidden = false;
  nicknameField.focus();
}
