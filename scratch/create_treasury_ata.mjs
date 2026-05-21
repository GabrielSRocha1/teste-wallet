// scratch/create_treasury_ata.mjs
//
// Cria a Associated Token Account (ATA) da treasury Verum para um mint.
// ATA é criação permissionless — qualquer wallet com SOL pode pagar o rent
// (~0.00203 SOL) sem precisar da private key da treasury.
//
// Por que isso é necessário: a Jupiter recusa swap com `platformFee` se o
// `feeAccount` (ATA da treasury para o output mint) não existir on-chain.
// Sem ATA → fee Verum 2% não é cobrada naquele par.
//
// USO (PowerShell):
//   $env:PAYER_PRIVATE_KEY_BASE58 = "..."           # chave da wallet que paga o rent
//   $env:SCRATCH_RPC_URL = "https://..."            # opcional, default mainnet público
//   node scratch/create_treasury_ata.mjs            # default: cria ATA wSOL
//   node scratch/create_treasury_ata.mjs --mint=<MINT_ADDRESS>
//
// Mints úteis:
//   wSOL = So11111111111111111111111111111111111111112
//   BDC  = AeAQdgjGqtHErysb5FBvUxNxmob2mVBGnEXdmULJ7dH9
//   ESCT = Ctauy54NbyabVqGXHuY5wwVEAh29mGhh5KGfif5jppZt
//   BRT  = 3nmVqybqR7iWwynmVtCAe1cBF8S6w3Kk3hTNiCy4UMEE

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import bs58 from 'bs58';

const TREASURY = new PublicKey('Da51JLCnUfN3L3RDNeYkn7kxr7C3otnLaLvbsjmTTzE8');
const DEFAULT_MINT = 'So11111111111111111111111111111111111111112'; // wSOL

function parseArgs() {
  let mint = DEFAULT_MINT;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--mint=')) mint = a.slice(7);
  }
  return { mint };
}

async function main() {
  const { mint } = parseArgs();
  const secret = process.env.PAYER_PRIVATE_KEY_BASE58;
  if (!secret) {
    console.error('FALTA: defina PAYER_PRIVATE_KEY_BASE58 com a chave do payer (base58).');
    process.exit(1);
  }

  const payer = Keypair.fromSecretKey(bs58.decode(secret));
  const rpc = process.env.SCRATCH_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const conn = new Connection(rpc, 'confirmed');

  const mintPubkey = new PublicKey(mint);
  const ata = getAssociatedTokenAddressSync(mintPubkey, TREASURY);

  console.log('━━━ Criar ATA da treasury Verum ━━━');
  console.log('payer    :', payer.publicKey.toBase58());
  console.log('treasury :', TREASURY.toBase58());
  console.log('mint     :', mintPubkey.toBase58());
  console.log('ata      :', ata.toBase58());

  const existing = await conn.getAccountInfo(ata, 'confirmed');
  if (existing) {
    console.log('\nATA já existe on-chain — nada a fazer.');
    return;
  }

  const payerBal = await conn.getBalance(payer.publicKey);
  console.log('\npayer balance:', (payerBal / 1e9).toFixed(6), 'SOL');
  if (payerBal < 3_000_000) {
    console.error('payer precisa de pelo menos ~0.003 SOL pra cobrir rent + fee.');
    process.exit(1);
  }

  const ix = createAssociatedTokenAccountInstruction(
    payer.publicKey,
    ata,
    TREASURY,
    mintPubkey,
  );
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight }).add(ix);
  tx.sign(payer);

  console.log('\nEnviando tx...');
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  console.log('signature:', sig);
  console.log('https://solscan.io/tx/' + sig);

  console.log('confirmando...');
  const conf = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  if (conf.value.err) {
    console.error('FALHOU:', JSON.stringify(conf.value.err));
    process.exit(1);
  }
  console.log('confirmada em slot', conf.context.slot);
  console.log('\n✓ ATA criada — a fee Verum 2% agora será cobrada nesse mint.');
}

main().catch((e) => {
  console.error('ERRO:', e);
  process.exit(1);
});
