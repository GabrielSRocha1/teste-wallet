import React from 'react';
const { createContext, useContext, useState, useEffect, useCallback, useRef } = React;
import * as SettingsStorage from '@/constants/settings-storage';
import transactionService from '@/src/services/transactionService';
import { io, Socket } from 'socket.io-client';

export type Language = 'en' | 'es' | 'pt';
export type Currency = 'USD' | 'BRL' | 'PYG';

export type SupportedToken = 'SOL' | 'USDT' | 'USDC' | 'BNB' | 'ESCT' | 'BODE' | string;
export type SupportedCurrency = 'BRL' | 'USD' | 'PYG';

export type PriceMap = {
  [token in SupportedToken]?: {
    [currency in SupportedCurrency]?: number;
  };
};

interface SettingsContextType {
  language: Language;
  currency: Currency;
  network: 'mainnet' | 'devnet';
  prices: PriceMap;
  walletName: string | null;
  setLanguage: (lang: Language) => Promise<void>;
  setCurrency: (curr: Currency) => Promise<void>;
  setNetwork: (net: 'mainnet' | 'devnet') => Promise<void>;
  setWalletName: (name: string | null) => Promise<void>;
  t: (key: string, params?: Record<string, string>) => string;
  formatCurrency: (value: number, keepDecimals?: boolean) => string;
  convertToCrypto: (amount: number, fromCurrency: SupportedCurrency, token: SupportedToken) => number | null;
}

import { getApiBaseUrl, SWAP_API_URL } from '@/src/services/apiUrl';

export const API_URL = getApiBaseUrl();

const translations: Record<Language, Record<string, string>> = {
  pt: {
    // Menu & Navigation
    'Receber Crypto': 'Receber Crypto',
    'Comprar Crypto': 'Comprar Crypto',
    'Investir': 'Investir',
    'Câmbio': 'Câmbio',
    'Pagar': 'Pagar',
    'Configurações': 'Configurações',
    'Sair': 'Sair',
    'VOLTAR': 'VOLTAR',
    'FECHAR': 'FECHAR',
    'CONCLUÍDO': 'CONCLUÍDO',
    'CONCLUIR': 'CONCLUIR',
    'CANCELAR': 'CANCELAR',
    'CONFIRMAR': 'CONFIRMAR',
    'ERRO': 'ERRO',
    'SUCESSO': 'SUCESSO',
    'FALHA': 'FALHA',
    'Aviso': 'Aviso',
    'PRINCIPAL': 'PRINCIPAL',

    // Home Screen
    'BEM-VINDO AO VERUM': 'BEM-VINDO AO VERUM',
    'Investidor': 'Investidor',
    'PATRIMÔNIO TOTAL': 'PATRIMÔNIO TOTAL',
    'SALDO TOTAL': 'SALDO TOTAL',
    'SALDO ESTIMADO': 'SALDO ESTIMADO',
    'Recebido': 'Recebido',
    'Enviado': 'Enviado',
    'Saldo oculto': 'Saldo oculto',
    'MEU': 'MEU',
    'PATRIMÔNIO': 'PATRIMÔNIO',
    'RECEBER': 'RECEBER',
    'ENVIAR': 'ENVIAR',
    'MODO SEGURO': 'MODO SEGURO',
    'Sua carteira está protegida por criptografia de ponta. Autentique-se para visualizar seu patrimônio.': 'Sua carteira está protegida por criptografia de ponta. Autentique-se para visualizar seu patrimônio.',
    'DESBLOQUEAR ACESSO': 'DESBLOQUEAR ACESSO',
    'Seus Ativos': 'SEUS ATIVOS',
    'Ver Tudo': 'VER TUDO',
    'Atividade Recente': 'ATIVIDADE RECENTE',
    'Histórico': 'HISTÓRICO',
    'Nenhuma transação encontrada': 'Nenhuma transação encontrada',
    'Endereço copiado!': 'Endereço copiado!',
    'Código PIX copiado!': 'Código PIX copiado!',

    // Auth & Login
    'BEM-VINDO': 'BEM-VINDO',
    'Acesse sua carteira digital exclusiva e gerencie seus ativos na rede Solana.': 'Acesse sua carteira digital exclusiva e gerencie seus ativos na rede Solana.',
    'E-mail': 'E-mail',
    'Telefone': 'Telefone',
    'Seu e-mail': 'Seu e-mail',
    'Sua senha': 'Sua senha',
    'Seu número': 'Seu número',
    'ENTRAR': 'ENTRAR',
    'OU': 'OU',
    'Ainda não tem acesso?': 'Ainda não tem acesso?',
    'Registre-se': 'Registre-se',
    'Esqueceu sua senha?': 'Esqueceu sua senha?',
    'NOVO CADASTRO': 'NOVO CADASTRO',
    'Inicie sua jornada no ecossistema Verum': 'Inicie sua jornada no ecossistema Verum',
    'Nome completo': 'Nome completo',
    'Repetir senha': 'Repetir senha',
    'CRIAR CONTA': 'Criar carteira',
    'VERIFIQUE SEU E-MAIL': 'VERIFIQUE SEU E-MAIL',
    'Enviamos um link de ativação para {email}. Acesse seu e-mail para confirmar.': 'Enviamos um link de ativação para {email}. Acesse seu e-mail para confirmar.',
    'CONTINUAR': 'CONTINUAR',
    'Por favor preencha os campos obrigatórios.': 'Por favor preencha os campos obrigatórios.',
    'Erro ao entrar': 'Erro ao entrar',
    'Credenciais inválidas.': 'Credenciais inválidas.',
    'Preencha todos os campos.': 'Preencha todos os campos.',
    'Senhas não coincidem.': 'Senhas não coincidem.',
    'Carteira Gerada!': 'Carteira Gerada!',
    'Frase de segurança:\n\n{mnemonic}\n\nCopie e guarde bem.': 'Frase de segurança:\n\n{mnemonic}\n\nCopie e guarde bem.',
    'Copiar e Continuar': 'Copiar e Continuar',

    // Send Crypto
    'ENVIAR CRIPTO': 'ENVIAR CRIPTO',
    'Transfira ativos entre carteiras digitais no ecossistema Solana.': 'Transfira ativos entre carteiras digitais no ecossistema Solana.',
    'ATIVO': 'ATIVO',
    'Escolha o ativo': 'Escolha o ativo',
    'QUANTIDADE': 'QUANTIDADE',
    'MÁXIMO': 'MÁXIMO',
    'ENDEREÇO DE DESTINO': 'ENDEREÇO DE DESTINO',
    'Chave pública Solana': 'Chave pública Solana',
    'Certifique-se que o destinatário e a rede (Solana) estão corretos para evitar perda de fundos.': 'Certifique-se que o destinatário e a rede (Solana) estão corretos para evitar perda de fundos.',
    'CONFIRMAR ENVIO': 'CONFIRMAR ENVIO',
    'Digite sua senha para autorizar a transação:': 'Digite sua senha para autorizar a transação:',
    'Transferência enviada com sucesso para a rede Solana.': 'Transferência enviada com sucesso para a rede Solana.',
    'ENVIAR ATIVOS': 'ENVIAR ATIVOS',
    'Transfira fundos com segurança dentro da rede Solana.': 'Transfira fundos com segurança dentro da rede Solana.',
    'E-mail ou endereço de carteira': 'E-mail ou endereço de carteira',
    'DESCRIÇÃO (OPCIONAL)': 'DESCRIÇÃO (OPCIONAL)',
    'Referência da transação...': 'Referência da transação...',
    'Confirme seu envio': 'Confirme seu envio',
    'Usar Senha': 'Usar Senha',
    'Sessão Expirada': 'Sessão Expirada',
    'Por favor, digite sua senha.': 'Por favor, digite sua senha.',
    'Senha incorreta.': 'Senha incorreta.',
    'Erro no Envio': 'Erro no Envio',
    'Falha ao processar.': 'Falha ao processar.',
    'Autorize o envio de {amount} {currency} para {destinatario}...': 'Autorize o envio de {amount} {currency} para {destinatario}...',
    'Não foi possível processar o envio.': 'Não foi possível processar o envio.',
    'Sua transação foi enviada para a rede Solana.': 'Sua transação foi enviada para a rede Solana.',
    'Por favor, preencha todos os campos.': 'Por favor, preencha todos os campos.',
    'Transferência enviada': 'Transferência enviada',
    'Transferência recebida': 'Transferência recebida',

    // Deposit Pix
    'COMPRAR CRYPTO': 'COMPRAR CRYPTO',
    'Converta BRL para USDT instantaneamente através do ecossistema Verum.': 'Converta BRL para USDT instantaneamente através do ecossistema Verum.',
    'VALOR DO DEPÓSITO': 'VALOR DO DEPÓSITO',
    'VALOR EM REAIS (BRL)': 'VALOR EM REAIS (BRL)',
    'VALOR EM DÓLAR (USD)': 'VALOR EM DÓLAR (USD)',
    'VALOR EM GUARANI (PYG)': 'VALOR EM GUARANI (PYG)',
    'Você Receberá': 'Você Receberá',
    'Mínimo R$ 2,00': 'Mínimo R$ 2,00',
    'GERAR CÓDIGO PIX': 'GERAR CÓDIGO PIX',
    'FORMA DE PAGAMENTO': 'FORMA DE PAGAMENTO',
    'PIX': 'PIX',
    'Transferência': 'Transferência',
    'Cartão': 'Cartão',
    'VER DADOS BANCÁRIOS': 'VER DADOS BANCÁRIOS',
    'PAGAR COM CARTÃO': 'PAGAR COM CARTÃO',
    'PAGAMENTO PENDENTE': 'PAGAMENTO PENDENTE',
    'Pague R$ {amount} no seu App Bancário': 'Pague R$ {amount} no seu App Bancário',
    'A conversão para USDT será processada automaticamente após a confirmação do PIX.': 'A conversão para USDT será processada automaticamente após a confirmação do PIX.',
    'Escanear QR Code': 'Escanear QR Code',
    'PIX COPIA E COLA': 'PIX COPIA E COLA',
    'CONFIRMAR PAGAMENTO': 'CONFIRMAR PAGAMENTO',
    'VOLTAR / ALTERAR VALOR': 'VOLTAR / ALTERAR VALOR',
    'Aguardando compensação bancária...': 'Aguardando compensação bancária...',

    // Deposit Crypto
    'RECEBER ATIVOS': 'RECEBER ATIVOS',
    'Selecione uma rede para gerar seu endereço de depósito exclusivo.': 'Selecione uma rede para gerar seu endereço de depósito exclusivo.',
    'CONFIGURAR DEPÓSITO': 'CONFIGURAR DEPÓSITO',
    'REDE DE DESTINO': 'REDE DE DESTINO',
    'Selecione a rede de depósito': 'Selecione a rede de depósito',
    'Selecione uma rede': 'Selecione uma rede',
    'GERAR ENDEREÇO': 'GERAR ENDEREÇO',
    'SUA CHAVE PÚBLICA SOLANA (SPL)': 'SUA CHAVE PÚBLICA SOLANA (SPL)',
    'SEU ENDEREÇO': 'SEU ENDEREÇO',
    'Aguardando transação...': 'Aguardando transação...',
    'ENDEREÇO DA CARTEIRA': 'ENDEREÇO DA CARTEIRA',
    'ENDEREÇO PÚBLICO': 'ENDEREÇO PÚBLICO',
    'Envie apenas {network} para este endereço. Outros ativos serão perdidos permanentemente.': 'Envie apenas {network} para este endereço. Outros ativos serão perdidos permanentemente.',
    'ESCOLHER REDE': 'ESCOLHER REDE',
    'Endereço copiado para a área de transferência.': 'Endereço copiado para a área de transferência.',

    // Notifications
    'NOTIFICAÇÕES': 'NOTIFICAÇÕES',
    'Nenhuma nova notificação': 'Nenhuma nova notificação',
    'Tudo limpo por aqui!': 'Tudo limpo por aqui!',
    'LIMPAR TUDO': 'LIMPAR TUDO',
    'TODAS': 'TODAS',
    'RECEBIDOS': 'RECEBIDOS',
    'ENVIADOS': 'ENVIADOS',
    'ERROS': 'ERROS',
    'LIDAS': 'LIDAS',
    'NENHUMA NOTIFICAÇÃO': 'NENHUMA NOTIFICAÇÃO',
    'Transação concluída': 'Transação concluída',
    'Recebimento confirmado': 'Recebimento confirmado',
    'Pagamento enviado': 'Pagamento enviado',
    'Câmbio realizado': 'Câmbio realizado',
    'Depósito via PIX': 'Depósito via PIX',
    'Transação falhou': 'Transação falhou',
    'Segurança da conta': 'Segurança da conta',
    'Saque processado': 'Saque processado',
    'Hoje': 'Hoje',
    'Ontem': 'Ontem',

    // Swap / Cambio
    'CÂMBIO VERUM': 'CÂMBIO VERUM',
    'Troque seus ativos com liquidez instantânea e taxas competitivas.': 'Troque seus ativos com liquidez instantânea e taxas competitivas.',
    'VOCÊ ENVIA': 'VOCÊ ENVIA',
    'VOCÊ RECEBE': 'VOCÊ RECEBE',
    'SALDO:': 'SALDO:',
    'Total estimado a receber:': 'Total estimado a receber:',
    'CONFIRMAR TROCA': 'CONFIRMAR TROCA',
    'MERCADO EM TEMPO REAL': 'MERCADO EM TEMPO REAL',
    'SELECIONAR ATIVO': 'SELECIONAR ATIVO',
    'Filtrar por nome...': 'Filtrar por nome...',
    'SEGURANÇA': 'SEGURANÇA',
    'Confirme sua senha para processar o câmbio:': 'Confirme sua senha para processar o câmbio:',
    'A troca de ativos foi enviada para processamento e será confirmada em breve.': 'A troca de ativos foi enviada para processamento e será confirmada em breve.',
    'REDUZIR': 'CONFIRMAR',

    // Settings & Security
    'Geral': 'Geral',
    'Idioma': 'Idioma',
    'Moeda': 'Moeda',
    'CONTA & SEGURANÇA': 'CONTA & SEGURANÇA',
    'Segurança e Privacidade': 'Segurança e Privacidade',
    'PREFERÊNCIAS': 'PREFERÊNCIAS',
    'Notificações Push': 'Notificações Push',
    'Bloqueio Biométrico': 'Bloqueio Biométrico',
    'Autentique-se para habilitar': 'Autentique-se para habilitar',
    'Biometria não disponível.': 'Biometria não disponível.',
    'SUPORTE & INFORMAÇÕES': 'SUPORTE & INFORMAÇÕES',
    'Central de Ajuda': 'Central de Ajuda',
    'Sobre o Verum': 'Sobre o Verum',
    'BACKUP E CHAVES': 'BACKUP E CHAVES',
    'Exportar Chave Privada': 'Exportar Chave Privada',
    'Acesso direto à sua conta': 'Acesso direto à sua conta',
    'Frase de Recuperação': 'Frase de Recuperação',
    'As 12 palavras mestras': 'As 12 palavras mestras',
    'PROTEÇÃO DE ACESSO': 'PROTEÇÃO DE ACESSO',
    'Autenticação Biométrica': 'Autenticação Biométrica',
    'Configurar FaceID ou Digital': 'Configurar FaceID ou Digital',
    'Identificação da Carteira': 'Identificação da Carteira',
    'Ex: Carteira Principal': 'Ex: Carteira Principal',
    'IDENTIFICAÇÃO': 'IDENTIFICAÇÃO',
    'Dê um nome para sua carteira para facilitar a identificação:': 'Dê um nome para sua carteira para facilitar a identificação:',
    'Ex: Minha Verum': 'Ex: Minha Verum',
    'Identificação atualizada!': 'Identificação atualizada!',
    'Sua frase de segurança é o único acesso aos seus fundos. NUNCA a compartilhe.': 'Sua frase de segurança é o único acesso aos seus fundos. NUNCA a compartilhe.',

    // Others
    'Preencha todos os campos antes de continuar.': 'Preencha todos os campos antes de continuar.',
    'POSICIONE O QR CODE NO CENTRO': 'POSICIONE O QR CODE NO CENTRO',
    'Aponte para o QR Code': 'Aponte para o QR Code',
    'Acesso Negado': 'Acesso Negado',
    'Permita o uso da câmera nas configurações.': 'Permita o uso da câmera nas configurações.',
    'Calculadora de Câmbio': 'Calculadora de Câmbio',
    '(Digite o valor no campo da moeda desejada)': '(Digite o valor no campo da moeda desejada)',
    'Versão': 'Versão',

    // Investir
    'LIBERDADE FINANCEIRA': 'LIBERDADE FINANCEIRA',
    'Invista nos ativos do ecossistema Verum e acelere seu crescimento patrimonial.': 'Invista nos ativos do ecossistema Verum e acelere seu crescimento patrimonial.',
    'PREÇO ATUAL': 'PREÇO ATUAL',
    'INVESTIR AGORA': 'INVESTIR AGORA',
    'Inglês': 'Inglês',
    'Espanhol': 'Espanhol',
    'Português': 'Português',
    'Dólar Americano': 'Dólar Americano',
    'Real Brasileiro': 'Real Brasileiro',
    'Guarani Paraguaio': 'Guarani Paraguaio',
    'Escolha a moeda de depósito': 'Escolha a moeda de depósito',
    'Autentique-se para acessar a carteira': 'Autentique-se para acessar a carteira',
    'Já tenho uma Carteira': 'Já tenho uma Carteira',
    'RECUPERAR CARTEIRA': 'RECUPERAR CARTEIRA',
    'Frase de Recuperação (12 palavras)': 'Frase de Recuperação (12 palavras)',
    'Cole sua frase de 12 palavras separadas por espaços para recuperar o acesso à sua conta na rede Solana.': 'Cole sua frase de 12 palavras separadas por espaços para recuperar o acesso à sua conta na rede Solana.',
    'COLAR FRASE': 'COLAR FRASE',
    'CONECTAR CARTEIRA': 'CONECTAR CARTEIRA',
    'Recuperando carteira...': 'Recuperando carteira...',
    'E-mail não encontrado. Por favor, faça o cadastro primeiro ou use o e-mail correto.': 'E-mail não encontrado. Por favor, faça o cadastro primeiro ou use o e-mail correto.',
    'Privacidade': 'Privacidade',
    'Política de Privacidade': 'Política de Privacidade',
    'AVISO DE PRIVACIDADE': 'AVISO DE PRIVACIDADE',
    'Última Atualização': 'Última Atualização',
    'ESTRUTURA JURÍDICA E JURISDIÇÃO': '1. ESTRUTURA JURÍDICA E JURISDIÇÃO',
    'O PILAR DA AUTOCUSTÓDIA (NON-CUSTODIAL SHIELD)': '2. O PILAR DA AUTOCUSTÓDIA (NON-CUSTODIAL SHIELD)',
    'VERUM PAY: IRREVERSIBILIDADE E CONVERSÃO FIDUCIÁRIA': '3. VERUM PAY: IRREVERSIBILIDADE E CONVERSÃO FIDUCIÁRIA',
    'CONFORMIDADE AML E COLETA DE DADOS (KYC)': '4. CONFORMIDADE AML E COLETA DE DADOS (KYC)',
    'PROTEÇÃO DE DADOS (LEI 81/2019 E GDPR)': '5. PROTEÇÃO DE DADOS (LEI 81/2019 E GDPR)',
    'LIMITAÇÃO DE RESPONSABILIDADE': '6. LIMITAÇÃO DE RESPONSABILIDADE',
    'Entendi e Aceito': 'Entendi e Aceito',
    'Termos e Política de Privacidade': 'Termos e Política de Privacidade',
  },
  en: {
    // Menu & Navigation
    'Receber Crypto': 'Receive Crypto',
    'Comprar Crypto': 'Buy Crypto',
    'Investir': 'Invest',
    'Câmbio': 'Swap',
    'Pagar': 'Pay',
    'Configurações': 'Settings',
    'Sair': 'Logout',
    'VOLTAR': 'BACK',
    'FECHAR': 'CLOSE',
    'CONCLUÍDO': 'COMPLETED',
    'CONCLUIR': 'FINISH',
    'CANCELAR': 'CANCEL',
    'CONFIRMAR': 'CONFIRM',
    'ERRO': 'ERROR',
    'SUCESSO': 'SUCCESS',
    'FALHA': 'FAILED',
    'Aviso': 'Warning',
    'PRINCIPAL': 'PRIMARY',

    // Home Screen
    'BEM-VINDO AO VERUM': 'WELCOME TO VERUM',
    'Investidor': 'Investor',
    'PATRIMÔNIO TOTAL': 'TOTAL BALANCE',
    'SALDO TOTAL': 'TOTAL BALANCE',
    'SALDO ESTIMADO': 'ESTIMATED BALANCE',
    'Recebido': 'Received',
    'Enviado': 'Sent',
    'Saldo oculto': 'Hidden balance',
    'MEU': 'MY',
    'PATRIMÔNIO': 'HOLDINGS',
    'RECEBER': 'RECEIVE',
    'ENVIAR': 'SEND',
    'MODO SEGURO': 'SAFE MODE',
    'Sua carteira está protegida por criptografia de ponta. Autentique-se para visualizar seu patrimônio.': 'Your wallet is protected by end-to-end encryption. Authenticate to view your holdings.',
    'DESBLOQUEAR ACESSO': 'UNLOCK ACCESS',
    'Seus Ativos': 'YOUR ASSETS',
    'Ver Tudo': 'SEE ALL',
    'Atividade Recente': 'RECENT ACTIVITY',
    'Histórico': 'HISTORY',
    'Nenhuma transação encontrada': 'No transactions found',
    'Endereço copiado!': 'Address copied!',
    'Código PIX copiado!': 'PIX code copied!',

    // Auth & Login
    'BEM-VINDO': 'WELCOME',
    'Acesse sua carteira digital exclusiva e gerencie seus ativos na rede Solana.': 'Access your exclusive digital wallet and manage your assets on the Solana network.',
    'E-mail': 'E-mail',
    'Telefone': 'Phone',
    'Seu e-mail': 'Your email',
    'Sua senha': 'Your password',
    'Seu número': 'Your number',
    'ENTRAR': 'LOGIN',
    'OU': 'OR',
    'Ainda não tem acesso?': 'Don\'t have access yet?',
    'Registre-se': 'Sign up',
    'Esqueceu sua senha?': 'Forgot your password?',
    'NOVO CADASTRO': 'NEW REGISTRATION',
    'Inicie sua jornada no ecossistema Verum': 'Start your journey in the Verum ecosystem',
    'Nome completo': 'Full name',
    'Repetir senha': 'Repeat password',
    'CRIAR CONTA': 'Create Wallet',
    'VERIFIQUE SEU E-MAIL': 'VERIFY YOUR EMAIL',
    'Enviamos um link de ativação para {email}. Acesse seu e-mail para confirmar.': 'We sent an activation link to {email}. Check your email to confirm.',
    'CONTINUAR': 'CONTINUE',
    'Por favor preencha os campos obrigatórios.': 'Please fill in the required fields.',
    'Erro ao entrar': 'Error logging in',
    'Credenciais inválidas.': 'Invalid credentials.',
    'Preencha todos os campos.': 'Fill in all fields.',
    'Senhas não coincidem.': 'Passwords do not match.',
    'Carteira Gerada!': 'Wallet Generated!',
    'Frase de segurança:\n\n{mnemonic}\n\nCopie e guarde bem.': 'Recovery phrase:\n\n{mnemonic}\n\nCopy and keep it safe.',
    'Copiar e Continuar': 'Copy and Continue',

    // Send Crypto
    'ENVIAR CRIPTO': 'SEND CRYPTO',
    'Transfira ativos entre carteiras digitais no ecossistema Solana.': 'Transfer assets between digital wallets in the Solana ecosystem.',
    'ATIVO': 'ASSET',
    'Escolha o ativo': 'Choose asset',
    'QUANTIDADE': 'AMOUNT',
    'MÁXIMO': 'MAX',
    'ENDEREÇO DE DESTINO': 'DESTINATION ADDRESS',
    'Chave pública Solana': 'Solana public key',
    'Certifique-se que o destinatário e a rede (Solana) estão corretos para evitar perda de fundos.': 'Make sure the recipient and network (Solana) are correct to avoid loss of funds.',
    'CONFIRMAR ENVIO': 'CONFIRM SEND',
    'Digite sua senha para autorizar a transação:': 'Enter your password to authorize the transaction:',
    'Transferência enviada com sucesso para a rede Solana.': 'Transfer successfully sent to the Solana network.',
    'ENVIAR ATIVOS': 'SEND ASSETS',
    'Transfira fundos com segurança dentro da rede Solana.': 'Transfer funds safely within the Solana network.',
    'E-mail ou endereço de carteira': 'Email or wallet address',
    'DESCRIÇÃO (OPCIONAL)': 'DESCRIPTION (OPTIONAL)',
    'Referência da transação...': 'Transaction reference...',
    'Confirme seu envio': 'Confirm your send',
    'Usar Senha': 'Use Password',
    'Sessão Expirada': 'Session Expired',
    'Por favor, digite sua senha.': 'Please enter your password.',
    'Senha incorreta.': 'Incorrect password.',
    'Erro no Envio': 'Send Error',
    'Falha ao processar.': 'Failed to process.',
    'Autorize o envio de {amount} {currency} para {destinatario}...': 'Authorize the sending of {amount} {currency} to {destinatario}...',
    'Não foi possível processar o envio.': 'Could not process the send.',
    'Sua transação foi enviada para a rede Solana.': 'Your transaction has been sent to the Solana network.',
    'Por favor, preencha todos os campos.': 'Please fill in all fields.',
    'Transferência enviada': 'Transfer sent',
    'Transferência recebida': 'Transfer received',

    // Deposit Pix
    'COMPRAR CRYPTO': 'BUY CRYPTO',
    'Converta BRL para USDT instantaneamente através do ecossistema Verum.': 'Convert BRL to USDT instantly through the Verum ecosystem.',
    'VALOR DO DEPÓSITO': 'DEPOSIT AMOUNT',
    'VALOR EM REAIS (BRL)': 'AMOUNT IN REAIS (BRL)',
    'VALOR EM DÓLAR (USD)': 'AMOUNT IN DOLLARS (USD)',
    'VALOR EM GUARANI (PYG)': 'AMOUNT IN GUARANI (PYG)',
    'Você Receberá': 'You Will Receive',
    'Mínimo R$ 2,00': 'Minimum R$ 2.00',
    'GERAR CÓDIGO PIX': 'GENERATE PIX CODE',
    'FORMA DE PAGAMENTO': 'PAYMENT METHOD',
    'PIX': 'PIX',
    'Transferência': 'Bank Transfer',
    'Cartão': 'Card',
    'VER DADOS BANCÁRIOS': 'VIEW BANK DETAILS',
    'PAGAR COM CARTÃO': 'PAY WITH CARD',
    'PAGAMENTO PENDENTE': 'PENDING PAYMENT',
    'Pague R$ {amount} no seu App Bancário': 'Pay R$ {amount} in your Banking App',
    'A conversão para USDT será processada automatically após a confirmação do PIX.': 'Conversion to USDT will be processed automatically after PIX confirmation.',
    'Escanear QR Code': 'Scan QR Code',
    'PIX COPIA E COLA': 'PIX COPY AND PASTE',
    'CONFIRMAR PAGAMENTO': 'CONFIRM PAYMENT',
    'VOLTAR / ALTERAR VALOR': 'BACK / CHANGE AMOUNT',
    'Aguardando compensação bancária...': 'Waiting for bank clearing...',

    // Deposit Crypto
    'RECEBER ATIVOS': 'RECEIVE ASSETS',
    'Selecione uma rede para gerar seu endereço de depósito exclusivo.': 'Select a network to generate your unique deposit address.',
    'CONFIGURAR DEPÓSITO': 'CONFIGURE DEPOSIT',
    'REDE DE DESTINO': 'DESTINATION NETWORK',
    'Selecione a rede de depósito': 'Select the deposit network',
    'Selecione uma rede': 'Select a network',
    'GERAR ENDEREÇO': 'GENERATE ADDRESS',
    'SUA CHAVE PÚBLICA SOLANA (SPL)': 'YOUR SOLANA PUBLIC KEY (SPL)',
    'SEU ENDEREÇO': 'YOUR ADDRESS',
    'Aguardando transação...': 'Waiting for transaction...',
    'ENDEREÇO DA CARTEIRA': 'WALLET ADDRESS',
    'ENDEREÇO PÚBLICO': 'PUBLIC ADDRESS',
    'Envie apenas {network} para este endereço. Outros ativos serão perdidos permanentemente.': 'Send only {network} to this address. Other assets will be permanently lost.',
    'ESCOLHER REDE': 'CHOOSE NETWORK',
    'Endereço copiado para a área de transferência.': 'Address copied to clipboard.',

    // Notifications
    'NOTIFICAÇÕES': 'NOTIFICATIONS',
    'Nenhuma nova notificação': 'No new notifications',
    'Tudo limpo por aqui!': 'Everything is clean here!',
    'LIMPAR TUDO': 'CLEAR ALL',
    'TODAS': 'ALL',
    'RECEBIDOS': 'RECEIVED',
    'ENVIADOS': 'SENT',
    'ERROS': 'ERRORS',
    'LIDAS': 'READ',
    'NENHUMA NOTIFICAÇÃO': 'NO NOTIFICATIONS',
    'Transação concluída': 'Transaction completed',
    'Recebimento confirmado': 'Payment confirmed',
    'Pagamento enviado': 'Payment sent',
    'Câmbio realizado': 'Swap completed',
    'Depósito via PIX': 'PIX Deposit',
    'Transação falhou': 'Transaction failed',
    'Segurança da conta': 'Account security',
    'Saque processado': 'Withdrawal processed',
    'Hoje': 'Today',
    'Ontem': 'Yesterday',

    // Swap / Cambio
    'CÂMBIO VERUM': 'VERUM SWAP',
    'Troque seus ativos com liquidez instantânea e taxas competitivas.': 'Exchange your assets with instant liquidity and competitive fees.',
    'VOCÊ ENVIA': 'YOU SEND',
    'VOCÊ RECEBE': 'YOU RECEIVE',
    'SALDO:': 'BALANCE:',
    'Total estimado a receber:': 'Estimated total to receive:',
    'CONFIRMAR TROCA': 'CONFIRM SWAP',
    'MERCADO EM TEMPO REAL': 'REAL-TIME MARKET',
    'SELECIONAR ATIVO': 'SELECT ASSET',
    'Filtrar por nome...': 'Filter by name...',
    'SEGURANÇA': 'SECURITY',
    'Confirme sua senha para processar o câmbio:': 'Confirm your password to process the swap:',
    'A troca de ativos foi enviada para processamento e será confirmada em breve.': 'Asset swap has been sent for processing and will be confirmed soon.',
    'REDUZIR': 'CONFIRM',

    // Settings & Security
    'Geral': 'General',
    'Idioma': 'Language',
    'Moeda': 'Currency',
    'CONTA & SEGURANÇA': 'ACCOUNT & SECURITY',
    'Segurança e Privacidade': 'Security and Privacy',
    'PREFERÊNCIAS': 'PREFERENCES',
    'Notificações Push': 'Push Notifications',
    'Bloqueio Biométrico': 'Biometric Lock',
    'Autentique-se para habilitar': 'Authenticate to enable',
    'Biometria não disponível.': 'Biometrics not available.',
    'SUPORTE & INFORMAÇÕES': 'SUPPORT & INFORMATION',
    'Central de Ajuda': 'Help Center',
    'Sobre o Verum': 'About Verum',
    'BACKUP E CHAVES': 'BACKUP & KEYS',
    'Exportar Chave Privada': 'Export Private Key',
    'Acesso direto à sua conta': 'Direct access to your account',
    'Frase de Recuperação': 'Recovery Phrase',
    'As 12 palavras mestras': 'The 12 master words',
    'PROTEÇÃO DE ACESSO': 'ACCESS PROTECTION',
    'Autenticação Biométrica': 'Biometric Authentication',
    'Configurar FaceID ou Digital': 'Configure FaceID or TouchID',
    'Identificação da Carteira': 'Wallet Identification',
    'Ex: Carteira Principal': 'Ex: Main Wallet',
    'IDENTIFICAÇÃO': 'IDENTIFICATION',
    'Dê um nome para sua carteira para facilitar a identificação:': 'Give your wallet a name to facilitate identification:',
    'Ex: Minha Verum': 'Ex: My Verum',
    'Identificação atualizada!': 'Identification updated!',
    'Sua frase de segurança é o único acesso aos seus fundos. NUNCA a compartilhe.': 'Your security phrase is the only access to your funds. NEVER share it.',

    // Others
    'Preencha todos os campos antes de continuar.': 'Fill in all fields before continuing.',
    'POSICIONE O QR CODE NO CENTRO': 'POSITION QR CODE IN CENTER',
    'Aponte para o QR Code': 'Point to the QR Code',
    'Acesso Negado': 'Access Denied',
    'Permita o uso da câmera nas configurações.': 'Allow camera use in settings.',
    'Calculadora de Câmbio': 'Currency Converter',
    '(Digite o valor no campo da moeda desejada)': '(Enter value in the desired currency field)',
    'Versão': 'Version',

    // Investir
    'LIBERDADE FINANCEIRA': 'FINANCIAL FREEDOM',
    'Invista nos ativos do ecossistema Verum e acelere seu crescimento patrimonial.': 'Invest in Verum ecosystem assets and accelerate your wealth growth.',
    'PREÇO ATUAL': 'CURRENT PRICE',
    'INVESTIR AGORA': 'INVEST_NOW',
    'Inglês': 'English',
    'Espanhol': 'Spanish',
    'Português': 'Portuguese',
    'Dólar Americano': 'US Dollar',
    'Real Brasileiro': 'Brazilian Real',
    'Guarani Paraguaio': 'Paraguayan Guarani',
    'Escolha a moeda de depósito': 'Choose your deposit currency',
    'Autentique-se para acessar a carteira': 'Authenticate to access your wallet',
    'Já tenho uma Carteira': 'I already have a Wallet',
    'RECUPERAR CARTEIRA': 'RECOVER WALLET',
    'Frase de Recuperação (12 palavras)': 'Recovery Phrase (12 words)',
    'Cole sua frase de 12 palavras separadas por espaços para recuperar o acesso à sua conta na rede Solana.': 'Paste your 12-word phrase separated by spaces to regain access to your Solana account.',
    'COLAR FRASE': 'PASTE PHRASE',
    'CONECTAR CARTEIRA': 'CONNECT WALLET',
    'Recuperando carteira...': 'Recovering wallet...',
    'E-mail não encontrado. Por favor, faça o cadastro primeiro ou use o e-mail correto.': 'Email not found. Please register first or use the correct email.',
    'Privacidade': 'Privacy',
    'Política de Privacidade': 'Privacy Policy',
    'AVISO DE PRIVACIDADE': 'PRIVACY NOTICE',
    'Última Atualização': 'Last Updated',
    'ESTRUTURA JURÍDICA E JURISDIÇÃO': '1. LEGAL STRUCTURE AND JURISDICTION',
    'O PILAR DA AUTOCUSTÓDIA (NON-CUSTODIAL SHIELD)': '2. THE SELF-CUSTODY PILLAR (NON-CUSTODIAL SHIELD)',
    'VERUM PAY: IRREVERSIBILITY AND FIAT CONVERSION': '3. VERUM PAY: IRREVERSIBILITY AND FIAT CONVERSION',
    'CONFORMIDADE AML E COLETA DE DADOS (KYC)': '4. AML COMPLIANCE AND DATA COLLECTION (KYC)',
    'PROTEÇÃO DE DADOS (LEI 81/2019 E GDPR)': '5. DATA PROTECTION (LAW 81/2019 AND GDPR)',
    'LIMITAÇÃO DE RESPONSABILIDADE': '6. LIMITATION OF LIABILITY',
    'Entendi e Aceito': 'I Understand and Accept',
    'Termos e Política de Privacidade': 'Terms and Privacy Policy',
  },
  es: {
    // Menu & Navigation
    'Receber Crypto': 'Recibir Crypto',
    'Comprar Crypto': 'Comprar Crypto',
    'Investir': 'Invertir',
    'Câmbio': 'Cambio',
    'Pagar': 'Pagar',
    'Configurações': 'Configuraciones',
    'Sair': 'Cerrar Sesión',
    'VOLTAR': 'VOLVER',
    'FECHAR': 'CERRAR',
    'CONCLUÍDO': 'COMPLETADO',
    'CONCLUIR': 'CONCLUIR',
    'CANCELAR': 'CANCELAR',
    'CONFIRMAR': 'CONFIRMAR',
    'ERRO': 'ERROR',
    'SUCESSO': 'ÉXITO',
    'FALHA': 'FALLIDO',
    'Aviso': 'Aviso',
    'PRINCIPAL': 'PRINCIPAL',

    // Home Screen
    'BEM-VINDO AO VERUM': 'BIENVENIDO A VERUM',
    'Investidor': 'Inversionista',
    'PATRIMÔNIO TOTAL': 'PATRIMONIO TOTAL',
    'SALDO TOTAL': 'SALDO TOTAL',
    'SALDO ESTIMADO': 'SALDO ESTIMADO',
    'Recebido': 'Recibido',
    'Enviado': 'Enviado',
    'Saldo oculto': 'Saldo oculto',
    'MEU': 'MI',
    'PATRIMÔNIO': 'PATRIMONIO',
    'RECEBER': 'RECIBIR',
    'ENVIAR': 'ENVIAR',
    'MODO SEGURO': 'MODO SEGURO',
    'Sua carteira está protegida por criptografia de ponta. Autentique-se para visualizar seu patrimônio.': 'Su billetera está protegida por encriptación de extremo a extremo. Autentíquese para ver su patrimonio.',
    'DESBLOQUEAR ACESSO': 'DESBLOQUEAR ACCESO',
    'Seus Ativos': 'TUS ACTIVOS',
    'Ver Tudo': 'VER TODO',
    'Atividade Recente': 'ACTIVIDAD RECIENTE',
    'Histórico': 'HISTORIAL',
    'Nenhuma transação encontrada': 'No se encontraron transacciones',
    'Endereço copiado!': '¡Dirección copiada!',
    'Código PIX copiado!': '¡Código PIX copiado!',

    // Auth & Login
    'BEM-VINDO': 'BIENVENIDO',
    'Acesse sua carteira digital exclusiva e gerencie seus ativos na rede Solana.': 'Acceda a su billetera digital exclusiva y gestione sus activos en la red Solana.',
    'E-mail': 'E-mail',
    'Telefone': 'Teléfono',
    'Seu e-mail': 'Tu e-mail',
    'Sua senha': 'Tu contraseña',
    'Seu número': 'Tu número',
    'ENTRAR': 'ENTRAR',
    'OU': 'O',
    'Ainda não tem acesso?': '¿Aún no tienes acceso?',
    'Registre-se': 'Regístrate',
    'Esqueceu sua senha?': '¿Olvidaste tu contraseña?',
    'NOVO CADASTRO': 'NUEVO REGISTRO',
    'Inicie sua jornada no ecossistema Verum': 'Inicie su viaje en el ecosistema Verum',
    'Nome completo': 'Nombre completo',
    'Repetir senha': 'Repetir contraseña',
    'CRIAR CONTA': 'Crear Billetera',
    'VERIFIQUE SEU E-MAIL': 'VERIFIQUE SU E-MAIL',
    'Enviamos um link de ativação para {email}. Acesse seu e-mail para confirmar.': 'Enviamos un enlace de activación a {email}. Accede a tu e-mail para confirmar.',
    'CONTINUAR': 'CONTINUAR',
    'Por favor preencha os campos obrigatórios.': 'Por favor completa los campos obligatorios.',
    'Erro ao entrar': 'Error al entrar',
    'Credenciais inválidas.': 'Credenciales inválidas.',
    'Preencha todos os campos.': 'Completa todos los campos.',
    'Senhas não coincidem.': 'Las contraseñas no coinciden.',
    'Carteira Gerada!': '¡Billetera Generada!',
    'Frase de segurança:\n\n{mnemonic}\n\nCopie e guarde bem.': 'Frase de seguridad:\n\n{mnemonic}\n\nCópiala y guárdala bien.',
    'Copiar e Continuar': 'Copiar y Continuar',

    // Send Crypto
    'ENVIAR CRIPTO': 'ENVIAR CRIPTO',
    'Transfira ativos entre carteiras digitais no ecossistema Solana.': 'Transfiera activos entre billeteras digitales en el ecosistema Solana.',
    'ATIVO': 'ACTIVO',
    'Escolha o ativo': 'Elija el activo',
    'QUANTIDADE': 'CANTIDAD',
    'MÁXIMO': 'MÁXIMO',
    'ENDEREÇO DE DESTINO': 'DIRECCIÓN DE DESTINO',
    'Chave pública Solana': 'Clave pública de Solana',
    'Certifique-se que o destinatário e a rede (Solana) estão corretos para evitar perda de fundos.': 'Asegúrese de que el destinatario y la red (Solana) sejam corretos para evitar pérdida de fondos.',
    'CONFIRMAR ENVIO': 'CONFIRMAR ENVÍO',
    'Digite sua senha para autorizar a transação:': 'Ingrese su contraseña para autorizar la transacción:',
    'Transferência enviada com sucesso para a rede Solana.': 'Transferencia enviada con éxito a la red Solana.',
    'ENVIAR ATIVOS': 'ENVIAR ACTIVOS',
    'Transfira fundos com segurança dentro da rede Solana.': 'Transfiera fondos de forma segura dentro de la red Solana.',
    'E-mail ou endereço de carteira': 'Correo electrónico o dirección de billetera',
    'DESCRIÇÃO (OPCIONAL)': 'DESCRIPCIÓN (OPCIONAL)',
    'Referência da transação...': 'Referencia de la transacción...',
    'Confirme seu envio': 'Confirme su envío',
    'Usar Senha': 'Usar Contraseña',
    'Sessão Expirada': 'Sesión Expirada',
    'Por favor, digite sua senha.': 'Por favor, ingrese su contraseña.',
    'Senha incorreta.': 'Contraseña incorrecta.',
    'Erro no Envio': 'Error de Envío',
    'Falha ao processar.': 'Fallo al procesar.',
    'Autorize o envio de {amount} {currency} para {destinatario}...': 'Autorice el envío de {amount} {currency} para {destinatario}...',
    'Não foi possível processar o envio.': 'No se pudo procesar el envío.',
    'Sua transação foi enviada para a rede Solana.': 'Su transacción ha sido enviada a la red Solana.',
    'Por favor, preencha todos os campos.': 'Por favor completa todos los campos.',
    'Transferência enviada': 'Transferencia enviada',
    'Transferência recebida': 'Transferencia recibida',

    // Deposit Pix
    'COMPRAR CRYPTO': 'COMPRAR CRYPTO',
    'Converta BRL para USDT instantaneamente através do ecossistema Verum.': 'Convierta BRL a USDT instantáneamente a través del ecosistema Verum.',
    'VALOR DO DEPÓSITO': 'MONTO DEL DEPÓSITO',
    'VALOR EM REAIS (BRL)': 'MONTO EN REALES (BRL)',
    'VALOR EM DÓLAR (USD)': 'MONTO EN DÓLARES (USD)',
    'VALOR EM GUARANI (PYG)': 'MONTO EN GUARANÍES (PYG)',
    'Você Receberá': 'Usted Recibirá',
    'Mínimo R$ 2,00': 'Mínimo R$ 2,00',
    'GERAR CÓDIGO PIX': 'GENERAR CÓDIGO PIX',
    'FORMA DE PAGAMENTO': 'FORMA DE PAGO',
    'PIX': 'PIX',
    'Transferência': 'Transferencia',
    'Cartão': 'Tarjeta',
    'VER DADOS BANCÁRIOS': 'VER DATOS BANCARIOS',
    'PAGAR COM CARTÃO': 'PAGAR CON TARJETA',
    'PAGAMENTO PENDENTE': 'PAGO PENDIENTE',
    'Pague R$ {amount} no seu App Bancário': 'Pague R$ {amount} en su App Bancaria',
    'A conversão para USDT será processada automaticamente após a confirmação do PIX.': 'La conversión a USDT será procesada automáticamente tras la confirmación del PIX.',
    'Escanear QR Code': 'Escanear Código QR',
    'PIX COPIA E COLA': 'PIX COPIAR Y PEGAR',
    'CONFIRMAR PAGAMENTO': 'CONFIRMAR PAGO',
    'VOLTAR / ALTERAR VALOR': 'VOLVER / CAMBIAR MONTO',
    'Aguardando compensação bancária...': 'Esperando compensación bancaria...',

    // Deposit Crypto
    'RECEBER ATIVOS': 'RECIBIR ACTIVOS',
    'Selecione uma rede para gerar seu endereço de depósito exclusivo.': 'Seleccione una red para generar su dirección de depósito exclusiva.',
    'CONFIGURAR DEPÓSITO': 'CONFIGURAR DEPÓSITO',
    'REDE DE DESTINO': 'RED DE DESTINO',
    'Selecione a rede de depósito': 'Seleccione la red de depósito',
    'Selecione uma rede': 'Seleccione una red',
    'GERAR ENDEREÇO': 'GENERAR DIRECCIÓN',
    'SUA CHAVE PÚBLICA SOLANA (SPL)': 'SU CLAVE PÚBLICA SOLANA (SPL)',
    'SEU ENDEREÇO': 'SU DIRECCIÓN',
    'Aguardando transação...': 'Esperando transacción...',
    'ENDEREÇO DA CARTEIRA': 'DIRECCIÓN DE LA BILLETERA',
    'ENDEREÇO PÚBLICO': 'DIRECCIÓN PÚBLICA',
    'Envie apenas {network} para este endereço. Outros ativos serão perdidos permanentemente.': 'Envíe solo {network} a esta dirección. Otros ativos se perderán permanentemente.',
    'ESCOLHER REDE': 'ELEGIR RED',
    'Endereço copiado para a área de transferência.': 'Dirección copiada al portapapeles.',

    // Notifications
    'NOTIFICAÇÕES': 'NOTIFICACIONES',
    'Nenhuma nova notificação': 'No hay nuevas notificaciones',
    'Tudo limpo por aqui!': '¡Todo limpio por aquí!',
    'LIMPAR TUDO': 'LIMPIAR TODO',
    'TODAS': 'TODAS',
    'RECEBIDOS': 'RECIBIDOS',
    'ENVIADOS': 'ENVIADOS',
    'ERROS': 'ERRORES',
    'LIDAS': 'LEÍDAS',
    'NENHUMA NOTIFICAÇÃO': 'NINGUNA NOTIFICACIÓN',
    'Transação concluída': 'Transacción completada',
    'Recebimento confirmado': 'Recibo confirmado',
    'Pagamento enviado': 'Pago enviado',
    'Câmbio realizado': 'Cambio realizado',
    'Depósito via PIX': 'Depósito vía PIX',
    'Transação falhou': 'Transacción fallida',
    'Segurança da cuenta': 'Seguridad de la cuenta',
    'Saque processado': 'Retiro procesado',
    'Hoje': 'Hoy',
    'Ontem': 'Ayer',

    // Swap / Cambio
    'CÂMBIO VERUM': 'CAMBIO VERUM',
    'Troque seus ativos com liquidez instantânea e taxas competitivas.': 'Canjee sus activos con liquidez instantánea y tarifas competitivas.',
    'VOCÊ ENVIA': 'USTED ENVÍA',
    'VOCÊ RECEBE': 'USTED RECIBE',
    'SALDO:': 'SALDO:',
    'Total estimado a receber:': 'Total estimado a recibir:',
    'CONFIRMAR TROCA': 'CONFIRMAR CAMBIO',
    'MERCADO EM TEMPO REAL': 'MERCADO EN TIEMPO REAL',
    'SELECIONAR ATIVO': 'SELECCIONAR ACTIVO',
    'Filtrar por nome...': 'Filtrar por nombre...',
    'SEGURANÇA': 'SEGURIDAD',
    'Confirme sua senha para processar o câmbio:': 'Confirme su contraseña para procesar el cambio:',
    'A troca de ativos foi enviada para processamento e será confirmada em breve.': 'El cambio de activos ha sido enviado para su procesamiento e se confirmará en breve.',
    'REDUZIR': 'CONFIRMAR',

    // Settings & Security
    'Geral': 'General',
    'Idioma': 'Idioma',
    'Moeda': 'Moneda',
    'CONTA & SEGURANÇA': 'CUENTA Y SEGURIDAD',
    'Segurança e Privacidade': 'Seguridad y Privacidad',
    'PREFERÊNCIAS': 'PREFERENCIAS',
    'Notificações Push': 'Notificaciones Push',
    'Bloqueio Biométrico': 'Bloqueo Biométrico',
    'Autentique-se para habilitar': 'Autenticarse para habilitar',
    'Biometria não disponível.': 'Biometría no disponible.',
    'SUPORTE & INFORMAÇÕES': 'SOPORTE E INFORMACIÓN',
    'Central de Ajuda': 'Centro de Ayuda',
    'Sobre o Verum': 'Sobre Verum',
    'BACKUP E CHAVES': 'COPIA DE SEGURIDAD Y CLAVES',
    'Exportar Chave Privada': 'Exportar Clave Privada',
    'Acesso direto à sua conta': 'Acceso directo a tu cuenta',
    'Frase de Recuperação': 'Frase de Recuperación',
    'As 12 palavras mestras': 'Las 12 palabras maestras',
    'PROTEÇÃO DE ACESSO': 'PROTECCIÓN DE ACESSO',
    'Autenticação Biométrica': 'Autenticación Biométrica',
    'Configurar FaceID ou Digital': 'Configurar FaceID o Digital',
    'Identificação da Carteira': 'Identificación de Billetera',
    'Ex: Carteira Principal': 'Ej: Billetera Principal',
    'IDENTIFICAÇÃO': 'IDENTIFICACIÓN',
    'Dê um nome para sua carteira para facilitar a identificação:': 'Asigne un nombre a su billetera para facilitar la identificación:',
    'Ex: Minha Verum': 'Ej: Mi Verum',
    'Identificação atualizada!': '¡Identificación actualizada!',
    'Sua frase de segurança é o único acesso aos seus fundos. NUNCA a compartilhe.': 'Tu frase de seguridad es el único acceso a tus fondos. NUNCA la compartas.',

    // Others
    'Preencha todos os campos antes de continuar.': 'Complete todos los campos antes de continuar.',
    'POSICIONE O QR CODE NO CENTRO': 'COLOQUE EL CÓDIGO QR EN EL CENTRO',
    'Aponte para o QR Code': 'Apunte al código QR',
    'Acesso Negado': 'Acceso Denegado',
    'Permita o uso da câmera nas configurações.': 'Permita el uso de la cámara en las configuraciones.',
    'Calculadora de Câmbio': 'Calculadora de Cambio',
    '(Digite o valor no campo da moeda desejada)': '(Ingrese el valor en el campo de la moneda deseada)',
    'Versão': 'Versión',

    // Investir
    'LIBERDADE FINANCEIRA': 'LIBERTAD FINANCIERA',
    'Invista nos ativos do ecossistema Verum e acelere seu crescimento patrimonial.': 'Invierta en los activos del ecosistema Verum y acelere su crecimiento patrimonial.',
    'PREÇO ATUAL': 'PRECIO ACTUAL',
    'INVESTIR AGORA': 'INVERTIR AHORA',
    'Inglês': 'Inglés',
    'Espanhol': 'Español',
    'Português': 'Portugués',
    'Dólar Americano': 'Dólar Estadounidense',
    'Real Brasileiro': 'Real Brasileño',
    'Guarani Paraguaio': 'Guaraní Paraguayo',
    'Escolha a moeda de depósito': 'Elija la moneda de depósito',
    'Autentique-se para acessar a carteira': 'Autentíquese para acceder a su billetera',
    'Já tenho uma Carteira': 'Ya tengo una Billetera',
    'RECUPERAR CARTEIRA': 'RECUPERAR BILLETERA',
    'Frase de Recuperação (12 palavras)': 'Frase de Recuperación (12 palabras)',
    'Cole sua frase de 12 palavras separadas por espaços para recuperar o acesso à sua conta na rede Solana.': 'Pegue sua frase de 12 palabras separadas por espacios para recuperar el acceso a su cuenta de Solana.',
    'COLAR FRASE': 'PEGAR FRASE',
    'CONECTAR CARTEIRA': 'CONECTAR BILLETERA',
    'Recuperando carteira...': 'Recuperando billetera...',
    'E-mail não encontrado. Por favor, faça o cadastro primeiro ou use o e-mail correto.': 'Email no encontrado. Por favor regístrese primero o use el email correcto.',
    'Privacidade': 'Privacidad',
    'Política de Privacidade': 'Política de Privacidad',
    'AVISO DE PRIVACIDADE': 'AVISO DE PRIVACIDAD',
    'Última Atualização': 'Última actualización',
    'ESTRUTURA JURÍDICA E JURISDIÇÃO': '1. ESTRUCTURA JURÍDICA Y JURISDICCIÓN',
    'O PILAR DA AUTOCUSTÓDIA (NON-CUSTODIAL SHIELD)': '2. EL PILAR DA AUTOCUSTODIA (NON-CUSTODIAL SHIELD)',
    'VERUM PAY: IRREVERSIBILIDADE E CONVERSÃO FIDUCIÁRIA': '3. VERUM PAY: IRREVERSIBILIDAD Y CONVERSIÓN FIDUCIARIA',
    'CONFORMIDADE AML E COLETA DE DADOS (KYC)': '4. CUMPLIMIENTO AML Y RECOLECCIÓN DE DATOS (KYC)',
    'PROTEÇÃO DE DADOS (LEI 81/2019 E GDPR)': '5. PROTECCIÓN DE DATOS (LEY 81/2019 Y GDPR)',
    'LIMITAÇÃO DE RESPONSABILIDADE': '6. LIMITACIÓN DE RESPONSABILIDAD',
    'Entendi e Aceito': 'Entendido y acepto',
    'Termos e Política de Privacidade': 'Términos y Política de Privacidad',
  }
};

// ─── (EX3) Tokens internos via Token Factory (src/config/tokens.ts) ─────────
// Antes esta lista duplicava `MAINNET_REGISTRY`. Agora derivamos via factory —
// adicionar token novo NÃO exige editar dois lugares.
import { getTokenMintsBySymbol } from '@/src/config/tokens';
const INTERNAL_TOKEN_MINTS: Record<string, string> = getTokenMintsBySymbol('mainnet');

// ─── Tier 1: Binance (CEX - Muito estável para major tokens) ────────────────
async function fetchBinancePrice(symbol: string): Promise<number> {
  try {
    const res = await fetch(`${SWAP_API_URL}/api/prices/binance?symbol=${symbol}`, { headers: { 'ngrok-skip-browser-warning': '1' } });
    if (!res.ok) {
      console.warn(`[SettingsContext] Binance REST error: ${res.status}`);
      return 0;
    }
    const data = await res.json();
    return data.price || 0;
  } catch (err: any) {
    console.warn(`[SettingsContext] fetchBinancePrice(${symbol}) error:`, err.message);
    return 0;
  }
}


// ─── Tier 2: Jupiter (DEX Aggregator - Melhor para Solana) ──────────────────
async function fetchJupiterPrices(mints: string[]): Promise<Record<string, number>> {
  if (mints.length === 0) return {};
  try {
    const res = await fetch(`${SWAP_API_URL}/api/prices?ids=${mints.join(',')}`, { headers: { 'ngrok-skip-browser-warning': '1' } });
    if (!res.ok) {
      console.warn(`[SettingsContext] Jupiter REST error: ${res.status}`);
      return {};
    }
    const data = await res.json();
    return data?.prices || {};
  } catch (err: any) {
    console.warn(`[SettingsContext] fetchJupiterPrices error:`, err.message);
    return {};
  }
}


// ─── Tier 3: CoinGecko (Agregador Geral) ─────────────────────────────────────
const COINGECKO_IDS: Record<string, string> = {
  SOL: 'solana',
  USDC: 'usd-coin',
  USDT: 'tether',
  BTC: 'bitcoin',
  ETH: 'ethereum'
};

async function fetchCoinGeckoPrice(id: string): Promise<number> {
  try {
    const res = await fetch(`${SWAP_API_URL}/api/prices/coingecko?id=${id}`, { headers: { 'ngrok-skip-browser-warning': '1' } });
    if (!res.ok) {
      console.warn(`[SettingsContext] CoinGecko REST error: ${res.status}`);
      return 0;
    }
    const data = await res.json();
    return data.price || 0;
  } catch (err: any) {
    console.warn(`[SettingsContext] fetchCoinGeckoPrice(${id}) error:`, err.message);
    return 0;
  }
}


// ─── Tier 4: DexScreener (Tokens "Long Tail" / Internos) ─────────────────────
async function fetchDexScreenerPrices(mints: string[]): Promise<Record<string, number>> {
  if (mints.length === 0) return {};
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mints.join(',')}`);
    if (!res.ok) return {};
    const data = await res.json();
    const results: Record<string, number> = {};
    for (const pair of (data?.pairs ?? [])) {
      const mint = pair.baseToken?.address;
      const price = parseFloat(pair.priceUsd || '0');
      if (mint && price > 0) {
        // Pega sempre o de maior liquidez para aquele mint
        if (!results[mint] || (pair.liquidity?.usd ?? 0) > 100) {
          results[mint] = price;
        }
      }
    }
    return results;
  } catch {
    return {};
  }
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [language, setLangState] = useState<Language>('pt');
  const [currency, setCurrState] = useState<Currency>('USD');
  const [network, setNetworkState] = useState<'mainnet' | 'devnet'>('mainnet');
  const [walletName, setWalletNameState] = useState<string | null>(null);
  const [rates, setRates] = useState({ BRL: 5.10, PYG: 7300 });
  const [prices, setPrices] = useState<PriceMap>({});
  
  const socketRef = useRef<Socket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const syncTokenPrices = useCallback(async (snapshot: PriceMap) => {
    const symbols = Object.keys(INTERNAL_TOKEN_MINTS);
    const updatedPrices: PriceMap = {};

    for (const sym of symbols) {
      const mint = INTERNAL_TOKEN_MINTS[sym];
      const priceObj = snapshot[sym];
      // Se já temos o preço do snapshot inicial (REST), pula para o próximo
      if (priceObj && (priceObj.USD ?? 0) > 0) {
        continue;
      }
      
      let usd = 0;

      // 1. Tenta Binance (Major Tokens) via Proxy
      if (['SOL', 'USDC', 'USDT', 'BTC', 'ETH'].includes(sym)) {
        usd = await fetchBinancePrice(sym);
      }


      // 2. Tenta Jupiter (Qualquer Solana)
      if (usd === 0) {
        const jupResults = await fetchJupiterPrices([mint]);
        usd = jupResults[mint] ?? 0;
      }

      // 3. Tenta CoinGecko
      if (usd === 0 && COINGECKO_IDS[sym]) {
        usd = await fetchCoinGeckoPrice(COINGECKO_IDS[sym]);
      }

      // 4. Tenta DexScreener (Tokens Internos/Baixa Liquidez)
      if (usd === 0) {
        const dexResults = await fetchDexScreenerPrices([mint]);
        usd = dexResults[mint] ?? 0;
      }

      if (usd > 0) {
        updatedPrices[sym] = {
          USD: usd,
          BRL: usd * rates.BRL,
          PYG: usd * rates.PYG,
        };
      }
    }

    if (Object.keys(updatedPrices).length > 0) {
      setPrices(prev => {
        const next = { ...prev, ...updatedPrices };
        SettingsStorage.setPricesCache(next).catch(() => {});
        return next;
      });
    }
  }, [rates]);

  // ── Carga inicial via REST ────────────────────────────────────────────────
  const fetchPricesRest = useCallback(async () => {
    const isWeb = typeof window !== 'undefined';
    const isLocalBackend =
      API_URL.includes('192.168.') ||
      API_URL.includes('localhost') ||
      API_URL.includes('127.0.');
    
    // Corrigido: Usa SWAP_API_URL (porta 3001) para fugir do erro de CORS do ngrok/NestJS
    const pricesUrl = `${SWAP_API_URL}/api/prices`;
    console.log('[SettingsContext] Buscando preços via REST:', pricesUrl);

    let basePrices: PriceMap = {};

    try {
      const res = await fetch(pricesUrl, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': '1',
        },
      });
      if (res.ok) {
        const data = await res.json();
        const rawPrices = data?.prices || {};
        console.log(`[SettingsContext] REST: Recebidos ${Object.keys(rawPrices).length} tokens do backend.`);
        
        // Mapeamento e normalização
        const mappedPrices: PriceMap = {};
        for (const [sym, p] of Object.entries(rawPrices)) {
          // Normaliza BDC: Aceita tanto o ticker 'BODE' quanto o Mint Address como 'BDC'
          const isBdcMint = sym === 'AeAQdgjGqtHErysb5FBvUxNxmob2mVBGnEXdmULJ7dH9';
          const finalSym = (sym === 'BODE' || isBdcMint) ? 'BDC' : sym;
          
          const usd = typeof p === 'number' ? p : (p as any)?.USD ?? 0;
          if (usd > 0) {
            mappedPrices[finalSym] = {
              USD: usd,
              BRL: usd * rates.BRL,
              PYG: usd * rates.PYG
            };
          }
        }
        
        if (Object.keys(mappedPrices).length > 0) {
          setPrices(prev => {
            const next = { ...prev, ...mappedPrices };
            SettingsStorage.setPricesCache(next).catch(() => {});
            return next;
          });
          basePrices = mappedPrices;
        }
      }
    } catch (e) {
      console.warn('[SettingsContext] Erro ao buscar preços via REST backend.');
    }

    // Dispara a sincronização multi-tier para o que faltar
    await syncTokenPrices(basePrices);
  }, [rates, syncTokenPrices]);

  // ── Conexão WebSocket para Preços ──────────────────────────────────────────
  // O backend de swap (porta 3001) NÃO expõe socket.io — apenas REST.
  // O polling REST de 15s abaixo (`fetchPricesRest`) cobre o real-time.
  // Para reativar, suba um servidor socket.io no namespace `/prices` e
  // mude PRICES_WS_ENABLED para true.
  const PRICES_WS_ENABLED = false;
  const connectPricesWS = useCallback(() => {
    if (!PRICES_WS_ENABLED) return;
    const isWeb = typeof window !== 'undefined';
    const isLocalBackend =
      API_URL.includes('192.168.') ||
      API_URL.includes('localhost') ||
      API_URL.includes('127.0.');
    if (isWeb && isLocalBackend) return;

    // Destrói socket anterior se existir e não estiver conectado
    if (socketRef.current) {
      if (socketRef.current.connected) return;
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    // Tenta conectar no SWAP_API_URL (3001) que é onde residem os novos serviços de preços
    const socket = io(`${SWAP_API_URL}/prices`, {
      transports: ['websocket'],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    socket.on('connect', () => {
      console.log('[SettingsContext] WS Preços conectado');
      if (reconnectTimerRef.current) {
        clearInterval(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    });

    socket.on('price.tick', (payload: any) => {
      const rawData = payload?.prices ? payload.prices : payload;
      if (rawData && typeof rawData === 'object' && Object.keys(rawData).length > 0) {
        const mapped: PriceMap = {};
        for (const [sym, p] of Object.entries(rawData)) {
          const isBdcMint = sym === 'AeAQdgjGqtHErysb5FBvUxNxmob2mVBGnEXdmULJ7dH9';
          const finalSym = (sym === 'BODE' || isBdcMint) ? 'BDC' : sym;

          const usd = typeof p === 'number' ? p : (p as any)?.USD ?? 0;
          if (usd > 0) {
            mapped[finalSym] = {
              USD: usd,
              BRL: usd * rates.BRL,
              PYG: usd * rates.PYG
            };
          }
        }
        
        setPrices(prev => ({ ...prev, ...mapped }));
        
        // Sincroniza o que ainda falta (como USDT ou BDC se não vierem no tick)
        void syncTokenPrices(mapped);
      }
    });

    socket.on('connect_error', () => {
      // Fallback REST imediato e polling enquanto WS está fora
      void fetchPricesRest();
      if (!reconnectTimerRef.current) {
        reconnectTimerRef.current = setInterval(() => void fetchPricesRest(), 10_000) as any;
      }
    });

    socket.on('disconnect', (reason) => {
      console.warn('[SettingsContext] WS desconectado:', reason);
      // Se o servidor desconectou, inicia REST polling como fallback
      if (reason === 'io server disconnect' || reason === 'transport close') {
        void fetchPricesRest();
        if (!reconnectTimerRef.current) {
          reconnectTimerRef.current = setInterval(() => void fetchPricesRest(), 10_000) as any;
        }
      }
    });

    socketRef.current = socket;
  }, [fetchPricesRest, rates]);

  // ── Polling de Preços (Real-time 15s) ─────────────────────────────────────
  const isFetchingRef = useRef(false);

  useEffect(() => {
    const fetchWrapper = async () => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      try {
        await fetchPricesRest();
      } finally {
        isFetchingRef.current = false;
      }
    };

    void fetchWrapper();
    connectPricesWS();

    const interval = setInterval(fetchWrapper, 15000);

    return () => {
      clearInterval(interval);
      if (reconnectTimerRef.current) {
        clearInterval(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [fetchPricesRest, connectPricesWS]);

  useEffect(() => {
    SettingsStorage.getLanguage().then(setLangState);
    SettingsStorage.getCurrency().then(setCurrState);
    
    // Tenta restaurar preços do cache para evitar "---" inicial
    SettingsStorage.getPricesCache().then(cached => {
      if (cached) {
        setPrices(cached);
      }
    });

    // Inicializa rede Solana
    SettingsStorage.getNetwork().then(net => {
      if (net === 'mainnet' || net === 'devnet') {
        setNetworkState(net);
        transactionService.setNetwork(net, false);
      }
    });

    SettingsStorage.getStorageItem('@VerumCrypto:walletName').then(name => {
      setWalletNameState(name);
    });
    
    fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL,USD-PYG')
      .then(res => res.json())
      .then(data => {
        setRates({
          BRL: parseFloat(data.USDBRL.bid),
          PYG: parseFloat(data.USDPYG.bid)
        });
      })
      .catch(() => {});
  }, []);

  const setLanguage = async (lang: Language) => {
    setLangState(lang);
    await SettingsStorage.setLanguage(lang);
  };

  const setCurrency = async (curr: Currency) => {
    setCurrState(curr);
    await SettingsStorage.setCurrency(curr);
  };
  const setNetwork = async (net: 'mainnet' | 'devnet') => {
    setNetworkState(net);
    transactionService.setNetwork(net); // Seta no service
    await SettingsStorage.setNetwork(net); // Salva no storage persistente
  };

  const setWalletName = async (name: string | null) => {
    setWalletNameState(name);
    if (name) {
      await SettingsStorage.setStorageItem('@VerumCrypto:walletName', name);
    } else {
      await SettingsStorage.removeStorageItem('@VerumCrypto:walletName');
    }
  };

  const t = (key: string, params?: Record<string, string>) => {
    let text = translations[language][key] || key;
    if (params) {
      Object.keys(params).forEach(param => {
        text = text.replace(`{${param}}`, params[param]);
      });
    }
    return text;
  };

  const formatCurrency = (value: number, keepDecimals?: boolean) => {
    const convertedValue = currency === 'BRL' ? value * rates.BRL : currency === 'PYG' ? value * rates.PYG : value;
    const locale = language === 'pt' ? 'pt-BR' : language === 'es' ? 'es-PY' : 'en-US';
    const currencyCode = currency;

    let minimumFractionDigits = 2;
    let maximumFractionDigits = 2;

    if (keepDecimals && convertedValue > 0 && convertedValue < 1) {
      maximumFractionDigits = 6;
      minimumFractionDigits = 2; // Mantém mínimo de 2, mas permite até 6 se tiver mais casas
    }

    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits,
        maximumFractionDigits,
      }).format(convertedValue);
    } catch (e) {
      return `${currency} ${convertedValue.toFixed(maximumFractionDigits)}`;
    }
  };

  const convertToCrypto = useCallback(
    (amount: number, fromCurrency: SupportedCurrency, token: SupportedToken): number | null => {
      const price = prices[token]?.[fromCurrency];
      if (!price || price === 0) return null;
      return amount / price;
    },
    [prices],
  );

  return (
    <SettingsContext.Provider value={{ 
      language, 
      currency, 
      network, 
      prices,
      walletName,
      setLanguage, 
      setCurrency, 
      setNetwork, 
      setWalletName,
      t, 
      formatCurrency,
      convertToCrypto 
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
