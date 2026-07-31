import { $inject, type Alepha, AlephaError } from "alepha";
import { ViteUtils } from "../services/ViteUtils.ts";
import type { AppEntry } from "./AppEntryProvider.ts";

export class ViteBuildProvider {
  protected alepha?: Alepha;
  protected appEntry?: AppEntry;
  protected readonly viteUtils = $inject(ViteUtils);

  public async init(opts: { entry: AppEntry }) {
    const alepha = await this.viteUtils.runAlepha({
      entry: opts.entry,
      mode: "production",
    });

    this.alepha = alepha;
    this.appEntry = opts.entry;

    return alepha;
  }

  public hasClient(): boolean {
    if (!this.alepha) {
      throw new AlephaError("ViteBuildProvider not initialized");
    }
    // A dedicated browser entry is an explicit client contract. Depending only on whether the
    // server-side analysis happened to instantiate ReactServerProvider makes the result sensitive
    // to asynchronous/composed router registration and can silently omit the complete client and
    // public-assets bundle from an otherwise successful build.
    if (this.appEntry?.browser) {
      return true;
    }
    try {
      this.alepha.inject("ReactServerProvider");
      return true;
    } catch {
      return false;
    }
  }
}
