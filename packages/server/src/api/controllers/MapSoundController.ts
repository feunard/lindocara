import { uploadedMusicFileId, uploadedMusicTrack } from "@lindocara/engine/audio-catalog.js";
import { $inject, type FileLike, isFileLike, z } from "alepha";
import { FileStorageProvider } from "alepha/bucket";
import { $secure } from "alepha/security";
import { $action, HttpError } from "alepha/server";
import type { MultipartPart } from "alepha/server/multipart";

const MAP_SOUND_BUCKET = "map-sounds";
const MAP_SOUND_MAX_BYTES = 20 * 1024 * 1024;
const MAP_SOUND_TITLE_BYTES = 72;

const MAP_SOUND_EXTENSIONS = new Map<string, string>([
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/webm", "webm"],
  ["audio/mp4", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/aac", "aac"],
  ["audio/flac", "flac"],
  ["audio/x-flac", "flac"],
]);

const mapSoundSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
  src: z.string(),
  loopable: z.boolean(),
});

function mapSoundType(value: string): string {
  return value.toLowerCase().split(";", 1)[0]?.trim() ?? "";
}

function mapSoundTitle(filename: string): string {
  const withoutExtension = filename.replace(/\.[^.]+$/, "").trim();
  return withoutExtension || "Map sound";
}

function encodeMapSoundTitle(title: string): string {
  const characters = Array.from(title);
  let encoded = "";
  while (characters.length > 0) {
    encoded = Buffer.from(characters.join(""), "utf8").toString("base64url");
    if (encoded.length <= MAP_SOUND_TITLE_BYTES) break;
    characters.pop();
  }
  return encoded || Buffer.from("Map sound", "utf8").toString("base64url");
}

function decodeMapSoundTitle(fileId: string): string | null {
  const encodedWithExtension = fileId.split("~")[2];
  if (!encodedWithExtension) return null;
  const dot = encodedWithExtension.lastIndexOf(".");
  if (dot <= 0) return null;
  try {
    const decoded = Buffer.from(encodedWithExtension.slice(0, dot), "base64url").toString("utf8");
    return decoded.trim() || null;
  } catch {
    return null;
  }
}

function mapSoundOwner(fileId: string): string | null {
  return fileId.split("~", 1)[0] ?? null;
}

/**
 * Durable uploaded music for the map editor.
 *
 * The bytes belong in Alepha's blob provider rather than SQLite. Bay owns `STORAGE_PATH`, so local
 * blobs survive release swaps beside the managed database. The owner and display title are encoded
 * into the opaque, strictly validated file id: listing needs no second metadata store or migration,
 * while content remains readable to every signed-in player who can enter a shared adventure.
 */
export class MapSoundController {
  bucket = $inject(FileStorageProvider);

  getMapSounds = $action({
    path: "/map-sounds",
    use: [$secure({})],
    schema: { response: z.array(mapSoundSchema) },
    handler: async ({ user }) => {
      const ids = await this.bucket.list(MAP_SOUND_BUCKET);
      return ids.flatMap((fileId) => {
        if (mapSoundOwner(fileId) !== user.id) return [];
        const title = decodeMapSoundTitle(fileId);
        const track = title
          ? uploadedMusicTrack(fileId, title, user.username ?? user.name ?? "lindocara")
          : null;
        return track ? [track] : [];
      });
    },
  });

  uploadMapSound = $action({
    method: "POST",
    path: "/map-sounds",
    use: [$secure({})],
    schema: {
      body: z.object({ file: z.stream({ maxBytes: MAP_SOUND_MAX_BYTES }) }),
      response: mapSoundSchema,
    },
    handler: async ({ body, user, reply }) => {
      const file = this.asFile(body.file);
      if (file.size > MAP_SOUND_MAX_BYTES) {
        throw new HttpError({
          status: 413,
          error: "map_sound_too_large",
          message: "map sound exceeds 20 MiB",
        });
      }
      const extension = MAP_SOUND_EXTENSIONS.get(mapSoundType(file.type));
      if (!extension) {
        throw new HttpError({
          status: 415,
          error: "map_sound_type",
          message: "unsupported map sound type",
        });
      }
      const title = mapSoundTitle(file.name);
      const fileId = `${user.id}~${crypto.randomUUID()}~${encodeMapSoundTitle(title)}.${extension}`;
      const track = uploadedMusicTrack(fileId, title, user.username ?? user.name ?? "lindocara");
      if (!track) {
        throw new HttpError({
          status: 400,
          error: "map_sound_invalid",
          message: "invalid map sound identifier",
        });
      }
      await this.bucket.upload(MAP_SOUND_BUCKET, file, fileId);
      reply.setStatus(201);
      return track;
    },
  });

  streamMapSound = $action({
    path: "/map-sounds/:id/content",
    use: [$secure({})],
    schema: {
      params: z.object({ id: z.string() }),
      response: z.file(),
    },
    handler: async ({ params }) => {
      if (!uploadedMusicFileId(`uploaded:${params.id}`)) this.notFound();
      try {
        return await this.bucket.download(MAP_SOUND_BUCKET, params.id);
      } catch {
        return this.notFound();
      }
    },
  });

  /**
   * Dresses a streamed multipart part as the one-shot `FileLike` the blob provider consumes.
   */
  asFile(input: MultipartPart | FileLike): FileLike {
    if (isFileLike(input)) return input;
    const part = input;
    return {
      name: part.filename ?? "map-sound",
      type: part.mediaType || "application/octet-stream",
      size: 0,
      lastModified: Date.now(),
      stream: () =>
        new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for await (const chunk of part.data) controller.enqueue(chunk);
              controller.close();
            } catch (error) {
              controller.error(error);
            }
          },
        }) as never,
      arrayBuffer: async () => {
        throw new Error("a streamed map sound can only be consumed once");
      },
      text: async () => {
        throw new Error("a streamed map sound is not text");
      },
    };
  }

  notFound(): never {
    throw new HttpError({
      status: 404,
      error: "map_sound_not_found",
      message: "map sound not found",
    });
  }
}
