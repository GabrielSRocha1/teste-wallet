import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Dimensions, Text, Image } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
  Extrapolation,
  withDelay,
  withSequence,
  runOnJS,
  cancelAnimation,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { V } from '@/constants/theme';

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

const { width, height } = Dimensions.get('window');
const COIN_SIZE = 120;

const NUM_PARTICLES = 15;
const particlesParams = Array.from({ length: NUM_PARTICLES }).map(() => ({
  x: Math.random() * width,
  y: Math.random() * height,
  size: Math.random() * 4 + 1,
  delay: Math.random() * 2000,
  duration: Math.random() * 3000 + 4000,
}));

function Particle({ params }: { params: any }) {
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    translateY.value = withDelay(
      params.delay,
      withRepeat(
        withTiming(-height * 0.5, { duration: params.duration, easing: Easing.linear }),
        -1,
        false
      )
    );
    opacity.value = withDelay(
      params.delay,
      withRepeat(
        withSequence(
          withTiming(0.6, { duration: params.duration * 0.2 }),
          withTiming(0.6, { duration: params.duration * 0.6 }),
          withTiming(0, { duration: params.duration * 0.2 })
        ),
        -1,
        false
      )
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          left: params.x,
          top: params.y,
          width: params.size,
          height: params.size,
          borderRadius: params.size / 2,
        },
        style,
      ]}
    />
  );
}

export default function CustomSplashScreen({ 
  isAppReady, 
  onFinish 
}: { 
  isAppReady: boolean; 
  onFinish: () => void; 
}) {
  const [minTimePassed, setMinTimePassed] = useState(false);

  // Rotação da moeda
  const spin = useSharedValue(0);
  
  // Animações de entrada e saída
  const introOpacity = useSharedValue(0);
  const textOpacity = useSharedValue(0);
  const scale = useSharedValue(0.8);
  const morphRadius = useSharedValue(COIN_SIZE / 2);
  const finalOpacity = useSharedValue(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setMinTimePassed(true);
    }, 4000);

    introOpacity.value = withTiming(1, { duration: 800 });
    scale.value = withTiming(1, { duration: 800, easing: Easing.out(Easing.back(1.5)) });
    textOpacity.value = withDelay(800, withTiming(1, { duration: 1000 }));

    spin.value = withRepeat(
      withTiming(360, { duration: 2000, easing: Easing.linear }),
      -1,
      false
    );

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isAppReady && minTimePassed) {
      cancelAnimation(spin);
      
      const currentRotation = spin.value % 360;
      const targetRotation = currentRotation > 180 ? 360 : 180;
      
      spin.value = withTiming(targetRotation, { duration: 800, easing: Easing.out(Easing.quad) }, () => {
        morphRadius.value = withTiming(20, { duration: 400 });
        scale.value = withSequence(
          withTiming(1.2, { duration: 300 }),
          withTiming(0, { duration: 400, easing: Easing.in(Easing.back(1.5)) })
        );
        
        finalOpacity.value = withTiming(0, { duration: 600 }, () => {
          runOnJS(onFinish)();
        });
      });
      
      textOpacity.value = withTiming(0, { duration: 500 });
    }
  }, [isAppReady, minTimePassed]);

  const coinInnerStyle = useAnimatedStyle(() => {
    const rotateY = `${spin.value}deg`;
    return {
      borderRadius: morphRadius.value,
      transform: [
        { perspective: 800 },
        { rotateX: '15deg' },
        { rotateY },
      ],
    };
  });

  const coinFaceAnimatedStyle = useAnimatedStyle(() => {
    return {
      borderRadius: morphRadius.value,
    };
  });

  const shineStyle = useAnimatedStyle(() => {
    const translateX = interpolate(
      spin.value % 180,
      [0, 180],
      [-COIN_SIZE, COIN_SIZE * 2],
      Extrapolation.CLAMP
    );
    const opacity = interpolate(
      spin.value % 180,
      [0, 90, 180],
      [0, 0.8, 0],
      Extrapolation.CLAMP
    );

    return {
      transform: [{ translateX }],
      opacity,
    };
  });

  const shadowStyle = useAnimatedStyle(() => {
    const scaleY = interpolate(
      spin.value % 360,
      [0, 90, 180, 270, 360],
      [1, 0.6, 1, 0.6, 1],
      Extrapolation.CLAMP
    );
    return {
      opacity: textOpacity.value,
      transform: [{ scaleY }, { scaleX: scale.value }],
    };
  });

  return (
    <Animated.View style={[styles.container, { opacity: finalOpacity }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: introOpacity }]}>
        <LinearGradient
          colors={[V.bg, '#1a160d', '#000000']}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {particlesParams.map((p, i) => (
        <Particle key={i} params={p} />
      ))}

      <Animated.View style={[styles.centerContent, { opacity: introOpacity, transform: [{ scale: scale }] }]}>
        
        <Animated.View style={[styles.coinWrapper, coinInnerStyle]}>
          <AnimatedLinearGradient
            colors={['#FFDF00', '#D4AF37', '#996515', '#FFDF00']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.coinFace, coinFaceAnimatedStyle]}
          >
            <Animated.View style={[styles.coinInnerCircle, coinFaceAnimatedStyle]}>
              <Image 
                source={require('../../public/logo-verum.png')}
                style={{ width: COIN_SIZE * 0.5, height: COIN_SIZE * 0.5 }}
                resizeMode="contain"
              />
            </Animated.View>

            <Animated.View style={[styles.shineLayer, shineStyle]}>
              <LinearGradient
                colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          </AnimatedLinearGradient>
        </Animated.View>

        <Animated.View style={[styles.shadow, shadowStyle]} />

        <Animated.View style={[styles.textContainer, { opacity: textOpacity }]}>
          <Text style={styles.titleText}>VERUM CRIPTO</Text>
          <Text style={styles.subtitleText}>The Future of Finance</Text>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: V.bg,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinWrapper: {
    width: COIN_SIZE,
    height: COIN_SIZE,
    shadowColor: '#FFDF00',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 20,
  },
  coinFace: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#FDB931',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  coinInnerCircle: {
    width: COIN_SIZE * 0.8,
    height: COIN_SIZE * 0.8,
    borderWidth: 2,
    borderColor: '#B8860B',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  shineLayer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: COIN_SIZE / 2,
    transform: [{ skewX: '-20deg' }],
  },
  shadow: {
    width: COIN_SIZE * 0.8,
    height: 12,
    backgroundColor: 'rgba(212, 175, 55, 0.15)',
    borderRadius: 50,
    marginTop: 40,
    shadowColor: '#D4AF37',
    shadowOpacity: 0.8,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
  },
  textContainer: {
    marginTop: 40,
    alignItems: 'center',
  },
  titleText: {
    fontFamily: 'Cinzel_700Bold',
    fontSize: 24,
    color: '#FFDF00',
    letterSpacing: 4,
    textShadowColor: 'rgba(212, 175, 55, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  subtitleText: {
    fontFamily: 'Rajdhani_500Medium',
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    letterSpacing: 2,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  particle: {
    position: 'absolute',
    backgroundColor: '#D4AF37',
    shadowColor: '#FFDF00',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
});
