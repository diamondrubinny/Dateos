// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../../components/AppText';
import { Banner } from '../../../components/Banner';
import { Loading } from '../../../components/Loading';
import { RequireSession } from '../../../components/RequireSession';
import { Screen } from '../../../components/Screen';
import { useTranscript } from '../../../lib/chaperone-queries';
import { radius, spacing, useColors } from '../../../lib/theme';

/** Phase 68d: one chat, read-only, from the day the chaperone joined; text only. */
function Transcript() {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const { memberId = '', matchId = '' } = useLocalSearchParams<{
    memberId: string;
    matchId: string;
  }>();
  const data = useTranscript(memberId, matchId);
  if (data.isPending) return <Loading />;
  if (!data.data) {
    return (
      <Screen back title={t('chaperone.iChaperone')}>
        <Banner tone="info" message={t('chaperone.gone')} />
      </Screen>
    );
  }
  const d = data.data;
  const time = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  return (
    <Screen back title={t('chaperone.chatTitle', { name: d.memberName, other: d.otherName })}>
      <Banner tone="info" message={t('chaperone.readOnly', { date: time(d.since) })} />
      {d.messages.length === 0 ? (
        <AppText variant="body" tone="muted">
          {t('chaperone.noMessages')}
        </AppText>
      ) : null}
      <View role="list" accessibilityLabel={t('chaperone.messages')} style={styles.list}>
        {d.messages.map((m) => (
          <View
            key={m.id}
            role="listitem"
            testID="transcript-message"
            style={[
              styles.bubble,
              m.fromMember ? styles.start : styles.end,
              { backgroundColor: m.fromMember ? colors.primarySoft : colors.surface },
            ]}
          >
            <AppText variant="caption" tone="muted">
              {m.fromMember ? d.memberName : d.otherName} · {time(m.createdAt)}
            </AppText>
            <AppText variant="body" userContent={m.text !== null}>
              {m.text ?? t(`chaperone.placeholder.${m.kind}`)}
            </AppText>
          </View>
        ))}
      </View>
    </Screen>
  );
}

export default function TranscriptRoute() {
  return (
    <RequireSession>
      <Transcript />
    </RequireSession>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  bubble: { borderRadius: radius.md, padding: spacing.sm, gap: spacing.xs, maxWidth: '85%' },
  start: { alignSelf: 'flex-start' },
  end: { alignSelf: 'flex-end' },
});
