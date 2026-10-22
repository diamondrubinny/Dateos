import {
  ageOn,
  genders,
  intentions,
  MIN_AGE,
  type Gender,
  type Intention,
} from '@nexaheart/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View, type TextInputProps } from 'react-native';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { ChoiceGroup } from '../../components/Choice';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { ApiRequestError } from '../../lib/api';
import { useCreateProfile } from '../../lib/queries';
import { ONBOARDING_TOTAL } from '../../lib/routes';
import { spacing } from '../../lib/theme';

function toIsoDate(day: string, month: string, year: string): string | undefined {
  const d = Number(day),
    m = Number(month),
    y = Number(year);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y) || y < 1900)
    return undefined;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return undefined;
  return date.toISOString().slice(0, 10);
}

/** HTML autocomplete tokens differ from React Native's names for the same fields. */
const bday = (part: 'day' | 'month' | 'year') =>
  (Platform.OS === 'web' ? `bday-${part}` : `birthdate-${part}`) as TextInputProps['autoComplete'];

type Errors = Partial<
  Record<'name' | 'birthDate' | 'gender' | 'interestedIn' | 'intention', string>
>;

export default function ProfileStep() {
  const { t } = useTranslation();
  const create = useCreateProfile();
  const [name, setName] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [gender, setGender] = useState<Gender[]>([]);
  const [interestedIn, setInterestedIn] = useState<Gender[]>([]);
  const [intention, setIntention] = useState<Intention[]>([]);
  const [bio, setBio] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();

  const submit = async () => {
    const birthDate = toIsoDate(day, month, year);
    const next: Errors = {};
    if (!name.trim()) next.name = t('onboarding.profile.required');
    if (!birthDate) next.birthDate = t('onboarding.profile.invalidDate');
    else if (ageOn(birthDate, new Date().toISOString().slice(0, 10)) < MIN_AGE) {
      next.birthDate = t('onboarding.profile.underage');
    }
    if (gender.length === 0) next.gender = t('onboarding.profile.chooseOne');
    if (interestedIn.length === 0) next.interestedIn = t('onboarding.profile.chooseOne');
    if (intention.length === 0) next.intention = t('onboarding.profile.chooseOne');
    setErrors(next);
    if (Object.keys(next).length > 0 || !birthDate) return;

    setFormError(undefined);
    try {
      await create.mutateAsync({
        displayName: name.trim(),
        birthDate,
        gender: gender[0]!,
        interestedIn,
        intention: intention[0]!,
        ...(bio.trim() ? { bio: bio.trim() } : {}),
        languages: [],
      });
      router.replace('/onboarding/photos');
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'UNDERAGE') return router.replace('/');
      if (error instanceof ApiRequestError && error.status === 409) return router.replace('/');
      setFormError(t('common.genericError'));
    }
  };

  const genderOptions = genders.map((value) => ({ value, label: t(`gender.${value}`) }));

  return (
    <Screen
      title={t('onboarding.profile.title')}
      step={{ current: 2, total: ONBOARDING_TOTAL }}
      footer={
        <Button
          label={t('common.continue')}
          loading={create.isPending}
          onPress={() => void submit()}
        />
      }
    >
      {formError ? <Banner tone="error" message={formError} /> : null}
      <TextField
        label={t('onboarding.profile.name')}
        hint={t('onboarding.profile.nameHint')}
        error={errors.name}
        value={name}
        onChangeText={setName}
        autoComplete="given-name"
        textContentType="givenName"
        maxLength={40}
      />
      <View style={styles.group} accessibilityLabel={t('onboarding.profile.birthDate')}>
        <AppText variant="label">{t('onboarding.profile.birthDate')}</AppText>
        <View style={styles.dateRow}>
          <View style={styles.dateCell}>
            <TextField
              label={t('onboarding.profile.day')}
              value={day}
              onChangeText={setDay}
              inputMode="numeric"
              maxLength={2}
              autoComplete={bday('day')}
            />
          </View>
          <View style={styles.dateCell}>
            <TextField
              label={t('onboarding.profile.month')}
              value={month}
              onChangeText={setMonth}
              inputMode="numeric"
              maxLength={2}
              autoComplete={bday('month')}
            />
          </View>
          <View style={[styles.dateCell, styles.yearCell]}>
            <TextField
              label={t('onboarding.profile.year')}
              value={year}
              onChangeText={setYear}
              inputMode="numeric"
              maxLength={4}
              autoComplete={bday('year')}
            />
          </View>
        </View>
        <AppText
          variant="caption"
          tone={errors.birthDate ? 'danger' : 'muted'}
          accessibilityLiveRegion="polite"
        >
          {errors.birthDate ?? t('onboarding.profile.birthDateHint')}
        </AppText>
      </View>
      <ChoiceGroup
        label={t('onboarding.profile.gender')}
        options={genderOptions}
        selected={gender}
        onChange={setGender}
        error={errors.gender}
      />
      <ChoiceGroup
        label={t('onboarding.profile.interestedIn')}
        options={genderOptions}
        multiple
        selected={interestedIn}
        onChange={setInterestedIn}
        error={errors.interestedIn}
      />
      <ChoiceGroup
        label={t('onboarding.profile.intention')}
        options={intentions.map((value) => ({ value, label: t(`intention.${value}`) }))}
        selected={intention}
        onChange={setIntention}
        error={errors.intention}
      />
      <TextField
        label={t('onboarding.profile.bio')}
        optionalLabel={t('common.optional')}
        hint={t('onboarding.profile.bioHint')}
        value={bio}
        onChangeText={setBio}
        multiline
        maxLength={500}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.xs },
  dateRow: { flexDirection: 'row', gap: spacing.sm },
  dateCell: { flex: 1 },
  yearCell: { flex: 1.4 },
});
