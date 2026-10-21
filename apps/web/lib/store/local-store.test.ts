import { describe, expect, it } from 'vitest';
import { DEFAULT_METHODOLOGY } from '@lwa/engine';
import { runStoreContract } from '@/lib/store/contract';
import { createLocalStore } from '@/lib/store/local-store';

let dbCount = 0;
/** A database name no other test uses, so every store starts empty. */
function freshDbName(): string {
  dbCount += 1;
  return `lwa-test-${dbCount}`;
}

describe('LocalStore (IndexedDB)', () => {
  runStoreContract(({ actor, now }) => createLocalStore({ dbName: freshDbName(), actor, now }));

  it('a second store on the same database sees the data and does not seed the methodology again', async () => {
    const dbName = freshDbName();
    const actor = () => 'T. Chisti';
    const first = createLocalStore({ dbName, actor });
    const p = await first.projects.create({ name: 'Persisted' });
    await first.methodology.publish({ ...DEFAULT_METHODOLOGY, revision: '2.1.0' }, 'later');

    const second = createLocalStore({ dbName, actor });
    expect(await second.projects.get(p.id)).toEqual(p);
    expect((await second.methodology.list()).map((r) => r.revision).sort()).toEqual(['2.0.0', '2.1.0']);
  });

  it('without a dbName the store opens the app database, "lwa"', async () => {
    const actor = () => 'T. Chisti';
    const p = await createLocalStore({ actor }).projects.create({ name: 'Default database' });
    expect(await createLocalStore({ dbName: 'lwa', actor }).projects.get(p.id)).toEqual(p);
  });

  it('a clock reading that is not a timestamp fails the write and leaves nothing behind', async () => {
    let reading = '2026-01-01T00:00:00.000Z';
    const store = createLocalStore({ dbName: freshDbName(), actor: () => 'T. Chisti', now: () => reading });
    const p = await store.projects.create({ name: 'Clock' });
    reading = 'not a time';
    await expect(store.projects.update(p.id, { description: 'edited' })).rejects.toThrow(
      'Clock returned an invalid timestamp: not a time',
    );
    expect(await store.projects.get(p.id)).toEqual(p);
  });

  it('timestamps never repeat or go backwards within one store, even when the clock does', async () => {
    const store = createLocalStore({ dbName: freshDbName(), actor: () => 'T. Chisti', now: () => '2026-01-01T00:00:00.000Z' });
    const p = await store.projects.create({ name: 'Frozen clock' });
    const u = await store.projects.update(p.id, { description: 'edited' });
    expect(Date.parse(u.updatedAt)).toBeGreaterThan(Date.parse(p.updatedAt));
    const events = await store.audit.list({ projectId: p.id });
    expect(events.map((e) => e.action)).toEqual(['update', 'create']);
  });
});
