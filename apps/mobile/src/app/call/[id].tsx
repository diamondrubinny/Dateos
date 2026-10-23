// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import type { CallJoin } from '@nexaheart/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';
import { RemoteImage } from '../../components/RemoteImage';
import { RequireSession } from '../../components/RequireSession';
import { VideoSurface } from '../../components/VideoSurface';
import { useNoScreenCapture } from '../../lib/screen-capture';
import { ApiRequestError } from '../../lib/api';
import { newCallKeyPair, toBase64Url } from '../../lib/call-crypto';
import { encryptionSupported } from '../../lib/call-encryption';
import { callKey, endCall, formatClock, joinCall, useCall } from '../../lib/call-queries';
import { useConversations } from '../../lib/chat-queries';
import { useRealtime } from '../../lib/realtime';
import { prefs } from '../../lib/storage';
import { radius, spacing, useColors } from '../../lib/theme';
import { useCallRoom } from '../../lib/use-call-room';
import { useCaptions } from '../../lib/use-captions';
import { useLocale } from '../../lib/locale';

/** Speech recognition language for each app language. */
const SPEECH_LANG = { he: 'he-IL', en: 'en-US', ar: 'ar-SA', ru: 'ru-RU' } as const;

/** Shown once per device before the first call. */
export const CALL_NOTICE_KEY = 'nexaheart.callNotice';

function CallScreen() {
  const { t } = useTranslation();
  // Other people's photos and words: no screenshots on Android, no recording on iOS (phase 21).
  useNoScreenCapture();
  const colors = useColors();
  const client = useQueryClient();
  const realtime = useRealtime();
  const { id } = useLocalSearchParams<{ id: string }>();
  const call = useCall(id);
  const conversation = useConversations().data?.find((c) => c.matchId === call.data?.matchId);
  const name = conversation?.profile.displayName ?? '';
  const [notice, setNotice] = useState<'unknown' | 'show' | 'seen'>('unknown');
  const [join, setJoin] = useState<CallJoin>();
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(Date.now());
  // A fresh key pair for this join: the secret half never leaves the device.
  const keyPair = useMemo(() => newCallKeyPair(), []);
  const supported = useMemo(() => encryptionSupported(), []);
  const room = useCallRoom(
    join
      ? { url: join.url, token: join.token, room: join.room, video: join.call.video, keyPair }
      : undefined,
  );
  const joined = useRef(false);
  const { locale } = useLocale();
  const captions = useCaptions(room.room, {
    lang: SPEECH_LANG[locale as keyof typeof SPEECH_LANG] ?? 'en-US',
    micOn: room.micOn,
    secure: room.secure,
  });

  useEffect(() => {
    void prefs.get(CALL_NOTICE_KEY).then((v) => setNotice(v ? 'seen' : 'show'));
  }, []);

  // The other person answering, declining or hanging up arrives live.
  useEffect(
    () =>
      realtime.subscribe((event) => {
        if (event.type === 'call.updated' && event.callId === id) {
          void client.invalidateQueries({ queryKey: callKey(id) });
        }
      }),
    [realtime, client, id],
  );

  const status = call.data?.status;
  const over =
    status === 'ended' || status === 'missed' || status === 'declined' || room.status === 'ended';

  // Join once the notice was seen and the call can still be joined.
  useEffect(() => {
    if (notice !== 'seen' || joined.current || !call.data || !supported) return;
    if (call.data.status !== 'ringing' && call.data.status !== 'active') return;
    joined.current = true;
    joinCall(id, toBase64Url(keyPair.publicKey))
      .then(setJoin)
      .catch((e) =>
        setError(
          e instanceof ApiRequestError && e.status === 409
            ? t('call.alreadyEnded')
            : t('common.genericError'),
        ),
      );
  }, [notice, call.data, id, t, keyPair, supported]);

  // Leaving the screen hangs up (the server also notices when the connection drops).
  useEffect(
    () => () => {
      if (joined.current) void endCall(id).catch(() => undefined);
    },
    [id],
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hangUp = async () => {
    await endCall(id).catch(() => undefined);
    await room.leave();
    void client.invalidateQueries({ queryKey: callKey(id) });
  };
  const report = async () => {
    await hangUp();
    if (conversation) {
      router.replace({
        pathname: '/report/[id]',
        params: { id: conversation.profile.id, name, matchId: conversation.matchId },
      });
    }
  };
  const back = () => (router.canGoBack() ? router.back() : router.replace('/matches'));

  if (call.isPending || notice === 'unknown') return <Loading />;
  if (!call.data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
        <View style={styles.pad}>
          <Banner tone="error" message={t('common.genericError')} />
          <Button variant="secondary" label={t('common.back')} onPress={back} />
        </View>
      </SafeAreaView>
    );
  }

  const kind = call.data.video ? t('call.video') : t('call.voice');

  if (notice === 'show') {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
        <View style={styles.pad}>
          <AppText variant="title" accessibilityRole="header">
            {t('call.noticeTitle')}
          </AppText>
          <AppText variant="body">{t('call.noticeCamera')}</AppText>
          <AppText variant="body">{t('call.noticeRecord')}</AppText>
          <AppText variant="body">{t('call.noticeReport')}</AppText>
          <Button
            label={t('call.noticeContinue')}
            onPress={() => {
              void prefs.set(CALL_NOTICE_KEY, '1');
              setNotice('seen');
            }}
          />
          <Button variant="ghost" label={t('common.back')} onPress={back} />
        </View>
      </SafeAreaView>
    );
  }

  if (!supported) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
        <View style={styles.pad}>
          <AppText variant="title" accessibilityRole="header">
            {t('call.unsupportedTitle')}
          </AppText>
          <AppText variant="body">{t('call.unsupported')}</AppText>
          <Button label={t('call.backToChat')} onPress={back} />
        </View>
      </SafeAreaView>
    );
  }

  if (over) {
    const summary =
      status === 'declined'
        ? call.data.mine
          ? t('call.lineDeclinedByThem', { kind })
          : t('call.lineDeclinedByYou', { kind })
        : status === 'missed'
          ? call.data.mine
            ? t('call.lineNoAnswer', { kind })
            : t('call.lineMissed', { kind })
          : t('call.ended');
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
        <View style={styles.pad}>
          <AppText variant="title" accessibilityRole="header" accessibilityLiveRegion="polite">
            {summary}
          </AppText>
          <Button
            label={t('call.backToChat')}
            onPress={() =>
              router.replace({ pathname: '/chat/[id]', params: { id: call.data.matchId } })
            }
          />
          {conversation ? (
            <Button
              variant="dangerGhost"
              label={t('call.report', { name })}
              onPress={() =>
                router.replace({
                  pathname: '/report/[id]',
                  params: { id: conversation.profile.id, name, matchId: conversation.matchId },
                })
              }
            />
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  const endsAt = call.data.endsAt ? Date.parse(call.data.endsAt) : null;
  const left = endsAt ? Math.round((endsAt - now) / 1000) : null;
  const announcement =
    error ??
    (room.status === 'connecting'
      ? t('call.connecting')
      : room.status === 'reconnecting'
        ? t('call.reconnecting')
        : room.status === 'waiting'
          ? call.data.mine
            ? t('call.calling', { name })
            : t('call.waitingFor', { name })
          : room.remoteVideo
            ? t('call.theirCameraOn', { name })
            : t('call.connectedWith', { name }));
  // A short warning before the community's time limit, read out once.
  const limitNote =
    left !== null && left <= 60
      ? t('call.oneMinuteLeft')
      : left !== null && left <= 300
        ? t('call.fiveMinutesLeft')
        : '';

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <View style={styles.stage}>
        {room.remoteVideo ? (
          <VideoSurface track={room.remoteVideo} style={styles.remote} />
        ) : (
          <View style={styles.placeholder}>
            {conversation?.profile.photos[0] ? (
              <RemoteImage
                path={conversation.profile.photos[0].url}
                label={name}
                style={styles.avatar}
              />
            ) : null}
            <AppText variant="title" tone="onPrimary" center>
              {name}
            </AppText>
            <AppText variant="body" tone="onPrimary" center>
              {call.data.video && room.status === 'connected' ? t('call.theirCameraOff') : kind}
            </AppText>
          </View>
        )}
        {room.localVideo ? (
          <VideoSurface track={room.localVideo} mirror style={styles.local} />
        ) : null}
        {captions.showing && (captions.lines.length > 0 || captions.interim) ? (
          <View style={styles.captions} accessibilityLabel={t('call.captionsLabel', { name })}>
            {captions.lines.map((line, i) => (
              <AppText key={`${i}-${line}`} variant="body" tone="onPrimary" userContent>
                {line}
              </AppText>
            ))}
            {captions.interim ? (
              <AppText variant="body" tone="onPrimary" userContent style={styles.interim}>
                {captions.interim}
              </AppText>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.panel}>
        <AppText variant="label" center accessibilityLiveRegion="polite" accessibilityRole="text">
          {announcement}
        </AppText>
        {left !== null ? (
          <AppText variant="caption" tone="muted" center>
            {t('call.timeLeft', { time: formatClock(left) })}
          </AppText>
        ) : null}
        <AppText variant="caption" center accessibilityLiveRegion="polite">
          {limitNote}
        </AppText>
        {room.secure && room.safety ? (
          <View style={styles.privacy} accessibilityRole="text">
            <AppText variant="caption" tone="success" center>
              🔒 {t('call.private')}
            </AppText>
            {/* Each emoji in its own box with its number, so the order is clear in any reading
                direction (people reading Hebrew or Arabic compare with people reading English). */}
            <View
              style={styles.code}
              accessibilityRole="text"
              accessibilityLabel={t('call.safetyCode', { code: room.safety.join(' ') })}
            >
              {room.safety.map((emoji, i) => (
                <View key={i} style={[styles.codeItem, { borderColor: colors.border }]}>
                  <AppText variant="caption" tone="muted" center>
                    {i + 1}
                  </AppText>
                  <AppText variant="heading" center>
                    {emoji}
                  </AppText>
                </View>
              ))}
            </View>
            <AppText variant="caption" tone="muted" center>
              {t('call.safetyHint', { name })}
            </AppText>
          </View>
        ) : room.status === 'connected' && !room.encryptionFailed ? (
          <AppText variant="caption" tone="muted" center>
            {t('call.securing')}
          </AppText>
        ) : null}
        {room.encryptionFailed ? <Banner tone="error" message={t('call.notPrivate')} /> : null}
        {captions.showing && captions.their === 'waiting' ? (
          <AppText variant="caption" tone="muted" center accessibilityLiveRegion="polite">
            {t('call.captionsWaiting', { name })}
          </AppText>
        ) : null}
        {captions.showing && captions.their === 'unavailable' ? (
          <Banner tone="info" message={t('call.captionsUnavailable', { name })} />
        ) : null}
        {captions.sending ? (
          <Banner tone="info" message={t('call.captionsSending', { name })} />
        ) : null}
        {captions.cantSend ? (
          <Banner tone="info" message={t('call.captionsCantSend', { name })} />
        ) : null}
        {captions.canInstall ? (
          <View style={styles.privacy}>
            <AppText variant="caption" center>
              {t('call.captionsInstallHint', { name })}
            </AppText>
            <Button
              variant="secondary"
              label={t('call.captionsInstall')}
              onPress={captions.install}
            />
          </View>
        ) : null}
        {room.permissionDenied ? <Banner tone="error" message={t('call.permission')} /> : null}
        {room.audioBlocked ? (
          <Button label={t('call.enableSound')} onPress={room.startAudio} />
        ) : null}
        <View style={styles.controls}>
          <Button
            variant="secondary"
            label={room.micOn ? t('call.mute') : t('call.unmute')}
            onPress={room.toggleMic}
          />
          {call.data.video ? (
            <Button
              variant="secondary"
              label={room.cameraOn ? t('call.cameraOff') : t('call.cameraOn')}
              onPress={room.toggleCamera}
            />
          ) : null}
          {room.secure ? (
            <Button
              variant="secondary"
              label={captions.showing ? t('call.captionsOff') : t('call.captionsOn')}
              onPress={captions.toggle}
            />
          ) : null}
          {call.data.video && room.cameraOn && Platform.OS !== 'web' ? (
            <Button variant="secondary" label={t('call.flip')} onPress={room.flipCamera} />
          ) : null}
        </View>
        <View style={styles.controls}>
          <Button variant="danger" label={t('call.end')} onPress={() => void hangUp()} />
          <Button
            variant="dangerGhost"
            label={t('call.report', { name })}
            onPress={() => void report()}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function CallRoute() {
  return (
    <RequireSession>
      <CallScreen />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  pad: { padding: spacing.lg, gap: spacing.md, maxWidth: 560, width: '100%', alignSelf: 'center' },
  // Video is shown on black in both themes; the controls below follow the app's theme.
  stage: {
    flex: 1,
    margin: spacing.sm,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  remote: { flex: 1 },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  avatar: { width: 120, height: 120, borderRadius: 60 },
  local: {
    position: 'absolute',
    top: spacing.md,
    end: spacing.md,
    width: 110,
    height: 150,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  panel: { padding: spacing.md, gap: spacing.sm },
  privacy: { gap: 2 },
  code: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  codeItem: {
    minWidth: 48,
    paddingVertical: 2,
    borderWidth: 1,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  // Captions sit over the video, on a dark band (readable on any picture).
  captions: {
    position: 'absolute',
    start: spacing.sm,
    end: spacing.sm,
    bottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.75)',
    gap: 2,
  },
  interim: { opacity: 0.85 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
});
