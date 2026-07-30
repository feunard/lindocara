/**
 * `GET /api/join?party=<uuid>&hero=<uuid>` — the realtime admission hint. Runs the exact legacy
 * `handleJoinHero` reads (`AdmissionService`, shared with `WorldRoom.onJoin`) and answers with the
 * room the client should dial: `{ roomId: "partyId:mapId", channelPath: "/ws/world" }`. It
 * acquires NO presence and writes NO row — the socket's `onJoin` re-derives everything, so this
 * response is a hint the room re-validates, never an authorization.
 */
import { $inject, z } from "alepha";
import { $secure } from "alepha/security";
import { $action, HttpError } from "alepha/server";
import { type AdmissionErrorCode, AdmissionService } from "../realtime/AdmissionService.ts";

const STATUS_BY_ERROR: Record<AdmissionErrorCode, number> = {
  missing_hero: 400,
  invalid_hero: 400,
  forbidden: 403,
  not_found: 404,
};

export class JoinController {
  admissionService = $inject(AdmissionService);

  resolveJoin = $action({
    path: "/join",
    use: [$secure({})],
    schema: {
      query: z.object({ party: z.string().optional(), hero: z.string().optional() }),
      response: z.object({ roomId: z.string(), channelPath: z.string() }),
    },
    handler: async ({ query, user }) => {
      const resolution = await this.admissionService.resolveAdmission(
        user.id,
        query.party ?? null,
        query.hero ?? null,
        // The HTTP path disposes an expired playtest envelope exactly like legacy admission did.
        { cleanupExpiredTest: true },
      );
      if (!resolution.ok) {
        throw new HttpError({
          status: STATUS_BY_ERROR[resolution.error],
          error: resolution.error,
          message: resolution.error,
        });
      }
      return {
        roomId: `${resolution.join.partyId}:${resolution.join.mapId}`,
        channelPath: "/ws/world",
      };
    },
  });
}
