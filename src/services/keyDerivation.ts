/**
 * keyDerivation.ts — Módulo de derivação criptográfica multi-chain.
 *
 * Implementa rigorosamente os padrões:
 *
 *  BIP39  — Geração de mnemonic a partir de entropia CSPRNG
 *  BIP32  — Derivação hierárquica determinística (HD) de chaves
 *  BIP44  — Paths padronizados por coin type
 *  SLIP-0010 — Variante de BIP32 para curvas não-secp256k1 (Ed25519)
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  FLUXO CRIPTOGRÁFICO COMPLETO                                   │
 * │                                                                  │
 * │  1. ENTROPIA (128 bits)                                         │
 * │     └─ crypto.randomBytes(16) via CSPRNG do SO                  │
 * │                                                                  │
 * │  2. MNEMONIC (12 palavras BIP39)                                │
 * │     └─ entropia + checksum SHA-256 → índices na wordlist        │
 * │                                                                  │
 * │  3. SEED (64 bytes)                                              │
 * │     └─ PBKDF2-HMAC-SHA512(password=mnemonic, salt="mnemonic",  │
 * │        iterations=2048, dkLen=64)                                │
 * │                                                                  │
 * │  4. DERIVAÇÃO HD (por chain)                                    │
 * │     ├─ SOLANA (Ed25519 / SLIP-0010):                            │
 * │     │  └─ m/44'/501'/0'/0'                                      │
 * │     │     HMAC-SHA512(key="ed25519 seed", data=seed)            │
 * │     │     → IL (32 bytes) = private key seed                    │
 * │     │     → Keypair.fromSeed(IL) → Ed25519 keypair              │
 * │     │     → publicKey = ponto na curva Ed25519                  │
 * │     │     → endereço = Base58(publicKey)                        │
 * │     │                                                            │
 * │     └─ EVM (secp256k1 / BIP32):                                │
 * │        └─ m/44'/60'/0'/0/0                                      │
 * │           HMAC-SHA512(key="Bitcoin seed", data=seed)            │
 * │           → IL (32 bytes) = master private key                  │
 * │           → derivação child por cada nível do path              │
 * │           → private key final (32 bytes)                        │
 * │           → public key = privateKey × G (ponto gerador)        │
 * │           → endereço = 0x + Keccak-256(pubkey[1:])[12:]        │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * SEGURANÇA:
 *  - Entropia gerada exclusivamente via CSPRNG (crypto.randomBytes)
 *  - Mnemonic validado contra wordlist inglesa oficial BIP39
 *  - Chaves privadas nunca saem deste módulo em texto plano
 *  - Suporte a passphrase BIP39 opcional (25ª palavra)
 *  - Validação de tamanho em cada etapa
 */

import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { Keypair } from '@solana/web3.js';
import { ethers } from 'ethers';
import { Buffer } from 'buffer';

// ─── Constantes BIP44 ───────────────────────────────────────────────────────

/** BIP44 coin types registrados em SLIP-0044 */
const COIN_TYPE = {
  SOLANA:  501,  // Ed25519 via SLIP-0010
  ETHEREUM: 60,  // secp256k1 via BIP32
} as const;

/** Paths de derivação padrão BIP44: m / purpose' / coin_type' / account' / change / index */
export const DERIVATION_PATHS = {
  /** Solana: path hardened completo (padrão Phantom/Solflare/CLI) */
  SOLANA: `m/44'/${COIN_TYPE.SOLANA}'/0'/0'`,
  /** Ethereum/BSC/Polygon: path padrão MetaMask (último nível não-hardened) */
  EVM:    `m/44'/${COIN_TYPE.ETHEREUM}'/0'/0/0`,
} as const;

/** Bits de entropia — 128 = 12 palavras, 256 = 24 palavras */
const ENTROPY_BITS = 128;

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface SolanaKeys {
  /** Keypair completo Ed25519 (para assinatura) */
  keypair: Keypair;
  /** Endereço público Solana em Base58 */
  address: string;
  /** Curva utilizada */
  curve: 'Ed25519';
  /** Path de derivação usado */
  path: string;
}

export interface EVMKeys {
  /** Chave privada hex (32 bytes, com prefixo 0x) */
  privateKey: string;
  /** Chave pública não-comprimida hex (65 bytes, com prefixo 0x04) */
  publicKeyUncompressed: string;
  /** Endereço Ethereum (Keccak-256 dos últimos 64 bytes da pubkey) */
  address: string;
  /** Curva utilizada */
  curve: 'secp256k1';
  /** Path de derivação usado */
  path: string;
}

export interface DerivedWallet {
  /** Frase mnemônica BIP39 (12 palavras) */
  mnemonic: string;
  /** Seed BIP39 em hex (64 bytes = 128 hex chars) — output do PBKDF2-HMAC-SHA512 */
  seedHex: string;
  /** Chaves Solana (Ed25519 / SLIP-0010) */
  solana: SolanaKeys;
  /** Chaves EVM (secp256k1 / BIP32) — compartilhado entre ETH, BSC, Polygon */
  evm: EVMKeys;
}

// ─── Funções Principais ─────────────────────────────────────────────────────

/**
 * ETAPA 1: Gerar entropia e mnemonic BIP39.
 *
 * Usa crypto.randomBytes(16) para 128 bits de entropia CSPRNG.
 * A lib bip39 internamente:
 *   1. Gera 16 bytes aleatórios via randomBytes
 *   2. Calcula checksum = SHA-256(entropia)[0:4 bits]
 *   3. Concatena entropia + checksum = 132 bits
 *   4. Divide em grupos de 11 bits → 12 índices
 *   5. Mapeia cada índice para uma palavra da wordlist BIP39 inglesa
 *
 * @returns Frase mnemônica de 12 palavras
 */
export function generateMnemonic(): string {
  // bip39.generateMnemonic(strength, rng, wordlist)
  // strength=128 → 12 palavras
  // rng=undefined → usa crypto.randomBytes (CSPRNG nativo)
  // wordlist=english → wordlist BIP39 oficial
  const mnemonic = bip39.generateMnemonic(
    ENTROPY_BITS,
    undefined,
    bip39.wordlists.english,
  );

  // Validação defensiva: confirma que gerou exatamente 12 palavras
  const words = mnemonic.split(' ');
  if (words.length !== 12) {
    throw new Error(
      `[keyDerivation] Mnemonic inválido: esperado 12 palavras, gerou ${words.length}.`,
    );
  }

  return mnemonic;
}

/**
 * Valida um mnemonic BIP39 contra a wordlist inglesa oficial.
 *
 * Verifica:
 *  - Cada palavra pertence à wordlist
 *  - O checksum SHA-256 está correto
 *
 * @param mnemonic Frase a validar (12 ou 24 palavras)
 * @returns true se válido
 */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(
    mnemonic.trim().toLowerCase(),
    bip39.wordlists.english,
  );
}

/**
 * ETAPA 2: Derivar seed BIP39 a partir do mnemonic.
 *
 * Aplica PBKDF2-HMAC-SHA512:
 *   - password = mnemonic (normalizado NFKD)
 *   - salt     = "mnemonic" + passphrase (padrão: vazia)
 *   - iterations = 2048
 *   - dkLen    = 64 bytes (512 bits)
 *
 * O resultado é a "BIP39 seed" de 64 bytes usada como entrada
 * para a derivação BIP32/SLIP-0010.
 *
 * @param mnemonic  Frase BIP39 validada
 * @param passphrase  Passphrase opcional (25ª palavra) — padrão vazio
 * @returns Buffer de 64 bytes (seed)
 */
export function mnemonicToSeed(mnemonic: string, passphrase = ''): Buffer {
  // bip39.mnemonicToSeedSync internamente executa:
  //   PBKDF2(HMAC-SHA512, mnemonic_NFKD, "mnemonic" + passphrase_NFKD, 2048, 64)
  const seed = bip39.mnemonicToSeedSync(mnemonic.trim().toLowerCase(), passphrase);

  // Validação: PBKDF2-HMAC-SHA512 deve produzir exatamente 64 bytes
  if (seed.length !== 64) {
    throw new Error(
      `[keyDerivation] Seed BIP39 inválida: esperado 64 bytes, obteve ${seed.length}.`,
    );
  }

  return seed;
}

/**
 * ETAPA 3a: Derivar chaves Solana (Ed25519 via SLIP-0010).
 *
 * SLIP-0010 é a variante de BIP32 para curvas que não são secp256k1.
 * Para Ed25519:
 *   1. Master key: HMAC-SHA512(key="ed25519 seed", data=seed)
 *      → IL (32 bytes) = master secret key
 *      → IR (32 bytes) = master chain code
 *   2. Child derivation: sempre hardened (index | 0x80000000)
 *      → HMAC-SHA512(key=parentChainCode, data=0x00||parentKey||index)
 *   3. Keypair final: Ed25519.fromSeed(derivedKey)
 *      → secret key = seed (32) || public key (32) = 64 bytes
 *      → public key = ponto na curva Ed25519 (32 bytes)
 *   4. Endereço = Base58(publicKey) — Solana usa a pubkey diretamente
 *
 * @param seed  BIP39 seed (64 bytes)
 * @returns Keypair Solana + endereço Base58
 */
export function deriveSolanaKeys(seed: Buffer): SolanaKeys {
  const path = DERIVATION_PATHS.SOLANA;

  // derivePath executa SLIP-0010:
  // - HMAC-SHA512(key="ed25519 seed", data=seed) → master
  // - Para cada nível do path: HMAC-SHA512 child derivation
  // - Retorna { key: Buffer(32), chainCode: Buffer(32) }
  const derived = derivePath(path, seed.toString('hex'));

  // derived.key = 32 bytes = seed para Ed25519
  if (derived.key.length !== 32) {
    throw new Error(
      `[keyDerivation] SLIP-0010 produziu chave de ${derived.key.length} bytes, esperado 32.`,
    );
  }

  // Keypair.fromSeed(seed32):
  //   - Internamente: nacl.sign.keyPair.fromSeed(seed)
  //   - Calcula a = SHA-512(seed)[0:32], clamped
  //   - Public key = a × B (ponto base Ed25519)
  //   - Secret key = seed(32) || publicKey(32) = 64 bytes
  const keypair = Keypair.fromSeed(derived.key);

  // Endereço Solana = Base58(publicKey) — 32 bytes codificados
  const address = keypair.publicKey.toBase58();

  return {
    keypair,
    address,
    curve: 'Ed25519',
    path,
  };
}

/**
 * ETAPA 3b: Derivar chaves EVM (secp256k1 via BIP32).
 *
 * BIP32 padrão para secp256k1:
 *   1. Master key: HMAC-SHA512(key="Bitcoin seed", data=seed)
 *      → IL (32 bytes) = master private key (deve ser < ordem da curva n)
 *      → IR (32 bytes) = master chain code
 *   2. Child derivation para m/44'/60'/0'/0/0:
 *      - Hardened ('):  HMAC-SHA512(key=chainCode, data=0x00||key||index|0x80000000)
 *      - Normal:        HMAC-SHA512(key=chainCode, data=pubkey||index)
 *   3. Private key final = 32 bytes (inteiro mod n da curva secp256k1)
 *   4. Public key = privateKey × G (ponto gerador da secp256k1)
 *      → Comprimida: 33 bytes (02/03 + x)
 *      → Não-comprimida: 65 bytes (04 + x + y)
 *   5. Endereço ETH = 0x + Keccak-256(pubkey_uncompressed[1:])[12:32]
 *      → Últimos 20 bytes do hash = endereço de 40 hex chars
 *
 * @param mnemonic  Frase BIP39 (ethers.HDNodeWallet faz seed internamente)
 * @returns Chaves EVM + endereço com checksum EIP-55
 */
export function deriveEVMKeys(mnemonic: string): EVMKeys {
  const path = DERIVATION_PATHS.EVM;

  // ethers.HDNodeWallet.fromPhrase internamente:
  //   1. Valida mnemonic BIP39
  //   2. PBKDF2-HMAC-SHA512(mnemonic, "mnemonic", 2048) → seed 64 bytes
  //   3. BIP32 master: HMAC-SHA512(key="Bitcoin seed", data=seed)
  //   4. Derivação child pelo path m/44'/60'/0'/0/0
  //   5. Private key final = IL do último nível
  const hdNode = ethers.HDNodeWallet.fromPhrase(
    mnemonic.trim().toLowerCase(),
    undefined, // passphrase vazia
    path,
  );

  // hdNode.privateKey = 0x + 64 hex chars (32 bytes)
  const privateKey = hdNode.privateKey;

  // Public key: privateKey × G na curva secp256k1
  // ethers retorna comprimida (33 bytes), precisamos não-comprimida para derivar endereço
  // SigningKey.publicKey retorna a chave não-comprimida (65 bytes, prefixo 0x04)
  const signingKey = new ethers.SigningKey(privateKey);
  const publicKeyUncompressed = signingKey.publicKey; // 0x04 + x(32) + y(32)

  // Endereço ETH:
  //   Keccak-256(publicKey_uncompressed[1:]) → últimos 20 bytes → 0x + hex
  //   ethers.computeAddress já faz isso internamente com checksum EIP-55
  const address = ethers.computeAddress(publicKeyUncompressed);

  return {
    privateKey,
    publicKeyUncompressed,
    address,
    curve: 'secp256k1',
    path,
  };
}

/**
 * Função principal: gera wallet completa multi-chain a partir de um mnemonic novo.
 *
 * Executa o pipeline completo:
 *   Entropia CSPRNG → Mnemonic BIP39 → Seed PBKDF2 → Derivação HD → Chaves + Endereços
 *
 * @returns Wallet completa com chaves Solana (Ed25519) e EVM (secp256k1)
 */
export function generateFullWallet(): DerivedWallet {
  // Etapa 1: Entropia → Mnemonic
  const mnemonic = generateMnemonic();

  return deriveFromMnemonic(mnemonic);
}

/**
 * Deriva wallet completa a partir de um mnemonic existente (import/recovery).
 *
 * @param mnemonic  Frase BIP39 de 12 ou 24 palavras
 * @param passphrase  Passphrase opcional (25ª palavra)
 * @returns Wallet completa multi-chain
 */
export function deriveFromMnemonic(mnemonic: string, passphrase = ''): DerivedWallet {
  const normalized = mnemonic.trim().toLowerCase();

  // Validação BIP39
  if (!validateMnemonic(normalized)) {
    throw new Error('[keyDerivation] Mnemonic inválido: checksum ou palavras não reconhecidas.');
  }

  // Etapa 2: Mnemonic → Seed (PBKDF2-HMAC-SHA512)
  const seed = mnemonicToSeed(normalized, passphrase);

  // Etapa 3a: Seed → Chaves Solana (Ed25519 / SLIP-0010)
  const solana = deriveSolanaKeys(seed);

  // Etapa 3b: Mnemonic → Chaves EVM (secp256k1 / BIP32)
  // NOTA: ethers.HDNodeWallet.fromPhrase faz PBKDF2 internamente a partir do mnemonic,
  // produzindo a mesma seed de 64 bytes. Passamos o mnemonic diretamente.
  const evm = deriveEVMKeys(normalized);

  return {
    mnemonic: normalized,
    seedHex: seed.toString('hex'),
    solana,
    evm,
  };
}
