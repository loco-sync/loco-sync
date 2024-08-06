import {
  type ModelsRelationshipDefs,
  one,
  many,
  type NetworkAdapter,
  type StorageAdapter,
} from '../index';

type M = {
  Group: {
    id: string;
    name: string;
  };
  Author: {
    id: string;
    name: string;
    groupId: string | null;
  };
  Post: {
    id: string;
    title: string;
    body: string;
    authorId: string;
  };
  Tag: {
    id: string;
    name: string;
  };
  PostTag: {
    id: string;
    postId: string;
    tagId: string;
  };
  PostTagAnnotation: {
    id: string;
    postId: string;
    tagId: string;
    annotation: string;
  };
};

type R = typeof relationshipDefs;

type SG =
  | {
      type: '1';
    }
  | {
      type: '2';
    }
  | {
      type: '3';
    };

export type MS = {
  models: M;
  relationshipDefs: R;
  syncGroup: SG;
};

export const relationshipDefs = {
  Post: {
    author: one('Author', {
      fields: ['authorId'],
      references: ['id'],
    }),
  },
  Author: {
    posts: many('Post', {
      fields: ['id'],
      references: ['authorId'],
    }),
  },
  Group: {
    authors: many('Author', {
      fields: ['id'],
      references: ['groupId'],
    }),
  },
  Tag: {},
  PostTag: {
    post: one('Post', {
      fields: ['postId'],
      references: ['id'],
    }),
    tag: one('Tag', {
      fields: ['tagId'],
      references: ['id'],
    }),
    annotations: many('PostTagAnnotation', {
      fields: ['postId', 'tagId'],
      references: ['postId', 'tagId'],
    }),
  },
} satisfies ModelsRelationshipDefs<M>;

export function controlledPromise<T>() {
  let resolve: (value: T | PromiseLike<T>) => void;
  let reject: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: resolve!, reject: reject! };
}

type ExpectedFnCall = NetworkFnCall | StorageFnCall;

type NetworkFnCall<
  Fn extends keyof NetworkAdapter<MS> = keyof NetworkAdapter<MS>,
> = {
  type: 'network';
  fn: Fn;
  params: Parameters<NetworkAdapter<MS>[Fn]>;
  result: ReturnType<NetworkAdapter<MS>[Fn]>;
  onParams?: (...params: Parameters<NetworkAdapter<MS>[Fn]>) => void;
};

type StorageFnCall<
  Fn extends keyof StorageAdapter<MS> = keyof StorageAdapter<MS>,
> = {
  type: 'storage';
  fn: keyof StorageAdapter<MS>;
  params: Parameters<StorageAdapter<MS>[Fn]>;
  result: ReturnType<StorageAdapter<MS>[Fn]>;
  onParams?: (...params: Parameters<StorageAdapter<MS>[Fn]>) => void;
};

type SetupOptions = {
  verbose?: boolean;
};

export const setup = (opts?: SetupOptions) => {
  const expectedFnCalls: Array<ExpectedFnCall> = [];
  let fnCallCount = 0;
  const verbose = opts?.verbose ?? false;

  const makeNetworkFn =
    <Fn extends keyof NetworkAdapter<MS>>(fn: Fn) =>
    (
      ...params: Parameters<NetworkAdapter<MS>[Fn]>
    ): ReturnType<NetworkAdapter<MS>[Fn]> => {
      fnCallCount++;
      const expectedCall = expectedFnCalls.shift();
      if (verbose) {
        console.log({
          expectedCall: expectedCall && {
            type: expectedCall.type,
            fn: expectedCall.fn,
            params: expectedCall.params,
          },
          actualCall: {
            type: 'network',
            fn,
            params,
          },
          result: expectedCall?.result,
          fnCallCount,
        });
      }
      if (!expectedCall) {
        throw new Error(
          `Unexpected call to network.${fn}, call #${fnCallCount}`,
        );
      }
      if (expectedCall.type !== 'network' || expectedCall.fn !== fn) {
        throw new Error(
          `Expected ${expectedCall.type}.${expectedCall.fn}, got network.${fn}, call #${fnCallCount}`,
        );
      }
      expect(params).toEqual(expectedCall.params);
      expectedCall.onParams?.(...params);
      return expectedCall.result as ReturnType<NetworkAdapter<MS>[Fn]>;
    };

  const network: NetworkAdapter<MS> = {
    sendTransaction: makeNetworkFn('sendTransaction'),
    deltaSync: makeNetworkFn('deltaSync'),
    bootstrap: makeNetworkFn('bootstrap'),
    initSync: makeNetworkFn('initSync'),
  };

  const makeStorageFn =
    <Fn extends keyof StorageAdapter<MS>>(fn: Fn) =>
    (
      ...params: Parameters<StorageAdapter<MS>[Fn]>
    ): ReturnType<StorageAdapter<MS>[Fn]> => {
      fnCallCount++;
      const expectedCall = expectedFnCalls.shift();
      if (verbose) {
        console.log({
          expectedCall: expectedCall && {
            type: expectedCall.type,
            fn: expectedCall.fn,
            params: expectedCall.params,
          },
          actualCall: {
            type: 'storage',
            fn,
            params,
          },
          result: expectedCall?.result,
          fnCallCount,
        });
      }
      if (!expectedCall) {
        throw new Error(
          `Unexpected call to storage.${fn}, call #${fnCallCount}`,
        );
      }
      if (expectedCall.type !== 'storage' || expectedCall.fn !== fn) {
        throw new Error(
          `Expected ${expectedCall.type}.${expectedCall.fn}, got storage.${fn}, call #${fnCallCount}`,
        );
      }
      expect(params).toEqual(expectedCall.params);

      expectedCall.onParams?.(...params);
      return expectedCall.result as ReturnType<StorageAdapter<MS>[Fn]>;
    };

  const storage: StorageAdapter<MS> = {
    getMetadataAndPendingTransactions: makeStorageFn(
      'getMetadataAndPendingTransactions',
    ),
    applySyncActions: makeStorageFn('applySyncActions'),
    createPendingTransaction: makeStorageFn('createPendingTransaction'),
    removePendingTransaction: makeStorageFn('removePendingTransaction'),
    // Types are weird because loadModelData is itself generic
    loadModelData: makeStorageFn(
      'loadModelData',
    ) as StorageAdapter<MS>['loadModelData'],
    saveEagerBootstrap: makeStorageFn('saveEagerBootstrap'),
    saveLazyBootstrap: makeStorageFn('saveLazyBootstrap'),
  };

  const addNetworkFnCall = <Fn extends keyof NetworkAdapter<MS>>(
    fn: Fn,
    params: Parameters<NetworkAdapter<MS>[Fn]>,
    result: ReturnType<NetworkAdapter<MS>[Fn]>,
    onParams?: (...params: Parameters<NetworkAdapter<MS>[Fn]>) => void,
  ) => {
    let fnCall: NetworkFnCall<Fn> = {
      type: 'network',
      fn,
      params,
      result,
      onParams,
    };
    expectedFnCalls.push(fnCall);
  };

  const addStorageFnCall = <Fn extends keyof StorageAdapter<MS>>(
    fn: Fn,
    params: Parameters<StorageAdapter<MS>[Fn]>,
    result: ReturnType<StorageAdapter<MS>[Fn]>,
    onParams?: (...params: Parameters<StorageAdapter<MS>[Fn]>) => void,
  ) => {
    let fnCall: StorageFnCall<Fn> = {
      type: 'storage',
      fn,
      params,
      result,
      onParams,
    };
    expectedFnCalls.push(fnCall);
  };

  return {
    storage,
    network,
    addNetworkFnCall,
    addStorageFnCall,
  };
};
