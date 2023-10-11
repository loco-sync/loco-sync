import type {
  SyncAction,
  Models,
  MutationArgs,
  BootstrapPayload,
  ModelsConfig,
} from './core';
import type { Result } from './typeUtils';

// TODO: Could include some function here to check whether we're online / a callback to detect if we change online/offline?
export interface NetworkClient<M extends Models, MC extends ModelsConfig<M>> {
  sendTransaction(args: MutationArgs<M, MC>): Promise<SendTransactionResult>;
  deltaSync(fromSyncId: number, toSyncId: number): Promise<DeltaSyncResult<M>>;
  loadBootstrap(): Promise<LoadBootstrapResult<M>>;

  // Does this need to return anything?
  // Could these args change on re-connections?
  initHandshake(data: any): void;
  addListener(callback: SocketEventCallback<M>): () => void;
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

type HandshakeRequest<Data> = {
  type: 'handshake';
  data: Data;
  // userId: string;
  // TODO: What else? Make generic? Just forward everything along?
};

type HandshakeResponse = {
  type: 'handshake';
  modelSchemaVersion: number;
  lastSyncId: number;
  // TODO: Maybe some auth stuff?
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
  event: SocketEvent<M>
) => void;
