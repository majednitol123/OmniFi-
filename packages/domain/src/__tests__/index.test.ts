import { describe, expect, it } from 'vitest';
import { DOMAIN_VERSION } from '../index';

describe('domain package', () => {
  it('exports version', () => {
    expect(DOMAIN_VERSION).toBe('0.1.0');
  });
});

