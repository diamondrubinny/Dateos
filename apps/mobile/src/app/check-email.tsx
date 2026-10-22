import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { radius, spacing, useColors } from '../lib/theme';
import { requestMagicLink } from '../lib/magic-link';

const COOLDOWN_SECONDS = 30;

export default function CheckEmail() {
  const { t } = useTranslation();
  const colors = useColors();
  const { email = '' } = useLocalSearchParams<{ email: string }>();
  const [seconds, setSeconds] = useState(COOLDOWN_SECONDS);
  const [notice, setNotice] = useState<'sent' | 'error'>();

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  const resend = async () => {
    setSeconds(COOLDOWN_SECONDS);
    setNotice((await requestMagicLink(email).catch(() => false)) ? 'sent' : 'error');
  };

  return (
    <Screen back title={t('checkEmail.title')}>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <AppText
          variant="display"
          center
          importantForAccessibility="no"
          accessibilityElementsHidden
        >
          ✉️
        </AppText>
        <AppText variant="body" center>
          {t('checkEmail.body', { email })}
        </AppText>
      </View>
      {notice === 'sent' ? <Banner tone="success" message={t('checkEmail.sent')} /> : null}
      {notice === 'error' ? <Banner tone="error" message={t('common.genericError')} /> : null}
      <Button
        variant="secondary"
        label={seconds > 0 ? t('checkEmail.resendIn', { seconds }) : t('checkEmail.resend')}
        disabled={seconds > 0}
        onPress={() => void resend()}
      />
      <Button
        variant="ghost"
        label={t('checkEmail.differentEmail')}
        onPress={() => router.replace('/sign-in')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, borderRadius: radius.lg, gap: spacing.md },
});
