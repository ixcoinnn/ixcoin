import { CHAIN_CONFIG } from "./config.js";

export interface GasEstimate {
  gasPrice: number;
  gasUsed: number;
  fee: number;
  priority: "low" | "medium" | "high";
}

export class GasSystem {
  private recentFees: number[] = [];
  private baseFee: number = CHAIN_CONFIG.BASE_GAS_PRICE;

  recordBlockFees(fees: number[]): void {
    this.recentFees.push(...fees);
    if (this.recentFees.length > 200) {
      this.recentFees = this.recentFees.slice(-200);
    }
    this.adjustBaseFee();
  }

  private adjustBaseFee(): void {
    if (this.recentFees.length === 0) return;
    const avg = this.recentFees.reduce((a, b) => a + b, 0) / this.recentFees.length;
    const targetFee = avg * 0.1;
    this.baseFee = Math.max(CHAIN_CONFIG.MIN_GAS_PRICE, targetFee);
  }

  estimate(priority: "low" | "medium" | "high" = "medium"): GasEstimate {
    const multipliers = { low: 1, medium: 1.2, high: 1.5 };
    const gasPrice = this.baseFee * multipliers[priority];
    const gasUsed = CHAIN_CONFIG.TX_GAS_LIMIT;
    const fee = (gasPrice * gasUsed) / 1_000_000;

    return { gasPrice, gasUsed, fee, priority };
  }

  estimateContract(codeLength: number): GasEstimate {
    const gasUsed = Math.min(
      CHAIN_CONFIG.CONTRACT_GAS_LIMIT,
      CHAIN_CONFIG.TX_GAS_LIMIT + codeLength * 100
    );
    const gasPrice = this.baseFee * 1.5;
    const fee = (gasPrice * gasUsed) / 1_000_000;
    return { gasPrice, gasUsed, fee, priority: "high" };
  }

  getBaseFee(): number {
    return this.baseFee;
  }

  calculateBurn(fee: number): number {
    return fee * 0.5;
  }

  calculateMinerTip(fee: number): number {
    return fee * 0.5;
  }
}
