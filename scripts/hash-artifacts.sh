#!/usr/bin/env bash
set -euo pipefail

# OmniFi Build Artifact Hasher
# Computes SHA-256 hashes of all compiled artifacts for audit verification.

OUTPUT_FILE="build-manifest.sha256"
echo "# OmniFi Build Artifact Manifest" > "$OUTPUT_FILE"
echo "# Generated at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

echo "Hashing EVM artifacts..."
if [ -d "chains/evm/out" ]; then
    find chains/evm/out -name "*.json" -not -name "*.metadata.json" -type f | sort | while read -r file; do
        shasum -a 256 "$file" >> "$OUTPUT_FILE"
    done
else
    echo "No EVM out directory found."
fi

echo "Hashing Solana artifacts..."
if [ -d "chains/solana/target/deploy" ]; then
    find chains/solana/target/deploy -name "*.so" -type f | sort | while read -r file; do
        shasum -a 256 "$file" >> "$OUTPUT_FILE"
    done
else
    echo "No Solana target/deploy directory found."
fi

echo "Hashing package builds..."
find packages -name "dist" -type d | while read -r dist_dir; do
    find "$dist_dir" -type f | sort | while read -r file; do
        shasum -a 256 "$file" >> "$OUTPUT_FILE"
    done
done

echo "Manifest generated: $OUTPUT_FILE"
cat "$OUTPUT_FILE"

