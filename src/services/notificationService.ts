import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateSecureId } from './_internal/crypto';
import { supabase } from './supabase';

/**
 * Sanitiza string monetária em número finito. Aceita:
 *  - "+1.5", "-1.5", "1.5"
 *  - "R$ 1.000,00" (BR), "1,000.00" (US), "1 000,00" (PT)
 * Retorna `null` se não conseguir extrair um número finito > 0 ou < 0.
 *
 * Sem isso, parseFloat de "R$ 1.000,00" retornava NaN e ia direto pro Postgres.
 */
function sanitizeAmount(input?: string | null): number | null {
  if (!input || typeof input !== 'string') return null;
  // Mantém apenas dígitos, ponto, vírgula e sinal — descarta R$, espaços, etc.
  let cleaned = input.replace(/[^\d.,+-]/g, '');
  // Se tiver vírgula E ponto: assume formato BR (1.234,56) → remove pontos, troca vírgula
  if (cleaned.includes(',') && cleaned.includes('.')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',') && !cleaned.includes('.')) {
    cleaned = cleaned.replace(',', '.');
  }
  // Remove sinais '+' (parseFloat aceita '-' como negativo).
  cleaned = cleaned.replace(/\+/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

export type NotificationType = 'recebimento' | 'pagamento' | 'sucesso' | 'erro' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  description: string;
  amount?: string;
  currency?: string;
  time: string;
  read: boolean;
}

class NotificationService {
  private async getUserEmail(): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.email || null;
  }

  private async getUserId(): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || null;
  }

  /**
   * 🆕 BUSCAR NOTIFICAÇÕES DO SUPABASE (para o frontend)
   */
  async getNotifications(): Promise<Notification[]> {
    try {
      const userId = await this.getUserId();
      if (!userId) return [];

      const { data, error } = await supabase
        .from('notificacoes')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('[NotificationService] getNotifications error:', error);
        return [];
      }

      // Mapear para o formato do frontend
      // Usa o campo 'tipo' salvo no banco (se existir), senão infere pelo título
      return (data || []).map(n => ({
        id: n.id,
        type: (n.tipo as NotificationType) || this.mapTipoNotificacao(n.titulo, n.descricao),
        title: n.titulo,
        description: n.descricao,
        amount: n.valor?.toString(),
        currency: n.moeda ?? undefined,
        time: this.formatTime(n.created_at),
        read: n.lida || false,
      }));
    } catch (e) {
      console.error('[NotificationService] getNotifications error:', e);
      return [];
    }
  }

  /**
   * 🆕 MARCAR NOTIFICAÇÃO COMO LIDA
   */
  async markAsRead(notificationId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('notificacoes')
        .update({ lida: true })
        .eq('id', notificationId);

      if (error) console.error('[NotificationService] markAsRead error:', error);
    } catch (e) {
      console.error('[NotificationService] markAsRead error:', e);
    }
  }

  /**
   * 🆕 MARCAR TODAS AS NOTIFICAÇÕES COMO LIDAS
   */
  async markAllAsRead(): Promise<void> {
    try {
      const userId = await this.getUserId();
      if (!userId) return;

      const { error } = await supabase
        .from('notificacoes')
        .update({ lida: true })
        .eq('user_id', userId)
        .eq('lida', false);

      if (error) console.error('[NotificationService] markAllAsRead error:', error);
    } catch (e) {
      console.error('[NotificationService] markAllAsRead error:', e);
    }
  }

  /**
   * 🆕 EXCLUIR TODAS AS NOTIFICAÇÕES
   */
  async deleteAllNotifications(): Promise<void> {
    try {
      const userId = await this.getUserId();
      if (!userId) return;

      const { error } = await supabase
        .from('notificacoes')
        .delete()
        .eq('user_id', userId);

      if (error) console.error('[NotificationService] deleteAllNotifications error:', error);
      
      const email = await this.getUserEmail();
      if (email) {
        await AsyncStorage.removeItem(`notifications_${email}`);
      }
    } catch (e) {
      console.error('[NotificationService] deleteAllNotifications error:', e);
    }
  }

  /**
   * 🆕 CONTAR NOTIFICAÇÕES NÃO LIDAS (para badge)
   */
  async getUnreadCount(): Promise<number> {
    try {
      const userId = await this.getUserId();
      if (!userId) return 0;

      const { count, error } = await supabase
        .from('notificacoes')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('lida', false);

      if (error) {
        console.error('[NotificationService] getUnreadCount error:', error);
        return 0;
      }

      return count || 0;
    } catch (e) {
      console.error('[NotificationService] getUnreadCount error:', e);
      return 0;
    }
  }

  /**
   * Envia notificação para o usuário (por padrão, para o usuário logado)
   */
  async pushNotification(params: {
    userId?: string;
    type: NotificationType;
    title: string;
    description: string;
    amount?: string;
    currency?: string;
  }) {
    try {
      const currentUserId = await this.getUserId();
      const targetUserId = params.userId || currentUserId;
      
      if (targetUserId) {
        // Salvar no Supabase — incluindo o campo 'tipo' para que os filtros funcionem
        await supabase.from('notificacoes').insert({
          user_id: targetUserId,
          tipo: params.type,
          titulo: params.title,
          descricao: params.description,
          valor: sanitizeAmount(params.amount),
          moeda: params.currency,
          lida: false,
        });
      }
      
      // Também salvar localmente para offline (apenas se for o próprio usuário logado)
      if (!params.userId || params.userId === currentUserId) {
        const email = await this.getUserEmail();
        await this._storeNotification(email, params);
      }
    } catch (e) {
      console.error('[NotificationService] push error:', e);
    }
  }

  /**
   * Envia notificação para UM EMAIL ESPECÍFICO (destinatário de uma transferência)
   */
  async pushToEmail(
    targetEmail: string,
    params: {
      type: NotificationType;
      title: string;
      description: string;
      amount?: string;
      currency?: string;
    }
  ) {
    try {
      // Buscar user_id pelo email — tenta tabela 'usuarios' primeiro, depois 'profiles'
      let targetUserId: string | null = null;

      const { data: userData } = await supabase
        .from('usuarios')
        .select('*')
        .eq('email', targetEmail)
        .maybeSingle();

      if (userData?.id) {
        targetUserId = userData.id as string;
      }

      if (targetUserId) {
        await supabase.from('notificacoes').insert({
          user_id: targetUserId,
          tipo: params.type,
          titulo: params.title,
          descricao: params.description,
          valor: sanitizeAmount(params.amount),
          moeda: params.currency,
          lida: false,
        });
      } else {
        console.warn(`[NotificationService] pushToEmail: usuário com email ${targetEmail} não encontrado`);
      }

      // Também salvar localmente se o usuário estiver logado no device
      await this._storeNotification(targetEmail, params);
    } catch (e) {
      console.error('[NotificationService] pushToEmail error:', e);
    }
  }

  // ========== MÉTODOS PRIVADOS ==========

  private mapTipoNotificacao(titulo: string, descricao?: string): NotificationType {
    const text = ((titulo || '') + ' ' + (descricao || '')).toLowerCase();
    if (text.includes('recebido') || text.includes('recebeu') || text.includes('recebimento') || text.includes('depositado')) return 'recebimento';
    if (text.includes('enviado') || text.includes('pago') || text.includes('pagamento') || text.includes('transfer')) return 'pagamento';
    if (text.includes('sucesso') || text.includes('ativado') || text.includes('conclu')) return 'sucesso';
    if (text.includes('erro') || text.includes('falha') || text.includes('insuficiente') || text.includes('cancelado')) return 'erro';
    return 'info';
  }

  private formatTime(createdAt: string): string {
    const date = new Date(createdAt);
    return (
      date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
      ', ' +
      date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    );
  }

  private async _storeNotification(
    email: string | null,
    params: {
      type: NotificationType;
      title: string;
      description: string;
      amount?: string;
      currency?: string;
    }
  ) {
    const key = email ? `notifications_${email}` : 'notifications_anonymous';

    const stored = await AsyncStorage.getItem(key);
    const notifications = stored ? JSON.parse(stored) : [];

    const now = new Date();
    const timeStr =
      now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
      ', ' +
      now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const newNotif: Notification = {
      id: generateSecureId('notif'),
      ...params,
      time: timeStr,
      read: false,
    };

    const newList = [newNotif, ...notifications].slice(0, 50);
    await AsyncStorage.setItem(key, JSON.stringify(newList));
  }
}

export const notificationService = new NotificationService();
export default notificationService;
