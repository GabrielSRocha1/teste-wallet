/**
 * SwipeToConfirm — slider de confirmação estilo Solflare.
 *
 * BUG FIX: O PanResponder é criado uma única vez (useRef) e NÃO pode
 * ler estado React diretamente — os valores seriam congelados no valor
 * inicial (closure). Portanto, todos os valores mutáveis que o PanResponder
 * precisa ler são armazenados em refs e mantidos sincronizados.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F, V } from '@/constants/theme';

interface SwipeToConfirmProps {
  onConfirm: () => void;
  label?: string;
  disabled?: boolean;
  accentColor?: string;
}

const THUMB_SIZE = 52;
const TRACK_HEIGHT = 60;
const PADDING = 4;
const CONFIRM_THRESHOLD = 0.82;

export default function SwipeToConfirm({
  onConfirm,
  label = 'Deslize para confirmar',
  disabled = false,
  accentColor,
}: SwipeToConfirmProps) {
  const accent = accentColor ?? V.gold;

  // ── Refs (lidos dentro do PanResponder sem problema de closure) ──────────
  const trackWidthRef = useRef(0);
  const disabledRef   = useRef(disabled);
  const confirmedRef  = useRef(false);

  // Sync props/state → refs em cada render
  disabledRef.current = disabled;

  // ── Estado apenas para re-render visual ──────────────────────────────────
  const [confirmed, setConfirmed] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);

  // ── Animated values ───────────────────────────────────────────────────────
  const translateX   = useRef(new Animated.Value(0)).current;
  const textOpacity  = useRef(new Animated.Value(1)).current;
  const thumbScale   = useRef(new Animated.Value(1)).current;
  const glowOpacity  = useRef(new Animated.Value(0)).current;

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getMaxSlide = () => trackWidthRef.current - THUMB_SIZE - PADDING * 2;

  const snapBack = useCallback(() => {
    Animated.spring(translateX,  { toValue: 0, useNativeDriver: Platform.OS !== 'web', tension: 120, friction: 12 }).start();
    Animated.timing(textOpacity, { toValue: 1, duration: 200, useNativeDriver: Platform.OS !== 'web' }).start();
    Animated.spring(thumbScale,  { toValue: 1, useNativeDriver: Platform.OS !== 'web' }).start();
    Animated.timing(glowOpacity, { toValue: 0, duration: 200, useNativeDriver: Platform.OS !== 'web' }).start();
  }, []);

  // ── PanResponder (criado uma vez; lê SOMENTE refs) ────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: ()  => !disabledRef.current && !confirmedRef.current,
      onMoveShouldSetPanResponder:  ()  => !disabledRef.current && !confirmedRef.current,
      onStartShouldSetPanResponderCapture: () => !disabledRef.current && !confirmedRef.current,
      onMoveShouldSetPanResponderCapture:  () => !disabledRef.current && !confirmedRef.current,

      onPanResponderGrant: () => {
        Animated.spring(thumbScale,  { toValue: 1.08, useNativeDriver: Platform.OS !== 'web' }).start();
        Animated.timing(glowOpacity, { toValue: 1, duration: 200, useNativeDriver: Platform.OS !== 'web' }).start();
      },

      onPanResponderMove: (_, gestureState) => {
        const maxSl = getMaxSlide();
        if (maxSl <= 0) return;

        const clamped = Math.min(Math.max(0, gestureState.dx), maxSl);
        translateX.setValue(clamped);

        const progress = clamped / maxSl;
        textOpacity.setValue(Math.max(0, 1 - progress * 1.6));
      },

      onPanResponderRelease: (_, gestureState) => {
        const maxSl = getMaxSlide();
        if (maxSl <= 0) return;

        const progress = Math.max(0, gestureState.dx) / maxSl;

        if (progress >= CONFIRM_THRESHOLD) {
          confirmedRef.current = true;
          Animated.timing(translateX, { toValue: maxSl, duration: 120, useNativeDriver: Platform.OS !== 'web' }).start(() => {
            setConfirmed(true);
            if (Platform.OS !== 'web') Vibration.vibrate(40);
            onConfirm();
          });
          Animated.timing(textOpacity, { toValue: 0, duration: 80, useNativeDriver: Platform.OS !== 'web' }).start();
        } else {
          Animated.spring(translateX,  { toValue: 0, useNativeDriver: Platform.OS !== 'web', tension: 120, friction: 12 }).start();
          Animated.timing(textOpacity, { toValue: 1, duration: 200, useNativeDriver: Platform.OS !== 'web' }).start();
          Animated.spring(thumbScale,  { toValue: 1, useNativeDriver: Platform.OS !== 'web' }).start();
          Animated.timing(glowOpacity, { toValue: 0, duration: 200, useNativeDriver: Platform.OS !== 'web' }).start();
        }
      },

      onPanResponderTerminate: () => {
        // Gesture stolen by another responder — snap back
        Animated.spring(translateX,  { toValue: 0, useNativeDriver: Platform.OS !== 'web', tension: 120, friction: 12 }).start();
        Animated.timing(textOpacity, { toValue: 1, duration: 200, useNativeDriver: Platform.OS !== 'web' }).start();
        Animated.spring(thumbScale,  { toValue: 1, useNativeDriver: Platform.OS !== 'web' }).start();
        Animated.timing(glowOpacity, { toValue: 0, duration: 200, useNativeDriver: Platform.OS !== 'web' }).start();
      },
    })
  ).current;

  // ── Layout handler — salva largura na ref E no estado ─────────────────────
  const onTrackLayout = (e: any) => {
    const w = e.nativeEvent.layout.width;
    trackWidthRef.current = w;
    setTrackWidth(w);
  };

  // ── Fill bar (usa estado trackWidth — ok para interpolação) ───────────────
  const maxSlideForAnim = Math.max(1, trackWidth - THUMB_SIZE - PADDING * 2);
  const fillWidth = translateX.interpolate({
    inputRange:  [0, maxSlideForAnim],
    outputRange: [THUMB_SIZE + PADDING * 2, trackWidth],
    extrapolate: 'clamp',
  });

  return (
    // Outer container: só bordas arredondadas, SEM overflow:hidden,
    // para não bloquear eventos de toque fora do clip visual
    <View
      style={[
        styles.trackOuter,
        { borderColor: confirmed ? accent : V.border, opacity: disabled ? 0.5 : 1 },
      ]}
      onLayout={onTrackLayout}
    >
      {/* Fundo interno arredondado (clipping visual sem bloquear toque) */}
      <View style={styles.trackInner} />

      {/* Fill bar */}
      <Animated.View
        pointerEvents="none"
        style={[styles.fill, { backgroundColor: accent + '28', width: fillWidth }]}
      />

      {/* Label */}
      <Animated.Text 
        pointerEvents="none"
        style={[styles.label, { opacity: textOpacity }]}
      >
        {confirmed ? '✓' : label}
      </Animated.Text>

      {/* Thumb — PanResponder aqui */}
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.thumb,
          {
            backgroundColor: accent,
            shadowColor: accent,
            transform: [{ translateX }, { scale: thumbScale }],
          },
        ]}
      >
        {/* Glow ring */}
        <Animated.View
          style={[styles.glowRing, { opacity: glowOpacity, borderColor: accent + '70' }]}
        />
        {confirmed
          ? <Feather name="check"          size={22} color={V.bg} />
          : <Feather name="chevrons-right" size={22} color={V.bg} />
        }
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  trackOuter: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    borderWidth: 1,
    justifyContent: 'center',
    position: 'relative',
    marginTop: 8,
    // SEM overflow:hidden — essencial para o PanResponder funcionar
  },
  trackInner: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: V.surface2,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: TRACK_HEIGHT / 2,
  },
  label: {
    textAlign: 'center',
    fontSize: 12,
    fontFamily: F.bold,
    letterSpacing: 1,
    color: V.muted,
    position: 'absolute',
    left: THUMB_SIZE + PADDING * 2,
    right: PADDING,
  },
  thumb: {
    position: 'absolute',
    left: PADDING,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    zIndex: 10,
  },
  glowRing: {
    position: 'absolute',
    width: THUMB_SIZE + 16,
    height: THUMB_SIZE + 16,
    borderRadius: (THUMB_SIZE + 16) / 2,
    borderWidth: 2,
    top: -8,
    left: -8,
  },
});
