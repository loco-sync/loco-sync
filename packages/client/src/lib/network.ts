import type {
  SyncAction,
  Models,
  MutationArgs,
  BootstrapPayload,
  ModelsSpec,
} from './core';
import type { Result } from './typeUtils';

type Unsubscribe = () => void;

// TODO: Could include some function here to check whether we're online / a callback to detect if we change online/offline?
export interface NetworkAdapter<MS extends ModelsSpec> {
  sendTransaction(args: MutationArgs<MS>): Promise<SendTransactionResult>;
  deltaSync(
    fromSyncId: number,
    toSyncId: number,
  ): Promise<DeltaSyncResult<MS['models']>>;
  loadBootstrap(): Promise<LoadBootstrapResult<MS['models']>>;
  initSync(
    listener: NetworkMessageListener<MS['models']>,
  ): Promise<Unsubscribe> | Unsubscribe;
}

type NetworkErrorType = 'auth' | 'network' | 'server';

type SendTransactionResult = Result<{ lastSyncId: number }, NetworkErrorType>;

type DeltaSyncResult<M extends Models> = Result<
  {
    sync: SyncAction<M, keyof M & string>[];
  },
  NetworkErrorType
>;

type LoadBootstrapResult<M extends Models> = Result<
  { bootstrap: BootstrapPayload<M>; lastSyncId: number },
  NetworkErrorType
>;

type HandshakeResponse = {
  type: 'handshake';
  lastSyncId: number;
};

type SyncMessage<M extends Models> = {
  type: 'sync';
  lastSyncId: number;
  sync: SyncAction<M, keyof M & string>[];
};

type Disconnected = {
  type: 'disconnected';
};

export type NetworkMessage<M extends Models> =
  | SyncMessage<M>
  | HandshakeResponse
  | Disconnected;

export type NetworkMessageListener<M extends Models> = (
  event: NetworkMessage<M>,
) => void;
