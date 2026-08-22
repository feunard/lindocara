import { $hook, $inject } from "alepha";

import { MapService } from "../services/MapService.ts";

/** Compiles pre-HD-2D map rows once migrations and repositories are ready. */
export class HeightfieldBackfillProvider {
  mapService = $inject(MapService);

  ready = $hook({
    on: "ready",
    handler: async () => {
      await this.mapService.backfillMissingHeightfields();
    },
  });
}
