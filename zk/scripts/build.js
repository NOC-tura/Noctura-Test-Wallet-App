import { execSync } from 'child_process';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { CIRCUITS, BUILD_DIR, ensureDirs } from './utils.js';
ensureDirs();
const CIRCOM_BIN = process.env.CIRCOM_BIN || 'circom';
for (const circuit of CIRCUITS) {
    const input = join('circuits', `${circuit}.circom`);
    const outDir = join(BUILD_DIR, circuit);
    mkdirSync(outDir, { recursive: true });
    console.log(`[build] compiling ${circuit}`);
    execSync(`${CIRCOM_BIN} ${input} --wasm --r1cs --output ${outDir}`, { stdio: 'inherit' });
}
