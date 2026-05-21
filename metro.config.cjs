const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Excluir a pasta backend das buscas do Metro para evitar conflitos de node_modules
config.resolver.blockList = [
  /backend\/.*/,
];

// Polyfills para módulos Node.js usados por @solana/web3.js e bip39 no browser
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  buffer: require.resolve('buffer/'),
  crypto: require.resolve('crypto-browserify'),
  stream: require.resolve('stream-browserify'),
  process: require.resolve('process/browser'),
  path: require.resolve('path-browserify'),
};

module.exports = config;
