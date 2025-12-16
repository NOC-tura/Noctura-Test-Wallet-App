import { join } from 'path';
import * as snarkjs from 'snarkjs';
import { createNote } from '../witness/note.js';
import { serializeDepositWitness } from '../witness/builders/deposit.js';
import { readFileSync } from 'fs';
async function main() {
    const note = createNote({
        secret: 123n,
        amount: 1000000n,
        tokenMint: 999n,
        blinding: 555n,
        rho: 42n,
    });
    const input = serializeDepositWitness({ note });
    const wasm = join('build', 'deposit', 'deposit_js', 'deposit.wasm');
    const zkey = join('keys', 'deposit.zkey');
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
    console.log('publicSignals:', publicSignals);
    const vkey = JSON.parse(readFileSync(join('keys', 'deposit.vkey.json'), 'utf8'));
    const verified = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    console.log('verify result:', verified);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
