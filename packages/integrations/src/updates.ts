// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';

/** One change on the update branch, as plain text (phase 53). */
export interface UpdateChange {
  title: string;
  /** The pull request number, when the change came through one. */
  number: number | null;
  at: string;
}

export interface UpdateCheck {
  latestCommit: string;
  latestAt: string | null;
  /** How many commits the branch is ahead of the running version. */
  behind: number;
  changes: UpdateChange[];
}

export class UpdateCheckError extends Error {}

const COMMIT = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,100}$/;
/** Changes shown at most; the rest are summarised by the count. */
export const MAX_UPDATE_CHANGES = 50;

interface CompareCommit {
  sha: string;
  commit: { message: string; committer?: { date?: string } | null };
}

/** Plain text on one line, no control characters, at most 200 characters. */
function clean(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex -- removing control characters is the point
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
  );
}

/**
 * What's new: the merged pull requests (their titles are the merge commits' second paragraph, as
 * GitHub writes them). A branch updated without pull requests falls back to the commits' first lines.
 * Newest first.
 */
export function changesFrom(commits: CompareCommit[]): UpdateChange[] {
  const parsed = commits.map((c) => {
    const lines = c.commit.message.split('\n');
    const first = lines[0] ?? '';
    const pr = /^Merge pull request #(\d+) from /.exec(first);
    const title = pr ? (lines.slice(1).find((l) => l.trim()) ?? first) : first;
    return {
      merge: Boolean(pr),
      otherMerge: !pr && /^Merge (branch|remote-tracking branch) /.test(first),
      change: {
        title: clean(title),
        number: pr ? Number(pr[1]) : null,
        at: c.commit.committer?.date ?? '',
      },
    };
  });
  const prs = parsed.filter((p) => p.merge);
  const list = (prs.length > 0 ? prs : parsed.filter((p) => !p.otherMerge)).map((p) => p.change);
  return list
    .filter((c) => c.title)
    .reverse()
    .slice(0, MAX_UPDATE_CHANGES);
}

/**
 * Asks GitHub what changed on `branch` since `current`. One unauthenticated request (GitHub allows 60
 * an hour per address 📘). Only the repository name, the branch and the commit leave the server.
 */
export async function checkForUpdates(options: {
  repo: string;
  branch: string;
  current: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<UpdateCheck> {
  const { repo, branch, current } = options;
  if (!REPO.test(repo) || !BRANCH.test(branch) || !COMMIT.test(current)) {
    throw new UpdateCheckError('The update settings or the running version aren’t valid.');
  }
  const url = `https://api.github.com/repos/${repo}/compare/${current}...${encodeURIComponent(branch)}`;
  let res: Response;
  try {
    res = await (options.fetch ?? fetch)(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'NexaHeart-update-check',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch {
    throw new UpdateCheckError('Couldn’t reach GitHub.');
  }
  if (res.status === 404) {
    throw new UpdateCheckError('GitHub doesn’t know this repository, branch or running version.');
  }
  if (res.status === 403 || res.status === 429) {
    throw new UpdateCheckError('GitHub asked to wait (rate limit); the next check will try again.');
  }
  if (!res.ok) throw new UpdateCheckError(`GitHub didn’t answer (status ${res.status}).`);
  const body = (await res.json()) as {
    status?: string;
    ahead_by?: number;
    commits?: CompareCommit[];
  };
  const commits = Array.isArray(body.commits) ? body.commits : [];
  // "behind" or "diverged": this server runs something the branch doesn't have; nothing to offer.
  if (body.status !== 'ahead' || commits.length === 0) {
    return { latestCommit: current, latestAt: null, behind: 0, changes: [] };
  }
  const head = commits[commits.length - 1]!;
  if (!COMMIT.test(head.sha)) throw new UpdateCheckError('GitHub’s answer wasn’t understood.');
  return {
    latestCommit: head.sha,
    latestAt: head.commit.committer?.date ?? null,
    behind: Number(body.ahead_by) || commits.length,
    changes: changesFrom(commits),
  };
}

export interface UpdateSettings {
  enabled: boolean;
  repo: string;
  branch: string;
  /** The commit this server runs (baked into the image), if known. */
  current: string | undefined;
  fetch?: typeof fetch;
}

/**
 * Runs the check and saves the result as the single `update_status` row, for the dashboard. A
 * failed check keeps the last good result and records why it failed.
 */
export async function refreshUpdateStatus(
  db: Database,
  settings: UpdateSettings,
  now = new Date(),
): Promise<'off' | 'unknown-version' | 'checked' | 'failed'> {
  const { updateStatus } = schema;
  if (!settings.enabled) return 'off';
  const save = (values: Partial<typeof updateStatus.$inferInsert>) =>
    db
      .insert(updateStatus)
      .values({ id: 1, checkedAt: now, currentCommit: settings.current ?? null, ...values })
      .onConflictDoUpdate({
        target: updateStatus.id,
        set: { checkedAt: now, currentCommit: settings.current ?? null, ...values },
      });
  if (!settings.current) {
    // Nothing from an earlier check applies: the server can't tell what it would update from.
    await save({
      latestCommit: null,
      latestAt: null,
      behind: 0,
      changes: [],
      error: 'unknown-version',
    });
    return 'unknown-version';
  }
  try {
    const result = await checkForUpdates({
      repo: settings.repo,
      branch: settings.branch,
      current: settings.current,
      ...(settings.fetch ? { fetch: settings.fetch } : {}),
    });
    await save({
      latestCommit: result.latestCommit,
      latestAt: result.latestAt ? new Date(result.latestAt) : null,
      behind: result.behind,
      changes: result.changes,
      error: null,
    });
    return 'checked';
  } catch (error) {
    const message = error instanceof UpdateCheckError ? error.message : 'The check failed.';
    await save({ error: message.slice(0, 200) });
    return 'failed';
  }
}
