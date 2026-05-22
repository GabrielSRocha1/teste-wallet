import BottomNav from '@/components/BottomNav';
import Header from '@/components/Header';
import { getUser } from '@/constants/auth-storage';
import { Feather, Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState, useEffect } from 'react';
import { ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { V, F, PAD } from '@/constants/theme';
import { useSettings } from '@/constants/SettingsContext';
import notificationService from '@/src/services/notificationService';
import { supabase } from '@/src/services/supabase';

type NotificationType = 'recebimento' | 'pagamento' | 'swap' | 'sucesso' | 'erro' | 'info';

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  description: string;
  amount?: string;
  currency?: string;
  time: string;
  read: boolean;
}

const NOTIFICATIONS_DEFAULT: Notification[] = [];

const TYPE_CONFIG: Record<NotificationType, { icon: string; color: string; label: string }> = {
  recebimento: { icon: 'arrow-down-left', color: V.success, label: 'Recebido' },
  pagamento: { icon: 'arrow-up-right', color: V.success, label: 'Enviado' },
  swap: { icon: 'repeat', color: V.gold, label: 'Swap' },
  sucesso: { icon: 'check-circle', color: V.success, label: 'Sucesso' },
  erro: { icon: 'x-circle', color: V.danger, label: 'Erro' },
  info: { icon: 'info', color: V.gold, label: 'Info' },
};

export default function NotificacoesScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useSettings();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<'todas' | NotificationType>('todas');

  const loadNotifications = async () => {
    const notifs = await notificationService.getNotifications();
    setNotifications(notifs as any[]);
  };

  useEffect(() => {
    loadNotifications();

    let channel: ReturnType<typeof supabase.channel> | null = null;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;

      // Subscription com filtro por user_id — evita receber notificações de outros usuários
      channel = supabase
        .channel(`notificacoes:${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notificacoes',
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            loadNotifications();
          }
        )
        .subscribe();
    });

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  // Mapeamento local como fallback para notificações antigas sem campo 'tipo' no banco
  const mapTypeFromTitle = (title: string, description: string): NotificationType => {
    const text = (title + ' ' + description).toLowerCase();
    if (text.includes('swap') || text.includes('trocou') || text.includes('câmbio') || text.includes('cambio')) return 'swap';
    if (text.includes('recebido') || text.includes('recebeu') || text.includes('depositado')) return 'recebimento';
    if (text.includes('enviado') || text.includes('pago') || text.includes('transfer')) return 'pagamento';
    if (text.includes('sucesso') || text.includes('ativado') || text.includes('conclu')) return 'sucesso';
    if (text.includes('erro') || text.includes('falha') || text.includes('insuficiente')) return 'erro';
    return 'info';
  };

  // Normaliza o tipo de cada notificação (usa campo do banco ou infere localmente)
  const normalizedNotifications = notifications.map(n => ({
    ...n,
    type: n.type || mapTypeFromTitle(n.title, n.description),
  }));

  const unreadCount = normalizedNotifications.filter((n) => !n.read).length;

  const filtered = filter === 'todas'
    ? normalizedNotifications
    : normalizedNotifications.filter((n) => n.type === filter);

  const emptyMessages: Record<string, string> = {
    todas: t('NENHUMA NOTIFICAÇÃO'),
    recebimento: t('Nenhuma notificação de recebimento'),
    pagamento: t('Nenhuma notificação de envio'),
    swap: t('Nenhum swap registrado'),
    sucesso: t('Nenhuma notificação de sucesso'),
    erro: t('Nenhum erro registrado'),
    info: t('Nenhuma informação'),
  };



  const markAllRead = async () => {
    const newList = notifications.map((n) => ({ ...n, read: true }));
    setNotifications(newList); // Atualização otimista
    await notificationService.markAllAsRead();
  };

  const clearAll = async () => {
    setNotifications([]); // Atualização otimista
    await notificationService.deleteAllNotifications();
  };

  const markRead = async (id: string) => {
    const newList = notifications.map((n) => n.id === id ? { ...n, read: true } : n);
    setNotifications(newList);
    await notificationService.markAsRead(id);
  };

  const FILTERS: { key: 'todas' | NotificationType; label: string }[] = [
    { key: 'todas', label: t('TODAS') },
    { key: 'recebimento', label: t('RECEBIDOS') },
    { key: 'pagamento', label: t('ENVIADOS') },
    { key: 'swap', label: t('SWAPS') },
    { key: 'sucesso', label: t('SUCESSO') },
    { key: 'erro', label: t('ERROS') },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />

      <Header onBackPress={() => router.back()} />

      <View style={styles.titleBox}>
          <Text style={styles.title}>{t('NOTIFICAÇÕES')}</Text>
          <View style={styles.goldLine} />
      </View>

      <View style={styles.filtersBox}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersRow}>
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
              onPress={() => setFilter(f.key)}
            >
              <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {notifications.length > 0 && (
        <View style={styles.actionsRow}>
          {unreadCount > 0 && (
            <TouchableOpacity style={styles.actionItem} onPress={markAllRead}>
              <Feather name="check-square" size={14} color={V.gold} />
              <Text style={styles.actionText}>{t('LIDAS')} ({unreadCount})</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.actionItem} onPress={clearAll}>
            <Feather name="trash-2" size={14} color={V.danger} />
            <Text style={[styles.actionText, { color: V.danger }]}>{t('LIMPAR TUDO')}</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={64} color={V.surface2} />
            <Text style={styles.emptyText}>{emptyMessages[filter] || t('NENHUMA NOTIFICAÇÃO')}</Text>
          </View>
        ) : (
          filtered.map((notif) => {
            const cfg = TYPE_CONFIG[notif.type] || TYPE_CONFIG['info'];
            return (
              <TouchableOpacity
                key={notif.id}
                style={[styles.card, !notif.read && styles.cardUnread]}
                onPress={() => markRead(notif.id)}
              >
                {!notif.read && <View style={styles.unreadDot} />}
                <View style={[styles.iconBox, { borderColor: cfg.color + '40' }]}>
                  <Feather name={cfg.icon as any} size={20} color={cfg.color} />
                </View>
                <View style={styles.cardInfo}>
                  <View style={styles.cardHeader}>
                    <Text style={[styles.cardTitle, { color: cfg.color }]}>{t(notif.title)}</Text>
                    <Text style={styles.cardTime}>{notif.time.replace('Hoje', t('Hoje')).replace('Ontem', t('Ontem'))}</Text>
                  </View>
                  <Text style={[styles.cardDesc, { color: cfg.color }]}>
                    {notif.description.split(/(\d+[.,]\d+|\d+)/).map((part, i) => {
                      const isNum = /\d/.test(part);
                      return <Text key={i} style={isNum ? { color: '#FFFFFF' } : null}>{part}</Text>
                    })}
                  </Text>
                  {notif.amount && (
                    <Text style={styles.cardAmount}>
                      {notif.amount} <Text style={styles.cardCurrency}>{notif.currency}</Text>
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <BottomNav activeRoute="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: V.bg },
  titleBox: { paddingHorizontal: V.px, marginTop: 16, marginBottom: 20 },
  title: { fontSize: 24, fontFamily: F.title, color: V.gold, letterSpacing: 2 },
  goldLine: { width: 40, height: 2, backgroundColor: V.gold, marginTop: 4 },

  filtersBox: { height: 44, marginBottom: 12 },
  filtersRow: { paddingHorizontal: V.px, gap: 8, alignItems: 'center' },
  filterChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: V.r20, backgroundColor: V.surface1, borderWidth: 1, borderColor: V.border },
  filterChipActive: { backgroundColor: V.gold, borderColor: V.gold },
  filterText: { fontSize: 10, fontFamily: F.bold, color: V.muted, letterSpacing: 0.5 },
  filterTextActive: { color: V.bg },

  actionsRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, paddingHorizontal: V.px, marginBottom: 16 },
  actionItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { fontSize: 10, fontFamily: F.bold, color: V.gold, letterSpacing: 1 },

  list: { paddingHorizontal: V.px, paddingBottom: 120, gap: 12 },
  card: { backgroundColor: V.surface1, borderRadius: V.r12, padding: 16, flexDirection: 'row', gap: 14, borderWidth: 1, borderColor: V.border, ...V.shadow },
  cardUnread: { borderColor: V.gold + '40', backgroundColor: 'rgba(201,168,76,0.03)' },
  unreadDot: { position: 'absolute', top: 16, right: 16, width: 8, height: 8, borderRadius: 4, backgroundColor: V.gold },
  iconBox: { width: 44, height: 44, borderRadius: 22, backgroundColor: V.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  cardInfo: { flex: 1 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  cardTitle: { fontSize: 15, fontFamily: F.semi, color: V.text },
  cardTime: { fontSize: 10, fontFamily: F.body, color: V.muted },
  cardDesc: { fontSize: 13, fontFamily: F.body, lineHeight: 18, marginBottom: 8 },
  cardAmount: { fontSize: 14, fontFamily: F.bold, color: '#FFFFFF' },
  cardCurrency: { fontSize: 11, fontFamily: F.body, color: '#FFFFFF' },

  empty: { alignItems: 'center', justifyContent: 'center', marginTop: 100, gap: 16 },
  emptyText: { fontSize: 14, fontFamily: F.title, color: V.muted, letterSpacing: 1 },
});
