declare module 'circomlibjs' {
  export interface Poseidon {
    F: {
      toObject: (value: any) => bigint;
      e: bigint;
    };
    (inputs: bigint[]): any;
  }

  export function buildPoseidon(): Promise<Poseidon>;
}
