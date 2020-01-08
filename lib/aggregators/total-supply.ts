import BigNumber from 'bignumber.js';
import Aggregator from './aggregator';
import { getUnlockedSupply } from '../core-db-pg/queries';
import { microStacksToStacks, TOTAL_STACKS, MICROSTACKS_IN_STACKS } from '../utils';


export interface TotalSupplyResult {
  unlockedPercent: string
  totalStacks: string
  totalStacksFormatted: string
  unlockedSupply: string
  unlockedSupplyFormatted: string
  blockHeight: string
}

class TotalSupplyAggregator extends Aggregator {
  static expiry() {
    return 10 * 60; // 10 minutes
  }

  static async setter(): Promise<TotalSupplyResult> {
    const { unlockedSupply, blockHeight } = await getUnlockedSupply();
    const totalStacks = new BigNumber(TOTAL_STACKS).times(MICROSTACKS_IN_STACKS);
    const unlockedPercent = unlockedSupply.div(totalStacks).times(100);
    const result = {
      unlockedPercent: unlockedPercent.toFixed(2),
      totalStacks: microStacksToStacks(totalStacks),
      totalStacksFormatted: microStacksToStacks(totalStacks, 'thousands'),
      unlockedSupply: microStacksToStacks(unlockedSupply),
      unlockedSupplyFormatted: microStacksToStacks(unlockedSupply, 'thousands'),
      blockHeight,
    };
    return result;
  }
}

export default TotalSupplyAggregator;
