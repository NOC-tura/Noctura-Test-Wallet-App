import { execSync } from 'child_process';
import { join } from 'path';
import { BUILD_DIR, KEYS_DIR, ensureDirs } from './utils.js';
const circuit = process.argv[2];
if (!circuit) {
    console.error('Usage: npm run prove:<circuit> [input.json]');
    process.exit(1);
}
ensureDirs();
const inputPath = process.argv[3] || join('inputs', `${circuit}.json`);
const wasm = join(BUILD_DIR, circuit, `${circuit}.wasm`);
const zkey = join(KEYS_DIR, `${circuit}.zkey`);
const proofOut = join(KEYS_DIR, `${circuit}-proof.json`);
const publicOut = join(KEYS_DIR, `${circuit}-public.json`);
const cmd = `npx snarkjs groth16 fullprove ${inputPath} ${wasm} ${zkey} ${proofOut} ${publicOut}`;
console.log(`[prove] ${cmd}`);
execSync(cmd, { stdio: 'inherit' });
