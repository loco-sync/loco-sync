import { type ModelsSpec, type ModelsConfig } from './core';
import type { ModelLoadingMessage } from './model-data-cache';
import type { NetworkAdapter } from './network';
import type { StorageAdapter } from './storage';

export class ModelDataLoader<MS extends ModelsSpec> {
  #config: ModelsConfig<MS>;
  #network: NetworkAdapter<MS>;
  #storage: StorageAdapter<MS>;

  #sendModelLoadingMessage: (message: ModelLoadingMessage<MS>) => void;

  #eagerModels: Set<keyof MS['models'] & string>;
  #syncGroups: MS['syncGroup'][];

  constructor(
    config: ModelsConfig<MS>,
    network: NetworkAdapter<MS>,
    storage: StorageAdapter<MS>,
    sendModelLoadingMessage: (message: ModelLoadingMessage<MS>) => void,
  ) {
    this.#config = config;
    this.#network = network;
    this.#storage = storage;
    this.#sendModelLoadingMessage = sendModelLoadingMessage;

    this.#eagerModels = new Set();
    this.#syncGroups = [];

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

    for (const currentGroup of this.#syncGroups) {
      if (
        !handshakeSyncGroups.some((newGroup) => equals(currentGroup, newGroup))
      ) {
        removedSyncGroups.push(currentGroup);
      }
    }
    for (const newGroup of handshakeSyncGroups) {
      if (
        !this.#syncGroups.some((currentGroup) => equals(currentGroup, newGroup))
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
   * TODO: May want to do some sort of batching here?
   * Should requests be made in parallel, or serially?
   * Or prioritizing models that a user is trying to show on the screen?
   *
   * @param syncGroups new syncGroups (via eager bootstrap result or handshake message)
   */
  async addNewSyncGroups(
    syncGroups: MS['syncGroup'][],
    tombstoneModelObjectKeys: Set<string>,
  ) {
    if (syncGroups.length === 0) {
      return;
    }
    if (!this.#config.syncGroupDefs) {
      console.error(
        'Cannot add new sync groups if no syncGroupDefs are defined in config',
      );
      return;
    }

    this.#syncGroups.push(...syncGroups);

    const syncGroupModels = new Map<
      MS['syncGroup'],
      Array<keyof MS['models'] & string>
    >();
    for (const syncGroup of syncGroups) {
      const models = this.#config.syncGroupDefs.lazyBootstrapModels(syncGroup);
      syncGroupModels.set(syncGroup, models);
      for (const model of models) {
        this.#sendModelLoadingMessage({
          type: 'modelDataLoading',
          syncGroup,
          modelName: model,
        });
      }
    }

    await Promise.all(
      syncGroups.map(async (syncGroup) => {
        const models = syncGroupModels.get(syncGroup) ?? [];
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
          for (const model of models) {
            this.#sendModelLoadingMessage({
              type: 'modelDataLoaded',
              syncGroup,
              modelName: model,
              data: bootstrapResult.value.bootstrap[model] ?? [],
            });
          }
        } else {
          console.error('Failed to bootstrap new sync group');
          // TODO: Retry partial bootstrap?
        }
      }),
    );
  }

  addSyncGroupsFromStorage(syncGroups: MS['syncGroup'][]) {
    if (syncGroups.length === 0) {
      return;
    }

    if (!this.#config.syncGroupDefs) {
      console.error(
        'Cannot add new sync groups if no syncGroupDefs are defined in config',
      );
      return;
    }

    this.#syncGroups.push(...syncGroups);
  }
}
