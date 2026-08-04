export interface GlideRules {
  /** Fraction de gravité appliquée quand le planeur est actif (0..1). */
  gravityScale: number;
  /** Réserve initiale de planeur (secondes). */
  reserve: number;
  /** Vitesse de consommation de la réserve (réserve/seconde). */
  burnRate: number;
  /** Condition de chute minimale pour ouvrir : `vy <= -activationDescent`. */
  activationDescent: number;
  /** Vitesse de chute max atteignable avec le planeur actif. */
  maxFallSpeed: number;
  /** Facteur de contrôle horizontal quand le planeur est actif. */
  airControl: number;
}

export interface GlideState {
  active: boolean;
  reserve: number;
}

export interface GlideInput {
  jumpHold: boolean;
  airborne: boolean;
  swimming: boolean;
  indoors: boolean;
  /** Vitesse verticale actuelle juste avant gravité. */
  vy: number;
}

export function createGlideState(rules: GlideRules): GlideState {
  return { active: false, reserve: rules.reserve };
}

export function resetGlideState(rules: GlideRules): GlideState {
  return { active: false, reserve: rules.reserve };
}

/** Met à jour l'état du planeur.
 * - pas de réactivation au sol, en eau ou en intérieur.
 * - activation seulement en descente.
 * - la réserve se consomme seulement tant que la touche est maintenue.
 * - le planeur s'arrête immédiatement quand la touche est relâchée.
 */
export function updateGlideState(
  state: GlideState,
  dt: number,
  input: GlideInput,
  rules: GlideRules,
): GlideState {
  if (!input.airborne || input.swimming || input.indoors) return resetGlideState(rules);

  const canActivate = input.jumpHold && input.vy <= -rules.activationDescent && state.reserve > 0;

  if (state.active) {
    if (!input.jumpHold) return { ...state, active: false };
    const reserve = Math.max(0, state.reserve - rules.burnRate * dt);
    return reserve <= 0 ? { active: false, reserve: 0 } : { ...state, reserve };
  }

  return canActivate ? { active: true, reserve: state.reserve } : state;
}

/** Applique la gravité selon l'état du planeur.
 * La gravité est réduite, pas annulée.
 */
export function applyGlideGravity(
  vy: number,
  state: GlideState,
  gravity: number,
  dt: number,
  rules: GlideRules,
): number {
  if (!state.active) return vy - gravity * dt;
  const next = vy - gravity * rules.gravityScale * dt;
  return Math.max(next, -rules.maxFallSpeed);
}

export function glideHorizontalScale(state: GlideState, rules: GlideRules): number {
  return state.active ? rules.airControl : 1;
}

export interface VerticalCurrent {
  x: number;
  z: number;
  radius: number;
  strength: number;
  /** Cooldown après un déclenchement, en secondes. */
  cooldown: number;
  /** Si `true`, le planeur doit être actif pour déclencher cette source. */
  requiresGlide: boolean;
  /** Marge de sécurité au-dessus d'un rebord/obstacle détecté via `overhead`. */
  maxOverhead: number;
}

export interface VerticalCurrentState {
  /** Délai restant avant un prochain déclenchement. */
  cooldown: number;
}

export interface VerticalCurrentInput {
  x: number;
  z: number;
  vy: number;
  airborne: boolean;
  swimming: boolean;
  indoors: boolean;
  glideActive: boolean;
  /** Hauteur locale au-dessus du corps (en unités monde), 0 si terrain libre. */
  overhead: number;
}

export interface VerticalCurrentResult {
  state: VerticalCurrentState;
  vy: number;
  applied: boolean;
  blocked: boolean;
}

export function createVerticalCurrentState(): VerticalCurrentState {
  return { cooldown: 0 };
}

/** Applique une source montante de vitesse verticale :
 * - zone circulaire (rayon),
 * - impulsion instantanée vers `strength`,
 * - délai de ré-activation (`cooldown`),
 * - rejet si la zone montante est utilisée comme plafond naturel.
 */
export function applyVerticalCurrent(
  state: VerticalCurrentState,
  dt: number,
  input: VerticalCurrentInput,
  source: VerticalCurrent,
): VerticalCurrentResult {
  if (!input.airborne || input.swimming || input.indoors) {
    return {
      state: { cooldown: Math.max(0, state.cooldown - dt) },
      vy: input.vy,
      applied: false,
      blocked: false,
    };
  }

  const cooldown = Math.max(0, state.cooldown - dt);
  const isInside =
    (input.x - source.x) * (input.x - source.x) + (input.z - source.z) * (input.z - source.z) <=
    source.radius * source.radius;

  if (!isInside || cooldown > 0) {
    return { state: { cooldown }, vy: input.vy, applied: false, blocked: false };
  }

  if (source.requiresGlide && !input.glideActive) return { state: { cooldown }, vy: input.vy, applied: false, blocked: false };

  if (input.overhead > source.maxOverhead) {
    return { state: { cooldown }, vy: input.vy, applied: false, blocked: true };
  }

  return {
    state: { cooldown: source.cooldown },
    vy: Math.max(input.vy, source.strength),
    applied: true,
    blocked: false,
  };
}

