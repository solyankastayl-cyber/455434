/**
 * Ethereum Onchain Module
 * ERC-20 Transfer indexing via Infura RPC
 */

// RPC Client
export { EthereumRpc, type EthLog, type EthBlock, type GetLogsParams } from './ethereum.rpc.js';

// Models
export { SyncStateModel, type ISyncState } from './sync_state.model.js';
export { ERC20LogModel, type IERC20Log } from './logs_erc20.model.js';

// Indexer
export {
  syncERC20Transfers,
  getSyncStatus,
  resetSyncState,
  type SyncResult,
} from './erc20.indexer.js';
