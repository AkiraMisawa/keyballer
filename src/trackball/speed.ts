// What Keyball's cursor and scroll settings mean in physical terms, and the
// sensor calibration. See docs/plans/trackball-settings.md.

const MM_PER_INCH = 25.4;

/** The PMW3360's range; Keyball stores CPI / 100 in one byte. */
export const CPI_MIN = 100;
export const CPI_MAX = 12000;
export const CPI_STEP = 100;
/** Keyball sends one scroll step per 2^(divider − 1) counts. */
export const DIVIDER_MIN = 1;
export const DIVIDER_MAX = 7;

/** Counts the sensor reports per centimetre of ball surface. */
export function countsPerCm(cpi: number): number {
  return (cpi / MM_PER_INCH) * 10;
}

/** Scroll steps Keyball sends per centimetre of ball surface. */
export function scrollStepsPerCm(cpi: number, divider: number): number {
  return countsPerCm(cpi) / 2 ** (divider - 1);
}

/** Rolls needed for a calibration, and how far one may stray from the median. */
export const ROLLS = 3;
const OUTLIER = 0.15;

/** The ball sizes the settings take, in mm. */
export const BALL_MM_MIN = 10;
export const BALL_MM_MAX = 60;

export type Calibration = { cpi: number } | { retry: number } | { more: true };

/**
 * The real CPI from the counts measured over full turns of a ball of the given diameter: the
 * mean counts per turn, over the ball's circumference, per inch. When the rolls spread more than
 * 15 % of the median, the roll farthest from the median (the later of equals) is to be done
 * again; fewer than three rolls asks for more.
 */
export function calibrate(rolls: number[], diameterMm: number): Calibration {
  if (rolls.length < ROLLS) return { more: true };
  const sorted = [...rolls].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if ((sorted.at(-1)! - sorted[0]) / median > OUTLIER) {
    let far = 0;
    rolls.forEach((r, i) => {
      if (Math.abs(r - median) >= Math.abs(rolls[far] - median)) far = i;
    });
    return { retry: far };
  }
  const mean = rolls.reduce((s, r) => s + r, 0) / rolls.length;
  return { cpi: Math.round((mean / (Math.PI * diameterMm)) * MM_PER_INCH) };
}
