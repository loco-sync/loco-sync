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
export interface NetworkClient<MS extends ModelsSpec> {
  sendTransaction(args: MutationArgs<MS>): Promise<SendTransactionResult>;
  deltaSync(
    fromSyncId: number,
    toSyncId: number,
  ): Promise<DeltaSyncResult<MS['models']>>;
  loadBootstrap(): Promise<LoadBootstrapResult<MS['models']>>;
  initHandshake(): Unsubscribe | undefined;
  addListener(callback: SocketEventCallback<MS['models']>): Unsubscribe;
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
  modelSchemaVersion: number;
  lastSyncId: number;
};

type SyncMessage<M extends Models> = {
  type: 'sync';
  lastSyncId: number;
  sync: SyncAction<M, keyof M & string>[];
};

type SocketDisconnected = {
  type: 'disconnected';
};

export type SocketEvent<M extends Models> =
  | SyncMessage<M>
  | HandshakeResponse
  | SocketDisconnected;

export type SocketEventCallback<M extends Models> = (
  event: SocketEvent<M>,
) => void;
