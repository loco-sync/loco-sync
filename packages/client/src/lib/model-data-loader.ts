import { type ModelsSpec, type ModelsConfig } from './core';
import type { NetworkAdapter } from './network';
import type { StorageAdapter } from './storage';

export class ModelDataLoader<MS extends ModelsSpec> {
  #config: ModelsConfig<MS>;
  #network: NetworkAdapter<MS>;
  #storage: StorageAdapter<MS>;

  #eagerModels: Set<keyof MS['models'] & string>;
  #lazyModelsToSyncGroups: Map<keyof MS['models'] & string, MS['syncGroup'][]>;
  #syncGroupLoadStatuses: Map<
    MS['syncGroup'],
    { loaded: true } | { loaded: false; listeners: Set<() => void> }
  >;

  constructor(
    config: ModelsConfig<MS>,
    network: NetworkAdapter<MS>,
    storage: StorageAdapter<MS>,
  ) {
    this.#config = config;
    this.#network = network;
    this.#storage = storage;

    this.#eagerModels = new Set();
    this.#lazyModelsToSyncGroups = new Map();
    this.#syncGroupLoadStatuses = new Map();

    for (const key in config.modelDefs) {
      const modelName = key as keyof MS['models'] & string;
      const modelDef = config.modelDefs[modelName];
      if (modelDef.initialBootstrap) {
        this.#eagerModels.add(modelName);
      }
    }
  }

  get eagerModels() {
    return Array.from(this.#eagerModels);
  }

  handleBootstrapsFromHandshake(
    handshakeSyncGroups: MS['syncGroup'][],
    tombstoneModelObjectKeys: Set<string>,
  ) {
    const addedSyncGroups: MS['syncGroup'][] = [];
    const removedSyncGroups: MS['syncGroup'][] = [];
    const equals = this.#config.syncGroupDefs?.equals ?? Object.is;

    const currentSyncGroups = Array.from(this.#syncGroupLoadStatuses.keys());
    for (const currentGroup of currentSyncGroups) {
      if (
        !handshakeSyncGroups.some((newGroup) => equals(currentGroup, newGroup))
      ) {
        removedSyncGroups.push(currentGroup);
      }
    }
    for (const newGroup of handshakeSyncGroups) {
      if (
        !currentSyncGroups.some((currentGroup) =>
          equals(currentGroup, newGroup),
        )
      ) {
        addedSyncGroups.push(newGroup);
      }
    }

    if (removedSyncGroups.length > 0) {
      console.error("Removing sync groups isn't supported yet");
    }

    void this.addNewSyncGroups(addedSyncGroups, tombstoneModelObjectKeys);
  }

  /**
   * Adds new syncGroups to the client.
   * This consists of running a lazy bootstrap request for each syncGroup, and saving the results to storage.
   *
   * TODO: May want to do some sort of batching or concurrent requests here
   *
   * @param syncGroups new syncGroups (via eager bootstrap result or handshake message)
   */
  async addNewSyncGroups(
    syncGroups: MS['syncGroup'][],
    tombstoneModelObjectKeys: Set<string>,
  ) {
    if (!this.#config.syncGroupDefs) {
      console.error(
        'Cannot add new sync groups if no syncGroupDefs are defined in config',
      );
      return;
    }
    for (const syncGroup of syncGroups) {
      this.#syncGroupLoadStatuses.set(syncGroup, {
        loaded: false,
        listeners: new Set(),
      });
    }

    for (const syncGroup of syncGroups) {
      const models =
        this.#config.syncGroupDefs.modelsForPartialBootstrap(syncGroup);
      for (const model of models) {
        const lazyData = this.#lazyModelsToSyncGroups.get(model);
        if (lazyData) {
          lazyData.push(syncGroup);
        } else {
          this.#lazyModelsToSyncGroups.set(model, [syncGroup]);
        }
      }
      const bootstrapResult = await this.#network.bootstrap({
        type: 'lazy',
        models,
        syncGroups: [syncGroup],
      });
      if (bootstrapResult.ok) {
        await this.#storage.saveLazyBootstrap(
          bootstrapResult.value.bootstrap,
          [syncGroup],
          tombstoneModelObjectKeys,
        );
        const syncGroupLoadStatus = this.#syncGroupLoadStatuses.get(syncGroup);
        if (syncGroupLoadStatus && !syncGroupLoadStatus.loaded) {
          this.#syncGroupLoadStatuses.set(syncGroup, { loaded: true });
          for (const listener of syncGroupLoadStatus.listeners) {
            listener();
          }
        }
      } else {
        console.error('Failed to bootstrap new sync group');
        // TODO: Retry partial bootstrap?
      }
    }
  }

  private isSyncGroupLoaded(syncGroup: MS['syncGroup']): IsLoadedResult {
    const status = this.#syncGroupLoadStatuses.get(syncGroup);
    if (!status) {
      console.error(`Sync group "${syncGroup}" not found`);
      return { loaded: true };
    }

    if (status.loaded) {
      return { loaded: true };
    }

    const promise = new Promise<void>((resolve) => {
      status.listeners.add(resolve);
    });

    return {
      loaded: false,
      promise,
    };
  }

  addSyncGroupsFromStorage(syncGroups: MS['syncGroup'][]) {
    if (!this.#config.syncGroupDefs) {
      console.error(
        'Cannot add new sync groups if no syncGroupDefs are defined in config',
      );
      return;
    }

    for (const syncGroup of syncGroups) {
      this.#syncGroupLoadStatuses.set(syncGroup, { loaded: true });

      const models =
        this.#config.syncGroupDefs.modelsForPartialBootstrap(syncGroup);
      for (const model of models) {
        const lazyData = this.#lazyModelsToSyncGroups.get(model);
        if (lazyData) {
          lazyData.push(syncGroup);
        } else {
          this.#lazyModelsToSyncGroups.set(model, [syncGroup]);
        }
      }
    }
  }

  isModelLoaded(modelName: keyof MS['models'] & string): IsLoadedResult {
    if (this.#eagerModels.has(modelName)) {
      return { loaded: true };
    }

    const syncGroups = this.#lazyModelsToSyncGroups.get(modelName);
    if (!syncGroups) {
      console.error(
        `Model "${modelName}" isn't part of initial bootstrap or any sync groups, so can't be loaded`,
      );
      return { loaded: false, promise: Promise.resolve() };
    }

    const promises: Promise<any>[] = [];
    for (const syncGroup of syncGroups) {
      const loadResult = this.isSyncGroupLoaded(syncGroup);
      if (!loadResult.loaded) {
        promises.push(loadResult.promise);
      }
    }
    if (promises.length > 0) {
      return { loaded: false, promise: Promise.all(promises) };
    }

    return { loaded: true };
  }
}

export type IsLoadedResult =
  | {
      loaded: true;
    }
  | {
      loaded: false;
      promise: Promise<any>;
    };
