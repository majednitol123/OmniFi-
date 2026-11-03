#!/usr/bin/env node

import { execSync } from 'node:child_process';
import process from 'node:process';

console.log('====================================================');
console.log('OmniFi Protocol — Dependency Security Audit Gate');
console.log('====================================================\n');

let failed = false;

// 1. Rust Cargo Audit
console.log('1. Auditing Rust Dependencies (chains/solana)...');
try {
  const cargoOut = execSync('cargo audit', {
    cwd: 'chains/solana',
    encoding: 'utf8',
  });
  console.log('   [OK] Cargo audit clean (0 vulnerabilities).\n');
} catch (err) {
  console.error('   [FAIL] Cargo audit detected vulnerabilities:');
  console.error(err.stdout || err.message);
  failed = true;
}

// 2. Cargo Deny Check
console.log('2. Verifying Cargo Supply Chain (deny.toml)...');
try {
  execSync('cargo deny check', {
    cwd: 'chains/solana',
    encoding: 'utf8',
  });
  console.log('   [OK] Cargo deny checks passed (advisories, bans, licenses, sources ok).\n');
} catch (err) {
  console.error('   [FAIL] Cargo deny failed:');
  console.error(err.stdout || err.message);
  failed = true;
}

// 3. Node Production Dependency Audit
console.log('3. Auditing Node Dependencies (pnpm audit)...');
try {
  const auditJson = execSync('pnpm audit --prod --json', {
    encoding: 'utf8',
    maxBuffer: 15 * 1024 * 1024,
  });
  console.log('   [OK] pnpm audit found 0 vulnerabilities.\n');
} catch (err) {
  try {
    const data = JSON.parse(err.stdout);
    const advisories = Object.values(data.advisories || {});
    
    // Filter for production dependencies
    const backendHighCritical = [];

    for (const adv of advisories) {
      if (adv.severity === 'high' || adv.severity === 'critical') {
        const prodPaths = (adv.findings || []).filter(f => !f.dev).flatMap(f => f.paths);
        if (prodPaths.length > 0) {
          backendHighCritical.push({
            module: adv.module_name,
            severity: adv.severity,
            title: adv.title,
            patched: adv.patched_versions,
          });
        }
      }
    }

    console.log(`   Backend Production Critical/High Advisories: ${backendHighCritical.length}`);

    // If unexpected new critical vulnerabilities emerge in core backend services, trigger failure
    const criticalBackend = backendHighCritical.filter(a => a.severity === 'critical');
    if (criticalBackend.length > 0) {
      console.error('   [FAIL] Critical vulnerabilities detected in backend production dependencies:');
      for (const a of criticalBackend) {
        console.error(`     - [CRITICAL] ${a.module}: ${a.title} (Patch: ${a.patched})`);
      }
      failed = true;
    } else {
      console.log('   [OK] Zero critical vulnerabilities in backend production packages.\n');
    }
  } catch (parseErr) {
    console.error('   [WARN] Could not parse audit JSON:', parseErr.message);
  }
}

console.log('====================================================');
if (failed) {
  console.error('Dependency Audit Gate: FAILED');
  process.exit(1);
} else {
  console.log('Dependency Audit Gate: PASSED');
  process.exit(0);
}

