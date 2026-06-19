/**
 * Connected Apps — Gerenciamento de dApps conectados à Verum Wallet.
 *
 * Lista todas as sessões ativas com opção de revogar individualmente
 * ou desconectar todos os dApps de uma vez.
 *
 * Segurança:
 *  - Nunca expõe chave privada
 *  - Revogar remove sessão do AsyncStorage e invalida o token
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { V, F } from '@/constants/theme';
import { useConnection } from '@/src/context/ConnectionContext';
import { ConnectedSession, PERMISSION_META, Permission } from '@/src/services/connectionService';
import trustedDapps from '@/src/services/trustedDapps';
import { useSettings } from '@/constants/SettingsContext';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function truncateKey(key: string): string {
  if (key.length <= 16) return key;
  return `${key.slice(0, 6)}...${key.slice(-6)}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const day   = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year  = d.getFullYear();
  const hours = d.getHours().toString().padStart(2, '0');
  const mins  = d.getMinutes().toString().padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${mins}`;
}

function timeAgo(ts: number, t: (k: string, p?: Record<string, string>) => string): string {
  const diff  = Date.now() - ts;
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);

  if (mins < 1)   return t('Agora mesmo');
  if (mins < 60)  return t('{n}m atrás', { n: String(mins) });
  if (hours < 24) return t('{n}h atrás', { n: String(hours) });
  if (days < 30)  return t('{n}d atrás', { n: String(days) });
  return formatDate(ts);
}

const RISK_COLOR: Record<string, string> = {
  low:    V.success,
  medium: V.gold,
  high:   V.danger,
};

// ─── Componentes ─────────────────────────────────────────────────────────────

function SessionCard({ session, onRevoke, onOpen }: {
  session: ConnectedSession;
  onRevoke: () => void;
  onOpen: () => void;
}) {
  const { t } = useSettings();
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={card.container}>
      <TouchableOpacity
        style={card.header}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={card.iconWrap}>
          {session.icon ? (
            <Image source={{ uri: session.icon }} style={card.icon} />
          ) : (
            <Feather name="globe" size={22} color={V.gold} />
          )}
        </View>

        <View style={card.info}>
          <Text style={card.name} numberOfLines={1}>{session.name}</Text>
          <Text style={card.origin} numberOfLines={1}>{extractHostname(session.origin)}</Text>
        </View>

        <View style={card.rightGroup}>
          <Text style={card.timeAgo}>{timeAgo(session.connectedAt, t)}</Text>
          <Feather
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={V.muted}
          />
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={card.details}>
          {/* Info */}
          <View style={card.detailRow}>
            <Text style={card.detailLabel}>{t('Endereço')}</Text>
            <Text style={card.detailValue}>{truncateKey(session.publicKey)}</Text>
          </View>
          <View style={card.detailRow}>
            <Text style={card.detailLabel}>{t('Rede')}</Text>
            <View style={card.networkBadge}>
              <View style={[card.networkDot, { backgroundColor: V.success }]} />
              <Text style={card.networkText}>{session.network}</Text>
            </View>
          </View>
          <View style={card.detailRow}>
            <Text style={card.detailLabel}>{t('Conectado em')}</Text>
            <Text style={card.detailValue}>{formatDate(session.connectedAt)}</Text>
          </View>

          {/* Permissões */}
          <Text style={card.permTitle}>{t('Permissões')}</Text>
          <View style={card.permList}>
            {session.permissions.map(perm => {
              const meta = PERMISSION_META[perm];
              if (!meta) return null;
              return (
                <View key={perm} style={card.permRow}>
                  <Feather name={meta.icon as any} size={12} color={RISK_COLOR[meta.risk]} />
                  <Text style={card.permLabel}>{t(meta.label)}</Text>
                </View>
              );
            })}
          </View>

          {/* Ações */}
          <View style={card.actions}>
            <TouchableOpacity style={card.openBtn} onPress={onOpen}>
              <Feather name="external-link" size={14} color={V.gold} />
              <Text style={card.openText}>{t('Abrir')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={card.revokeBtn} onPress={onRevoke}>
              <Feather name="slash" size={14} color={V.danger} />
              <Text style={card.revokeText}>{t('Desconectar')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Tela Principal ──────────────────────────────────────────────────────────

export default function ConnectedAppsScreen() {
  const insets = useSafeAreaInsets();
  const { sessions, revokeSession, reloadSessions } = useConnection();
  const { t } = useSettings();

  useEffect(() => {
    reloadSessions();
  }, [reloadSessions]);

  const handleRevoke = useCallback((session: ConnectedSession) => {
    const doRevoke = async () => {
      await revokeSession(session.id);
      await trustedDapps.removeTrusted(session.origin);
    };

    if (Platform.OS === 'web') {
      if (confirm(t('Desconectar {name}?', { name: session.name }))) doRevoke();
      return;
    }

    Alert.alert(
      t('Desconectar dApp'),
      t('Tem certeza que deseja desconectar "{name}"?\n\nO dApp perderá acesso à sua carteira.', { name: session.name }),
      [
        { text: t('Cancelar'), style: 'cancel' },
        { text: t('Desconectar'), style: 'destructive', onPress: doRevoke },
      ],
    );
  }, [revokeSession, t]);

  const handleRevokeAll = useCallback(() => {
    if (sessions.length === 0) return;

    const doRevokeAll = async () => {
      for (const session of sessions) {
        await revokeSession(session.id);
        await trustedDapps.removeTrusted(session.origin);
      }
    };

    if (Platform.OS === 'web') {
      if (confirm(t('Desconectar todos os dApps?'))) doRevokeAll();
      return;
    }

    Alert.alert(
      t('Desconectar Todos'),
      t('Tem certeza que deseja desconectar {count} dApp(s)?\n\nTodos perderão acesso à sua carteira.', { count: String(sessions.length) }),
      [
        { text: t('Cancelar'), style: 'cancel' },
        { text: t('Desconectar Todos'), style: 'destructive', onPress: doRevokeAll },
      ],
    );
  }, [sessions, revokeSession, t]);

  const openDApp = useCallback((session: ConnectedSession) => {
    router.push({
      pathname: '/dapp-browser',
      params: {
        url: encodeURIComponent(session.origin),
        name: encodeURIComponent(session.name),
      },
    } as any);
  }, []);

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={V.bg} />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={V.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{t('Apps Conectados')}</Text>
        {sessions.length > 0 ? (
          <TouchableOpacity style={s.revokeAllBtn} onPress={handleRevokeAll}>
            <Text style={s.revokeAllText}>{t('Desconectar Todos')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 100 }} />
        )}
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Info */}
        <LinearGradient
          colors={['#1A1500', '#0D0B00']}
          style={s.infoBanner}
        >
          <Feather name="shield" size={18} color={V.gold} />
          <Text style={s.infoText}>
            {t('Os dApps abaixo têm acesso ao endereço público da sua carteira. Sua chave privada nunca é compartilhada.')}
          </Text>
        </LinearGradient>

        {/* Stats */}
        {sessions.length > 0 && (
          <View style={s.statsRow}>
            <View style={s.statCard}>
              <Text style={s.statNumber}>{sessions.length}</Text>
              <Text style={s.statLabel}>{t('Conectados')}</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statNumber}>
                {sessions.filter(s => s.permissions.includes('signTransaction')).length}
              </Text>
              <Text style={s.statLabel}>{t('Com assinatura')}</Text>
            </View>
          </View>
        )}

        {/* Lista */}
        {sessions.length === 0 ? (
          <View style={s.emptyState}>
            <View style={s.emptyIcon}>
              <Feather name="link-2" size={40} color={V.muted + '40'} />
            </View>
            <Text style={s.emptyTitle}>{t('Nenhum app conectado')}</Text>
            <Text style={s.emptyDesc}>
              {t('Navegue para um dApp e conecte sua carteira para vê-lo aqui.')}
            </Text>
            <TouchableOpacity
              style={s.exploreBtn}
              onPress={() => router.push('/dapp-hub' as any)}
            >
              <Feather name="compass" size={16} color={V.bg} />
              <Text style={s.exploreBtnText}>{t('Explorar dApps')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          sessions.map(session => (
            <SessionCard
              key={session.id}
              session={session}
              onRevoke={() => handleRevoke(session)}
              onOpen={() => openDApp(session)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: V.bg },

  // Header
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: V.px,
    paddingVertical:   14,
    borderBottomWidth: 1,
    borderBottomColor: V.border,
  },
  backBtn: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: {
    fontFamily:    F.bold,
    fontSize:      16,
    color:         V.text,
    letterSpacing: 0.5,
  },
  revokeAllBtn: {
    paddingHorizontal: 10,
    paddingVertical:   6,
  },
  revokeAllText: {
    fontFamily: F.semi,
    fontSize:   12,
    color:      V.danger,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: V.px,
    paddingTop:        16,
    gap:               12,
  },

  // Info banner
  infoBanner: {
    flexDirection:  'row',
    gap:            12,
    alignItems:     'center',
    borderRadius:   V.r12,
    padding:        14,
    borderWidth:    1,
    borderColor:    V.border,
  },
  infoText: {
    flex:       1,
    fontFamily: F.body,
    fontSize:   12,
    color:      V.muted,
    lineHeight: 18,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap:           12,
  },
  statCard: {
    flex:            1,
    backgroundColor: V.surface1,
    borderRadius:    V.r10,
    padding:         14,
    alignItems:      'center',
    borderWidth:     1,
    borderColor:     V.border,
  },
  statNumber: {
    fontFamily: F.bold,
    fontSize:   24,
    color:      V.gold,
  },
  statLabel: {
    fontFamily: F.body,
    fontSize:   11,
    color:      V.muted,
    marginTop:  2,
  },

  // Empty
  emptyState: {
    alignItems:      'center',
    paddingVertical: 60,
    gap:             12,
  },
  emptyIcon: {
    width:           80,
    height:          80,
    borderRadius:    40,
    backgroundColor: V.surface2,
    alignItems:      'center',
    justifyContent:  'center',
    marginBottom:    8,
  },
  emptyTitle: {
    fontFamily: F.bold,
    fontSize:   18,
    color:      V.text,
  },
  emptyDesc: {
    fontFamily: F.body,
    fontSize:   14,
    color:      V.muted,
    textAlign:  'center',
    lineHeight: 22,
    paddingHorizontal: 20,
  },
  exploreBtn: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              8,
    backgroundColor:  V.gold,
    paddingHorizontal: 24,
    paddingVertical:  12,
    borderRadius:     V.r8,
    marginTop:        8,
  },
  exploreBtnText: {
    fontFamily:    F.bold,
    fontSize:      14,
    color:         V.bg,
    letterSpacing: 0.3,
  },
});

const card = StyleSheet.create({
  container: {
    backgroundColor: V.surface1,
    borderRadius:    V.r12,
    borderWidth:     1,
    borderColor:     V.border,
    overflow:        'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           12,
    padding:       14,
  },
  iconWrap: {
    width:           44,
    height:          44,
    borderRadius:    12,
    backgroundColor: V.surface2,
    borderWidth:     1,
    borderColor:     V.border,
    alignItems:      'center',
    justifyContent:  'center',
    overflow:        'hidden',
  },
  icon: { width: 44, height: 44 },
  info: { flex: 1 },
  name: {
    fontFamily: F.bold,
    fontSize:   14,
    color:      V.text,
  },
  origin: {
    fontFamily: F.body,
    fontSize:   12,
    color:      V.muted,
    marginTop:  1,
  },
  rightGroup: {
    alignItems: 'flex-end',
    gap:        4,
  },
  timeAgo: {
    fontFamily: F.body,
    fontSize:   11,
    color:      V.muted,
  },

  // Details
  details: {
    paddingHorizontal: 14,
    paddingBottom:     14,
    borderTopWidth:    1,
    borderTopColor:    V.border,
    paddingTop:        12,
    gap:               8,
  },
  detailRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  detailLabel: {
    fontFamily: F.body,
    fontSize:   12,
    color:      V.muted,
  },
  detailValue: {
    fontFamily: F.semi,
    fontSize:   12,
    color:      V.text,
  },
  networkBadge: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           4,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderRadius:  V.r20,
    borderWidth:   1,
    borderColor:   V.success + '40',
  },
  networkDot:  { width: 6, height: 6, borderRadius: 3 },
  networkText: { fontFamily: F.semi, fontSize: 10, color: V.success, textTransform: 'capitalize' },

  // Permissions
  permTitle: {
    fontFamily:    F.bold,
    fontSize:      10,
    color:         V.muted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop:     4,
  },
  permList: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           8,
  },
  permRow: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              4,
    backgroundColor:  V.surface2,
    paddingHorizontal: 8,
    paddingVertical:  4,
    borderRadius:     V.r20,
  },
  permLabel: {
    fontFamily: F.body,
    fontSize:   11,
    color:      V.text,
  },

  // Actions
  actions: {
    flexDirection: 'row',
    gap:           12,
    marginTop:     8,
  },
  openBtn: {
    flex:          1,
    flexDirection: 'row',
    alignItems:    'center',
    justifyContent: 'center',
    gap:           6,
    paddingVertical: 10,
    borderRadius:  V.r8,
    borderWidth:   1,
    borderColor:   V.gold + '40',
    backgroundColor: V.gold + '10',
  },
  openText: {
    fontFamily: F.semi,
    fontSize:   13,
    color:      V.gold,
  },
  revokeBtn: {
    flex:          1,
    flexDirection: 'row',
    alignItems:    'center',
    justifyContent: 'center',
    gap:           6,
    paddingVertical: 10,
    borderRadius:  V.r8,
    borderWidth:   1,
    borderColor:   V.danger + '40',
    backgroundColor: V.danger + '10',
  },
  revokeText: {
    fontFamily: F.semi,
    fontSize:   13,
    color:      V.danger,
  },
});
