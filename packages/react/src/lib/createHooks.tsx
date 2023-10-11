import React, {
  type ReactNode,
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  LocoSyncClient,
  getStateUpdate,
  getMutationLocalChanges,
} from '@loco-sync/client';
import type {
  ModelsRelationshipDefs,
  ModelRelationshipSelection,
  ModelFilter,
  Models,
  ModelId,
  ModelResult,
  MutationFn,
  ToProcessMessage,
  ModelsConfig,
  ExtractModelsRelationshipDefs,
} from '@loco-sync/client';
import { type LocoSyncReactStore, createLocoSyncReactStore } from './store';
import { QueryManyWatcher, QueryOneWatcher } from './watchers';
import { useSyncExternalStore } from 'use-sync-external-store/shim';

export interface LocoSyncReactProviderProps {
  children: ReactNode;
}

export type LocoSyncReactProvider = (
  props: LocoSyncReactProviderProps
) => JSX.Element;

export interface LocoSyncReact<M extends Models, MC extends ModelsConfig<M>> {
  Provider: LocoSyncReactProvider;
  useQuery: {
    <ModelName extends keyof M & string>(
      modelName: ModelName,
      modelFilter?: ModelFilter<M, ModelName>
    ): ModelResult<
      M,
      ExtractModelsRelationshipDefs<M, MC>,
      ModelName,
      undefined
    >[];

    <
      ModelName extends keyof M & string,
      Selection extends ModelRelationshipSelection<
        M,
        ExtractModelsRelationshipDefs<M, MC>,
        ModelName
      >
    >(
      modelName: ModelName,
      modelFilter: ModelFilter<M, ModelName> | undefined,
      selection: Selection
    ): ModelResult<
      M,
      ExtractModelsRelationshipDefs<M, MC>,
      ModelName,
      Selection
    >[];
  };
  useQueryOne: {
    <ModelName extends keyof M & string>(
      modelName: ModelName,
      modelId: ModelId
    ):
      | ModelResult<
          M,
          ExtractModelsRelationshipDefs<M, MC>,
          ModelName,
          Record<string, never>
        >
      | undefined;

    <
      ModelName extends keyof M & string,
      Selection extends ModelRelationshipSelection<
        M,
        ExtractModelsRelationshipDefs<M, MC>,
        ModelName
      >
    >(
      modelName: ModelName,
      modelId: ModelId,
      selection: Selection
    ):
      | ModelResult<
          M,
          ExtractModelsRelationshipDefs<M, MC>,
          ModelName,
          Selection
        >
      | undefined;
  };
  useMutation(): [MutationFn<M, MC>];
  useIsHydrated: () => boolean;
}

export const createLocoSyncReact = <
  M extends Models,
  MC extends ModelsConfig<M>
>(
  syncClient: LocoSyncClient<M, MC>,
  config: MC
): LocoSyncReact<M, MC> => {
  type R = ExtractModelsRelationshipDefs<M, MC>;
  const relationshipDefs: R = config.relationshipDefs ?? {};

  const store = createLocoSyncReactStore<M>();
  const context = createContext({
    isHydrated: false,
  });
  const useContext = () => React.useContext(context);

  const Provider: LocoSyncReactProvider = (props) => {
    const [isHydrated, setIsHydrated] = useState(false);

    const [toProcessMessages, setToProcessMessages] = useState<
      ToProcessMessage<M>[]
    >([]);

    useEffect(() => {
      let syncUnsubscribe: (() => void) | undefined;
      let localChangeUnsubscribe: (() => void) | undefined;
      (async () => {
        syncUnsubscribe = syncClient.addSyncListener((lastSyncId, sync) => {
          setToProcessMessages((state) =>
            state.concat({ type: 'sync', lastSyncId, sync })
          );
        });

        const { unsubscribe, initialized } = syncClient.addLocalChangeListener(
          (payload) => {
            if (payload.type === 'start') {
              setToProcessMessages((state) =>
                state.concat({
                  type: 'startTransaction',
                  transactionId: payload.clientTransactionId,
                  changes: getMutationLocalChanges(config, payload.args),
                })
              );
            } else if (payload.type === 'commit') {
              setToProcessMessages((state) =>
                state.concat({
                  type: 'commitTransaction',
                  transactionId: payload.clientTransactionId,
                  lastSyncId: payload.lastSyncId,
                })
              );
            } else if (payload.type === 'rollback') {
              setToProcessMessages((state) =>
                state.concat({
                  type: 'rollbackTransaction',
                  transactionId: payload.clientTransactionId,
                })
              );
            } else if (payload.type === 'bootstrap') {
              store.loadBootstrap(payload.bootstrap);
              setIsHydrated(true);
              syncClient.startSync();
            }
          }
        );

        localChangeUnsubscribe = unsubscribe;
        if (initialized) {
          const bootstrap = await syncClient.loadLocalBootstrap();
          store.loadBootstrap(bootstrap);
          setIsHydrated(true);
          syncClient.startSync();
        }
      })();

      return () => {
        if (syncUnsubscribe) {
          syncUnsubscribe();
        }
        if (localChangeUnsubscribe) {
          localChangeUnsubscribe();
        }
      };
    }, []);

    // If there are any messages to process, take the first one from the list
    useEffect(() => {
      if (!isHydrated) {
        return;
      }

      const [first, ...rest] = toProcessMessages;
      if (first) {
        const update = getStateUpdate(
          {
            lastSyncId: store.lastSyncId(),
            pendingTransactions: store.pendingTransactions(),
            getData: store.getConfirmedData,
            getChangeSnapshots: store.getChangeSnapshots,
          },
          first
        );
        if (update) {
          store.update(update);
        }

        setToProcessMessages(rest);
      }
    }, [isHydrated, toProcessMessages]);

    return (
      <context.Provider
        value={{
          isHydrated,
        }}
      >
        {props.children}
      </context.Provider>
    );
  };

  const useQuery = <
    ModelName extends keyof M & string,
    Selection extends ModelRelationshipSelection<M, R, ModelName>
  >(
    modelName: ModelName,
    modelFilter?: ModelFilter<M, ModelName>,
    selection?: Selection
  ): ModelResult<M, R, ModelName, Selection>[] => {
    return useQueryManyFromStore(
      store,
      relationshipDefs,
      modelName,
      modelFilter,
      selection
    );
  };

  const useQueryOne = <
    ModelName extends keyof M & string,
    Selection extends ModelRelationshipSelection<M, R, ModelName>
  >(
    modelName: ModelName,
    modelId: string,
    selection?: Selection
  ): ModelResult<M, R, ModelName, Selection> | undefined => {
    return useQueryOneFromStore(
      store,
      relationshipDefs,
      modelName,
      modelId,
      selection
    );
  };

  const useMutation: LocoSyncReact<M, MC>['useMutation'] = () => {
    const mutationFn: MutationFn<M, MC> = useCallback((args) => {
      syncClient.addMutation(args);
    }, []);
    return [mutationFn];
  };

  const useIsHydrated = () => {
    const context = useContext();
    return context.isHydrated;
  };

  return {
    Provider,
    useQuery,
    useQueryOne,
    useMutation,
    useIsHydrated,
  };
};

const useQueryOneFromStore = <
  M extends Models,
  R extends ModelsRelationshipDefs<M>,
  ModelName extends keyof M & string,
  Selection extends ModelRelationshipSelection<M, R, ModelName>
>(
  store: LocoSyncReactStore<M>,
  relationshipDefs: R,
  modelName: ModelName,
  modelId: string,
  selection?: Selection
): ModelResult<M, R, ModelName, Selection> | undefined => {
  const watcherRef = useRef<QueryOneWatcher<M, R, ModelName, Selection>>();
  if (!watcherRef.current) {
    watcherRef.current = new QueryOneWatcher(
      store,
      relationshipDefs,
      modelName,
      modelId,
      selection
    );
  }
  const watcher = watcherRef.current;

  const invariantCheck = useRef(false);
  useEffect(() => {
    if (invariantCheck.current) {
      console.error(
        'The following args should not change per hook call, and changes are ignored: store, modelName, selection, relationshipDefs'
      );
    }
    invariantCheck.current = true;
  }, [store, modelName, JSON.stringify(selection), relationshipDefs]);

  return useSyncExternalStore(
    useCallback(() => {
      watcher.subscribe();
      return () => watcher.unsubscribe();
    }, [modelId]),
    () => watcher.getCurrentResults()
  );
};

const useQueryManyFromStore = <
  M extends Models,
  R extends ModelsRelationshipDefs<M>,
  ModelName extends keyof M & string,
  Selection extends ModelRelationshipSelection<M, R, ModelName>
>(
  store: LocoSyncReactStore<M>,
  relationshipDefs: R,
  modelName: ModelName,
  modelFilter: ModelFilter<M, ModelName> | undefined,
  selection?: Selection
): ModelResult<M, R, ModelName, Selection>[] => {
  const watcherRef = useRef<QueryManyWatcher<M, R, ModelName, Selection>>();
  if (!watcherRef.current) {
    watcherRef.current = new QueryManyWatcher(
      store,
      relationshipDefs,
      modelName,
      modelFilter,
      selection
    );
  }
  const watcher = watcherRef.current;

  const invariantCheck = useRef(false);
  useEffect(() => {
    if (invariantCheck.current) {
      console.error(
        'The following args should not change per hook call, and changes are ignored: store, modelName, selection, relationshipDefs'
      );
    }
    invariantCheck.current = true;
  }, [store, modelName, JSON.stringify(selection), relationshipDefs]);

  return useSyncExternalStore(
    useCallback(() => {
      watcher.subscribe();
      return () => watcher.unsubscribe();
    }, [JSON.stringify(modelFilter)]),
    () => watcher.getCurrentResults()
  );
};
