import { Image, type ImageStyle } from 'expo-image';
import { Platform, type StyleProp } from 'react-native';
import { mediaUrl } from '../lib/api';
import { useSessionCookie } from '../lib/use-cookie';

/** API-served photo. Native needs the session cookie explicitly; browsers send it themselves. */
export function RemoteImage({
  path,
  label,
  style,
}: {
  path: string;
  label: string;
  style: StyleProp<ImageStyle>;
}) {
  const cookie = useSessionCookie();
  return (
    <Image
      source={{
        uri: mediaUrl(path),
        ...(Platform.OS !== 'web' && cookie ? { headers: { cookie } } : {}),
      }}
      style={style}
      contentFit="cover"
      accessibilityLabel={label}
      accessibilityIgnoresInvertColors
    />
  );
}
