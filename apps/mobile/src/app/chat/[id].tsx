import { MESSAGES_BEFORE_IMAGES, type MessageView } from '@dateos/shared';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { VoiceRecorder, type Recording } from '../../components/VoiceRecorder';
import { ApiRequestError } from '../../lib/api';
import {
  checkMessage,
  markRead,
  newClientId,
  useConversations,
  useIcebreakers,
  useMessages,
  useSendImage,
  useSendMessage,
  useSendVoice,
} from '../../lib/chat-queries';
import { useLocale } from '../../lib/locale';
import { useRealtime } from '../../lib/realtime';
import { MIN_TOUCH, radius, spacing, useColors } from '../../lib/theme';

function ChatScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const { locale, direction } = useLocale();
  const { id: matchId } = useLocalSearchParams<{ id: string }>();
  const conversations = useConversations();
  const conversation = conversations.data?.find((c) => c.matchId === matchId);
  const messages = useMessages(matchId);
  const send = useSendMessage(matchId);
  const sendImage = useSendImage(matchId);
  const sendVoice = useSendVoice(matchId);
  const [recording, setRecording] = useState(false);
  const realtime = useRealtime();
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState<{ text: string; clientId: string }>();
  const [error, setError] = useState<string>();
  const [typing, setTyping] = useState(false);
  const [closed, setClosed] = useState(false);
  const lastTyping = useRef(0);

  const all: MessageView[] = useMemo(
    () => (messages.data ? [...messages.data.pages].reverse().flatMap((p) => p.messages) : []),
    [messages.data],
  );
  const newest = messages.data?.pages[0];
  const otherReadAt = newest?.otherReadAt ?? null;
  const lastMineId = [...all].reverse().find((m) => m.mine)?.id;
  const name = conversation?.profile.displayName ?? '';
  const icebreakers = useIcebreakers(matchId, locale, all.length === 0 && !messages.isPending);

  // Mark as read on open and whenever a new message from them arrives.
  const lastTheirs = [...all].reverse().find((m) => !m.mine)?.id;
  useEffect(() => {
    if (!closed) markRead(matchId).catch(() => undefined);
  }, [matchId, lastTheirs, closed]);

  useEffect(
    () =>
      realtime.subscribe((event) => {
        if (event.matchId !== matchId) return;
        if (event.type === 'typing') {
          setTyping(true);
          setTimeout(() => setTyping(false), 3_000);
        }
        if (event.type === 'message.new' && !event.message.mine) setTyping(false);
        if (event.type === 'match.closed') setClosed(true);
      }),
    [realtime, matchId],
  );

  if (messages.isPending) return <Loading />;
  if (messages.error instanceof ApiRequestError && messages.error.status === 404) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
        <View style={styles.pad}>
          <Banner tone="info" message={t('chat.closed')} />
          <Button variant="secondary" label={t('common.back')} onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const deliver = async (body: string, clientId: string) => {
    setError(undefined);
    try {
      await send.mutateAsync({ text: body, clientId });
      setText('');
      setConfirming(undefined);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 404) setClosed(true);
      else setError(t('chat.failed'));
    }
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || send.isPending) return;
    const clientId = newClientId();
    // "Are you sure?": a local check before anything is sent.
    const check = await checkMessage(body).catch(() => ({ flagged: false }));
    if (check.flagged) return setConfirming({ text: body, clientId });
    await deliver(body, clientId);
  };

  const onChange = (value: string) => {
    setText(value);
    if (Date.now() - lastTyping.current > 2_500) {
      lastTyping.current = Date.now();
      realtime.send({ type: 'typing', matchId });
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    sendImage.mutate(
      {
        uri: asset.uri,
        mimeType: asset.mimeType ?? null,
        fileName: asset.fileName ?? null,
        file: asset.file ?? null,
      },
      { onError: () => setError(t('common.genericError')) },
    );
  };

  // The server flag reflects history when the chat loaded; live messages can unlock images
  // later, so the same rule (text messages from each side) is also applied to what is loaded.
  const textCount = (mine: boolean) =>
    all.filter((m) => m.kind === 'text' && m.mine === mine).length;
  const unlocked =
    (newest?.imagesUnlocked ?? false) ||
    (textCount(true) >= MESSAGES_BEFORE_IMAGES && textCount(false) >= MESSAGES_BEFORE_IMAGES);
  const voiceAccepted = newest?.otherAcceptsVoice ?? true;

  const sendRecording = (rec: Recording) =>
    sendVoice.mutate(rec, {
      onSuccess: () => setRecording(false),
      onError: (e) =>
        setError(
          e instanceof ApiRequestError && e.status === 403 ? e.message : t('common.genericError'),
        ),
    });

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
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            style={styles.iconBtn}
          >
            <AppText variant="heading" tone="primary">
              {direction === 'rtl' ? '→' : '←'}
            </AppText>
          </Pressable>
          {conversation?.profile.photos[0] ? (
            <RemoteImage
              path={conversation.profile.photos[0].url}
              label={name}
              style={styles.avatar}
            />
          ) : null}
          <AppText variant="heading" style={styles.flex} accessibilityRole="header">
            {name}
          </AppText>
          {conversation ? (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/profile/[id]',
                  params: { id: conversation.profile.id, matchId },
                })
              }
              accessibilityRole="button"
              style={styles.iconBtn}
            >
              <AppText variant="caption" tone="primary">
                {t('chat.viewProfile')}
              </AppText>
            </Pressable>
          ) : null}
          {conversation ? (
            <Pressable
              onPress={() =>
                router.push({ pathname: '/close/[id]', params: { id: matchId, name } })
              }
              accessibilityRole="button"
              style={styles.iconBtn}
            >
              <AppText variant="caption" tone="muted">
                {t('ghosting.closeKindly')}
              </AppText>
            </Pressable>
          ) : null}
          {conversation ? (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/report/[id]',
                  params: { id: conversation.profile.id, name, matchId },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={t('report.openLabel', { name })}
              style={styles.iconBtn}
            >
              <AppText variant="caption" tone="danger">
                {t('report.open')}
              </AppText>
            </Pressable>
          ) : null}
        </View>

        <FlatList
          // Keyboard users must be able to focus and scroll the conversation (WCAG 2.1.1).
          focusable
          accessibilityLabel={t('chat.title', { name })}
          style={styles.flex}
          contentContainerStyle={styles.list}
          data={[...all].reverse()}
          inverted
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              seen={item.id === lastMineId && otherReadAt !== null && otherReadAt >= item.createdAt}
            />
          )}
          onEndReached={() =>
            messages.hasNextPage && !messages.isFetchingNextPage && void messages.fetchNextPage()
          }
          ListEmptyComponent={
            <View style={[styles.empty, { backgroundColor: colors.surface }]}>
              <AppText variant="heading" center>
                {t('chat.emptyTitle')}
              </AppText>
              <AppText variant="body" tone="muted" center>
                {t('chat.emptyBody')}
              </AppText>
              <View
                role="list"
                accessibilityLabel={t('chat.icebreakersLabel')}
                style={styles.suggestions}
              >
                {(icebreakers.data ?? []).map((s) => (
                  // `role` would override the button role, so the list item wraps the button.
                  <View key={s} role="listitem">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityHint={t('chat.useSuggestion')}
                      onPress={() => setText(s)}
                      style={[
                        styles.suggestion,
                        { borderColor: colors.primary, backgroundColor: colors.background },
                      ]}
                    >
                      <AppText variant="body" tone="primary">
                        {s}
                      </AppText>
                    </Pressable>
                  </View>
                ))}
              </View>
            </View>
          }
          // Inverted lists put the header at the bottom: the typing indicator sits above the composer.
          ListHeaderComponent={
            <AppText
              variant="caption"
              tone="muted"
              accessibilityLiveRegion="polite"
              style={styles.typing}
            >
              {typing ? t('chat.typing', { name }) : ''}
            </AppText>
          }
        />

        {closed ? (
          <View style={styles.pad}>
            <Banner tone="info" message={t('chat.closed')} />
          </View>
        ) : null}
        {error ? (
          <View style={styles.pad}>
            <Banner tone="error" message={error} />
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
            {/* Stacked, so long labels and 200% text never get squeezed. Editing is the first choice. */}
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

        {!closed && recording ? (
          <View style={styles.pad}>
            <VoiceRecorder
              sending={sendVoice.isPending}
              onSend={sendRecording}
              onClose={() => setRecording(false)}
            />
          </View>
        ) : null}

        {!closed && !recording ? (
          <View style={[styles.composer, { borderTopColor: colors.border }]}>
            <Pressable
              onPress={() =>
                unlocked
                  ? void pickImage()
                  : setError(t('chat.imagesLocked', { n: MESSAGES_BEFORE_IMAGES }))
              }
              accessibilityRole="button"
              accessibilityLabel={t('chat.sendImage')}
              {...(unlocked ? {} : { accessibilityHint: t('chat.imagesLocked') })}
              aria-disabled={!unlocked}
              style={[styles.iconBtn, { opacity: unlocked ? 1 : 0.45 }]}
            >
              <AppText variant="heading" tone="primary">
                🖼
              </AppText>
            </Pressable>
            <Pressable
              onPress={() => {
                if (!unlocked)
                  return setError(t('chat.imagesLocked', { n: MESSAGES_BEFORE_IMAGES }));
                if (!voiceAccepted) return setError(t('voice.notAccepted', { name }));
                setError(undefined);
                setRecording(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('voice.record')}
              {...(!unlocked
                ? { accessibilityHint: t('chat.imagesLocked', { n: MESSAGES_BEFORE_IMAGES }) }
                : !voiceAccepted
                  ? { accessibilityHint: t('voice.notAccepted', { name }) }
                  : {})}
              aria-disabled={!unlocked || !voiceAccepted}
              style={[styles.iconBtn, { opacity: unlocked && voiceAccepted ? 1 : 0.45 }]}
            >
              <AppText variant="heading" tone="primary">
                🎙
              </AppText>
            </Pressable>
            <Pressable
              onPress={() => router.push({ pathname: '/date/[id]', params: { id: matchId, name } })}
              accessibilityRole="button"
              accessibilityLabel={t('datePlan.open')}
              style={styles.iconBtn}
            >
              <AppText variant="heading" tone="primary">
                📅
              </AppText>
            </Pressable>
            <TextInput
              value={text}
              onChangeText={onChange}
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
              disabled={!text.trim()}
              loading={send.isPending}
              onPress={() => void submit()}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default function ChatRoute() {
  return (
    <RequireSession>
      <ChatScreen />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  pad: { padding: spacing.md, gap: spacing.sm },
  header: {
    flexDirection: 'row',
    // Long names or labels (Arabic, Russian, large text) wrap to a second line instead of being cut.
    flexWrap: 'wrap',
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
  list: { padding: spacing.md, flexGrow: 1, justifyContent: 'flex-end' },
  empty: { padding: spacing.lg, borderRadius: radius.lg, gap: spacing.sm },
  suggestions: { gap: spacing.sm, marginTop: spacing.sm },
  suggestion: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    minHeight: MIN_TOUCH,
  },
  typing: { paddingVertical: spacing.xs },
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
