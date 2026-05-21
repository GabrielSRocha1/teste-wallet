import { supabase } from './supabase';
import { getApiBaseUrl } from './apiUrl';

export interface KYCData {
  nome: string;
  sobrenome: string;
  data_nascimento: string;
  nacionalidade: string;
  cpf: string;
}

export interface KYCProfile extends KYCData {
  id: string;
  user_id: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  updated_at: string;
}

/**
 * Verifica se o usuário já possui KYC preenchido e salvo no banco local.
 */
export async function checkKYC(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('kyc_profiles')
      .select('id, status')
      .eq('user_id', userId)
      .maybeSingle() as unknown as {
        data: { id: string; status: string } | null;
        error: { message: string } | null;
      };

    if (error) {
      console.error('[KYC] Erro ao verificar KYC:', error.message);
      return false;
    }

    // Se estiver aprovado no banco, retorna true
    if (data?.status === 'approved') return true;
    
    // Se não existir perfil, retorna false (precisa preencher dados)
    if (!data) return false;

    // Se existir mas não estiver aprovado, retornamos false por padrão
    // mas a UI pode decidir fazer um sync automático.
    return false;
  } catch (e) {
    console.error('[KYC] Exceção ao verificar KYC:', e);
    return false;
  }
}

/**
 * Checagem inteligente: Verifica banco local e, se necessário, sincroniza com Didit.
 * Útil para o botão "Gerar QR Code".
 */
export async function isKycApproved(userId: string): Promise<boolean> {
  // 1. Check local
  const localApproved = await checkKYC(userId);
  if (localApproved) return true;

  // 2. Tenta sincronizar se houver perfil (syncKycStatus já lida com a checagem)
  try {
    const sync = await syncKycStatus();
    return !!sync.approved;
  } catch {
    return false;
  }
}

/**
 * Salva ou atualiza os dados de KYC do usuário na tabela kyc_profiles.
 * Retorna { success: true } ou { success: false, error: string }.
 */
export async function saveKYC(
  userId: string,
  data: KYCData
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: existing } = await (supabase as any)
      .from('kyc_profiles')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      const { error } = await (supabase as any)
        .from('kyc_profiles')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('user_id', userId);

      if (error) return { success: false, error: error.message };
    } else {
      const { error } = await (supabase as any).from('kyc_profiles').insert({
        user_id: userId,
        ...data,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (error) return { success: false, error: error.message };
    }

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || 'Erro desconhecido' };
  }
}

/**
 * Consulta o status da sessão Didit e atualiza o banco.
 * Chamar após o usuário retornar da verificação.
 */
export async function syncKycStatus(): Promise<{
  success: boolean;
  kycStatus?: string;
  approved?: boolean;
  error?: string;
}> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Sessão expirada. Faça login novamente.');

    const apiBase = getApiBaseUrl();
    const response = await fetch(`${apiBase}/kyc/check-status`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || data.message || 'Erro ao verificar status');

    return { success: true, kycStatus: data.kycStatus, approved: data.approved };
  } catch (e: any) {
    console.error('[KYC] Erro ao sincronizar status:', e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Inicia o processo de KYC no backend (NestJS/Vercel) e retorna os dados de sessão.
 * Para a Didit, retornará uma 'verificationUrl'.
 */
export async function initiateKyc(_userId: string): Promise<{
  success: boolean;
  verificationUrl?: string;
  error?: string;
}> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Sessão expirada. Faça login novamente.');

    const apiBase = getApiBaseUrl();
    console.log('[KYC] Iniciando requisição para:', `${apiBase}/kyc/initiate`);

    const response = await fetch(`${apiBase}/kyc/initiate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
    });

    // (SE7) Parsing defensivo: backend pode mudar shape; nunca confiar em
    // `data.x` sem checar tipo.
    const data: unknown = await response.json();
    const dataObj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    if (!response.ok) {
      const errObj = (dataObj.error && typeof dataObj.error === 'object'
        ? dataObj.error
        : {}) as Record<string, unknown>;
      const errMsg =
        (typeof errObj.message === 'string' && errObj.message) ||
        (typeof dataObj.message === 'string' && dataObj.message) ||
        'Erro ao iniciar verificação';
      console.error('[KYC] initiateKyc erro:', JSON.stringify(dataObj));
      throw new Error(errMsg);
    }

    console.log('[KYC] initiateKyc resposta:', JSON.stringify(dataObj));

    const verificationUrl = dataObj.verificationUrl;
    if (typeof verificationUrl !== 'string' || verificationUrl.length === 0) {
      console.error('[KYC] verificationUrl ausente/inválida na resposta:', JSON.stringify(dataObj));
      throw new Error('URL de verificação não retornada pelo servidor');
    }

    return {
      success: true,
      verificationUrl,
    };
  } catch (e: any) {
    console.error('[KYC] Erro ao iniciar:', e.message);
    return { success: false, error: e.message };
  }
}
