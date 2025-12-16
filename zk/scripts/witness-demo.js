import { IncrementalMerkleTree, createNote, serializeDepositWitness, serializeTransferWitness, serializeWithdrawWitness, serializeTransferPublicInputs, serializeWithdrawPublicInputs, } from '../witness/index.js';
const tokenMint = 1234567n;
const note = createNote({
    secret: 777n,
    amount: 100000000n,
    tokenMint,
    blinding: 12345n,
    rho: 888n,
});
const tree = new IncrementalMerkleTree();
tree.append(note.commitment);
const proof = tree.generateProof(0);
console.log('Deposit witness', serializeDepositWitness({ note }));
const out1 = createNote({ secret: 1n, amount: 50000000n, tokenMint, blinding: 2n, rho: 3n });
const out2 = createNote({ secret: 4n, amount: 50000000n, tokenMint, blinding: 5n, rho: 6n });
const transferWitness = serializeTransferWitness({ inputNote: note, merkleProof: proof, outputNote1: out1, outputNote2: out2 });
console.log('Transfer witness public inputs', serializeTransferPublicInputs(transferWitness));
const withdrawWitness = serializeWithdrawWitness({ inputNote: out1, merkleProof: proof, receiver: 999n });
console.log('Withdraw witness public inputs', serializeWithdrawPublicInputs(withdrawWitness));
