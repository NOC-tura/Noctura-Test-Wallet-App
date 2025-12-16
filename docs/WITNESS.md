# Witness Builder Toolkit

Location: `zk/witness/`

## Modules
- `constants.ts`: Poseidon hashing helpers, tree height, zero element.
- `note.ts`: Deterministic creation of notes (commitment + nullifier) from secrets/blinding/rho.
- `merkle.ts`: Simple incremental Merkle tree + proof generator matching the circuits (Poseidon hash of child nodes, zero default leaves).
- `builders/`: Serializers for deposit, shielded transfer, and withdraw circuits returning exact witness JSON and public input arrays.
- `serialization.ts`: Helpers to convert field elements to on-chain byte arrays or hex strings.
- `index.ts`: Barrel export for consumers (wallet app, prover service, CLI scripts).

## Sample Usage
```ts
import {
  createNote,
  IncrementalMerkleTree,
  serializeDepositWitness,
  serializeDepositPublicInputs,
} from '../witness';

const note = createNote({
  secret: 123n,
  amount: 1_000_000n,
  tokenMint: 987n,
  blinding: 555n,
  rho: 777n,
});

const tree = new IncrementalMerkleTree();
tree.append(note.commitment);
const proof = tree.generateProof(0);

const witness = serializeDepositWitness({ note, proof });
const publicInputs = serializeDepositPublicInputs(note);
```

The resulting `witness` can be passed directly to `snarkjs groth16 fullprove`, while `publicInputs` flow into Solana instruction data (after packing via `fieldToBytesLE`).
