import { describe, expect, it } from 'vitest';
import { CONFIG_VERSION } from '../index';

describe('config package', () => {
  it('exports version', () => {
    expect(CONFIG_VERSION).toBe('0.1.0');
  });
});

