const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const { Keypair } = require('@solana/web3.js');

const mnemonic = 'soccer patrol broom valid brief whip omit fruit enable frown afford gain';
const seed = bip39.mnemonicToSeedSync(mnemonic);

console.log('Seed length:', seed.length);

const derivedFromBuffer = derivePath("m/44'/501'/0'/0'", seed).key;
const keypairFromBuffer = Keypair.fromSeed(derivedFromBuffer);
console.log('PublicKey from Buffer:', keypairFromBuffer.publicKey.toBase58());

const derivedFromHex = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
const keypairFromHex = Keypair.fromSeed(derivedFromHex);
console.log('PublicKey from Hex:', keypairFromHex.publicKey.toBase58());
