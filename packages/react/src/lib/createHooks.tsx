import React, {
  type ReactNode,
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { LocoSyncClient, getMutationLocalChanges } from '@loco-sync/client';
import type {
  ModelsRelationshipDefs,
  ModelRelationshipSelection,
  ModelFilter,
  Models,
  ModelId,
  ModelResult,
  MutationFn,
  ExtractModelsRelationshipDefs,
  ModelsSpec,
  ModelsConfig,
} from '@loco-sync/client';
import { type LocoSyncReactStore, createLocoSyncReactStore } from './store';
import { QueryManyWatcher, QueryOneWatcher } from './watchers';
import { useSyncExternalStore } from 'use-sync-external-store/shim';

export interface LocoSyncReactProviderProps {
  notHydratedFallback?: ReactNode;
  children: ReactNode;
}

export type LocoSyncReactProvider = (
  props: LocoSyncReactProviderProps,
) => JSX.Element;

export interface LocoSyncReact<MS extends ModelsSpec> {
  Provider: LocoSyncReactProvider;
  useQuery: {
    <ModelName extends keyof MS['models'] & string>(
      modelName: ModelName,
      modelFilter?: ModelFilter<MS['models'], ModelName>,
    ): ModelResult<
      MS['models'],
      ExtractModelsRelationshipDefs<MS>,
      ModelName,
      undefined
    >[];

    <
      ModelName extends keyof MS['models'] & string,
      Selection extends ModelRelationshipSelection<
        MS['models'],
        ExtractModelsRelationshipDefs<MS>,
        ModelName
      >,
    >(
      modelName: ModelName,
      modelFilter: ModelFilter<MS['models'], ModelName> | undefined,
      selection: Selection,
    ): ModelResult<
      MS['models'],
      ExtractModelsRelationshipDefs<MS>,
      ModelName,
      Selection
    >[];
  };
  useQueryOne: {
    <ModelName extends keyof MS['models'] & string>(
      modelName: ModelName,
      modelId: ModelId,
    ):
      | ModelResult<
          MS['models'],
          ExtractModelsRelationshipDefs<MS>,
          ModelName,
          {}
        >
      | undefined;

    <
      ModelName extends keyof MS['models'] & string,
      Selection extends ModelRelationshipSelection<
        MS['models'],
        ExtractModelsRelationshipDefs<MS>,
        ModelName
      >,
    >(
      modelName: ModelName,
      modelId: ModelId,
      selection: Selection,
    ):
      | ModelResult<
          MS['models'],
          ExtractModelsRelationshipDefs<MS>,
          ModelName,
          Selection
        >
      | undefined;
  };
  useMutation(): [MutationFn<MS>];
  useIsHydrated: () => boolean;
}

export const createLocoSyncReact = <MS extends ModelsSpec>(
  syncClient: LocoSyncClient<MS>,
  config: ModelsConfig<MS>,
): LocoSyncReact<MS> => {
  type M = MS['models'];
  type R = ExtractModelsRelationshipDefs<MS>;
  const relationshipDefs: R = config.relationshipDefs ?? {};

  const store = createLocoSyncReactStore<M>();
  const context = createContext({
    isHydrated: false,
  });
  const useContext = () => React.useContext(context);

  const Provider: LocoSyncReactProvider = (props) => {
    const [isHydrated, setIsHydrated] = useState(false);

    useEffect(() => {
      let syncUnsubscribe: (() => void) | undefined;
      let localChangeUnsubscribe: (() => void) | undefined;
      (async () => {
        syncUnsubscribe = syncClient.addSyncListener((lastSyncId, sync) => {
          store.processMessage({ type: 'sync', lastSyncId, sync });
        });

        const { unsubscribe, initialized } = syncClient.addLocalChangeListener(
          (payload) => {
            if (payload.type === 'start') {
              store.processMessage({
                type: 'startTransaction',
                transactionId: payload.clientTransactionId,
                changes: getMutationLocalChanges(config, payload.args),
              });
            } else if (payload.type === 'commit') {
              store.processMessage({
                type: 'commitTransaction',
                transactionId: payload.clientTransactionId,
                lastSyncId: payload.lastSyncId,
              });
            } else if (payload.type === 'rollback') {
              store.processMessage({
                type: 'rollbackTransaction',
                transactionId: payload.clientTransactionId,
              });
            } else if (payload.type === 'bootstrap') {
              store.loadBootstrap(payload.bootstrap);
              setIsHydrated(true);
              syncClient.startSync();
            }
          },
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

    if (props.notHydratedFallback && !isHydrated) {
      return <>{props.notHydratedFallback}</>;
    }

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
    Selection extends ModelRelationshipSelection<M, R, ModelName>,
  >(
    modelName: ModelName,
    modelFilter?: ModelFilter<M, ModelName>,
    selection?: Selection,
  ): ModelResult<M, R, ModelName, Selection>[] => {
    return useQueryManyFromStore(
      store,
      relationshipDefs,
      modelName,
      modelFilter,
      selection,
    );
  };

  const useQueryOne = <
    ModelName extends keyof M & string,
    Selection extends ModelRelationshipSelection<M, R, ModelName>,
  >(
    modelName: ModelName,
    modelId: string,
    selection?: Selection,
  ): ModelResult<M, R, ModelName, Selection> | undefined => {
    return useQueryOneFromStore(
      store,
      relationshipDefs,
      modelName,
      modelId,
      selection,
    );
  };

  const useMutation: LocoSyncReact<MS>['useMutation'] = () => {
    const mutationFn: MutationFn<MS> = useCallback((args) => {
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
  Selection extends ModelRelationshipSelection<M, R, ModelName>,
>(
  store: LocoSyncReactStore<M>,
  relationshipDefs: R,
  modelName: ModelName,
  modelId: string,
  selection?: Selection,
): ModelResult<M, R, ModelName, Selection> | undefined => {
  const watcherRef = useRef<QueryOneWatcher<M, R, ModelName, Selection>>();
  if (!watcherRef.current) {
    watcherRef.current = new QueryOneWatcher(
      store,
      relationshipDefs,
      modelName,
      selection,
    );
  }
  const watcher = watcherRef.current;

  const invariantCheck = useRef(false);
  useEffect(() => {
    if (invariantCheck.current) {
      console.warn(
        'The following args should not change per hook call, and changes are ignored: store, modelName, selection, relationshipDefs',
      );
    }
    invariantCheck.current = true;
  }, [store, modelName, JSON.stringify(selection), relationshipDefs]);

  return useSyncExternalStore(
    useCallback((cb) => watcher.subscribe(cb, modelId), [modelId]),
    useCallback(() => watcher.getSnapshot(), []),
  );
};

// TODO: I don't think this will work properly if modelFilter changes
const useQueryManyFromStore = <
  M extends Models,
  R extends ModelsRelationshipDefs<M>,
  ModelName extends keyof M & string,
  Selection extends ModelRelationshipSelection<M, R, ModelName>,
>(
  store: LocoSyncReactStore<M>,
  relationshipDefs: R,
  modelName: ModelName,
  modelFilter: ModelFilter<M, ModelName> | undefined,
  selection?: Selection,
): ModelResult<M, R, ModelName, Selection>[] => {
  const watcherRef = useRef<QueryManyWatcher<M, R, ModelName, Selection>>();
  if (!watcherRef.current) {
    watcherRef.current = new QueryManyWatcher(
      store,
      relationshipDefs,
      modelName,
      selection,
    );
  }
  const watcher = watcherRef.current;

  const invariantCheck = useRef(false);
  useEffect(() => {
    if (invariantCheck.current) {
      console.warn(
        'The following args should not change per hook call, and changes are ignored: store, modelName, selection, relationshipDefs',
      );
    }
    invariantCheck.current = true;
  }, [store, modelName, JSON.stringify(selection), relationshipDefs]);

  return useSyncExternalStore(
    useCallback(
      (cb) => watcher.subscribe(cb, modelFilter),
      [JSON.stringify(modelFilter)],
    ),
    useCallback(() => watcher.getSnapshot(), []),
  );
};
