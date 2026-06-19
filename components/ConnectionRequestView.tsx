import React, { useEffect, useRef } from 'react';
import {
  Animated,
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { V, F } from '@/constants/theme';
import { ConnectionRequest, Permission, PERMISSION_META } from '@/src/services/connectionService';
import { useSettings } from '@/constants/SettingsContext';

interface ConnectionRequestViewProps {
  request: ConnectionRequest;
  walletAddress: string;
  network: string;
  onApprove: () => void;
  onReject: () => void;
  isApproving: boolean;
  error?: string | null;
  /** Contagem regressiva em segundos até auto-rejeição (0 = sem timeout) */
  timeLeft?: number;
  /** true se este dApp já se conectou antes */
  isReturning?: boolean;
}

function truncateKey(key: string) {
  if (!key || key.length <= 16) return key || '';
  return `${key.slice(0, 6)}...${key.slice(-6)}`;
}

function extractHostname(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

function PermissionRow({ permission, last }: { permission: string; last: boolean }) {
  const { t } = useSettings();
  const meta = PERMISSION_META[permission as Permission] || {
    label: permission,
    description: t('Solicitação de acesso'),
    icon: 'lock',
    risk: 'medium',
  };

  const isHigh = meta.risk === 'high';
  const iconColor = isHigh ? V.danger : (meta.risk === 'low' ? V.success : V.gold);

  return (
    <View style={[s.permRow, last && { borderBottomWidth: 0 }]}>
      <View style={[s.permIcon, { backgroundColor: iconColor + '18' }]}>
        <Feather name={(meta.icon as any) || 'lock'} size={15} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.permLabel}>{t(meta.label)}</Text>
        <Text style={s.permDesc}>{t(meta.description)}</Text>
      </View>
      {isHigh ? (
        <View style={s.highBadge}>
          <Text style={s.highBadgeT}>{t('ALTO RISCO')}</Text>
        </View>
      ) : (
        <Feather name="check-circle" size={16} color={iconColor} />
      )}
    </View>
  );
}

export const ConnectionRequestView: React.FC<ConnectionRequestViewProps> = ({
  request,
  walletAddress,
  network,
  onApprove,
  onReject,
  isApproving,
  error,
  timeLeft,
  isReturning,
}) => {
  const insets = useSafeAreaInsets();
  const { t } = useSettings();
  const slideAnim = useRef(new Animated.Value(350)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, []);

  const hostname = extractHostname(request.origin);
  const hasHighRisk = (request.permissions || []).some(p => PERMISSION_META[p]?.risk === 'high');

  return (
    <View style={s.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onReject} />

      <Animated.View
        style={[s.sheet, { transform: [{ translateY: slideAnim }] }]}
      >
        {/* Handle */}
        <View style={s.handle} />

        {/* URL Pill */}
        <View style={s.urlPill}>
          <View style={s.urlDot} />
          <Text style={s.urlText}>{hostname}</Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* dApp icon + name */}
          <View style={s.dappCenter}>
            <View style={s.dappIconWrap}>
              {request.icon ? (
                <Image source={{ uri: request.icon }} style={s.dappIcon} />
              ) : (
                <View style={s.dappIconFallback}>
                  <Feather name="globe" size={32} color={V.gold} />
                </View>
              )}
            </View>
            <Text style={s.dappName}>{request.name || hostname}</Text>
            <Text style={s.dappSubtitle}>{t('quer se conectar à sua carteira')}</Text>
            {isReturning !== undefined && (
              <View style={[s.returnPill, isReturning ? s.returnPillKnown : s.returnPillNew]}>
                <Text style={[s.returnPillText, isReturning ? s.returnPillTextKnown : s.returnPillTextNew]}>
                  {isReturning ? t('RECONECTAR') : t('PRIMEIRA CONEXÃO')}
                </Text>
              </View>
            )}
          </View>

          <View style={s.divider} />

          {/* Wallet row */}
          <View style={s.walletRow}>
            <View style={s.walletAvatar}>
              <Feather name="shield" size={18} color={V.gold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.walletName}>Verum Wallet</Text>
              <Text style={s.walletAddr}>{walletAddress ? truncateKey(walletAddress) : '...'}</Text>
            </View>
            <View style={s.netPill}>
              <View style={[s.netDot, { backgroundColor: V.success }]} />
              <Text style={s.netText}>{network || 'mainnet'}</Text>
            </View>
          </View>

          {/* Permissions */}
          <Text style={s.sectionLabel}>{t('O QUE ESTE SITE IRÁ ACESSAR')}</Text>
          <View style={s.permCard}>
            {(request.permissions || ['publicKey']).map((perm, i, arr) => (
              <PermissionRow
                key={`${perm}-${i}`}
                permission={perm}
                last={i === arr.length - 1}
              />
            ))}
          </View>

          {hasHighRisk && (
            <View style={s.riskAlert}>
              <Feather name="alert-triangle" size={16} color={V.danger} />
              <Text style={s.riskAlertText}>
                {t('Atenção: Este site solicita permissões de alto risco.')}
              </Text>
            </View>
          )}

          {error && (
            <View style={s.errorBox}>
              <Text style={s.errorText}>{error}</Text>
            </View>
          )}
        </ScrollView>

        {/* Footer — two buttons */}
        <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TouchableOpacity
            style={[s.cancelBtn, isApproving && { opacity: 0.5 }]}
            onPress={onReject}
            disabled={isApproving}
          >
            <Text style={s.cancelBtnT}>{t('CANCELAR')}</Text>
            {!!timeLeft && timeLeft > 0 && (
              <Text style={s.countdownText}>{timeLeft}s</Text>
            )}
          </TouchableOpacity>

          {isApproving ? (
            <View style={[s.connectBtn, { opacity: 0.8 }]}>
              <ActivityIndicator color={V.bg} size="small" />
            </View>
          ) : (
            <TouchableOpacity style={s.connectBtn} onPress={onApprove}>
              <Text style={s.connectBtnT}>{t('CONECTAR')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>
    </View>
  );
};

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: V.surface1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: V.border,
    maxHeight: '75%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: V.muted,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
    opacity: 0.4,
  },
  urlPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
    backgroundColor: V.gold + '15',
    borderRadius: V.r20,
    paddingHorizontal: 14,
    paddingVertical: 5,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: V.gold + '40',
  },
  urlDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: V.success,
  },
  urlText: {
    fontFamily: F.semi,
    fontSize: 13,
    color: V.text,
  },
  scroll: {
    paddingHorizontal: V.px,
    paddingTop: 16,
    paddingBottom: 8,
  },
  dappCenter: {
    alignItems: 'center',
    marginBottom: 20,
  },
  dappIconWrap: {
    marginBottom: 14,
  },
  dappIcon: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: V.surface2,
  },
  dappIconFallback: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: V.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: V.border,
  },
  dappName: {
    fontFamily: F.title,
    fontSize: 24,
    color: V.text,
    marginBottom: 4,
    textAlign: 'center',
  },
  dappSubtitle: {
    fontFamily: F.body,
    fontSize: 15,
    color: V.muted,
  },
  divider: {
    height: 1,
    backgroundColor: V.border,
    marginVertical: 18,
  },
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: V.surface2,
    padding: 14,
    borderRadius: V.r12,
    borderWidth: 1,
    borderColor: V.border,
    marginBottom: 20,
  },
  walletAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: V.gold + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletName: {
    fontFamily: F.bold,
    fontSize: 14,
    color: V.text,
  },
  walletAddr: {
    fontFamily: F.body,
    fontSize: 12,
    color: V.muted,
  },
  netPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: V.r20,
    borderWidth: 1,
    borderColor: V.success + '40',
    backgroundColor: V.surface1,
  },
  netDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  netText: {
    fontFamily: F.semi,
    fontSize: 10,
    color: V.success,
    textTransform: 'lowercase',
  },
  sectionLabel: {
    fontFamily: F.bold,
    fontSize: 11,
    color: V.muted,
    letterSpacing: 1,
    marginBottom: 10,
    textAlign: 'center',
  },
  permCard: {
    backgroundColor: V.surface2,
    borderRadius: V.r12,
    borderWidth: 1,
    borderColor: V.border,
    overflow: 'hidden',
    marginBottom: 14,
  },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: V.border,
  },
  permIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permLabel: {
    fontFamily: F.semi,
    fontSize: 14,
    color: V.text,
  },
  permDesc: {
    fontFamily: F.body,
    fontSize: 12,
    color: V.muted,
  },
  highBadge: {
    backgroundColor: V.danger + '15',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: V.r8,
    borderWidth: 1,
    borderColor: V.danger + '30',
  },
  highBadgeT: {
    fontFamily: F.bold,
    fontSize: 9,
    color: V.danger,
  },
  riskAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: V.danger + '10',
    padding: 12,
    borderRadius: V.r10,
    borderWidth: 1,
    borderColor: V.danger + '20',
    marginBottom: 8,
  },
  riskAlertText: {
    flex: 1,
    fontFamily: F.body,
    fontSize: 13,
    color: V.danger,
  },
  errorBox: {
    backgroundColor: V.danger + '15',
    padding: 12,
    borderRadius: V.r10,
    marginTop: 6,
  },
  errorText: {
    fontFamily: F.body,
    fontSize: 14,
    color: V.danger,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: V.px,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: V.border,
  },
  cancelBtn: {
    flex: 1,
    height: 52,
    borderRadius: V.r12,
    borderWidth: 1,
    borderColor: V.danger + '70',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnT: {
    fontFamily: F.bold,
    fontSize: 14,
    color: V.danger,
    letterSpacing: 0.5,
  },
  connectBtn: {
    flex: 1,
    height: 52,
    borderRadius: V.r12,
    backgroundColor: V.gold,
    alignItems: 'center',
    justifyContent: 'center',
    ...V.shadow,
  },
  connectBtnT: {
    fontFamily: F.bold,
    fontSize: 14,
    color: V.bg,
    letterSpacing: 0.5,
  },
  countdownText: {
    fontFamily: F.body,
    fontSize: 10,
    color: V.danger,
    marginTop: 2,
  },
  returnPill: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  returnPillKnown: {
    backgroundColor: V.gold + '15',
    borderColor: V.gold + '40',
  },
  returnPillNew: {
    backgroundColor: V.success + '15',
    borderColor: V.success + '40',
  },
  returnPillText: {
    fontFamily: F.bold,
    fontSize: 9,
    letterSpacing: 0.5,
  },
  returnPillTextKnown: {
    color: V.gold,
  },
  returnPillTextNew: {
    color: V.success,
  },
});
