import type {
  BootstrapPayload,
  LocalDbClient,
  Metadata,
  ModelsConfig,
  ModelsSpec,
} from '@loco-sync/client';
import { openDB, type IDBPDatabase, type DBSchema } from 'idb';

const _METADATA = '_metadata';
const _TRANSACTIONS = '_transactions';

const DEFAULT_METADATA: Metadata = {
  firstSyncId: 0,
  lastSyncId: 0,
  modelSchemaVersion: 0,
  lastUpdatedAt: new Date(Date.UTC(1970, 0)).toISOString(),
};

// TODO: What are the inputs here?
// TODO: Figure out what to do on version changes. Seems like version might need to be fetched from backend?
// TODO: What durability level to use on transactions? Don't want issues with processing sync actions twice.
export const createLocoSyncIdbClient = <MS extends ModelsSpec>(
  name: string,
  config: ModelsConfig<MS>
): LocalDbClient<MS> => {
  type M = MS['models'];

  let _db: IDBPDatabase | undefined = undefined;
  // TODO: What version number?
  const version = 1;
  const dbPromise = openDB(`loco-sync_${name}`, version, {
    upgrade(db, oldVersion, newVersion, transaction, event) {
      for (const modelName in config.modelDefs) {
        db.createObjectStore(modelName, {
          keyPath: 'id',
        });
      }

      db.createObjectStore(_TRANSACTIONS, {
        keyPath: 'id',
        autoIncrement: true,
      });

      db.createObjectStore(_METADATA);
    },
    // TODO: Are any of these methods needed?
    blocked(currentVersion, blockedVersion, event) {
      console.log('IDB: Blocked');
      // …
    },
    blocking(currentVersion, blockedVersion, event) {
      console.log('IDB: Blocking');
      // …
    },
    terminated() {
      console.log('IDB: terminated');
      // …
    },
  }).then((db) => {
    _db = db;
    return db;
  });

  const getDb = async (): Promise<IDBPDatabase> => {
    if (_db) {
      return _db;
    }
    return dbPromise;
  };

  return {
    getMetadataAndPendingTransactions: async () => {
      const db = await getDb();

      const tx = db.transaction([_METADATA, _TRANSACTIONS], 'readonly');

      const metadataStore = tx.objectStore(_METADATA);
      const transactionStore = tx.objectStore(_TRANSACTIONS);

      const [metadata, pendingTransactions] = await Promise.all([
        metadataStore.get(_METADATA),
        transactionStore.getAll(),
      ]);

      if (!metadata) {
        if (pendingTransactions.length > 0) {
          // TODO: Maybe delete database here?
          throw new Error(
            'Invariant violation: should not be possible to have pending transaction without metadata saved'
          );
        } else {
          return undefined;
        }
      }

      return {
        metadata,
        pendingTransactions,
      };
    },
    // TODO: Add test for multiple sync actions on a single model in one sync
    applySyncActions: async (lastSyncId, sync) => {
      const storeNames: string[] = [_TRANSACTIONS, _METADATA];
      for (const { modelName } of sync) {
        storeNames.push(modelName);
      }

      const db = await getDb();
      const tx = db.transaction(storeNames, 'readwrite');
      const metadataStore = tx.objectStore(_METADATA);

      const metadata: Metadata | undefined = await metadataStore.get(_METADATA);
      if (metadata && metadata.lastSyncId > lastSyncId) {
        await tx.done;
        return;
      }

      // Is it valid to have multiple syncActions on the same model in a sync?
      // I think it is, and that means I might have to handle these in order, or at the very least batch?
      await Promise.all(
        sync.map(async (syncAction) => {
          const store = tx.objectStore(syncAction.modelName);
          if (syncAction.action === 'insert') {
            return store.put(syncAction.data);
          } else if (syncAction.action === 'update') {
            return store.put(syncAction.data);
          } else {
            return store.delete(syncAction.modelId);
          }
        })
      );

      await Promise.all([
        metadataStore.put(
          {
            ...DEFAULT_METADATA,
            ...metadata,
            lastSyncId,
            lastUpdatedAt: new Date().toISOString(),
          },
          _METADATA
        ),
        tx.done,
      ]);
    },
    createPendingTransaction: async (changes) => {
      const db = await getDb();
      const id = await db.put(_TRANSACTIONS, {
        changes,
      });
      if (!Number.isInteger(id)) {
        throw new Error(
          'Transaction id not set correctly, createPendingTransaction'
        );
      }
      // Transaction store has "autoIncrement: true", so this will be a number
      return id as number;
    },
    removePendingTransaction: async (id) => {
      const db = await getDb();
      await db.delete(_TRANSACTIONS, id);
    },
    loadBootstrap: async () => {
      const db = await getDb();

      const allModelNames: (keyof M & string)[] = Object.keys(config.modelDefs);

      const tx = db.transaction(allModelNames, 'readonly');
      const result = {} as BootstrapPayload<M>;
      await Promise.all(
        allModelNames.map(async (modelName) => {
          const store = tx.objectStore(modelName);
          result[modelName] = await store.getAll();
        })
      );

      return result;
    },
    saveBootstrap: async (payload, syncId) => {
      const db = await getDb();

      const allModelNames: (keyof M & string)[] = Object.keys(config.modelDefs);

      const tx = db.transaction([...allModelNames, _METADATA], 'readwrite');

      const metadataStore = tx.objectStore(_METADATA);

      await Promise.all([
        Promise.all(
          Object.keys(payload).map(async (modelName) => {
            const store = tx.objectStore(modelName);
            const allData = payload[modelName] ?? [];
            await Promise.all(
              allData.map((data) => {
                try {
                  return store.put(data);
                } catch (e) {
                  console.error(e);
                  throw e;
                }
              })
            );
          })
        ),
        metadataStore.add(
          {
            ...DEFAULT_METADATA,
            firstSyncId: syncId,
            lastSyncId: syncId,
            lastUpdatedAt: new Date().toISOString(),
          },
          _METADATA
        ),
        tx.done,
      ]);
    },
  };
};
