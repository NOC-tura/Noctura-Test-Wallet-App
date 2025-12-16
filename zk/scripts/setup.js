import { execSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { BUILD_DIR, KEYS_DIR, CIRCUITS, ensureDirs } from './utils.js';
const PTAU = process.env.PTAU_PATH || join(KEYS_DIR, 'powersOfTau28_hez_final_15.ptau');
if (!existsSync(PTAU)) {
    console.error('Missing trusted setup file. Download powersOfTau and set PTAU_PATH env.');
    process.exit(1);
}
ensureDirs();
for (const circuit of CIRCUITS) {
    const r1cs = join(BUILD_DIR, circuit, `${circuit}.r1cs`);
    const zkey = join(KEYS_DIR, `${circuit}.zkey`);
    const vkey = join(KEYS_DIR, `${circuit}.vkey.json`);
    console.log(`[setup] groth16 for ${circuit}`);
    execSync(`npx snarkjs groth16 setup ${r1cs} ${PTAU} ${zkey}`, { stdio: 'inherit' });
    execSync(`npx snarkjs zkey export verificationkey ${zkey} ${vkey}`, { stdio: 'inherit' });
}
