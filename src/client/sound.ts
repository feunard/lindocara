/**
 * Tiny procedural sound palette. It has no assets or dependencies and only starts after a
 * player gesture, so browser autoplay rules remain respected.
 */
export class GameSound {
  #context: AudioContext | null = null;

  unlock(): void {
    if (!this.#context) this.#context = new AudioContext();
    if (this.#context.state === "suspended") void this.#context.resume();
  }

  #tone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    endFrequency?: number,
    delay = 0,
  ): void {
    const context = this.#context;
    if (context?.state !== "running") return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency)
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  attack(): void {
    this.#tone(210, 0.11, "sawtooth", 0.035, 90);
    this.#tone(520, 0.07, "triangle", 0.025, 260, 0.025);
  }

  hit(): void {
    this.#tone(95, 0.1, "square", 0.035, 55);
  }

  loot(): void {
    this.#tone(540, 0.08, "sine", 0.035, 760);
    this.#tone(760, 0.1, "sine", 0.03, 980, 0.06);
  }

  levelUp(): void {
    for (const [index, note] of [392, 523, 659, 784].entries()) {
      this.#tone(note, 0.18, "triangle", 0.035, note * 1.04, index * 0.09);
    }
  }

  interact(): void {
    this.#tone(330, 0.11, "sine", 0.025, 440);
  }

  death(): void {
    this.#tone(180, 0.45, "triangle", 0.04, 65);
  }

  chat(): void {
    this.#tone(620, 0.06, "sine", 0.018, 690);
  }
}
