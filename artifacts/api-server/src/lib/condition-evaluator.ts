import { calcEMA, calcSMA, calcRSI, calcMACD, calcBB, calcVWAP, calcATR, type Candle } from "./indicators";

export interface Condition {
  indicator: string;
  comparator: string;
  value: string;
  period?: string;
}

function getVal(indicator: string, period: number, candles: Candle[], idx: number): number {
  const i = idx;
  switch (indicator) {
    case "RSI": return calcRSI(candles, period)[i];
    case "EMA": return calcEMA(candles, period)[i];
    case "SMA": return calcSMA(candles, period)[i];
    case "MACD": return calcMACD(candles).macd[i];
    case "MACD_Signal": return calcMACD(candles).signal[i];
    case "MACD_Histogram": return calcMACD(candles).histogram[i];
    case "BB_Upper": return calcBB(candles, period).upper[i];
    case "BB_Lower": return calcBB(candles, period).lower[i];
    case "VWAP": return calcVWAP(candles)[i];
    case "ATR": return calcATR(candles, period)[i];
    case "Price": return candles[i].close;
    case "Volume": return candles[i].volume;
    default: return NaN;
  }
}

export function evaluateCondition(cond: Condition, candles: Candle[]): boolean {
  if (candles.length < 30) return false;
  const period = parseInt(cond.period || "14");
  const threshold = parseFloat(cond.value);
  const last = candles.length - 1;
  const prev = last - 1;
  const current = getVal(cond.indicator, period, candles, last);
  if (isNaN(current)) return false;

  switch (cond.comparator) {
    case "<": return current < threshold;
    case ">": return current > threshold;
    case "=": return Math.abs(current - threshold) < 0.01;
    case "crosses_above": {
      if (cond.indicator === "MACD") {
        const mac = calcMACD(candles);
        return mac.macd[prev] < mac.signal[prev] && mac.macd[last] > mac.signal[last];
      }
      const prevPrice = candles[prev].close;
      const prevMA = getVal(cond.indicator, period, candles, prev);
      return prevPrice < prevMA && candles[last].close > current;
    }
    case "crosses_below": {
      if (cond.indicator === "MACD") {
        const mac = calcMACD(candles);
        return mac.macd[prev] > mac.signal[prev] && mac.macd[last] < mac.signal[last];
      }
      const prevPrice = candles[prev].close;
      const prevMA = getVal(cond.indicator, period, candles, prev);
      return prevPrice > prevMA && candles[last].close < current;
    }
    default: return false;
  }
}

export function evaluateAllConditions(conditions: Condition[], candles: Candle[]): boolean {
  if (!conditions.length) return false;
  return conditions.every(c => evaluateCondition(c, candles));
}
