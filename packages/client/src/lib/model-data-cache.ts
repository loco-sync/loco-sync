import type { ModelsSpec } from './core';
import { createModelDataStore, type ModelDataStore } from './model-data-store';
import type { QueryObserver } from './query-observers';
import type { StorageAdapter } from './storage';
import type { ToProcessMessage } from './transactionUtils';

type AnyQueryObserver<MS extends ModelsSpec> = QueryObserver<MS, any, any>;

export class ModelDataCache<MS extends ModelsSpec> {
  #store: ModelDataStore<MS['models']>;
  #storage: StorageAdapter<MS>;
  #observers: Set<AnyQueryObserver<MS>> = new Set();
  #bootstrapped = false;

  constructor(storage: StorageAdapter<MS>) {
    this.#store = createModelDataStore();
    this.#storage = storage;
  }

  getStore() {
    return this.#store;
  }

  async addObserver(observer: AnyQueryObserver<MS>): Promise<void> {
    this.#observers.add(observer);
    if (this.#bootstrapped) {
      return;
    }

    this.#bootstrapped = true;
    // TODO: Incremental load based on observer data
    const bootstrap = await this.#storage.loadBootstrap();
    this.#store.loadBootstrap(bootstrap);
  }

  async removeObserver(observer: AnyQueryObserver<MS>) {
    // TODO: Probably some sort of timeout thing?
    // TODO: Remove data that was only associated with this observer
    this.#observers.delete(observer);
  }

  processMessage = (message: ToProcessMessage<MS['models']>) => {
    // TODO: Filter messages based on observers
    this.#store.processMessage(message);
  };
}
