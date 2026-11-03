import { describe, expect, it } from 'vitest';
import { API_CLIENT_VERSION } from '../index';

describe('api-client package', () => {
  it('exports version', () => {
    expect(API_CLIENT_VERSION).toBe('0.1.0');
  });
});

