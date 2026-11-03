import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { expect } from 'chai';

describe('placeholder program', () => {
  // Configure client to use local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  it('Is initialized!', async () => {
    // Basic verification test structure
    expect(provider).to.not.be.null;
    expect(provider.connection).to.not.be.null;
  });
});
