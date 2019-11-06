import Promise from 'bluebird';
import * as c32check from 'c32check';
import moment from 'moment';
import compact from 'lodash/compact';
import accounting from 'accounting';

import Aggregator from './aggregator';
import {
  network, fetchRawTxInfo, fetchBlockHash, fetchBlockInfo,
} from '../client/core-api';
import { decode } from '../stacks-decoder';
import { stacksValue, blockToTime } from '../utils';
import { getTimesForBlockHeights } from '../bitcore-db/queries';
import {
  getAddressSTXTransactions, HistoryRecord, getVestingForAddress,
} from '../core-db-pg/queries';

import { getAccounts } from '../addresses';

export interface HistoryRecordWithData extends HistoryRecord {
  operation?: string
  blockTime?: number
  valueStacks: number
  value: number
  sender?: string
  recipient?: string
}

export interface History {
  records: HistoryRecordWithData[]
  totalUnlocked: number
}

class StacksAddress extends Aggregator {
  static key(addr: string) {
    return `StacksAddress:${addr}`;
  }

  static async setter(addr: string) {
    const { accountsByAddress } = await getAccounts();
    let genesisData = {};
    if (accountsByAddress[addr]) {
      genesisData = this.formatGenesisAddress(accountsByAddress[addr]);
    }

    const address = c32check.c32ToB58(addr);
    const token = 'STACKS';

    const [{ tokens }, history, status, balance, Vesting] = await Promise.all([
      network.getAccountTokens(address),
      this.getHistory(address),
      network.getAccountStatus(address, token),
      network.getAccountBalance(address, token),
      getVestingForAddress(address),
    ]);

    let unlockInfo = {};
    if (Vesting.vestingTotal && Vesting.vestingTotal > 0) {
      unlockInfo = {
        formattedUnlockTotal: accounting.formatNumber(Vesting.vestingTotal * 10e-7),
        unlockTotalStacks: stacksValue(Vesting.vestingTotal),
        unlockTotal: Vesting.vestingTotal,
      };
    }

    const account = {
      ...genesisData,
      totalUnlocked: Vesting.totalUnlocked,
      totalUnlockedStacks: stacksValue(Vesting.totalUnlocked),
      tokens,
      btcAddress: address,
      address: addr,
      history: history.records,
      status,
      balance: balance.toString(),
      vesting_total: Vesting.vestingTotal, // preserved for wallet
      vestingTotal: Vesting.vestingTotal,
      totalLocked: Vesting.totalLocked,
      totalLockedStacks: stacksValue(Vesting.totalLocked),
      ...unlockInfo,
    };

    account.status.debit_value = status.debit_value.toString();
    account.status.credit_value = status.credit_value.toString();

    return account;
  }

  static async getHistory(address: string) {
    const history = await getAddressSTXTransactions(address);
    history.reverse();
    const totalUnlocked = 0;
    const blockHeights = history.map(h => h.block_id);
    const blockTimes = await getTimesForBlockHeights(blockHeights);
    const historyWithData: HistoryRecordWithData[] = await Promise.map(history, async (h, index) => {
      try {
        let historyEntry: HistoryRecordWithData = {
          ...h,
          valueStacks: stacksValue(h.historyData.token_fee),
          value: parseInt(h.historyData.token_fee, 10),
        };
        const blockTime = blockTimes[h.block_id] || blockToTime(h.block_id);
        const { txid } = h;
        try {
          const hex = await fetchRawTxInfo(txid);
          const decoded = decode(hex);
          historyEntry = {
            ...historyEntry,
            ...h,
            ...decoded,
            blockTime,
            operation: decoded.senderBitcoinAddress === address ? 'SENT' : 'RECEIVED',
          };
          return historyEntry;
        } catch (error) {
          console.error('Error when fetching TX info:', error.message);
          return {
            ...blockTime,
            h,
          };
        }
      } catch (error) {
        console.error('Error when fetching history', error.message);
        return null;
      }
    });
    // return [compact(historyWithData.reverse()), totalUnlocked];
    return {
      records: compact(historyWithData.reverse()),
      totalUnlocked,
    };
  }

  static formatGenesisAddress(account) {
    const btcAddress = c32check.c32ToB58(account.address);
    return {
      balance: '0',
      status: {
        debit_value: '0',
        credit_value: '0',
      },
      btcAddress,
      transferUnlockDateFormatted: moment(account.transferUnlockDate).format('MMMM DD, YYYY'),
      formattedUnlockTotal: accounting.formatNumber(account.vesting_total * 10e-7),
      unlockTotal: account.vesting_total,
      unlockTotalStacks: stacksValue(account.vesting_total),
      history: [],
      ...account,
    };
  }

  static expiry() {
    return 60; // 1 minute
  }
}

module.exports = StacksAddress;
export default StacksAddress;
