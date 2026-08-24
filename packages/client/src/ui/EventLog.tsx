import {
  MOVEMENT_EFFECT_DEFAULTS,
  type MovementEffectKind,
} from "@lindocara/engine/movement-effects.js";
import { useEffect, useState } from "react";

import { t, useLocale, type MessageKey } from "../i18n.js";
import { type EventLine, useUiStore } from "../store.js";

const MARKERS: Record<EventLine["tone"], string> = {
  good: "+ ",
  bad: "! ",
  info: "* ",
};

const MOVEMENT_EFFECT_LABELS: Record<MovementEffectKind, MessageKey> = {
  speed_boost: "hud.movementEffect.speed_boost",
  light_gravity: "hud.movementEffect.light_gravity",
  double_jump: "hud.movementEffect.double_jump",
  speed_slow: "hud.movementEffect.speed_slow",
  heavy_gravity: "hud.movementEffect.heavy_gravity",
  inverted_controls: "hud.movementEffect.inverted_controls",
};

interface LocalMovementEffect {
  kind: MovementEffectKind;
  localUntil: number;
}

function MovementEffectNotices() {
  const locale = useLocale();
  const snapshot = useUiStore((state) => state.selfState);
  const [effects, setEffects] = useState<LocalMovementEffect[]>([]);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    const receivedAt = performance.now();
    const serverNow = snapshot?.serverNow ?? Date.now();
    setEffects(
      (snapshot?.movementEffects ?? []).flatMap((effect) => {
        const remaining = effect.until - serverNow;
        return remaining > 0 ? [{ kind: effect.kind, localUntil: receivedAt + remaining }] : [];
      }),
    );
    setNow(receivedAt);
  }, [snapshot]);

  useEffect(() => {
    if (effects.length === 0) return;
    const timer = window.setInterval(() => {
      const nextNow = performance.now();
      setNow(nextNow);
      setEffects((current) => {
        if (!current.some((effect) => effect.localUntil <= nextNow)) return current;
        return current.filter((effect) => effect.localUntil > nextNow);
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [effects.length]);

  return effects.flatMap((effect) => {
    const remaining = effect.localUntil - now;
    if (remaining <= 0) return [];
    const beneficial = MOVEMENT_EFFECT_DEFAULTS[effect.kind].beneficial;
    const seconds = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(remaining / 1_000);
    return [
      <div
        key={effect.kind}
        className={`event movement-effect-notice ${beneficial ? "good" : "bad"}`}
        data-movement-effect={beneficial ? "bonus" : "malus"}
        data-text-surface="information"
        data-text-tone={beneficial ? "good" : "bad"}
      >
        {t(beneficial ? "hud.movementEffect.bonus" : "hud.movementEffect.malus", {
          effect: t(MOVEMENT_EFFECT_LABELS[effect.kind]),
          seconds,
        })}
      </div>,
    ];
  });
}

function EventItem({ line }: { line: EventLine }) {
  const removeEvent = useUiStore((s) => s.removeEvent);

  useEffect(() => {
    const timer = window.setTimeout(() => removeEvent(line.id), 6_000);
    return () => window.clearTimeout(timer);
  }, [line.id, removeEvent]);

  return (
    <div
      className={`event ${line.tone}`}
      data-text-surface="information"
      data-text-tone={line.tone}
    >
      {`${MARKERS[line.tone]}${line.text}`}
    </div>
  );
}

export function EventLog() {
  const events = useUiStore((s) => s.events);

  return (
    <div id="event-log" aria-live="polite">
      <MovementEffectNotices />
      {[...events].reverse().map((line) => (
        <EventItem key={line.id} line={line} />
      ))}
    </div>
  );
}
