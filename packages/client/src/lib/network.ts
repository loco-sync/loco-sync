import type {
  SyncAction,
  MutationArgs,
  BootstrapPayload,
  ModelsSpec,
} from './core';
import type { Result } from './typeUtils';

type Unsubscribe = () => void;

// TODO: Could include some function here to check whether we're online / a callback to detect if we change online/offline?
export interface NetworkAdapter<MS extends ModelsSpec> {
  sendTransaction(args: MutationArgs<MS>): Promise<SendTransactionResult>;
  bootstrap(args: BootstrapArgs<MS>): Promise<BootstrapResult<MS>>;
  deltaSync(fromSyncId: number, toSyncId: number): Promise<DeltaSyncResult<MS>>;
  initSync(listener: SyncListener<MS>): Promise<Unsubscribe> | Unsubscribe;
}

type NetworkErrorType = 'auth' | 'network' | 'server';

export type SendTransactionResult = Result<{ lastSyncId: number }, NetworkErrorType>;

export type DeltaSyncResult<MS extends ModelsSpec> = Result<
  {
    sync: SyncAction<MS['models'], keyof MS['models'] & string>[];
  },
  NetworkErrorType
>;

export type BootstrapArgs<MS extends ModelsSpec> =
  | EagerBootstrapArgs<MS>
  | LazyBootstrapArgs<MS>;

export type EagerBootstrapArgs<MS extends ModelsSpec> = {
  type: 'eager';
  models: (keyof MS['models'] & string)[];
};

export type LazyBootstrapArgs<MS extends ModelsSpec> = {
  type: 'lazy';
  models: (keyof MS['models'] & string)[];
  syncGroups: MS['syncGroup'][];
};

export type BootstrapResult<MS extends ModelsSpec> = Result<
  {
    bootstrap: BootstrapPayload<MS['models']>;
    firstSyncId: number;
    syncGroups: MS['syncGroup'][];
  },
  NetworkErrorType
>;

type HandshakeResponse<MS extends ModelsSpec> = {
  type: 'handshake';
  lastSyncId: number;
  syncGroups: MS['syncGroup'][];
};

type SyncDataMessage<MS extends ModelsSpec> = {
  type: 'sync';
  lastSyncId: number;
  sync: SyncAction<MS['models'], keyof MS['models'] & string>[];
};

type Disconnected = {
  type: 'disconnected';
};

export type SyncMessage<MS extends ModelsSpec> =
  | SyncDataMessage<MS>
  | HandshakeResponse<MS>
  | Disconnected;

export type SyncListener<MS extends ModelsSpec> = (
  message: SyncMessage<MS>,
) => void;
