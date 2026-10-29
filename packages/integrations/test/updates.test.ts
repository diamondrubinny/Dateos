// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { describe, expect, it } from 'vitest';
import { changesFrom, checkForUpdates, UpdateCheckError } from '../src/updates.js';

const sha = (n: number) => n.toString(16).padStart(40, '0');
const commit = (n: number, message: string, date = `2026-10-2${n % 10}T10:00:00Z`) => ({
  sha: sha(n),
  commit: { message, committer: { date } },
});
const CURRENT = sha(1);

function fakeFetch(status: number, body: unknown, seen?: { url?: string; init?: RequestInit }) {
  return (async (url: string | URL, init?: RequestInit) => {
    if (seen) Object.assign(seen, { url: String(url), init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

describe('update check (phase 53)', () => {
  it('lists merged pull requests by their titles, newest first, without their own commits', () => {
    const changes = changesFrom([
      commit(2, 'Phase 52: email the admins when backups stop\n\nA daily worker job…'),
      commit(
        3,
        'Merge pull request #61 from owner/claude/phase-52\n\nPhase 52: email the admins when backups stop',
      ),
      commit(4, 'Fix a typo'),
      commit(5, 'Merge pull request #62 from owner/fix\n\nFix a typo in the dashboard'),
    ]);
    expect(changes).toEqual([
      { title: 'Fix a typo in the dashboard', number: 62, at: '2026-10-25T10:00:00Z' },
      {
        title: 'Phase 52: email the admins when backups stop',
        number: 61,
        at: '2026-10-23T10:00:00Z',
      },
    ]);
  });

  it('a branch without pull requests: the commits’ first lines, skipping branch merges', () => {
    expect(
      changesFrom([
        commit(2, 'Add a thing\n\ndetails'),
        commit(3, "Merge branch 'main' into x"),
      ]).map((c) => c.title),
    ).toEqual(['Add a thing']);
  });

  it('keeps titles to one plain line', () => {
    const [c] = changesFrom([
      commit(2, 'Merge pull request #7 from o/b\n\n<script>alert(1)</script>\u0007 and\ttabs'),
    ]);
    // Shown as text by the dashboard; here only control characters and spacing are removed.
    expect(c!.title).toBe('<script>alert(1)</script> and tabs');
  });

  it('asks GitHub’s compare API for exactly this repository, version and branch', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const result = await checkForUpdates({
      repo: 'diamondrubinny/NexaHeart',
      branch: 'main',
      current: CURRENT,
      fetch: fakeFetch(
        200,
        {
          status: 'ahead',
          ahead_by: 2,
          commits: [
            commit(2, 'Phase 52'),
            commit(3, 'Merge pull request #61 from o/b\n\nPhase 52: backups'),
          ],
        },
        seen,
      ),
    });
    expect(seen.url).toBe(
      `https://api.github.com/repos/diamondrubinny/NexaHeart/compare/${CURRENT}...main`,
    );
    expect(seen.init?.redirect).toBe('error');
    expect(result).toEqual({
      latestCommit: sha(3),
      latestAt: '2026-10-23T10:00:00Z',
      behind: 2,
      changes: [{ title: 'Phase 52: backups', number: 61, at: '2026-10-23T10:00:00Z' }],
    });
  });

  it('up to date, or running something the branch doesn’t have: nothing to offer', async () => {
    for (const status of ['identical', 'behind', 'diverged']) {
      const r = await checkForUpdates({
        repo: 'o/r',
        branch: 'main',
        current: CURRENT,
        fetch: fakeFetch(200, { status, ahead_by: 0, commits: [] }),
      });
      expect(r).toEqual({ latestCommit: CURRENT, latestAt: null, behind: 0, changes: [] });
    }
  });

  it('refuses bad settings before any request, and explains GitHub errors in a few words', async () => {
    const bad = [
      { repo: 'o/r/../x', branch: 'main', current: CURRENT },
      { repo: 'o/r', branch: 'main;rm -rf', current: CURRENT },
      { repo: 'o/r', branch: 'main', current: 'HEAD' },
    ];
    for (const b of bad) {
      await expect(checkForUpdates({ ...b, fetch: fakeFetch(200, {}) })).rejects.toThrow(
        UpdateCheckError,
      );
    }
    const err = (status: number) =>
      checkForUpdates({
        repo: 'o/r',
        branch: 'main',
        current: CURRENT,
        fetch: fakeFetch(status, {}),
      });
    await expect(err(404)).rejects.toThrow('doesn’t know this repository');
    await expect(err(403)).rejects.toThrow('rate limit');
    await expect(err(500)).rejects.toThrow('status 500');
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(
      checkForUpdates({ repo: 'o/r', branch: 'main', current: CURRENT, fetch: offline }),
    ).rejects.toThrow('Couldn’t reach GitHub.');
  });
});
