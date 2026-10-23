// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { DOUBLE_MESSAGE_MAX } from '@nexaheart/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';
import { RequireSession } from '../../components/RequireSession';
import { ApiRequestError } from '../../lib/api';
import {
  useDoubleMessages,
  useDoubles,
  useLeaveDouble,
  useSendDouble,
} from '../../lib/friend-queries';
import { useLocale } from '../../lib/locale';
import { useNoScreenCapture } from '../../lib/screen-capture';
import { MIN_TOUCH, radius, spacing, useColors } from '../../lib/theme';

/** The group chat of a double date (phase 22): four people, text only, the usual filters. */
function DoubleChatScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const { direction } = useLocale();
  useNoScreenCapture();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const doubles = useDoubles();
  const messages = useDoubleMessages(id);
  const send = useSendDouble(id);
  const leave = useLeaveDouble(id);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const chat = doubles.data?.find((d) => d.id === id);
  if (doubles.isPending || messages.isPending) return <Loading />;
  if (!chat) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
        <View style={styles.pad}>
          <Banner tone="info" message={t('double.gone')} />
          <Button variant="secondary" label={t('common.back')} onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }
  const names = new Map(chat.members.map((m) => [m.id, m.displayName]));
  const title = chat.members.map((m) => m.displayName).join(', ');

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    setError(undefined);
    send.mutate(value, {
      onSuccess: () => setText(''),
      onError: (e) =>
        setError(
          e instanceof ApiRequestError && e.status === 409
            ? t('double.closed')
            : t('common.genericError'),
        ),
    });
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/matches'))}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          style={styles.iconBtn}
        >
          <AppText variant="heading" tone="primary">
            {direction === 'rtl' ? '→' : '←'}
          </AppText>
        </Pressable>
        <View style={styles.flex}>
          <AppText variant="heading" accessibilityRole="header" userContent numberOfLines={1}>
            {title}
          </AppText>
          <AppText variant="caption" tone="muted">
            {t('double.subtitle')}
          </AppText>
        </View>
      </View>
      <View style={[styles.pad, styles.menu]}>
        {chat.members.map((m) => (
          <Button
            key={m.id}
            variant="ghost"
            label={t('double.report', { name: m.displayName })}
            onPress={() =>
              router.push({ pathname: '/report/[id]', params: { id: m.id, name: m.displayName } })
            }
          />
        ))}
        {chat.closed ? null : confirming ? (
          <>
            <Banner tone="info" message={t('double.leaveConfirm')} />
            <Button
              variant="danger"
              label={t('double.leaveYes')}
              loading={leave.isPending}
              onPress={() =>
                leave.mutate(undefined, {
                  onSuccess: () => setConfirming(false),
                  onError: () => setError(t('common.genericError')),
                })
              }
            />
            <Button
              variant="ghost"
              label={t('common.cancel')}
              onPress={() => setConfirming(false)}
            />
          </>
        ) : (
          <Button
            variant="dangerGhost"
            label={t('double.leave')}
            onPress={() => setConfirming(true)}
          />
        )}
      </View>
      <FlatList
        focusable
        accessibilityLabel={t('double.messages', { names: title })}
        style={styles.flex}
        contentContainerStyle={styles.list}
        data={[...(messages.data ?? [])].reverse()}
        inverted
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <View style={[styles.row, item.mine ? styles.mine : styles.theirs]}>
            {item.mine ? null : (
              <AppText variant="caption" tone="muted" userContent>
                {names.get(item.senderId) ?? ''}
              </AppText>
            )}
            <View
              style={[
                styles.bubble,
                { backgroundColor: item.mine ? colors.primary : colors.surface },
              ]}
            >
              {item.hidden && !revealed.has(item.id) ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setRevealed(new Set([...revealed, item.id]))}
                >
                  <AppText variant="body" tone="muted">
                    {t('chat.hidden')}
                  </AppText>
                </Pressable>
              ) : (
                <AppText
                  variant="body"
                  tone={item.mine ? 'onPrimary' : 'default'}
                  userContent
                  selectable
                >
                  {item.text}
                </AppText>
              )}
            </View>
          </View>
        )}
        ListEmptyComponent={
          <AppText variant="body" tone="muted" center>
            {t('double.empty')}
          </AppText>
        }
      />
      {chat.closed ? (
        <View style={styles.pad}>
          <Banner tone="info" message={t('double.closed')} />
        </View>
      ) : (
        <View style={[styles.composer, { borderTopColor: colors.border }]}>
          {error ? <Banner tone="error" message={error} /> : null}
          <TextInput
            value={text}
            onChangeText={(v) => setText(v.slice(0, DOUBLE_MESSAGE_MAX))}
            placeholder={t('chat.placeholder')}
            placeholderTextColor={colors.muted}
            accessibilityLabel={t('chat.placeholder')}
            multiline
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface },
            ]}
          />
          <Button label={t('chat.send')} loading={send.isPending} onPress={submit} />
        </View>
      )}
    </SafeAreaView>
  );
}

export default function DoubleChatRoute() {
  return (
    <RequireSession>
      <DoubleChatScreen />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  pad: { padding: spacing.md, gap: spacing.sm },
  menu: { paddingTop: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { padding: spacing.md, gap: spacing.sm },
  row: { gap: 2, maxWidth: '85%' },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  bubble: { padding: spacing.md, borderRadius: radius.lg },
  composer: { padding: spacing.md, gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  input: {
    minHeight: MIN_TOUCH,
    maxHeight: 140,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
