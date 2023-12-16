import React, {
  type ReactNode,
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
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

export interface LocoSyncReactProviderProps<MS extends ModelsSpec> {
  client: LocoSyncClient<MS>;
  notHydratedFallback?: ReactNode;
  children: ReactNode;
}

export type LocoSyncReactProvider<MS extends ModelsSpec> = (
  props: LocoSyncReactProviderProps<MS>,
) => JSX.Element;

export interface LocoSyncReact<MS extends ModelsSpec> {
  Provider: LocoSyncReactProvider<MS>;
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

type InternalContext<MS extends ModelsSpec> = {
  isHydrated: boolean;
  store: LocoSyncReactStore<MS['models']> | undefined;
  client: LocoSyncClient<MS> | undefined;
};

export const createLocoSyncReact = <MS extends ModelsSpec>(
  config: ModelsConfig<MS>,
): LocoSyncReact<MS> => {
  type M = MS['models'];
  type R = ExtractModelsRelationshipDefs<MS>;
  const relationshipDefs: R = config.relationshipDefs ?? {};

  const context = createContext<InternalContext<MS>>({
    isHydrated: false,
    store: undefined,
    client: undefined,
  });
  const useContext = () => React.useContext(context);

  const Provider: LocoSyncReactProvider<MS> = (props) => {
    const [isHydrated, setIsHydrated] = useState(false);
    const client = props.client;
    const store = useMemo(() => createLocoSyncReactStore(), [client]);

    useEffect(() => {
      const unsubscribe = client.addListener((payload) => {
        if (payload.type === 'sync') {
          store.processMessage({
            type: 'sync',
            lastSyncId: payload.lastSyncId,
            sync: payload.sync,
          });
        } else if (payload.type === 'startTransaction') {
          store.processMessage({
            type: 'startTransaction',
            transactionId: payload.clientTransactionId,
            changes: getMutationLocalChanges(config, payload.args),
          });
        } else if (payload.type === 'commitTransaction') {
          store.processMessage({
            type: 'commitTransaction',
            transactionId: payload.clientTransactionId,
            lastSyncId: payload.lastSyncId,
          });
        } else if (payload.type === 'rollbackTransaction') {
          store.processMessage({
            type: 'rollbackTransaction',
            transactionId: payload.clientTransactionId,
          });
        } else if (payload.type === 'bootstrap') {
          store.loadBootstrap(payload.bootstrap);
          setIsHydrated(true);
        }
      });

      client.start();

      return () => {
        // TODO: Any cleanup needed on "store"?
        client.stop();
        unsubscribe();
        setIsHydrated(false);
      };
    }, [client, store]);

    if (props.notHydratedFallback && !isHydrated) {
      return <>{props.notHydratedFallback}</>;
    }

    return (
      <context.Provider
        value={{
          isHydrated,
          store,
          client,
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
    const store = useContext().store;
    if (!store) {
      throw new Error('LocoSync context provider not found.');
    }
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
    const store = useContext().store;
    if (!store) {
      throw new Error('LocoSync context provider not found.');
    }
    return useQueryOneFromStore(
      store,
      relationshipDefs,
      modelName,
      modelId,
      selection,
    );
  };

  const useMutation: LocoSyncReact<MS>['useMutation'] = () => {
    const client = useContext().client;
    if (!client) {
      throw new Error('LocoSync context provider not found.');
    }
    const mutationFn: MutationFn<MS> = useCallback(
      (args) => {
        client.addMutation(args);
      },
      [client],
    );
    return [mutationFn];
  };

  const useIsHydrated = () => {
    return useContext().isHydrated;
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

  if (
    !watcherRef.current ||
    watcherRef.current.store !== store ||
    watcherRef.current.relationshipDefs !== relationshipDefs
  ) {
    watcherRef.current = new QueryOneWatcher(store, relationshipDefs);
  }
  const watcher = watcherRef.current;

  return useSyncExternalStore(
    useCallback(
      (cb) => watcher.subscribe(cb, modelName, modelId, selection),
      [watcher, modelName, modelId, JSON.stringify(selection)],
    ),
    useCallback(() => watcher.getSnapshot(), [watcher]),
  );
};

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

  if (
    !watcherRef.current ||
    watcherRef.current.store !== store ||
    watcherRef.current.relationshipDefs !== relationshipDefs
  ) {
    watcherRef.current = new QueryManyWatcher(store, relationshipDefs);
  }
  const watcher = watcherRef.current;

  return useSyncExternalStore(
    useCallback(
      (cb) => watcher.subscribe(cb, modelName, modelFilter, selection),
      [
        watcher,
        modelName,
        JSON.stringify(modelFilter),
        JSON.stringify(selection),
      ],
    ),
    useCallback(() => watcher.getSnapshot(), [watcher]),
  );
};
