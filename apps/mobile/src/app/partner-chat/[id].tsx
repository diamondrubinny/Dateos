// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, startAlign } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';
import { MessageBubble } from '../../components/MessageBubble';
import { RemoteImage } from '../../components/RemoteImage';
import { RequireSession } from '../../components/RequireSession';
import { ApiRequestError } from '../../lib/api';
import { checkMessage, newClientId } from '../../lib/chat-queries';
import {
  asMessageView,
  useFederatedMatches,
  useFederatedMessages,
  useSendFederatedMessage,
} from '../../lib/federated-queries';
import { useLocale } from '../../lib/locale';
import { useNoScreenCapture } from '../../lib/screen-capture';
import { MIN_TOUCH, radius, spacing, useColors } from '../../lib/theme';

/**
 * A chat with a match from a partner community (phase 28c): text only for now. Each community
 * keeps its own member's side; hurtful messages arrive hidden and scams are flagged, as here.
 */
function PartnerChat() {
  const { t } = useTranslation();
  const colors = useColors();
  const { direction } = useLocale();
  useNoScreenCapture();
  const { id: matchId } = useLocalSearchParams<{ id: string }>();
  const matches = useFederatedMatches();
  const match = matches.data?.find((m) => m.id === matchId);
  const messages = useFederatedMessages(matchId);
  const send = useSendFederatedMessage(matchId);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState<{ text: string; clientId: string }>();
  const [ended, setEnded] = useState(false);

  if (matches.isPending || messages.isPending) return <Loading />;
  const name = match?.displayName ?? '';
  const closed = ended || !match || Boolean(messages.error);

  const deliver = async (body: string, clientId: string) => {
    setError(undefined);
    try {
      await send.mutateAsync({ text: body, clientId });
      setText('');
      setConfirming(undefined);
    } catch (e) {
      if (e instanceof ApiRequestError && (e.status === 404 || e.status === 410)) setEnded(true);
      else if (e instanceof ApiRequestError && e.status === 502) {
        setError(t('partners.unreachable', { community: match?.community ?? '' }));
      } else setError(t('chat.failed'));
    }
  };
  const submit = async () => {
    const body = text.trim();
    if (!body || send.isPending) return;
    const clientId = newClientId();
    // "Are you sure?": checked on this server before anything is sent anywhere.
    const check = await checkMessage(body).catch(() => ({ flagged: false }));
    if (check.flagged) return setConfirming({ text: body, clientId });
    await deliver(body, clientId);
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
          {match?.photo ? (
            <RemoteImage path={match.photo.url} label={name} style={styles.avatar} />
          ) : null}
          <View style={styles.flex}>
            <AppText variant="heading" accessibilityRole="header">
              {name}
            </AppText>
            {match ? (
              <AppText variant="caption" tone="muted" userContent>
                {t('partners.from', { community: match.community })}
              </AppText>
            ) : null}
          </View>
          {match ? (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/partner-report',
                  params: {
                    partnerId: match.partnerId,
                    alias: match.alias,
                    name: match.displayName,
                    community: match.community,
                    matched: '1',
                  },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={t('partners.report', { name })}
              style={styles.iconBtn}
            >
              <AppText variant="label" tone="danger">
                {t('report.open')}
              </AppText>
            </Pressable>
          ) : null}
        </View>

        {match ? (
          <View style={[styles.note, { backgroundColor: colors.primarySoft }]}>
            <AppText variant="caption">
              {t('partners.chatNote', { community: match.community })}
            </AppText>
          </View>
        ) : null}

        <FlatList
          // Keyboard users must be able to focus and scroll the conversation (WCAG 2.1.1).
          focusable
          accessibilityLabel={t('chat.title', { name })}
          style={styles.flex}
          contentContainerStyle={styles.list}
          data={messages.data?.messages ?? []}
          inverted
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <MessageBubble message={asMessageView(item, matchId)} seen={false} />
          )}
          ListFooterComponent={
            messages.data?.messages.length === 0 ? (
              <View style={[styles.empty, { backgroundColor: colors.surface }]}>
                <AppText variant="body">{t('partners.chatEmpty', { name })}</AppText>
              </View>
            ) : undefined
          }
        />

        {error ? (
          <View style={styles.pad}>
            <Banner tone="error" message={error} />
          </View>
        ) : null}
        {closed ? (
          <View style={styles.pad}>
            <Banner tone="info" message={t('partners.chatEnded')} />
          </View>
        ) : null}

        {confirming ? (
          <View
            style={[styles.confirm, { backgroundColor: colors.dangerSoft }]}
            accessibilityRole="alert"
          >
            <AppText variant="heading" tone="danger">
              {t('chat.sureTitle')}
            </AppText>
            <AppText variant="body">{t('chat.sureBody', { name })}</AppText>
            <Button
              variant="secondary"
              label={t('chat.edit')}
              onPress={() => setConfirming(undefined)}
            />
            <Button
              variant="dangerGhost"
              label={t('chat.sendAnyway')}
              loading={send.isPending}
              onPress={() => void deliver(confirming.text, confirming.clientId)}
            />
          </View>
        ) : null}

        {!closed ? (
          <View style={[styles.composer, { borderTopColor: colors.border }]}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={t('chat.placeholder')}
              placeholderTextColor={colors.muted}
              accessibilityLabel={t('chat.messageLabel')}
              multiline
              maxLength={2000}
              style={[
                styles.input,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                  textAlign: startAlign,
                },
              ]}
              onKeyPress={(e) => {
                // Enter sends on the web; Shift+Enter adds a new line.
                const native = e.nativeEvent as unknown as { key: string; shiftKey?: boolean };
                if (Platform.OS === 'web' && native.key === 'Enter' && !native.shiftKey) {
                  (e as unknown as { preventDefault: () => void }).preventDefault();
                  void submit();
                }
              }}
            />
            <Button
              label={t('chat.send')}
              loading={send.isPending}
              disabled={!text.trim()}
              onPress={() => void submit()}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  note: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  list: { padding: spacing.md, flexGrow: 1, justifyContent: 'flex-end' },
  empty: { padding: spacing.lg, borderRadius: radius.lg, gap: spacing.sm },
  pad: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  confirm: { margin: spacing.md, padding: spacing.lg, borderRadius: radius.lg, gap: spacing.sm },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: MIN_TOUCH,
    maxHeight: 140,
    borderWidth: 1.5,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
  },
});

export default function PartnerChatRoute() {
  return (
    <RequireSession>
      <PartnerChat />
    </RequireSession>
  );
}
