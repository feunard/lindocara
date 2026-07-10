import { useEffect } from "react";
import { type EventLine, useUiStore } from "../store.js";

const MARKERS: Record<EventLine["tone"], string> = {
  good: "+ ",
  bad: "! ",
  info: "* ",
};

function EventItem({ line }: { line: EventLine }) {
  const removeEvent = useUiStore((s) => s.removeEvent);

  useEffect(() => {
    const timer = window.setTimeout(() => removeEvent(line.id), 6_000);
    return () => window.clearTimeout(timer);
  }, [line.id, removeEvent]);

  return <div className={`event ${line.tone}`}>{`${MARKERS[line.tone]}${line.text}`}</div>;
}

export function EventLog() {
  const events = useUiStore((s) => s.events);

  return (
    <div id="event-log" aria-live="polite">
      {[...events].reverse().map((line) => (
        <EventItem key={line.id} line={line} />
      ))}
    </div>
  );
}
