// What cursor and scroll settings mean in physical terms, and the sensor
// calibration. Expected values are worked out by hand in the comments.

import { describe, expect, it } from 'vitest';
import { calibrate, countsPerCm, scrollStepsPerCm } from './speed';

describe('speed figures', () => {
  it('turns CPI into counts per centimetre of ball surface', () => {
    expect(countsPerCm(700)).toBeCloseTo(275.6, 1); // 700 / 2.54
    expect(countsPerCm(100)).toBeCloseTo(39.4, 1);
  });

  it('turns the scroll divider into scroll steps per centimetre', () => {
    // Keyball sends one step per 2^(divider - 1) counts: divider 4 = every 8 counts.
    expect(scrollStepsPerCm(700, 4)).toBeCloseTo(34.4, 1); // 275.59 / 8
    expect(scrollStepsPerCm(700, 1)).toBeCloseTo(275.6, 1);
    expect(scrollStepsPerCm(700, 7)).toBeCloseTo(4.3, 1); // 275.59 / 64
  });
});

describe('calibration', () => {
  // A 34 mm ball turns 106.81 mm of surface per turn (π × 34). At a true 700 CPI that is
  // 700 / 25.4 × 106.81 = 2943.7 counts.
  it('finds the real CPI from counts over full turns of a ball of known size', () => {
    const result = calibrate([2944, 2930, 2960], 34);
    // mean 2944.67 counts / 106.81 mm × 25.4 = 700.2
    expect(result).toEqual({ cpi: 700 });
  });

  it('uses the ball size: the same counts on a 25 mm ball mean a higher CPI', () => {
    // 2944.67 / (π × 25) × 25.4 = 952.3
    expect(calibrate([2944, 2930, 2960], 25)).toEqual({ cpi: 952 });
  });

  it('asks for a roll again when one differs from the others by more than 15 %', () => {
    // The median is 2944; 3500 is 19 % above it.
    expect(calibrate([2944, 2930, 3500], 34)).toEqual({ retry: 2 });
  });

  it('asks again when the rolls spread more than 15 % even if each is near the middle one', () => {
    // 100, 116, 132: each is 14 % from the median, but the rolls span 32 / 116 = 28 %.
    // The one asked again is the farthest from the median; between equals, the later one.
    expect(calibrate([100, 116, 132], 34)).toEqual({ retry: 2 });
  });

  it('needs three rolls', () => {
    expect(calibrate([2944, 2930], 34)).toEqual({ more: true });
  });
});
