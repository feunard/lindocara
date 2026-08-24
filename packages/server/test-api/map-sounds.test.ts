import { UserController } from "alepha/api/users";
import { ServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestApp } from "./helpers.ts";

const PASSWORD = "Sup3rSecret";

let alepha: ReturnType<typeof createTestApp>;
let hostname: string;
let userCount = 0;

beforeEach(async () => {
  alepha = createTestApp();
  await alepha.start();
  hostname = alepha.inject(ServerProvider).hostname;
});

afterEach(async () => {
  await alepha.stop();
});

async function registerAndLogin(prefix: string): Promise<{ token: string; username: string }> {
  userCount += 1;
  const username = `${prefix}${userCount}`;
  const users = alepha.inject(UserController);
  const intent = await users.createRegistrationIntent.fetch({
    body: { username, password: PASSWORD },
  });
  await users.createUserFromIntent.fetch({
    body: { intentId: intent.data.intentId },
  });
  const login = await fetch(`${hostname}/_auth/token?provider=credentials`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const tokens = (await login.json()) as { access_token: string };
  return { token: tokens.access_token, username };
}

function authedFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${hostname}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...init.headers },
  });
}

function uploadForm(type = "audio/ogg", name = "Course héroïque.ogg"): FormData {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array([79, 103, 103, 83, 1, 2, 3])], { type }), name);
  return form;
}

describe("map sound library", () => {
  test("uploads, lists and streams a sound without exposing it in another author's library", async () => {
    const owner = await registerAndLogin("soundowner");
    const listener = await registerAndLogin("soundlistener");

    const uploaded = await authedFetch("/api/map-sounds", owner.token, {
      method: "POST",
      body: uploadForm(),
    });
    expect(uploaded.status).toBe(201);
    const track = (await uploaded.json()) as {
      id: string;
      title: string;
      author: string;
      src: string;
      loopable: boolean;
    };
    expect(track).toMatchObject({
      title: "Course héroïque",
      author: owner.username,
      loopable: true,
    });
    expect(track.id).toMatch(/^uploaded:/);

    const ownerLibrary = await authedFetch("/api/map-sounds", owner.token);
    expect(ownerLibrary.status).toBe(200);
    expect(await ownerLibrary.json()).toEqual([track]);

    const listenerLibrary = await authedFetch("/api/map-sounds", listener.token);
    expect(listenerLibrary.status).toBe(200);
    expect(await listenerLibrary.json()).toEqual([]);

    const streamed = await authedFetch(track.src, listener.token);
    expect(streamed.status).toBe(200);
    expect(new Uint8Array(await streamed.arrayBuffer())).toEqual(
      new Uint8Array([79, 103, 103, 83, 1, 2, 3]),
    );
  });

  test("rejects an unsupported upload type", async () => {
    const user = await registerAndLogin("soundtype");
    const response = await authedFetch("/api/map-sounds", user.token, {
      method: "POST",
      body: uploadForm("text/plain", "notes.txt"),
    });

    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ error: "map_sound_type" });
  });

  test("requires authentication for the library and uploaded bytes", async () => {
    expect((await fetch(`${hostname}/api/map-sounds`)).status).toBe(401);
    expect((await fetch(`${hostname}/api/map-sounds/not-a-track/content`)).status).toBe(401);
  });
});
