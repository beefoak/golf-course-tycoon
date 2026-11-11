import { readHeader } from './save';

export interface SaveMeta {
  name: string;
  savedAt: number;
  day: number;
  cash: number;
  bytes: number;
}

interface Row { name: string; meta: SaveMeta; data: Uint8Array }

const DB = 'gct';
const STORE = 'saves';
export const AUTOSAVE = 'autosave';
/** Autosave cadence in game days. */
export const AUTOSAVE_DAYS = 7;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

/** IndexedDB save slots (db `gct`, store `saves`, keyed by name). */
export class SaveStore {
  private db: Promise<IDBDatabase> | null = null;
  constructor(private idb: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((res, rej) => {
        const r = this.idb.open(DB, 1);
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'name' }); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return this.db;
  }
  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.open()).transaction(STORE, mode).objectStore(STORE);
  }

  async put(name: string, data: Uint8Array): Promise<SaveMeta> {
    const h = readHeader(data);
    const meta: SaveMeta = { name, savedAt: Date.now(), day: h.ok ? h.value.clock.day : 0, cash: h.ok ? h.value.ledger.cash : 0, bytes: data.byteLength };
    await req((await this.store('readwrite')).put({ name, meta, data } satisfies Row));
    return meta;
  }
  async get(name: string): Promise<Uint8Array | null> {
    const row = await req((await this.store('readonly')).get(name)) as Row | undefined;
    return row ? new Uint8Array(row.data) : null;
  }
  async list(): Promise<SaveMeta[]> {
    const rows = await req((await this.store('readonly')).getAll()) as Row[];
    return rows.map(r => r.meta).sort((a, b) => b.savedAt - a.savedAt);
  }
  async delete(name: string): Promise<void> {
    await req((await this.store('readwrite')).delete(name));
  }
}
