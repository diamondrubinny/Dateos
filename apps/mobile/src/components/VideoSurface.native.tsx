import { VideoView } from '@livekit/react-native';
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client';
import type { ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';

/** iOS and Android: the native WebRTC view for one track (decorative for screen readers). */
export function VideoSurface({
  track,
  mirror,
  style,
}: {
  track: RemoteVideoTrack | LocalVideoTrack;
  mirror?: boolean;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[styles.box, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <VideoView
        videoTrack={track}
        objectFit="cover"
        mirror={Boolean(mirror)}
        style={styles.fill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', backgroundColor: '#000' },
  fill: { flex: 1 },
});
