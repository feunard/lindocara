import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, authErrorText, errorCode, register } from "../src/api.js";
import { t } from "../src/i18n.js";

/**
 * `HttpError.toJSON` names an uncoded failure by STATUS, so every 409 the app can raise arrives at
 * the client as the bare class name `ConflictError` — the ORM's `DbConflictError`/`DbForeignKeyError`
 * included. Mapping that name straight onto the registration message made a foreign-key failure on
 * `POST /api/adventures` tell the author their username was taken.
 */
describe("conflict error codes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not read an uncoded conflict as a taken username", () => {
    expect(authErrorText("ConflictError")).not.toBe(t("auth.error.username_taken"));
  });

  it("still names a taken username for the app's own machine code", () => {
    expect(authErrorText("username_taken")).toBe(t("auth.error.username_taken"));
  });

  it("turns the registration route's framework conflict into the username code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "ConflictError", message: "conflict" }, { status: 409 }),
      ),
    );

    const caught = await register("wren", "hunter2hunter2").catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ApiError);
    expect(errorCode(caught)).toBe("username_taken");
    expect(authErrorText(errorCode(caught))).toBe(t("auth.error.username_taken"));
  });
});
