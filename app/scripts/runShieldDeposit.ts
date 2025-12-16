import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { config as loadEnv } from 'dotenv';
import bs58 from 'bs58';
import { Keypair, PublicKey } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';

type SolanaLib = typeof import('../src/lib/solana');
type ProverLib = typeof import('../src/lib/prover');
type ShieldLib = typeof import('../src/lib/shield');
type ShieldProgramLib = typeof import('../src/lib/shieldProgram');
type ConstantsLib = typeof import('../src/lib/constants');

let connection!: SolanaLib['connection'];
let getSolBalance!: SolanaLib['getSolBalance'];
let requestSolAirdrop!: SolanaLib['requestSolAirdrop'];
let secretKeyToKeypair!: SolanaLib['secretKeyToKeypair'];
let requestNocAirdrop!: ProverLib['requestNocAirdrop'];
let proveCircuit!: ProverLib['proveCircuit'];
let prepareDeposit!: ShieldLib['prepareDeposit'];
let submitShieldedDeposit!: ShieldProgramLib['submitShieldedDeposit'];
let NOC_TOKEN_MINT!: ConstantsLib['NOC_TOKEN_MINT'];

const envPath = path.resolve(process.cwd(), '.env');
loadEnv({ path: envPath });

const globals = globalThis as typeof globalThis & {
  __HELIUS_URL__?: string;
  __PROVER_URL__?: string;
};

globals.__HELIUS_URL__ ??= process.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
globals.__PROVER_URL__ ??= process.env.VITE_PROVER_URL || 'http://localhost:8787';

const DEPOSIT_AMOUNT_ATOMS = BigInt(process.env.DEPOSIT_AMOUNT_ATOMS || '1000000');
const EXTRA_FEE_BUFFER = BigInt(process.env.DEPOSIT_FEE_BUFFER_ATOMS || '1000000');
const MIN_SOL_BALANCE = Number(process.env.DEPOSIT_MIN_SOL || '0.2');
const SOL_AIRDROP_AMOUNT = Number(process.env.DEPOSIT_SOL_AIRDROP || '1');

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

async function loadKeypair(): Promise<Keypair> {
  const keyfile = process.env.DEPOSIT_KEYFILE?.trim();
  if (keyfile) {
    const raw = await readFile(path.resolve(keyfile), 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return Keypair.fromSecretKey(Uint8Array.from(parsed));
    }
    if (typeof parsed === 'string') {
      return secretKeyToKeypair(parsed);
    }
    throw new Error('Unsupported keyfile format. Provide a JSON array or base58 string.');
  }
  const secret = process.env.DEPOSIT_SECRET_KEY?.trim();
  if (secret) {
    return secretKeyToKeypair(secret);
  }
  const keypair = Keypair.generate();
  console.log('Generated ephemeral keypair. Base58 secret:', bs58.encode(keypair.secretKey));
  return keypair;
}

async function ensureSol(keypair: Keypair): Promise<number> {
  let balance = await getSolBalance(keypair.publicKey);
  if (balance >= MIN_SOL_BALANCE) {
    return balance;
  }
  console.log(`Requesting ${SOL_AIRDROP_AMOUNT} SOL airdrop…`);
  const signature = await requestSolAirdrop(keypair, SOL_AIRDROP_AMOUNT);
  console.log(`SOL airdrop signature ${signature}`);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    balance = await getSolBalance(keypair.publicKey);
    if (balance >= MIN_SOL_BALANCE) {
      return balance;
    }
  }
  throw new Error('SOL airdrop did not confirm in time');
}

async function getNocBalanceAtoms(owner: PublicKey): Promise<bigint> {
  const mint = new PublicKey(NOC_TOKEN_MINT);
  const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const balance = await connection.getTokenAccountBalance(ata).catch(() => null);
  if (!balance) {
    return 0n;
  }
  return BigInt(balance.value.amount);
}

async function ensureNoc(keypair: Keypair, required: bigint): Promise<bigint> {
  let balance = await getNocBalanceAtoms(keypair.publicKey);
  if (balance >= required) {
    return balance;
  }
  console.log('Requesting 10,000 $NOC faucet…');
  const { signature } = await requestNocAirdrop(keypair.publicKey.toBase58());
  console.log(`NOC airdrop signature ${signature}`);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    balance = await getNocBalanceAtoms(keypair.publicKey);
    if (balance >= required) {
      return balance;
    }
  }
  throw new Error('NOC airdrop did not arrive in time');
}

async function main() {
  const [solanaLib, proverLib, shieldLib, shieldProgram, constantsLib] = await Promise.all([
    import('../src/lib/solana'),
    import('../src/lib/prover'),
    import('../src/lib/shield'),
    import('../src/lib/shieldProgram'),
    import('../src/lib/constants'),
  ]);

  connection = solanaLib.connection;
  getSolBalance = solanaLib.getSolBalance;
  requestSolAirdrop = solanaLib.requestSolAirdrop;
  secretKeyToKeypair = solanaLib.secretKeyToKeypair;
  requestNocAirdrop = proverLib.requestNocAirdrop;
  proveCircuit = proverLib.proveCircuit;
  prepareDeposit = shieldLib.prepareDeposit;
  submitShieldedDeposit = shieldProgram.submitShieldedDeposit;
  NOC_TOKEN_MINT = constantsLib.NOC_TOKEN_MINT;

  const keypair = await loadKeypair();
  console.log('Using wallet:', keypair.publicKey.toBase58());
  const solBalance = await ensureSol(keypair);
  console.log(`SOL balance: ${solBalance.toFixed(4)} SOL`);
  const requiredNoc = DEPOSIT_AMOUNT_ATOMS + EXTRA_FEE_BUFFER;
  const nocBalance = await ensureNoc(keypair, requiredNoc);
  console.log(`NOC balance ready: ${nocBalance} atoms`);

  const mint = new PublicKey(NOC_TOKEN_MINT);
  console.log(`Preparing shielded deposit for ${(DEPOSIT_AMOUNT_ATOMS / 1_000_000n).toString()} $NOC…`);
  const prepared = prepareDeposit(DEPOSIT_AMOUNT_ATOMS, mint);
  const proof = await proveCircuit('deposit', prepared.witness);
  if (process.env.DUMP_PROOF === '1') {
    console.log('proofBytes(base64)', proof.proofBytes);
    console.log('publicInputs(base64)', proof.publicInputs);
    const [pi0, pi1] = prepared.publicInputsBytes;
    console.log('prepared.publicInputs[0]', prepared.publicInputs[0].toString());
    console.log('prepared.publicInputs[1]', prepared.publicInputs[1].toString());
    console.log('prepared.publicInputsBytes[0].base64', toBase64(pi0));
    console.log('prepared.publicInputsBytes[1].base64', toBase64(pi1));
    console.log('prepared.publicInputsBytes[0].hex_le', toHex(pi0));
    console.log('prepared.publicInputsBytes[1].hex_le', toHex(pi1));
  }
  console.log(
    `Proof ready in ${proof.proverMs}ms. Submitting on-chain deposit (leaf commitment ${prepared.note.commitment}).`,
  );
  const { signature, leafIndex } = await submitShieldedDeposit({
    keypair,
    prepared,
    proof,
  });
  console.log(`Shielded deposit confirmed. Signature ${signature}, leaf index ${leafIndex}`);
}

main().catch((err) => {
  console.error(err);
  const logs = (err as unknown as { logs?: string[] })?.logs;
  if (logs && logs.length > 0) {
    console.error('Transaction logs:\n', logs.join('\n'));
  }
  const signature = (err as unknown as { signature?: string })?.signature;
  if (signature) {
    console.error('Failed transaction signature:', signature);
  }
  process.exitCode = 1;
});
