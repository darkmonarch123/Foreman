/**
 * A critically-damped-by-default spring, parameterised the way designers think:
 * damping ratio (1 = no overshoot, < 1 = bounce) and response (seconds to settle).
 * Springs start from wherever the value currently is, so motion can be grabbed and
 * redirected at any moment without a jump.
 */
export class Spring {
  value: number;
  velocity = 0;
  target: number;
  damping: number;
  response: number;

  constructor(value: number, { damping = 1, response = 0.4 }: { damping?: number; response?: number } = {}) {
    this.value = value;
    this.target = value;
    this.damping = damping;
    this.response = response;
  }

  /** Advances by dt seconds. Returns true while still moving. */
  step(dt: number): boolean {
    const stiffness = ((2 * Math.PI) / this.response) ** 2;
    const friction = (4 * Math.PI * this.damping) / this.response;
    const substeps = 4;
    const h = dt / substeps;
    for (let i = 0; i < substeps; i += 1) {
      const acceleration = -stiffness * (this.value - this.target) - friction * this.velocity;
      this.velocity += acceleration * h;
      this.value += this.velocity * h;
    }
    return Math.abs(this.value - this.target) + Math.abs(this.velocity) > 0.01;
  }

  /** Jumps to the target (used for reduced motion). */
  settle(): void {
    this.value = this.target;
    this.velocity = 0;
  }
}

/** Drives springs on one animation-frame loop until they all settle. Returns a cancel function. */
export function animateSprings(springs: Spring[], onFrame: () => void, reduceMotion = false): () => void {
  let last = performance.now();
  let id = 0;
  const loop = (now: number) => {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    let moving = false;
    for (const spring of springs) {
      if (reduceMotion) spring.settle();
      else if (spring.step(dt)) moving = true;
    }
    onFrame();
    if (moving) id = requestAnimationFrame(loop);
  };
  id = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(id);
}

/** Progressive resistance past an edge, instead of a hard stop. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
