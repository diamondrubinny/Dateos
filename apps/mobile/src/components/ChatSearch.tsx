// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput, View } from 'react-native';
import { useChatSearch } from '../lib/chat-queries';
import { radius, spacing, useColors } from '../lib/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';

/**
 * Search this chat (phase 32): text messages containing the words, newest first. Unsent messages
 * and messages hidden from me never appear. Results are announced as they change.
 */
export function ChatSearch({
  matchId,
  otherName,
  onClose,
}: {
  matchId: string;
  otherName: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const colors = useColors();
  const [q, setQ] = useState('');
  const search = useChatSearch(matchId, q);
  const results = search.data?.results ?? [];
  const searching = q.trim().length >= 2;
  return (
    <View style={[styles.panel, { borderBottomColor: colors.border }]} testID="chat-search">
      <View style={styles.row}>
        <TextInput
          value={q}
          onChangeText={setQ}
          autoFocus
          placeholder={t('chatSearch.placeholder')}
          placeholderTextColor={colors.muted}
          accessibilityLabel={t('chatSearch.label')}
          maxLength={100}
          style={[
            styles.input,
            { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
          ]}
        />
        <Button variant="ghost" label={t('chatSearch.close')} onPress={onClose} />
      </View>
      {search.isError ? <Banner tone="error" message={t('common.genericError')} /> : null}
      {searching && search.isSuccess ? (
        <AppText variant="caption" tone="muted" accessibilityLiveRegion="polite">
          {results.length === 0
            ? t('chatSearch.none')
            : t('chatSearch.found', { count: results.length })}
        </AppText>
      ) : null}
      <View role="list">
        {results.map((r) => (
          <View
            key={r.id}
            role="listitem"
            style={[styles.result, { backgroundColor: colors.surface }]}
          >
            <AppText variant="caption" tone="muted">
              {r.mine ? t('chatControl.you') : otherName} ·{' '}
              {new Date(r.createdAt).toLocaleDateString(i18n.language, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </AppText>
            <AppText variant="body" userContent>
              {r.body}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: spacing.md, gap: spacing.sm, borderBottomWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
  },
  result: { padding: spacing.sm, borderRadius: radius.md, gap: 2 },
});
