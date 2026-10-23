// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { SPEED_HEARTBEAT_SECONDS, type SpeedDate, type SpeedJoin } from '@nexaheart/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';
import { RequireSession } from '../../components/RequireSession';
import { Screen } from '../../components/Screen';
import { VideoSurface } from '../../components/VideoSurface';
import { ApiRequestError } from '../../lib/api';
import { newCallKeyPair, toBase64Url } from '../../lib/call-crypto';
import { encryptionSupported } from '../../lib/call-encryption';
import { formatClock } from '../../lib/call-queries';
import {
  enterLobby,
  joinSpeedDate,
  leaveLobby,
  leaveSpeedDate,
  speedKey,
  useEvent,
  useSpeedAnswer,
  useSpeedState,
} from '../../lib/event-queries';
import { useNoScreenCapture } from '../../lib/screen-capture';
import { radius, spacing, useColors } from '../../lib/theme';
import { useCallRoom } from '../../lib/use-call-room';

/** One live round: an end-to-end encrypted video date that ends for both at the same time. */
function Round({ date, onDone }: { date: SpeedDate; onDone: () => void }) {
  const { t } = useTranslation();
  const colors = useColors();
  const [join, setJoin] = useState<SpeedJoin>();
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const keyPair = useMemo(() => newCallKeyPair(), []);
  const room = useCallRoom(
    join ? { url: join.url, token: join.token, room: join.room, video: true, keyPair } : undefined,
  );
  const name = date.with.displayName;

  useEffect(() => {
    joinSpeedDate(date.id, toBase64Url(keyPair.publicKey))
      .then(setJoin)
      .catch((e) =>
        setError(
          e instanceof ApiRequestError && e.status === 409
            ? t('speed.roundOver')
            : t('common.genericError'),
        ),
      );
  }, [date.id, keyPair, t]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const left = Math.max(0, Math.round((Date.parse(date.endsAt) - now) / 1000));
  // The round ends for both at the same time; leaving early ends it for both too.
  const done = useRef(false);
  const finish = async (early: boolean) => {
    if (done.current) return;
    done.current = true;
    if (early) await leaveSpeedDate(date.id).catch(() => undefined);
    await room.leave();
    onDone();
  };
  useEffect(() => {
    if (left === 0) void finish(false);
  });

  const leave = () => finish(true);
  const report = async () => {
    await leave();
    router.push({ pathname: '/report/[id]', params: { id: date.with.id, name } });
  };

  const announcement =
    error ??
    (room.status === 'connecting'
      ? t('call.connecting')
      : room.status === 'waiting'
        ? t('call.waitingFor', { name })
        : room.status === 'reconnecting'
          ? t('call.reconnecting')
          : t('call.connectedWith', { name }));

  return (
    <View style={styles.round} testID="speed-round">
      <View style={styles.stage}>
        {room.remoteVideo ? (
          <VideoSurface track={room.remoteVideo} style={styles.flex} />
        ) : (
          <View style={styles.placeholder}>
            <AppText variant="title" tone="onPrimary" center userContent>
              {t('speed.with', { name: date.with.displayName, age: date.with.age })}
            </AppText>
            <AppText variant="body" tone="onPrimary" center>
              {room.status === 'connected' ? t('call.theirCameraOff') : t('call.video')}
            </AppText>
          </View>
        )}
        {room.localVideo ? (
          <VideoSurface track={room.localVideo} mirror style={styles.local} />
        ) : null}
      </View>
      <AppText variant="label" center accessibilityLiveRegion="polite">
        {announcement}
      </AppText>
      <AppText variant="caption" tone="muted" center>
        {t('call.timeLeft', { time: formatClock(left) })}
      </AppText>
      <AppText variant="caption" center accessibilityLiveRegion="polite">
        {left <= 60 ? t('call.oneMinuteLeft') : ''}
      </AppText>
      {room.secure && room.safety ? (
        <AppText variant="caption" tone="success" center>
          🔒 {t('call.private')} · {room.safety.join(' ')}
        </AppText>
      ) : null}
      {room.encryptionFailed ? <Banner tone="error" message={t('call.notPrivate')} /> : null}
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
        <Button
          variant="secondary"
          label={room.cameraOn ? t('call.cameraOff') : t('call.cameraOn')}
          onPress={room.toggleCamera}
        />
        {room.cameraOn && Platform.OS !== 'web' ? (
          <Button variant="secondary" label={t('call.flip')} onPress={room.flipCamera} />
        ) : null}
      </View>
      <View style={styles.controls}>
        <Button variant="danger" label={t('speed.leaveRound')} onPress={() => void leave()} />
        <Button
          variant="dangerGhost"
          label={t('call.report', { name })}
          onPress={() => void report()}
        />
      </View>
      <View style={[styles.note, { borderColor: colors.border }]}>
        <AppText variant="caption" tone="muted">
          {t('speed.afterHint', { name })}
        </AppText>
      </View>
    </View>
  );
}

/** "Would you like to match?" for one past round. Nobody learns about a no. */
function Answer({ eventId, date }: { eventId: string; date: SpeedDate }) {
  const { t } = useTranslation();
  const colors = useColors();
  const answer = useSpeedAnswer(eventId);
  const name = date.with.displayName;
  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface }]}
      testID="speed-answer"
      accessibilityRole="summary"
    >
      <AppText variant="label" userContent>
        {t('speed.roundWith', { round: date.round, name, age: date.with.age })}
      </AppText>
      {date.matchId ? (
        <>
          <AppText variant="body" tone="success" accessibilityLiveRegion="polite">
            💜 {t('speed.matched', { name })}
          </AppText>
          <Button
            label={t('speed.openChat')}
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: date.matchId! } })}
          />
        </>
      ) : date.answer === null ? (
        <>
          <AppText variant="body">{t('speed.question', { name })}</AppText>
          <View style={styles.controls}>
            <Button
              label={t('speed.yes')}
              loading={answer.isPending && answer.variables?.yes === true}
              onPress={() => answer.mutate({ id: date.id, yes: true })}
            />
            <Button
              variant="secondary"
              label={t('speed.no')}
              loading={answer.isPending && answer.variables?.yes === false}
              onPress={() => answer.mutate({ id: date.id, yes: false })}
            />
          </View>
          <AppText variant="caption" tone="muted">
            {t('speed.private')}
          </AppText>
        </>
      ) : (
        <AppText variant="body" tone="muted" accessibilityLiveRegion="polite">
          {date.answer ? t('speed.saidYes', { name }) : t('speed.saidNo')}
        </AppText>
      )}
    </View>
  );
}

function SpeedScreen() {
  const { t } = useTranslation();
  // Other people's faces and names: no screenshots on Android, no recording on iOS.
  useNoScreenCapture();
  const client = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useEvent(id);
  const [entered, setEntered] = useState(false);
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const [finished, setFinished] = useState<string>();
  const state = useSpeedState(id, entered);
  const supported = useMemo(() => encryptionSupported(), []);
  const inLobby = useRef(false);

  // Enter now, then a heartbeat every 15 seconds; leaving the screen leaves the lobby.
  useEffect(() => {
    if (!supported) return;
    let stopped = false;
    const beat = () =>
      enterLobby(id)
        .then((s) => {
          if (stopped) return;
          inLobby.current = true;
          setEntered(true);
          setError(undefined);
          client.setQueryData(speedKey(id), s);
        })
        .catch((e) => {
          if (stopped) return;
          setError(
            e instanceof ApiRequestError && e.status === 409
              ? t('speed.closed')
              : e instanceof ApiRequestError && e.status === 503
                ? t('speed.noVideo')
                : t('common.genericError'),
          );
        });
    void beat();
    const timer = setInterval(beat, SPEED_HEARTBEAT_SECONDS * 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
      if (inLobby.current) void leaveLobby(id).catch(() => undefined);
    };
  }, [id, client, t, supported]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (event.isPending) return <Loading />;
  const title = event.data?.title ?? t('speed.title');
  if (!supported) {
    return (
      <Screen back title={title}>
        <Banner tone="info" message={t('call.unsupported')} />
      </Screen>
    );
  }
  const s = state.data;
  const current = s?.current && s.current.id !== finished ? s.current : null;
  const next = s?.nextRoundAt
    ? Math.max(0, Math.round((Date.parse(s.nextRoundAt) - now) / 1000))
    : null;
  const toAnswer = s?.past ?? [];

  return (
    <Screen back title={title}>
      {error ? <Banner tone="error" message={error} /> : null}
      {current ? (
        <Round
          key={current.id}
          date={current}
          onDone={() => {
            setFinished(current.id);
            void client.invalidateQueries({ queryKey: speedKey(id) });
          }}
        />
      ) : s ? (
        <View style={styles.lobby} testID="speed-lobby">
          <AppText variant="heading" accessibilityRole="header">
            {t('speed.lobby')}
          </AppText>
          <AppText variant="body" accessibilityLiveRegion="polite">
            {t('speed.here', { count: s.here })}
          </AppText>
          <AppText variant="label" tone="primary" accessibilityLiveRegion="polite">
            {!s.live
              ? t('speed.startsSoon')
              : next !== null
                ? next > 0
                  ? t('speed.nextIn', { time: formatClock(next) })
                  : t('speed.pairing')
                : t('speed.noMoreRounds')}
          </AppText>
          <AppText variant="caption" tone="muted">
            {t('speed.lobbyHint')}
          </AppText>
        </View>
      ) : !error ? (
        <Loading />
      ) : null}
      {toAnswer.length > 0 ? (
        <View style={styles.answers}>
          <AppText variant="heading" accessibilityRole="header">
            {t('speed.yourRounds')}
          </AppText>
          {toAnswer.map((date) => (
            <Answer key={date.id} eventId={id} date={date} />
          ))}
        </View>
      ) : null}
      <Banner tone="info" message={t('speed.safety')} />
      <Button
        variant="ghost"
        label={t('speed.leaveLobby')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/events'))}
      />
    </Screen>
  );
}

export default function SpeedRoute() {
  return (
    <RequireSession>
      <SpeedScreen />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  round: { gap: spacing.sm },
  // Video is shown on black in both themes.
  stage: {
    height: 360,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  local: {
    position: 'absolute',
    top: spacing.md,
    end: spacing.md,
    width: 90,
    height: 120,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  controls: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  note: { borderTopWidth: 1, paddingTop: spacing.sm },
  lobby: { gap: spacing.sm },
  answers: { gap: spacing.sm },
  card: { padding: spacing.md, borderRadius: radius.md, gap: spacing.sm },
});
