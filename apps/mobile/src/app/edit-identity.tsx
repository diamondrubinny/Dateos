// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import {
  addressForms,
  GENDER_CUSTOM_MAX,
  genderCustomSchema,
  genderIdentities,
  identityVisibilities,
  type AddressForm,
  type GenderIdentity,
  type IdentityVisibility,
  type MyIdentity,
} from '@nexaheart/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { ChoiceGroup } from '../components/Choice';
import { Loading } from '../components/Loading';
import { RequireSession } from '../components/RequireSession';
import { Screen } from '../components/Screen';
import { TextField } from '../components/TextField';
import { ApiRequestError } from '../lib/api';
import { useInstance, useMe, useSetIdentity } from '../lib/queries';

const NONE = 'none';
const OWN = 'own';

/**
 * Gender identity and pronouns (phase 62a): optional, beside the matching gender (which stays as
 * it is). Only what this community offers; matches only unless the member chooses everyone.
 */
function IdentityEditor() {
  const { t } = useTranslation();
  const me = useMe();
  const instance = useInstance();
  const save = useSetIdentity();
  const [value, setValue] = useState<MyIdentity>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (value === undefined && me.data) setValue(me.data.identity);
  }, [me.data, value]);
  if (!me.data || !value || !instance.data) return <Loading />;

  const offer = instance.data.identity;
  const extended = offer.vocabulary === 'extended';
  const ownAllowed = extended && offer.customGender;
  const choice = value.genderCustom !== null ? OWN : (value.genderIdentity ?? NONE);
  const ownInvalid =
    choice === OWN && !genderCustomSchema.safeParse(value.genderCustom ?? '').success;

  const submit = async () => {
    if (ownInvalid) {
      setError(t('identity.ownInvalid', { max: GENDER_CUSTOM_MAX }));
      return;
    }
    setError(undefined);
    try {
      await save.mutateAsync({
        genderIdentity: extended ? value.genderIdentity : null,
        genderCustom: ownAllowed ? value.genderCustom : null,
        pronouns: offer.pronouns ? value.pronouns : null,
        visibility: value.visibility,
      });
      if (router.canGoBack()) router.back();
    } catch (e) {
      setError(
        e instanceof ApiRequestError && e.status === 400
          ? t('identity.ownInvalid', { max: GENDER_CUSTOM_MAX })
          : t('common.genericError'),
      );
    }
  };

  return (
    <Screen
      back
      title={t('identity.title')}
      footer={
        extended || offer.pronouns ? (
          <Button label={t('common.save')} loading={save.isPending} onPress={() => void submit()} />
        ) : undefined
      }
    >
      <AppText variant="body" tone="muted">
        {t('identity.intro')}
      </AppText>
      {error ? <Banner tone="error" message={error} /> : null}
      {!extended && !offer.pronouns ? (
        <AppText variant="body">{t('identity.notOffered')}</AppText>
      ) : null}
      {extended ? (
        <ChoiceGroup<string>
          label={t('identity.identityLabel')}
          stacked
          options={[
            { value: NONE, label: t('identity.none') },
            ...genderIdentities.map((g) => ({ value: g, label: t(`identity.options.${g}`) })),
            ...(ownAllowed ? [{ value: OWN, label: t('identity.own') }] : []),
          ]}
          selected={[choice]}
          onChange={([next]) =>
            setValue({
              ...value,
              genderIdentity:
                next && next !== NONE && next !== OWN ? (next as GenderIdentity) : null,
              genderCustom: next === OWN ? (value.genderCustom ?? '') : null,
            })
          }
        />
      ) : null}
      {choice === OWN && ownAllowed ? (
        <TextField
          label={t('identity.ownLabel')}
          hint={t('identity.ownHint', { max: GENDER_CUSTOM_MAX })}
          value={value.genderCustom ?? ''}
          onChangeText={(text) => setValue({ ...value, genderCustom: text })}
          maxLength={GENDER_CUSTOM_MAX}
          error={
            ownInvalid && value.genderCustom
              ? t('identity.ownInvalid', { max: GENDER_CUSTOM_MAX })
              : undefined
          }
        />
      ) : null}
      {offer.pronouns ? (
        <ChoiceGroup<string>
          label={t('identity.pronounsLabel')}
          stacked
          options={[
            { value: NONE, label: t('identity.none') },
            ...addressForms.map((f) => ({ value: f, label: t(`identity.forms.${f}`) })),
          ]}
          selected={[value.pronouns ?? NONE]}
          onChange={([next]) =>
            setValue({ ...value, pronouns: next && next !== NONE ? (next as AddressForm) : null })
          }
        />
      ) : null}
      {extended || offer.pronouns ? (
        <>
          <ChoiceGroup<IdentityVisibility>
            label={t('identity.visibilityLabel')}
            stacked
            options={identityVisibilities.map((v) => ({
              value: v,
              label: t(`identity.visibility.${v}`),
            }))}
            selected={[value.visibility]}
            onChange={([next]) => next && setValue({ ...value, visibility: next })}
          />
          <AppText variant="caption" tone="muted">
            {t('identity.never')}
          </AppText>
        </>
      ) : null}
    </Screen>
  );
}

export default function EditIdentityScreen() {
  return (
    <RequireSession>
      <IdentityEditor />
    </RequireSession>
  );
}
