import {
  type BootstrapPayload,
  type StorageAdapter,
  type Metadata,
  type ModelsConfig,
  type ModelsSpec,
  type Models,
  type ModelFilter,
  type ModelIndex,
  modelObjectKey,
} from '@loco-sync/client';
import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';

const _METADATA = '_metadata';
const _TRANSACTIONS = '_transactions';

export type CreateLocoSyncIdbAdapterOptions = {
  onBlocking?: (
    currentVersion: number,
    blockedVersion: number | null,
    event: IDBVersionChangeEvent,
  ) => void;
  onBlocked?: (
    currentVersion: number,
    blockedVersion: number | null,
    event: IDBVersionChangeEvent,
  ) => void;
  onTerminated?: () => void;
};

export const createLocoSyncIdbAdapter = <MS extends ModelsSpec>(
  namespace: string,
  config: ModelsConfig<MS>,
  options?: CreateLocoSyncIdbAdapterOptions,
): StorageAdapter<MS> => {
  type M = MS['models'];

  let _db: IDBPDatabase | undefined = undefined;
  const version = 1;
  const dbPromise = openDB(namespace, version, {
    upgrade(db, oldVersion, newVersion, transaction, event) {
      for (const modelName in config.modelDefs) {
        const store = db.createObjectStore(modelName, {
          keyPath: 'id',
        });
        const indexes = config.indexes?.[modelName as keyof M & string] ?? [];
        for (const index of indexes) {
          store.createIndex(index.name, index.fields);
        }
      }

      db.createObjectStore(_TRANSACTIONS, {
        keyPath: 'id',
        autoIncrement: true,
      });

      db.createObjectStore(_METADATA);
    },
    blocked: options?.onBlocked,
    blocking: options?.onBlocking,
    terminated: options?.onTerminated,
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
            'Invariant violation: should not be possible to have pending transaction without metadata saved',
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
    applySyncActions: async (lastSyncId, sync) => {
      const storeNames: string[] = [_TRANSACTIONS, _METADATA];
      for (const { modelName } of sync) {
        storeNames.push(modelName);
      }

      const db = await getDb();
      const tx = db.transaction(storeNames, 'readwrite');
      const metadataStore = tx.objectStore(_METADATA);

      const metadata: Metadata<MS['syncGroup']> | undefined =
        await metadataStore.get(_METADATA);
      if (!metadata) {
        throw new Error('Cannot apply sync actions if metadata does not exist');
      }
      if (metadata.lastSyncId > lastSyncId) {
        await tx.done;
        return;
      }

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
        }),
      );

      await Promise.all([
        metadataStore.put(
          {
            ...metadata,
            lastSyncId,
            lastUpdatedAt: new Date().toISOString(),
          },
          _METADATA,
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
          'Transaction id not set correctly, createPendingTransaction',
        );
      }
      // Transaction store has "autoIncrement: true", so this will be a number
      return id as number;
    },
    removePendingTransaction: async (id) => {
      const db = await getDb();
      await db.delete(_TRANSACTIONS, id);
    },
    loadModelData: async (modelName, args) => {
      const db = await getDb();
      if (!args) {
        return db.getAll(modelName);
      } else {
        const { index, filter } = args;
        const data = await db.getAllFromIndex(
          modelName,
          index.name,
          formatFilterForIndex(index, filter),
        );
        return data;
      }
    },
    saveEagerBootstrap: async (payload, firstSyncId) => {
      const db = await getDb();

      const allModelNames = Object.keys(config.modelDefs) as (keyof M &
        string)[];

      const tx = db.transaction([...allModelNames, _METADATA], 'readwrite');

      const metadataStore = tx.objectStore(_METADATA);
      const metadata: Metadata<MS['syncGroup']> = {
        firstSyncId,
        lastSyncId: firstSyncId,
        lastUpdatedAt: new Date().toISOString(),
        syncGroups: [],
      };

      await Promise.all([
        saveBootstrap(tx, payload, null),
        metadataStore.add(metadata, _METADATA),
        tx.done,
      ]);
    },
    saveLazyBootstrap: async (
      payload,
      syncGroups,
      tombstoneModelObjectKeys,
    ) => {
      const syncGroupDefs = config.syncGroupDefs;
      if (!syncGroupDefs) {
        throw new Error(
          'Cannot save lazy bootstrap if config does not have syncGroupDefs',
        );
      }
      const db = await getDb();

      const allModelNames = Object.keys(config.modelDefs) as (keyof M &
        string)[];

      const tx = db.transaction([...allModelNames, _METADATA], 'readwrite');

      const metadataStore = tx.objectStore(_METADATA);
      const metadata: Metadata<MS['syncGroup']> | undefined =
        await metadataStore.get(_METADATA);

      if (!metadata) {
        throw new Error(
          'Cannot save lazy bootstrap if metadata does not exist',
        );
      }
      for (const syncGroup of syncGroups) {
        const matchesMetadataSyncGroup = metadata.syncGroups.some((sg) =>
          syncGroupDefs.equals(syncGroup, sg),
        );
        if (matchesMetadataSyncGroup) {
          throw new Error(
            'Cannot save lazy bootstrap for syncGroup already saved to metadata',
          );
        }
      }

      const newMetadata: Metadata<MS['syncGroup']> = {
        ...metadata,
        syncGroups: [...metadata.syncGroups, ...syncGroups],
      };
      await Promise.all([
        saveBootstrap(tx, payload, tombstoneModelObjectKeys),
        metadataStore.put(newMetadata, _METADATA),
        tx.done,
      ]);
    },
  };
};

async function saveBootstrap<MS extends ModelsSpec>(
  tx: IDBPTransaction<unknown, string[], 'readwrite'>,
  payload: BootstrapPayload<MS['models']>,
  tombstoneModelObjectKeys: Set<string> | null,
) {
  await Promise.all(
    Object.keys(payload).map(async (key) => {
      const modelName = key as keyof MS['models'] & string;
      const store = tx.objectStore(modelName);
      const allData = payload[modelName] ?? [];
      await Promise.all(
        allData.map(async (data) => {
          const objKey = modelObjectKey<MS['models']>({
            modelName,
            modelId: data.id,
          });
          if (tombstoneModelObjectKeys?.has(objKey)) {
            return;
          }
          const existingData = await store.get(data.id);
          if (existingData) {
            return;
          }
          // Important to use "add" instead of "put" to avoid overwriting data that might have come from a sync action
          // However, need to check if data exists before calling  "add" because will fail and abort the current transaction
          // Another possibility is running each command with it's own transaction and removing the check - no idea on the performance tradeoffs
          await store.add(data);
        }),
      );
    }),
  );
}

function formatFilterForIndex<
  M extends Models,
  ModelName extends keyof M & string,
>(
  index: ModelIndex<M, ModelName>,
  filter: ModelFilter<M, ModelName>,
): IDBValidKey {
  const result = [];
  for (const field of index.fields) {
    result.push(filter[field]);
  }
  return result as IDBValidKey;
}
