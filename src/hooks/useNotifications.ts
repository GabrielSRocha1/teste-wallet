import { useEffect } from 'react';
import { supabase } from '@/src/services/supabase';
import { Alert } from 'react-native';

export function useNotifications(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;

    // 1. Criar o canal de escuta para a tabela 'notificacoes'
    const channel = supabase
      .channel(`realtime:notificacoes:${userId}`) // Canal único por usuário
      .on(
        'postgres_changes',
        {
          event: 'INSERT', // Queremos apenas novas inserções
          schema: 'public',
          table: 'notificacoes',
          filter: `user_id=eq.${userId}`, // Filtra apenas para este usuário
        },
        (payload: any) => {
          // 2. O que acontece quando a notificação chega
          const { titulo, descricao, valor, moeda } = payload.new;
          
          Alert.alert(
            titulo,
            `${descricao}${valor && moeda ? `\nValor: ${valor} ${moeda}` : ''}`,
            [{ text: 'OK', onPress: () => console.log('Notificação lida') }]
          );
        }
      )
      .subscribe();

    // 3. Limpeza: fecha a conexão ao desmontar o componente
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);
}
