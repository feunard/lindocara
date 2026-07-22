import { INTERIORS } from "@lindocara/renderer/interiors.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";

/** The interior threshold panel: what you see when you look inside a door without entering
 *  the world proper. Pure render from the store — the E-key/Escape handlers in session.ts
 *  and the close button below both just write `interiorDoorId`. */
export function InteriorOverlay() {
  useLocale();
  const interiorDoorId = useUiStore((s) => s.interiorDoorId);
  const setInteriorDoorId = useUiStore((s) => s.setInteriorDoorId);

  const door = INTERIORS.find((candidate) => candidate.id === interiorDoorId);
  if (!door) return null;

  return (
    <section id="interior" data-room={door.id}>
      <div className="interior-room">
        <header>
          <span id="interior-title">{t(door.nameKey)}</span>
          <button
            id="interior-close"
            type="button"
            aria-label={t("interior.close")}
            title={t("interior.close")}
            onClick={() => setInteriorDoorId(null)}
          >
            &times;
          </button>
        </header>
        <div className="room-grid" aria-hidden="true">
          <span className="room-object hearth" />
          <span className="room-object table" />
          <span className="room-object npc" />
          <span className="room-object chest" />
          <span className="room-object bench" />
          <span className="room-object rug" />
        </div>
        <p id="interior-copy">{t(door.copyKey)}</p>
      </div>
    </section>
  );
}
