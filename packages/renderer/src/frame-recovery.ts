/**
 * A Pixi ticker listener must never let an application frame exception escape: Pixi schedules its
 * next RAF after its listeners run, so one uncaught render error can stop the visual loop while the
 * WebSocket and React UI continue normally.
 */
export function runRecoverableFrame(
  frame: () => void,
  recover: () => void,
  report: (error: unknown) => void,
): boolean {
  try {
    frame();
    return true;
  } catch (error) {
    try {
      recover();
    } catch (recoveryError) {
      report(
        new AggregateError(
          [error, recoveryError],
          "Renderer frame and visual recovery both failed",
        ),
      );
      return false;
    }
    report(error);
    return false;
  }
}
