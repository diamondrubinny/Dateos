// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import type { Storage } from '@nexaheart/storage';
import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import { strToU8, zipSync, type Zippable } from 'fflate';

const t = schema;

// Raw SQL rows return timestamps as strings, Drizzle rows as Dates.
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * Everything this server holds about one member, for access and portability requests.
 * Other people's data is left out (their messages, their photos, staff notes about the member,
 * hashes of banned emails), so one export never discloses someone else. ⚖️
 */
export async function exportMemberData(
  db: Database,
  storage: Storage,
  userId: string,
): Promise<Uint8Array> {
  const [account] = await db
    .select({
      id: t.user.id,
      email: t.user.email,
      status: t.user.status,
      createdAt: t.user.createdAt,
      pausedAt: t.user.pausedAt,
      pausedUntil: t.user.pausedUntil,
      incognito: t.user.incognito,
    })
    .from(t.user)
    .where(eq(t.user.id, userId));
  if (!account) throw new Error('no such member');
  const [profile] = await db.select().from(t.profiles).where(eq(t.profiles.userId, userId));
  const [about] = await db.select().from(t.profileAbout).where(eq(t.profileAbout.userId, userId));
  // Phase 63: the age check's result only (never what the member showed the provider).
  const [ageCheck] = await db.select().from(t.ageChecks).where(eq(t.ageChecks.userId, userId));
  const [preferences] = await db
    .select()
    .from(t.preferences)
    .where(eq(t.preferences.userId, userId));
  const prompts = await db
    .select({
      promptKey: t.prompts.promptKey,
      answer: t.prompts.answer,
      createdAt: t.prompts.createdAt,
    })
    .from(t.prompts)
    .where(eq(t.prompts.userId, userId))
    .orderBy(asc(t.prompts.position));
  const consents = await db
    .select({
      kind: t.consents.kind,
      granted: t.consents.granted,
      version: t.consents.version,
      at: t.consents.createdAt,
    })
    .from(t.consents)
    .where(eq(t.consents.userId, userId))
    .orderBy(asc(t.consents.createdAt));
  const photos = await db
    .select()
    .from(t.photos)
    .where(eq(t.photos.userId, userId))
    .orderBy(asc(t.photos.createdAt));
  const clips = await db.select().from(t.audioClips).where(eq(t.audioClips.userId, userId));
  const [location] = await db
    .execute<{
      lat: number;
      lng: number;
      updated_at: Date;
      travel_city_id: number | null;
      travel_lat: number | null;
      travel_lng: number | null;
      travel_started_at: Date | null;
      travel_until: Date | null;
    }>(
      sql`SELECT ST_Y(geo::geometry) AS lat, ST_X(geo::geometry) AS lng, updated_at,
                 travel_city_id, ST_Y(travel_geo::geometry) AS travel_lat, ST_X(travel_geo::geometry) AS travel_lng,
                 travel_started_at, travel_until
          FROM locations WHERE user_id = ${userId}`,
    )
    .then((r) => r.rows);
  const interactions = await db
    .select({
      targetId: t.interactions.targetId,
      kind: t.interactions.kind,
      comment: t.interactions.comment,
      at: t.interactions.createdAt,
    })
    .from(t.interactions)
    .where(eq(t.interactions.actorId, userId));
  const matches = await db
    .select({
      id: t.matches.id,
      userA: t.matches.userA,
      userB: t.matches.userB,
      createdAt: t.matches.createdAt,
      unmatchedAt: t.matches.unmatchedAt,
    })
    .from(t.matches)
    .where(or(eq(t.matches.userA, userId), eq(t.matches.userB, userId)));
  // Phase 66a: matches where you showed your blurred photos.
  const shown = new Set(
    (
      await db
        .select({ matchId: t.photoReveals.matchId })
        .from(t.photoReveals)
        .where(eq(t.photoReveals.userId, userId))
    ).map((r) => r.matchId),
  );
  // Phase 66c: your private album and the matches you shared it with.
  const albumPhotos = await db
    .select({ id: t.photos.id, status: t.photos.status, at: t.photos.createdAt })
    .from(t.photos)
    .where(and(eq(t.photos.userId, userId), eq(t.photos.purpose, 'album')));
  const albumShares = await db
    .select({
      matchId: t.albumShares.matchId,
      mode: t.albumShares.mode,
      sharedAt: t.albumShares.createdAt,
      firstViewedAt: t.albumShares.openedAt,
    })
    .from(t.albumShares)
    .where(eq(t.albumShares.userId, userId));
  // Phase 68a: introductions to me (with my own answer, never the other's) and, as a community
  // matchmaker, the ones I sent (their state, never the answers).
  const introductionsReceived = (
    await db.execute<Record<string, unknown>>(sql`
      SELECT it.id, it.note, it.created_at AS "at", it.expires_at AS "expiresAt",
        CASE WHEN it.a_id = ${userId} THEN it.a_answer ELSE it.b_answer END AS "yourAnswer",
        CASE WHEN it.a_id = ${userId} THEN it.a_answered_at ELSE it.b_answered_at END AS "answeredAt",
        it.matched_at AS "matchedAt", it.outcome
      FROM introductions it
      WHERE (it.a_id = ${userId} OR it.b_id = ${userId})
        AND (it.first_id IS NULL OR it.first_id = ${userId}
             OR (it.first_id = it.a_id AND it.a_answer = 'yes')
             OR (it.first_id = it.b_id AND it.b_answer = 'yes'))
      ORDER BY it.created_at`)
  ).rows;
  const introductionsSent = (
    await db.execute<Record<string, unknown>>(sql`
      SELECT it.id, it.note, it.created_at AS "at", it.matched_at AS "matchedAt", it.outcome
      FROM introductions it WHERE it.matchmaker_id = ${userId} ORDER BY it.created_at`)
  ).rows;
  const [matchmakerRole] = await db
    .select({ since: t.matchmakers.grantedAt })
    .from(t.matchmakers)
    .where(eq(t.matchmakers.userId, userId));
  // Phase 68c: the profile's review, where a moderator approves new profiles (never who).
  const [review] = await db
    .select({
      status: t.profiles.reviewStatus,
      reason: t.profiles.reviewReason,
      note: t.profiles.reviewNote,
      reviewedAt: t.profiles.reviewedAt,
    })
    .from(t.profiles)
    .where(eq(t.profiles.userId, userId));
  // Phase 68d: my chaperone, and whom I chaperone (since when; never what they read).
  const chaperoneRows = (
    await db.execute<Record<string, unknown>>(sql`
      SELECT CASE WHEN c.user_id = ${userId} THEN 'my_chaperone' ELSE 'i_chaperone' END AS role,
        p.display_name AS "name", c.started_at AS "since", c.last_viewed_at AS "lastViewedAt"
      FROM chaperones c
      JOIN profiles p ON p.user_id = CASE WHEN c.user_id = ${userId} THEN c.chaperone_id ELSE c.user_id END
      WHERE c.user_id = ${userId} OR c.chaperone_id = ${userId}`)
  ).rows;
  // Phase 68b: résumé links (never the token).
  const resumeLinkRows = await db
    .select({
      label: t.resumeLinks.label,
      sections: t.resumeLinks.sections,
      views: t.resumeLinks.views,
      at: t.resumeLinks.createdAt,
      expiresAt: t.resumeLinks.expiresAt,
      endedAt: t.resumeLinks.endedAt,
    })
    .from(t.resumeLinks)
    .where(eq(t.resumeLinks.ownerId, userId));
  // Partner communities (phase 28b): your alias there, your decisions and matches.
  const partnerName = t.federationPartners.name;
  const federatedAliases = await db
    .select({
      community: partnerName,
      alias: t.federationAliases.alias,
      since: t.federationAliases.createdAt,
    })
    .from(t.federationAliases)
    .innerJoin(t.federationPartners, eq(t.federationPartners.id, t.federationAliases.partnerId))
    .where(eq(t.federationAliases.userId, userId));
  const federatedDecisions = await db
    .select({
      community: partnerName,
      theirAlias: t.federationDecisions.alias,
      kind: t.federationDecisions.kind,
      at: t.federationDecisions.createdAt,
    })
    .from(t.federationDecisions)
    .innerJoin(t.federationPartners, eq(t.federationPartners.id, t.federationDecisions.partnerId))
    .where(eq(t.federationDecisions.userId, userId));
  const federatedMatches = await db
    .select({
      community: partnerName,
      theirAlias: t.federationMatches.alias,
      name: t.federationMatches.name,
      at: t.federationMatches.createdAt,
    })
    .from(t.federationMatches)
    .innerJoin(t.federationPartners, eq(t.federationPartners.id, t.federationMatches.partnerId))
    .where(eq(t.federationMatches.userId, userId));
  // 28c: the messages you sent to people in partner communities.
  const federatedSent = await db
    .select({
      community: partnerName,
      to: t.federationMatches.name,
      body: t.federationMessages.body,
      at: t.federationMessages.createdAt,
    })
    .from(t.federationMessages)
    .innerJoin(t.federationMatches, eq(t.federationMatches.id, t.federationMessages.matchId))
    .innerJoin(t.federationPartners, eq(t.federationPartners.id, t.federationMatches.partnerId))
    .where(and(eq(t.federationMatches.userId, userId), eq(t.federationMessages.mine, true)));
  const sent = await db
    .select({
      matchId: t.messages.matchId,
      kind: t.messages.kind,
      body: t.messages.body,
      at: t.messages.createdAt,
      // Phase 30: kept (for safety) until purged, so it's in my own export until then.
      unsentAt: t.messages.unsentAt,
    })
    .from(t.messages)
    .where(eq(t.messages.senderId, userId))
    .orderBy(asc(t.messages.createdAt));
  const blocks = await db
    .select({ blockedId: t.blocks.blockedId, at: t.blocks.createdAt })
    .from(t.blocks)
    .where(eq(t.blocks.blockerId, userId));
  const reportsFiled = await db
    .select({
      reportedId: t.reports.reportedId,
      category: t.reports.category,
      details: t.reports.details,
      status: t.reports.status,
      at: t.reports.createdAt,
    })
    .from(t.reports)
    .where(eq(t.reports.reporterId, userId));
  // Warnings and suspensions affecting the member: the category and date, not staff notes.
  const moderation = await db
    .select({
      action: t.moderationLog.action,
      category: t.moderationLog.category,
      // Phase 61: what you were told (never the staff's internal note or who decided).
      ground: t.moderationLog.ground,
      explanation: t.moderationLog.explanation,
      automatedDetection: t.moderationLog.automatedDetection,
      reversedAt: t.moderationLog.reversedAt,
      at: t.moderationLog.createdAt,
    })
    .from(t.moderationLog)
    .where(eq(t.moderationLog.targetId, userId));
  const appeals = await db
    .select({
      text: t.moderationAppeals.text,
      status: t.moderationAppeals.status,
      response: t.moderationAppeals.response,
      at: t.moderationAppeals.createdAt,
      decidedAt: t.moderationAppeals.decidedAt,
    })
    .from(t.moderationAppeals)
    .where(eq(t.moderationAppeals.userId, userId));
  const verifications = await db
    .select({
      status: t.verifications.status,
      pose: t.verifications.pose,
      at: t.verifications.createdAt,
      decidedAt: t.verifications.decidedAt,
    })
    .from(t.verifications)
    .where(eq(t.verifications.userId, userId))
    .orderBy(desc(t.verifications.createdAt));
  // Safety check-ins you created (kept 7 days after they end), including the contact you entered.
  const checkinRows = await db
    .select({
      status: t.checkins.status,
      matchName: t.checkins.matchName,
      place: t.checkins.place,
      note: t.checkins.note,
      contactName: t.checkins.contactName,
      contactEmail: t.checkins.contactEmail,
      startsAt: t.checkins.startsAt,
      checkAt: t.checkins.checkAt,
      sosCount: t.checkins.sosCount,
      extensions: t.checkins.extensions,
      alertedAt: t.checkins.alertedAt,
    })
    .from(t.checkins)
    .where(eq(t.checkins.userId, userId))
    .orderBy(desc(t.checkins.createdAt));
  // Community events you said you're going to, or whose waiting list you joined.
  const rsvpRows = await db
    .select({
      title: t.events.title,
      startsAt: t.events.startsAt,
      status: t.events.status,
      you: t.eventRsvps.status,
      at: t.eventRsvps.createdAt,
      checkedInAt: t.eventRsvps.checkedInAt,
      // Phase 71a: a place from the waiting list, joining "Meet again", a missed event excused.
      // Phase 71b: the group (gender) the place was taken in, for events with places by gender.
      group: t.eventRsvps.pool,
      // Phase 71d: answers to join a table, and the table.
      tableAnswers: t.eventRsvps.tableAnswers,
      table: t.eventRsvps.tableNo,
      placeFromWaitingListAt: t.eventRsvps.promotedAt,
      joinedMeetAgainAt: t.eventRsvps.meetAgainAt,
      excusedAt: t.eventRsvps.excusedAt,
    })
    .from(t.eventRsvps)
    .innerJoin(t.events, eq(t.events.id, t.eventRsvps.eventId))
    .where(eq(t.eventRsvps.userId, userId))
    .orderBy(asc(t.eventRsvps.createdAt));
  // "Meet again" (phase 71a): whom you chose, never who chose you.
  const pickRows = await db
    .select({
      event: t.events.title,
      chose: t.profiles.displayName,
      at: t.eventPicks.createdAt,
    })
    .from(t.eventPicks)
    .innerJoin(t.events, eq(t.events.id, t.eventPicks.eventId))
    .leftJoin(t.profiles, eq(t.profiles.userId, t.eventPicks.targetId))
    .where(eq(t.eventPicks.userId, userId))
    .orderBy(asc(t.eventPicks.createdAt));
  // Events you proposed as a community organizer (phase 71e).
  const proposalRows = await db
    .select({
      title: t.eventProposals.title,
      startsAt: t.eventProposals.startsAt,
      status: t.eventProposals.status,
      reason: t.eventProposals.reason,
      at: t.eventProposals.createdAt,
    })
    .from(t.eventProposals)
    .where(eq(t.eventProposals.organizerId, userId))
    .orderBy(asc(t.eventProposals.createdAt));
  // Your questions to event organizers (phase 27), with their answers.
  const questionRows = await db
    .select({
      event: t.events.title,
      question: t.eventQuestions.body,
      urgent: t.eventQuestions.urgent,
      answer: t.eventQuestions.answer,
      askedAt: t.eventQuestions.createdAt,
      answeredAt: t.eventQuestions.answeredAt,
    })
    .from(t.eventQuestions)
    .innerJoin(t.events, eq(t.events.id, t.eventQuestions.eventId))
    .where(eq(t.eventQuestions.userId, userId))
    .orderBy(asc(t.eventQuestions.createdAt));
  // Speed-dating rounds (phase 23): when, and your own answer. The other person's answer is theirs.
  const speedRows = (
    await db
      .select({
        event: t.events.title,
        round: t.speedDates.round,
        startsAt: t.speedDates.startsAt,
        userA: t.speedDates.userA,
        answerA: t.speedDates.answerA,
        answerB: t.speedDates.answerB,
        matched: t.speedDates.matchId,
      })
      .from(t.speedDates)
      .innerJoin(t.events, eq(t.events.id, t.speedDates.eventId))
      .where(or(eq(t.speedDates.userA, userId), eq(t.speedDates.userB, userId)))
      .orderBy(asc(t.speedDates.startsAt))
  ).map((r) => ({
    event: r.event,
    round: r.round,
    startsAt: iso(r.startsAt),
    yourAnswer: r.userA === userId ? r.answerA : r.answerB,
    matched: r.matched !== null,
  }));
  // Date ideas in your chats. The other person's own note is theirs, so only yours is included.
  const datePlanRows = await db
    .select({
      proposerId: t.datePlans.proposerId,
      status: t.datePlans.status,
      place: t.datePlans.venueName,
      area: t.datePlans.venueArea,
      startsAt: t.datePlans.startsAt,
      note: t.datePlans.note,
      respondedAt: t.datePlans.respondedAt,
      countered: t.datePlans.countered,
      createdAt: t.datePlans.createdAt,
      proposerMet: t.datePlans.proposerMet,
      receiverMet: t.datePlans.receiverMet,
      proposerAgain: t.datePlans.proposerAgain,
      receiverAgain: t.datePlans.receiverAgain,
    })
    .from(t.datePlans)
    .innerJoin(t.matches, eq(t.matches.id, t.datePlans.matchId))
    .where(or(eq(t.matches.userA, userId), eq(t.matches.userB, userId)))
    .orderBy(asc(t.datePlans.createdAt));
  // Friends (phase 22): takes about you, your pairs, and your own messages in double chats.
  const takeRows = await db
    .select({
      name: t.friendTakes.name,
      relation: t.friendTakes.relation,
      text: t.friendTakes.text,
      status: t.friendTakes.status,
      createdAt: t.friendTakes.createdAt,
    })
    .from(t.friendTakes)
    .where(eq(t.friendTakes.ownerId, userId));
  const pairRows = await db
    .select({ createdAt: t.pairs.createdAt, endedAt: t.pairs.endedAt })
    .from(t.pairs)
    .where(or(eq(t.pairs.userA, userId), eq(t.pairs.userB, userId)));
  const doubleSent = await db
    .select({ text: t.doubleMessages.body, at: t.doubleMessages.createdAt })
    .from(t.doubleMessages)
    .where(eq(t.doubleMessages.senderId, userId))
    .orderBy(asc(t.doubleMessages.createdAt));
  // Hide me from my contacts (phase 21): how many, not who (the matches are other members).
  const [contactHideCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.contactHides)
    .where(eq(t.contactHides.userId, userId));
  const invitesMade = await db
    .select({
      uses: t.inviteCodes.uses,
      maxUses: t.inviteCodes.maxUses,
      expiresAt: t.inviteCodes.expiresAt,
      createdAt: t.inviteCodes.createdAt,
    })
    .from(t.inviteCodes)
    .where(eq(t.inviteCodes.createdBy, userId));
  // "When I'm free" lists you shared (the other person's list is theirs).
  const availabilityRows = await db
    .select({
      matchId: t.matchAvailability.matchId,
      slots: t.matchAvailability.slots,
      updatedAt: t.matchAvailability.updatedAt,
    })
    .from(t.matchAvailability)
    .where(eq(t.matchAvailability.userId, userId));
  const callRows = await db
    .select({
      matchId: t.calls.matchId,
      callerId: t.calls.callerId,
      video: t.calls.video,
      status: t.calls.status,
      createdAt: t.calls.createdAt,
      answeredAt: t.calls.answeredAt,
      endedAt: t.calls.endedAt,
    })
    .from(t.calls)
    .where(or(eq(t.calls.callerId, userId), eq(t.calls.calleeId, userId)))
    .orderBy(asc(t.calls.createdAt));
  const devices = await db
    .select({
      platform: t.pushTokens.platform,
      createdAt: t.pushTokens.createdAt,
      lastUsedAt: t.pushTokens.lastUsedAt,
    })
    .from(t.pushTokens)
    .where(eq(t.pushTokens.userId, userId));
  // Phase 60: browsers with notifications on (the push service's host, not the full address,
  // which is a capability to send to that browser).
  const browsers = await db
    .select({
      endpoint: t.webPushSubscriptions.endpoint,
      createdAt: t.webPushSubscriptions.createdAt,
      lastUsedAt: t.webPushSubscriptions.lastUsedAt,
    })
    .from(t.webPushSubscriptions)
    .where(eq(t.webPushSubscriptions.userId, userId));
  // My "Maybe later" list (phase 33): who, and when.
  const savedForLater = await db
    .select({ profileId: t.savedProfiles.targetId, savedAt: t.savedProfiles.createdAt })
    .from(t.savedProfiles)
    .where(eq(t.savedProfiles.userId, userId));
  // My private chat choices (phase 31).
  const chatPrefs = await db
    .select({
      matchId: t.matchPrefs.matchId,
      muted: t.matchPrefs.muted,
      archived: t.matchPrefs.archived,
    })
    .from(t.matchPrefs)
    .where(eq(t.matchPrefs.userId, userId));
  // My reactions to messages (phase 29b).
  const reactions = await db
    .select({
      messageId: t.messageReactions.messageId,
      emoji: t.messageReactions.emoji,
      createdAt: t.messageReactions.createdAt,
    })
    .from(t.messageReactions)
    .where(eq(t.messageReactions.userId, userId))
    .orderBy(asc(t.messageReactions.createdAt));
  // "Your devices" (phase 29): only the coarse label and dates are stored.
  const sessions = await db
    .select({
      device: t.session.deviceLabel,
      createdAt: t.session.createdAt,
      updatedAt: t.session.updatedAt,
    })
    .from(t.session)
    .where(eq(t.session.userId, userId))
    .orderBy(asc(t.session.createdAt));

  const files: Zippable = {};
  const photoEntries = [];
  for (const p of photos) {
    let file: string | null = null;
    if (p.mediaKey && p.status === 'clean') {
      file = `photos/${p.id}.webp`;
      files[file] = new Uint8Array(await storage.getBuffer(storage.buckets.media, p.mediaKey));
    }
    photoEntries.push({
      id: p.id,
      purpose: p.purpose,
      status: p.status,
      // Phase 40: what the member wrote about the photo.
      description: p.description,
      uploadedAt: iso(p.createdAt),
      file,
    });
  }
  const voiceEntries = [];
  for (const c of clips) {
    let file: string | null = null;
    if (c.mediaKey && c.status === 'clean') {
      file = `voice/${c.id}.m4a`;
      files[file] = new Uint8Array(await storage.getBuffer(storage.buckets.media, c.mediaKey));
    }
    voiceEntries.push({
      id: c.id,
      durationMs: c.durationMs,
      status: c.status,
      recordedAt: iso(c.createdAt),
      file,
      // Phase 26: the automatic text of your clip, if someone asked for it.
      transcript: c.transcriptStatus === 'done' ? c.transcript : null,
    });
  }

  const data = {
    exportedAt: new Date().toISOString(),
    note:
      'All personal data this community holds about you. Messages written by other people are not included. ' +
      'Your location is stored only as an approximate ~1 km grid cell.',
    account: {
      ...account,
      createdAt: iso(account.createdAt),
      pausedAt: iso(account.pausedAt),
      pausedUntil: iso(account.pausedUntil),
    },
    profile: profile
      ? {
          displayName: profile.displayName,
          birthDate: profile.birthDate,
          gender: profile.gender,
          interestedIn: profile.interestedIn,
          intention: profile.intention,
          bio: profile.bio,
          languages: profile.languages,
          verifiedAt: iso(profile.verifiedAt),
          lastEventCheckInAt: iso(profile.eventCheckInAt),
        }
      : null,
    preferences: preferences
      ? {
          ageMin: preferences.ageMin,
          ageMax: preferences.ageMax,
          maxDistanceKm: preferences.maxDistanceKm,
          intentions: preferences.intentions,
          acceptVoice: preferences.acceptVoice,
          acceptCalls: preferences.acceptCalls,
          allowTranscripts: preferences.allowTranscripts,
          // Phase 65: who can reach me.
          dailyLikeLimit: preferences.dailyLikeLimit,
          verifiedContactOnly: preferences.verifiedContactOnly,
          // Phase 66a.
          blurPhotos: preferences.blurPhotos,
          // Phase 67a.
          hideDistance: preferences.hideDistance,
          discreetNotifications: preferences.discreetNotifications,
          appBadge: preferences.appBadge,
          partnerShortCard: preferences.partnerShortCard,
          shabbatMode: preferences.shabbatMode,
          shabbatTellMatches: preferences.shabbatShow,
          shabbatCandleMinutes: preferences.shabbatCandles,
          shabbatSecondDay: preferences.shabbatSecondDay,
          shabbatTimeZone: preferences.shabbatTimeZone,
          openToMatchmakers: preferences.openToMatchmakers,
          friendSuggestions: preferences.friendSuggestions,
          showMetInPersonBadge: preferences.showMetBadge,
          showCheckedInAtEventBadge: preferences.showEventBadge,
          friendsMode: {
            on: preferences.friendMode,
            ageMin: preferences.friendAgeMin,
            ageMax: preferences.friendAgeMax,
            genders: preferences.friendGenders,
          },
          dealbreakers: {
            smokingOk: preferences.smokingOk,
            childrenOk: preferences.childrenOk,
            religionOk: preferences.religionOk,
            faithOk: preferences.faithOk,
            streamOk: preferences.streamOk,
            heightMin: preferences.heightMin,
            heightMax: preferences.heightMax,
          },
        }
      : null,
    // About me (phase 19); religious observance only while its consent is given.
    about: about
      ? {
          interests: about.interests,
          children: about.children,
          smoking: about.smoking,
          drinking: about.drinking,
          heightCm: about.heightCm,
          religion: about.religion,
          openingQuestion: about.openingQuestion,
          // Phase 25: only while the accessibility consent is given.
          accessNeeds: about.accessNeeds,
          showAccessNeeds: about.showAccessNeeds,
          // Phase 62a: gender identity and pronouns, and who sees them.
          genderIdentity: about.genderIdentity,
          genderCustom: about.genderCustom,
          pronouns: about.pronouns,
          identityVisibility: about.identityVisibility,
          // Phase 66b: shown only to matches.
          matchNote: about.matchNote,
          // Phase 62b: relationship history; faith answers only while the religion consent is given.
          relationshipHistory: about.relationshipHistory,
          faith: about.faith,
          faithStream: about.faithStream,
          observance: about.observance,
        }
      : null,
    approximateLocation: location
      ? {
          lat: Number(location.lat),
          lng: Number(location.lng),
          updatedAt: iso(location.updated_at),
        }
      : null,
    // Travel mode (phase 18c): a public city centre (GeoNames id), kept 30 days after the trip.
    travel:
      location?.travel_city_id != null
        ? {
            geonamesCityId: location.travel_city_id,
            cityCentre: { lat: Number(location.travel_lat), lng: Number(location.travel_lng) },
            startedAt: iso(location.travel_started_at),
            until: iso(location.travel_until),
          }
        : null,
    prompts: prompts.map((p) => ({ ...p, createdAt: iso(p.createdAt) })),
    consents: consents.map((c) => ({ ...c, at: iso(c.at) })),
    photos: photoEntries,
    voiceMessages: voiceEntries,
    likesAndPasses: interactions.map((i) => ({ ...i, at: iso(i.at) })),
    partnerCommunities: {
      note: 'Partners know you only by these aliases, one per community.',
      aliases: federatedAliases.map((a) => ({ ...a, since: iso(a.since) })),
      decisions: federatedDecisions.map((d) => ({ ...d, at: iso(d.at) })),
      matches: federatedMatches.map((m) => ({ ...m, at: iso(m.at) })),
      messagesSent: federatedSent.map((m) => ({ ...m, at: iso(m.at) })),
    },
    matches: matches.map((m) => ({
      id: m.id,
      otherMemberId: m.userA === userId ? m.userB : m.userA,
      createdAt: iso(m.createdAt),
      unmatchedAt: iso(m.unmatchedAt),
      youShowedYourPhotos: shown.has(m.id),
    })),
    privateAlbum: {
      photos: albumPhotos.map((p) => ({ ...p, at: iso(p.at) })),
      sharedWith: albumShares.map((a) => ({
        ...a,
        sharedAt: iso(a.sharedAt),
        firstViewedAt: iso(a.firstViewedAt),
      })),
    },
    introductions: {
      matchmakerSince: matchmakerRole ? iso(matchmakerRole.since) : null,
      received: introductionsReceived,
      sentAsMatchmaker: introductionsSent,
    },
    chaperones: chaperoneRows,
    profileReview: review ? { ...review, reviewedAt: iso(review.reviewedAt) } : null,
    resumeLinks: resumeLinkRows.map((r) => ({
      ...r,
      at: iso(r.at),
      expiresAt: iso(r.expiresAt),
      endedAt: iso(r.endedAt),
    })),
    messagesYouSent: sent.map((m) => ({ ...m, at: iso(m.at), unsentAt: iso(m.unsentAt) })),
    blocks: blocks.map((b) => ({ ...b, at: iso(b.at) })),
    reportsYouFiled: reportsFiled.map((r) => ({ ...r, at: iso(r.at) })),
    moderationAffectingYou: moderation.map((m) => ({
      ...m,
      at: iso(m.at),
      reversedAt: iso(m.reversedAt),
    })),
    appeals: appeals.map((a) => ({ ...a, at: iso(a.at), decidedAt: iso(a.decidedAt) })),
    ageCheck: ageCheck
      ? { result: ageCheck.result, method: ageCheck.method, checkedAt: iso(ageCheck.checkedAt) }
      : null,
    photoVerifications: verifications.map((v) => ({
      ...v,
      at: iso(v.at),
      decidedAt: iso(v.decidedAt),
    })),
    safetyCheckins: checkinRows.map((c) => ({
      ...c,
      startsAt: iso(c.startsAt),
      checkAt: iso(c.checkAt),
      alertedAt: iso(c.alertedAt),
    })),
    eventsYouAreGoingTo: rsvpRows.map((r) => ({
      ...r,
      startsAt: iso(r.startsAt),
      at: iso(r.at),
      checkedInAt: iso(r.checkedInAt),
      placeFromWaitingListAt: iso(r.placeFromWaitingListAt),
      joinedMeetAgainAt: iso(r.joinedMeetAgainAt),
      excusedAt: iso(r.excusedAt),
    })),
    meetAgainChoices: pickRows.map((p) => ({ ...p, at: iso(p.at) })),
    eventsYouProposed: proposalRows.map((p) => ({
      ...p,
      startsAt: iso(p.startsAt),
      at: iso(p.at),
    })),
    questionsToEventOrganizers: questionRows.map((q) => ({
      ...q,
      askedAt: iso(q.askedAt),
      answeredAt: iso(q.answeredAt),
    })),
    speedDatingRounds: speedRows,
    dateIdeas: datePlanRows.map(
      ({ proposerId, note, proposerMet, receiverMet, proposerAgain, receiverAgain, ...d }) => {
        const mine = proposerId === userId;
        return {
          ...d,
          proposedByYou: mine,
          note: mine ? note : null,
          // Only your own private answers after the date.
          youSaidYouMet: mine ? proposerMet : receiverMet,
          youWouldMeetAgain: mine ? proposerAgain : receiverAgain,
          startsAt: iso(d.startsAt),
          respondedAt: iso(d.respondedAt),
          createdAt: iso(d.createdAt),
        };
      },
    ),
    friendsTakesAboutYou: takeRows.map((r) => ({ ...r, createdAt: iso(r.createdAt) })),
    doubleDatePairs: pairRows.map((p) => ({
      createdAt: iso(p.createdAt),
      endedAt: iso(p.endedAt),
    })),
    doubleChatMessagesYouSent: doubleSent.map((m) => ({ ...m, at: iso(m.at) })),
    peopleHiddenFromYourContacts: contactHideCount?.n ?? 0,
    invitesYouCreated: invitesMade.map((i) => ({
      ...i,
      expiresAt: iso(i.expiresAt),
      createdAt: iso(i.createdAt),
    })),
    availabilityYouShared: availabilityRows.map((a) => ({
      ...a,
      updatedAt: iso(a.updatedAt),
    })),
    callsNoAudioOrVideoIsStored: callRows.map(({ callerId, ...c }) => ({
      ...c,
      startedByYou: callerId === userId,
      createdAt: iso(c.createdAt),
      answeredAt: iso(c.answeredAt),
      endedAt: iso(c.endedAt),
    })),
    pushDevices: devices.map((d) => ({
      ...d,
      createdAt: iso(d.createdAt),
      lastUsedAt: iso(d.lastUsedAt),
    })),
    browserNotifications: browsers.map((b) => ({
      pushService: new URL(b.endpoint).hostname,
      createdAt: iso(b.createdAt),
      lastUsedAt: iso(b.lastUsedAt),
    })),
    signedInDevices: sessions.map((d) => ({
      device: d.device,
      signedInAt: iso(d.createdAt),
      lastActiveAt: iso(d.updatedAt),
    })),
    reactions: reactions.map((r) => ({ ...r, createdAt: iso(r.createdAt) })),
    chatPreferences: chatPrefs,
    savedForLater: savedForLater.map((s) => ({ ...s, savedAt: iso(s.savedAt) })),
  };
  files['data.json'] = strToU8(JSON.stringify(data, null, 2));
  files['README.txt'] = strToU8(
    'This archive contains your data from this NexaHeart community.\n' +
      'data.json: your account, profile, choices and activity. photos/ and voice/: your files.\n' +
      'Keep it safe: it contains personal information.\n',
  );
  return zipSync(files, { level: 6 });
}
