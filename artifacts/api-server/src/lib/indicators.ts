export interface Candle {
  open: number; high: number; low: number; close: number;
  volume: number; timestamp: string;
}

export function calcEMA(candles: Candle[], period: number): number[] {
  const closes = candles.map(c => c.close);
  const k = 2 / (period + 1);
  const ema: number[] = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    ema.push(closes[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

export function calcSMA(candles: Candle[], period: number): number[] {
  const closes = candles.map(c => c.close);
  return closes.map((_, i) => {
    if (i < period - 1) return NaN;
    return closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  });
}

export function calcRSI(candles: Candle[], period = 14): number[] {
  const closes = candles.map(c => c.close);
  const rsi: number[] = new Array(period).fill(NaN);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff; else avgLoss += Math.abs(diff);
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period; i < closes.length; i++) {
    if (i > period) {
      const diff = closes[i] - closes[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rs));
  }
  return rsi;
}

export function calcMACD(candles: Candle[], fast = 12, slow = 26, signal = 9): { macd: number[]; signal: number[]; histogram: number[] } {
  const emaFast = calcEMA(candles, fast);
  const emaSlow = calcEMA(candles, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const k = 2 / (signal + 1);
  const signalLine: number[] = [macdLine[0]];
  for (let i = 1; i < macdLine.length; i++) {
    signalLine.push(macdLine[i] * k + signalLine[i - 1] * (1 - k));
  }
  return { macd: macdLine, signal: signalLine, histogram: macdLine.map((v, i) => v - signalLine[i]) };
}

export function calcBB(candles: Candle[], period = 20, stdDev = 2): { upper: number[]; middle: number[]; lower: number[] } {
  const sma = calcSMA(candles, period);
  const closes = candles.map(c => c.close);
  const upper = sma.map((mid, i) => {
    if (isNaN(mid)) return NaN;
    const slice = closes.slice(Math.max(0, i - period + 1), i + 1);
    const variance = slice.reduce((s, v) => s + (v - mid) ** 2, 0) / slice.length;
    return mid + stdDev * Math.sqrt(variance);
  });
  const lower = sma.map((mid, i) => {
    if (isNaN(mid)) return NaN;
    const slice = closes.slice(Math.max(0, i - period + 1), i + 1);
    const variance = slice.reduce((s, v) => s + (v - mid) ** 2, 0) / slice.length;
    return mid - stdDev * Math.sqrt(variance);
  });
  return { upper, middle: sma, lower };
}

export function calcVWAP(candles: Candle[]): number[] {
  let cumTPV = 0, cumVol = 0;
  return candles.map(c => {
    cumTPV += ((c.high + c.low + c.close) / 3) * c.volume;
    cumVol += c.volume;
    return cumVol === 0 ? c.close : cumTPV / cumVol;
  });
}

export function calcATR(candles: Candle[], period = 14): number[] {
  const trs = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  });
  const atr: number[] = [trs[0]];
  for (let i = 1; i < trs.length; i++) {
    atr.push((atr[i - 1] * (period - 1) + trs[i]) / period);
  }
  return atr;
}
