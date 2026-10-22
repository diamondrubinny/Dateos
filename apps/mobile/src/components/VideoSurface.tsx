// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client';
import { useEffect, useRef } from 'react';
import type { ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';

/**
 * Web: a <video> element showing one track. Decorative for screen readers (the call screen says
 * in words who is on camera); muted because audio plays separately.
 */
export function VideoSurface({
  track,
  mirror,
  style,
}: {
  track: RemoteVideoTrack | LocalVideoTrack;
  mirror?: boolean;
  style?: ViewStyle;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);
  return (
    <View style={[styles.box, style]} aria-hidden>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: mirror ? 'scaleX(-1)' : undefined,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({ box: { overflow: 'hidden', backgroundColor: '#000' } });
