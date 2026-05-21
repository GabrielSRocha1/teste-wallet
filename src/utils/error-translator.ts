export const translateError = (error: any): string => {
  const message = typeof error === 'string' ? error : error?.message || '';
  const lower = message.toLowerCase();

  // Códigos específicos de swap Solana — checados primeiro (mais específicos)
  if (
    lower.includes('blockhashnotfound') ||
    lower.includes('block height exceeded') ||
    lower.includes('blockhash_expired') ||
    lower.includes('blockhash expirado') ||
    lower.includes('transactionexpired')
  ) {
    return 'A cotação expirou enquanto a transação era enviada. Tente novamente — vamos buscar uma nova cotação.';
  }

  if (
    lower.includes('0x1771') ||
    lower.includes('slippagetoleranceexceeded') ||
    lower.includes('slippage tolerance')
  ) {
    return 'O preço mudou mais do que a tolerância (0,5%). Tente novamente; se persistir, reduza o valor.';
  }

  if (
    lower.includes('insufficientfundsforrent') ||
    (lower.includes('accountnotfound') && lower.includes('destination'))
  ) {
    return 'Esta é a primeira vez que você recebe este token. Será criada uma conta SPL (~0,002 SOL). Confirme novamente.';
  }

  if (
    lower.includes('"custom":1') ||
    lower.includes('insufficientfunds')
  ) {
    return 'Saldo insuficiente. Confirme que você tem SOL para a taxa de rede (~0,005) além do valor do swap.';
  }

  if (lower.includes('transaction simulation failed') || lower.includes('simula')) {
    return 'A rede recusou a transação na pré-validação. Atualize a cotação e tente novamente.';
  }

  if (lower.startsWith('timeout') || lower.includes('timeout:') || lower.includes('não confirmada após')) {
    return 'A rede está congestionada. Verifique seu histórico antes de tentar de novo — a transação pode ainda confirmar.';
  }

  // Dicionário genérico
  const translations: Record<string, string> = {
    'insufficient funds': 'Saldo insuficiente para realizar esta operação.',
    'User rejected the request': 'A transação foi cancelada pelo usuário.',
    'transaction failed': 'A transação falhou. Tente novamente mais tarde.',
    'network error': 'Erro de conexão. Verifique sua internet.',
    'Account not found': 'Carteira de destino não encontrada.',
    'invalid address': 'Endereço de carteira inválido.',
    'rate limit exceeded': 'Limite de requisições excedido. Aguarde um momento.',
    'balance is too low': 'Seu saldo é insuficiente para cobrir as taxas.',
    'amount must be greater than 0': 'O valor deve ser maior que zero.',
    'user not found': 'Usuário não encontrado no sistema.',
    'invalid amount': 'O valor inserido é inválido.',
    'unauthorized': 'Sessão expirada. Faça login novamente.',
    'transaction expired': 'A transação expirou. Tente novamente.',
  };

  for (const [key, value] of Object.entries(translations)) {
    if (lower.includes(key.toLowerCase())) {
      return value;
    }
  }

  return message || 'Ocorreu um erro inesperado.';
};
