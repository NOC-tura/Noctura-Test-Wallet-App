import { Note } from '../note';
import { MerkleProof } from '../merkle';

export interface TransferMultiWitnessInput {
  inputNotes: Note[];  // 1-4 notes to combine
  merkleProofs: MerkleProof[];
  outputNote1: Note;
  outputNote2: Note;
}

export interface TransferMultiWitness {
  inSecret1: string; inAmount1: string; inBlinding1: string; inRho1: string;
  inSecret2: string; inAmount2: string; inBlinding2: string; inRho2: string;
  inSecret3: string; inAmount3: string; inBlinding3: string; inRho3: string;
  inSecret4: string; inAmount4: string; inBlinding4: string; inRho4: string;
  tokenMint: string;
  pathElements1: string[]; pathIndices1: string[];
  pathElements2: string[]; pathIndices2: string[];
  pathElements3: string[]; pathIndices3: string[];
  pathElements4: string[]; pathIndices4: string[];
  merkleRoot: string;
  outSecret1: string; outAmount1: string; outBlinding1: string;
  outSecret2: string; outAmount2: string; outBlinding2: string;
  nullifier1: string; nullifier2: string; nullifier3: string; nullifier4: string;
}

export function serializeTransferMultiWitness({
  inputNotes,
  merkleProofs,
  outputNote1,
  outputNote2,
}: TransferMultiWitnessInput): TransferMultiWitness {
  const paddedInputs: Note[] = [...inputNotes];
  const paddedProofs: MerkleProof[] = [...merkleProofs];
  
  while (paddedInputs.length < 4) {
    paddedInputs.push({
      secret: 0n, amount: 0n, tokenMint: inputNotes[0].tokenMint,
      blinding: 0n, rho: 0n, commitment: 0n, nullifier: 0n,
    });
    paddedProofs.push({
      pathElements: Array(20).fill(0n),
      pathIndices: Array(20).fill(0n),
      root: merkleProofs[0].root,
    });
  }

  return {
    inSecret1: paddedInputs[0].secret.toString(), inAmount1: paddedInputs[0].amount.toString(),
    inBlinding1: paddedInputs[0].blinding.toString(), inRho1: paddedInputs[0].rho.toString(),
    inSecret2: paddedInputs[1].secret.toString(), inAmount2: paddedInputs[1].amount.toString(),
    inBlinding2: paddedInputs[1].blinding.toString(), inRho2: paddedInputs[1].rho.toString(),
    inSecret3: paddedInputs[2].secret.toString(), inAmount3: paddedInputs[2].amount.toString(),
    inBlinding3: paddedInputs[2].blinding.toString(), inRho3: paddedInputs[2].rho.toString(),
    inSecret4: paddedInputs[3].secret.toString(), inAmount4: paddedInputs[3].amount.toString(),
    inBlinding4: paddedInputs[3].blinding.toString(), inRho4: paddedInputs[3].rho.toString(),
    tokenMint: inputNotes[0].tokenMint.toString(),
    pathElements1: paddedProofs[0].pathElements.map((x) => x.toString()),
    pathIndices1: paddedProofs[0].pathIndices.map((x) => x.toString()),
    pathElements2: paddedProofs[1].pathElements.map((x) => x.toString()),
    pathIndices2: paddedProofs[1].pathIndices.map((x) => x.toString()),
    pathElements3: paddedProofs[2].pathElements.map((x) => x.toString()),
    pathIndices3: paddedProofs[2].pathIndices.map((x) => x.toString()),
    pathElements4: paddedProofs[3].pathElements.map((x) => x.toString()),
    pathIndices4: paddedProofs[3].pathIndices.map((x) => x.toString()),
    merkleRoot: merkleProofs[0].root.toString(),
    outSecret1: outputNote1.secret.toString(), outAmount1: outputNote1.amount.toString(),
    outBlinding1: outputNote1.blinding.toString(),
    outSecret2: outputNote2.secret.toString(), outAmount2: outputNote2.amount.toString(),
    outBlinding2: outputNote2.blinding.toString(),
    nullifier1: paddedInputs[0].nullifier.toString(), nullifier2: paddedInputs[1].nullifier.toString(),
    nullifier3: paddedInputs[2].nullifier.toString(), nullifier4: paddedInputs[3].nullifier.toString(),
  };
}

export function serializeTransferMultiPublicInputs(witness: TransferMultiWitness): [bigint, bigint, bigint, bigint, bigint] {
  return [
    BigInt(witness.merkleRoot), BigInt(witness.nullifier1), BigInt(witness.nullifier2),
    BigInt(witness.nullifier3), BigInt(witness.nullifier4),
  ];
}
