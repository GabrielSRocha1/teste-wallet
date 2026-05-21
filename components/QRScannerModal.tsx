/**
 * QRScannerModal — Modal dedicado para leitura de QR Code.
 *
 * A câmera é montada UMA única vez quando o modal fica visível
 * e só é destruída quando ele fecha. Isso evita o problema de
 * re-montagem/perda de foco que causava a queda de resolução
 * após ~1 segundo.
 *
 * Uso:
 *   <QRScannerModal
 *     visible={isScannerVisible}
 *     onClose={() => setIsScannerVisible(false)}
 *     onScanned={(data) => { /* handle QR data *\/ }}
 *   />
 */

import { Feather } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { F, V } from '@/constants/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Chamada UMA vez com os dados do QR. Modal fecha automaticamente. */
  onScanned: (data: string) => void;
  label?: string;
}

const { width, height } = Dimensions.get('window');
const FRAME_SIZE = Math.min(width, height) * 0.65;

export default function QRScannerModal({ visible, onClose, onScanned, label }: Props) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const scannedRef = useRef(false); // evita múltiplas callbacks com useRef (sem re-render)

  // Quando o modal abre, garante permissão e reseta o flag de leitura
  useEffect(() => {
    if (!visible) {
      // Pequeno delay para deixar a animação de fechamento terminar antes de desmontar
      const t = setTimeout(() => { scannedRef.current = false; setReady(false); }, 350);
      return () => clearTimeout(t);
    }

    scannedRef.current = false;

    if (permission?.granted) {
      // Delay mínimo para o Modal terminar de animar antes de ligar a câmera,
      // evitando a queda de resolução que ocorria quando a câmera era montada
      // durante a animação de entrada do Modal.
      const t = setTimeout(() => setReady(true), 150);
      return () => clearTimeout(t);
    }

    // Sem permissão: solicita
    requestPermission().then((res) => {
      if (res?.granted) {
        setTimeout(() => setReady(true), 150);
      } else {
        Alert.alert('Acesso negado', 'Permita o uso da câmera nas configurações do dispositivo.');
        onClose();
      }
    });
  }, [visible, permission?.granted]);

  const handleBarCodeScanned = useCallback(({ data }: { data: string }) => {
    if (scannedRef.current) return; // já leu — ignora duplicatas
    scannedRef.current = true;
    onClose(); // fecha o modal primeiro
    // Pequeno delay para o modal fechar antes do callback (evita flash na UI)
    setTimeout(() => onScanned(data), 100);
  }, [onClose, onScanned]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Câmera: só montada quando ready=true E modal visível */}
        {ready && visible && (
          <CameraView
            style={StyleSheet.absoluteFillObject}
            facing="back"
            onBarcodeScanned={handleBarCodeScanned}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          />
        )}

        {/* Overlay escuro nas bordas + frame central */}
        <View style={styles.overlay} pointerEvents="none">
          {/* Topo */}
          <View style={styles.overlayEdge} />

          {/* Linha do meio: lateral-esquerda | frame | lateral-direita */}
          <View style={styles.overlayMiddle}>
            <View style={styles.overlaySide} />
            {/* Frame de mira */}
            <View style={styles.frame}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
            <View style={styles.overlaySide} />
          </View>

          {/* Rodapé */}
          <View style={styles.overlayEdge} />
        </View>

        {/* Label */}
        <View style={[styles.labelContainer, { bottom: insets.bottom + 100 }]}>
          <Text style={styles.labelText}>
            {label ?? 'POSICIONE O QR CODE NO CENTRO'}
          </Text>
        </View>

        {/* Botão fechar */}
        <TouchableOpacity
          style={[styles.closeBtn, { top: insets.top + 16 }]}
          onPress={onClose}
          activeOpacity={0.8}
        >
          <Feather name="x" size={28} color="#FFF" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const CORNER = 24;
const BORDER = 3;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'column',
  },
  overlayEdge: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    width: '100%',
  },
  overlayMiddle: {
    flexDirection: 'row',
    height: FRAME_SIZE,
  },
  overlaySide: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  frame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: V.gold,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: BORDER,
    borderLeftWidth: BORDER,
    borderTopLeftRadius: 4,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: BORDER,
    borderRightWidth: BORDER,
    borderTopRightRadius: 4,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: BORDER,
    borderLeftWidth: BORDER,
    borderBottomLeftRadius: 4,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: BORDER,
    borderRightWidth: BORDER,
    borderBottomRightRadius: 4,
  },
  labelContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  labelText: {
    color: '#FFF',
    fontFamily: F.bold,
    fontSize: 12,
    letterSpacing: 1.5,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    overflow: 'hidden',
  },
  closeBtn: {
    position: 'absolute',
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
});
