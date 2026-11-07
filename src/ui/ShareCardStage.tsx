/**
 * Preview stage wrapper that visually scales the fixed-size share card to fit
 * any phone screen while keeping the inner `cardRef` unscaled and rectangular
 * for crisp 1080px PNG capture.
 */

import type { RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import type { TripShareModel, YearShareModel } from '../flights/shareCard';
import { TripShareCard, YearShareCard } from './ShareCards';

export type RenderedCard =
  | { kind: 'trip'; model: TripShareModel; fileName: string }
  | { kind: 'year'; model: YearShareModel; fileName: string };

export function ShareCardsBody({
  cardRef,
  rendered,
  scale,
  width,
  height,
}: {
  cardRef: RefObject<View | null>;
  rendered: RenderedCard;
  scale: number;
  width: number;
  height: number;
}) {
  const safeScale = scale > 0 ? scale : 0.72;

  return (
    <View style={[styles.frame, { width: width * safeScale, height: height * safeScale }]}>
      <View
        style={[
          styles.scaler,
          {
            width,
            height,
            borderRadius: Math.round(18 / safeScale),
            transform: [{ scale: safeScale }],
          },
        ]}
      >
        <View ref={cardRef} collapsable={false} style={{ width, height }}>
          {rendered.kind === 'trip' ? (
            <TripShareCard model={rendered.model} />
          ) : (
            <YearShareCard model={rendered.model} />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaler: {
    overflow: 'hidden',
    elevation: 4,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
});
