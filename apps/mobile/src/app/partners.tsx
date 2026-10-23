// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Choice';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { useFederatedStatus, useJoinFederated, useLeaveFederated } from '../lib/federated-queries';
import { radius, spacing, useColors } from '../lib/theme';

/**
 * Partner communities (phase 28b): what joining shares, with whom, and leaving. Joining is an
 * explicit consent ⚖️; nothing crosses before it.
 */
function PartnersScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const status = useFederatedStatus();
  const join = useJoinFederated();
  const leave = useLeaveFederated();
  const [agreed, setAgreed] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();

  if (status.isPending) return <Loading />;
  const data = status.data;

  return (
    <Screen back title={t('partners.title')}>
      {notice ? <Banner tone={notice.tone} message={notice.text} /> : null}
      {!data?.available ? (
        <AppText variant="body" tone="muted">
          {t('partners.none')}
        </AppText>
      ) : (
        <>
          <AppText variant="body">{t('partners.intro')}</AppText>
          <AppText variant="heading">{t('partners.whoTitle')}</AppText>
          {data.partners.map((p) => (
            <View
              key={p.id}
              style={[styles.partner, { backgroundColor: colors.surface }]}
              accessibilityRole="summary"
            >
              <AppText variant="label" userContent>
                {p.name}
              </AppText>
              {p.privacyUrl ? (
                <Button
                  variant="ghost"
                  label={t('partners.privacyOf', { name: p.name })}
                  onPress={() => void Linking.openURL(p.privacyUrl!)}
                />
              ) : null}
            </View>
          ))}
          <AppText variant="heading">{t('partners.sharesTitle')}</AppText>
          <AppText variant="body">{t('partners.shares')}</AppText>
          <AppText variant="body">{t('partners.filter')}</AppText>
          <AppText variant="heading">{t('partners.neverTitle')}</AppText>
          <AppText variant="body">{t('partners.never')}</AppText>
          <AppText variant="body" tone="muted">
            {t('partners.otherOperator')}
          </AppText>
          {data.joined ? (
            <>
              <Banner tone="info" message={t('partners.joinedNote')} />
              {confirmLeave ? (
                <View style={[styles.partner, { backgroundColor: colors.surface }]}>
                  <AppText variant="body">{t('partners.leaveConfirm')}</AppText>
                  <Button
                    variant="danger"
                    label={t('partners.leaveYes')}
                    loading={leave.isPending}
                    onPress={() =>
                      leave.mutate(undefined, {
                        onSuccess: () => {
                          setConfirmLeave(false);
                          setAgreed(false);
                          setNotice({ tone: 'success', text: t('partners.left') });
                        },
                        onError: () => setNotice({ tone: 'error', text: t('common.genericError') }),
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    label={t('common.cancel')}
                    onPress={() => setConfirmLeave(false)}
                  />
                </View>
              ) : (
                <Button
                  variant="dangerGhost"
                  label={t('partners.leave')}
                  onPress={() => setConfirmLeave(true)}
                />
              )}
            </>
          ) : (
            <>
              <Checkbox
                label={t('partners.agree')}
                hint={t('partners.agreeHint')}
                checked={agreed}
                onChange={setAgreed}
              />
              <Button
                label={t('partners.join')}
                disabled={!agreed}
                loading={join.isPending}
                onPress={() =>
                  join.mutate(data.consentVersion, {
                    onSuccess: () => setNotice({ tone: 'success', text: t('partners.joined') }),
                    onError: () => setNotice({ tone: 'error', text: t('common.genericError') }),
                  })
                }
              />
            </>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  partner: { padding: spacing.md, borderRadius: radius.md, gap: spacing.xs },
});

export default function PartnersRoute() {
  return (
    <RequireSession>
      <PartnersScreen />
    </RequireSession>
  );
}
