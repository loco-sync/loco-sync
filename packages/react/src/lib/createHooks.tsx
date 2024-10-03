import React, {
  type ReactNode,
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from 'react';
import { LocoSyncClient, Query } from '@loco-sync/client';
import type {
  ModelRelationshipSelection,
  ModelFilter,
  ModelResult,
  MutationFn,
  ModelsSpec,
  ModelsConfig,
  ModelDataCache,
  QueryManyResult,
  QueryOneResult,
} from '@loco-sync/client';
import { useSyncExternalStore } from 'use-sync-external-store/shim';

export type UseMutation<MS extends ModelsSpec> = {
  mutate: MutationFn<MS>;
};

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
    ): QueryManyResult<MS, ModelName, undefined>;

    <
      ModelName extends keyof MS['models'] & string,
      Selection extends ModelRelationshipSelection<
        MS['models'],
        MS['relationshipDefs'],
        ModelName
      >,
    >(
      modelName: ModelName,
      modelFilter: ModelFilter<MS['models'], ModelName> | undefined,
      selection: Selection,
    ): QueryManyResult<MS, ModelName, Selection>;
  };
  useQueryOne: {
    <ModelName extends keyof MS['models'] & string>(
      modelName: ModelName,
      modelFilter?: ModelFilter<MS['models'], ModelName>,
    ): QueryOneResult<MS, ModelName, undefined>;
    <
      ModelName extends keyof MS['models'] & string,
      Selection extends ModelRelationshipSelection<
        MS['models'],
        MS['relationshipDefs'],
        ModelName
      >,
    >(
      modelName: ModelName,
      modelFilter: ModelFilter<MS['models'], ModelName> | undefined,
      selection: Selection,
    ): QueryOneResult<MS, ModelName, Selection>;
  };
  useMutation(): UseMutation<MS>;
  useIsHydrated: () => boolean;
  useClient: () => LocoSyncClient<MS>;
}

type InternalContext<MS extends ModelsSpec> = {
  isHydrated: boolean;
  client: LocoSyncClient<MS> | undefined;
};

export const createLocoSyncReact = <MS extends ModelsSpec>(
  config: ModelsConfig<MS>,
): LocoSyncReact<MS> => {
  type M = MS['models'];
  type R = MS['relationshipDefs'];
  const relationshipDefs: R = config.relationshipDefs ?? {};

  const context = createContext<InternalContext<MS>>({
    isHydrated: false,
    client: undefined,
  });
  const useContext = () => React.useContext(context);

  const Provider: LocoSyncReactProvider<MS> = (props) => {
    const [isHydrated, setIsHydrated] = useState(false);
    const client = props.client;

    useEffect(() => {
      const unsubscribe = client.addListener((payload) => {
        if (payload.type === 'started') {
          setIsHydrated(true);
        }
      });

      client.start();

      return () => {
        client.stop();
        unsubscribe();
        setIsHydrated(false);
      };
    }, [client]);

    if (props.notHydratedFallback !== undefined && !isHydrated) {
      return <>{props.notHydratedFallback}</>;
    }

    return (
      <context.Provider
        value={{
          isHydrated,
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
  ): QueryManyResult<MS, ModelName, Selection> => {
    const cache = useContext().client?.getCache();
    if (!cache) {
      throw new Error('LocoSync context provider not found.');
    }
    return useQueryManyFromStore(cache, modelName, modelFilter, selection);
  };

  const useQueryOne = <
    ModelName extends keyof M & string,
    Selection extends ModelRelationshipSelection<M, R, ModelName>,
  >(
    modelName: ModelName,
    modelFilter?: ModelFilter<M, ModelName>,
    selection?: Selection,
  ): QueryOneResult<MS, ModelName, Selection> => {
    const cache = useContext().client?.getCache();
    if (!cache) {
      throw new Error('LocoSync context provider not found.');
    }
    return useQueryOneFromStore(cache, modelName, modelFilter, selection);
  };

  const useMutation: LocoSyncReact<MS>['useMutation'] = () => {
    const client = useContext().client;
    if (!client) {
      throw new Error('LocoSync context provider not found.');
    }
    return useMemo(
      () => ({
        mutate: (args, options) => {
          client.addMutation(args, options);
        },
      }),
      [client],
    );
  };

  const useIsHydrated = () => {
    return useContext().isHydrated;
  };

  const useClient = () => {
    const client = useContext().client;
    if (!client) {
      throw new Error('LocoSync context provider not found.');
    }
    return client;
  };

  return {
    Provider,
    useQuery,
    useQueryOne,
    useMutation,
    useIsHydrated,
    useClient,
  };
};

const useQueryOneFromStore = <
  MS extends ModelsSpec,
  ModelName extends keyof MS['models'] & string,
  Selection extends ModelRelationshipSelection<
    MS['models'],
    MS['relationshipDefs'],
    ModelName
  >,
>(
  cache: ModelDataCache<MS>,
  modelName: ModelName,
  modelFilter: ModelFilter<MS['models'], ModelName> | undefined,
  selection?: Selection,
): QueryOneResult<MS, ModelName, Selection> => {
  const queryRef = useRef<Query<MS, ModelName, Selection>>();

  if (
    !queryRef.current ||
    queryRef.current.modelName !== modelName ||
    JSON.stringify(queryRef.current.modelFilter) !==
      JSON.stringify(modelFilter) ||
    JSON.stringify(queryRef.current.selection) !== JSON.stringify(selection)
  ) {
    const newQuery = new Query(modelName, modelFilter, selection);
    queryRef.current = newQuery;
    cache.addQuery(newQuery);
  }
  const query = queryRef.current;

  return useSyncExternalStore(
    useCallback(
      (cb) => {
        const unsubscribe = query.subscribe(cb);
        return () => {
          unsubscribe();
          cache.removeQuery(query);
        };
      },
      [query, cache],
    ),
    useCallback(() => query.getSnapshotOne(), [query]),
  );
};

const useQueryManyFromStore = <
  MS extends ModelsSpec,
  ModelName extends keyof MS['models'] & string,
  Selection extends ModelRelationshipSelection<
    MS['models'],
    MS['relationshipDefs'],
    ModelName
  >,
>(
  cache: ModelDataCache<MS>,
  modelName: ModelName,
  modelFilter: ModelFilter<MS['models'], ModelName> | undefined,
  selection?: Selection,
): QueryManyResult<MS, ModelName, Selection> => {
  const queryRef = useRef<Query<MS, ModelName, Selection>>();

  if (
    !queryRef.current ||
    queryRef.current.modelName !== modelName ||
    JSON.stringify(queryRef.current.modelFilter) !==
      JSON.stringify(modelFilter) ||
    JSON.stringify(queryRef.current.selection) !== JSON.stringify(selection)
  ) {
    const newObserver = new Query(modelName, modelFilter, selection);
    queryRef.current = newObserver;
    cache.addQuery(newObserver);
  }
  const query = queryRef.current;

  return useSyncExternalStore(
    useCallback(
      (cb) => {
        const unsubscribe = query.subscribe(cb);
        return () => {
          unsubscribe();
          cache.removeQuery(query);
        };
      },
      [query, cache],
    ),
    useCallback(() => query.getSnapshotMany(), [query]),
  );
};
