import React, {
  type ReactNode,
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from 'react';
import { LocoSyncClient, QueryObserver } from '@loco-sync/client';
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

  return {
    Provider,
    useQuery,
    useQueryOne,
    useMutation,
    useIsHydrated,
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
  const observerRef = useRef<QueryObserver<MS, ModelName, Selection>>();

  if (
    !observerRef.current ||
    observerRef.current.modelName !== modelName ||
    JSON.stringify(observerRef.current.modelFilter) !==
      JSON.stringify(modelFilter) ||
    JSON.stringify(observerRef.current.selection) !== JSON.stringify(selection)
  ) {
    observerRef.current = new QueryObserver(
      cache,
      modelName,
      modelFilter,
      selection,
    );
  }
  const observer = observerRef.current;

  return useSyncExternalStore(
    useCallback((cb) => observer.subscribe(cb), [observer]),
    useCallback(() => observer.getSnapshotOne(), [observer]),
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
  const observerRef = useRef<QueryObserver<MS, ModelName, Selection>>();

  if (
    !observerRef.current ||
    observerRef.current.modelName !== modelName ||
    JSON.stringify(observerRef.current.modelFilter) !==
      JSON.stringify(modelFilter) ||
    JSON.stringify(observerRef.current.selection) !== JSON.stringify(selection)
  ) {
    observerRef.current = new QueryObserver(
      cache,
      modelName,
      modelFilter,
      selection,
    );
  }
  const observer = observerRef.current;

  return useSyncExternalStore(
    useCallback((cb) => observer.subscribe(cb), [observer]),
    useCallback(() => observer.getSnapshotMany(), [observer]),
  );
};
