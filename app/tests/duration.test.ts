import { describe, it, expect } from 'vitest';
import { bytes, duration } from '../src/shared/units';

describe('time spans', () => {
  it('reads as people say it, from milliseconds to hours', () => {
    expect(duration(undefined)).toBe('–');
    expect(duration(48)).toBe('48 ms');
    expect(duration(3400)).toBe('3,4 sn');
    expect(duration(12_300)).toBe('12 sn');
    expect(duration(125_000)).toBe('2 dk 5 sn');
    expect(duration(3_840_000)).toBe('1 sa 4 dk');
  });

  it('rounds to whole seconds before splitting into minutes', () => {
    expect(duration(119_600)).toBe('2 dk 0 sn');
    expect(duration(59_700)).toBe('1 dk 0 sn');
    expect(duration(9_960)).toBe('10 sn');
  });

  it('writes sizes in the UI language, without a trailing .0', () => {
    expect(bytes(512)).toBe('512 B');
    expect(bytes(2048)).toBe('2 KB');
    expect(bytes(2.4 * 1024 * 1024)).toBe('2,4 MB');
    expect(bytes(1000 * 1024)).toBe('1000 KB');
    expect(bytes(582.54)).toBe('583 B');
    expect(bytes(1023.97 * 1024)).toBe('1 MB');
    expect(duration(999.6)).toBe('1,0 sn');
    expect(bytes(undefined)).toBe('–');
  });
});
