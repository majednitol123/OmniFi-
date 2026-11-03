import { describe, expect, it } from 'vitest';
import { TOKEN_REGISTRY_VERSION } from '../index';

describe('token-registry package', () => {
  it('exports version', () => {
    expect(TOKEN_REGISTRY_VERSION).toBe('0.1.0');
  });
});

