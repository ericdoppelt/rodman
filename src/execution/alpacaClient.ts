import axios from 'axios';

// Paper trading only — see docs/decisions/0012-alpaca-paper-trading-execution.md.
// Going live means pointing this at https://api.alpaca.markets with a funded, verified account.
const ALPACA_BASE_URL = 'https://paper-api.alpaca.markets';

export interface AlpacaOrderResult {
  orderId: string;
  status: string;
  filledQty: number | null;
  filledAvgPrice: number | null;
  raw: unknown;
}

export async function getOrder(orderId: string): Promise<AlpacaOrderResult> {
  const apiKey = process.env.ALPACA_API_KEY;
  const apiSecret = process.env.ALPACA_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error('ALPACA_API_KEY / ALPACA_API_SECRET is not set');

  const { data } = await axios.get(`${ALPACA_BASE_URL}/v2/orders/${orderId}`, {
    headers: {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': apiSecret,
    },
  });

  return {
    orderId: data.id,
    status: data.status,
    filledQty: data.filled_qty !== null && data.filled_qty !== undefined ? Number(data.filled_qty) : null,
    filledAvgPrice: data.filled_avg_price !== null && data.filled_avg_price !== undefined ? Number(data.filled_avg_price) : null,
    raw: data,
  };
}

export async function placeNotionalBuyOrder(symbol: string, notionalUsd: number): Promise<AlpacaOrderResult> {
  const apiKey = process.env.ALPACA_API_KEY;
  const apiSecret = process.env.ALPACA_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error('ALPACA_API_KEY / ALPACA_API_SECRET is not set');

  try {
    const { data } = await axios.post(
      `${ALPACA_BASE_URL}/v2/orders`,
      {
        symbol,
        notional: notionalUsd.toFixed(2),
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
      },
      {
        headers: {
          'APCA-API-KEY-ID': apiKey,
          'APCA-API-SECRET-KEY': apiSecret,
        },
      }
    );

    return {
      orderId: data.id,
      status: data.status,
      filledQty: data.filled_qty !== null && data.filled_qty !== undefined ? Number(data.filled_qty) : null,
      filledAvgPrice: data.filled_avg_price !== null && data.filled_avg_price !== undefined ? Number(data.filled_avg_price) : null,
      raw: data,
    };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      const detail = typeof error.response.data === 'object' ? JSON.stringify(error.response.data) : String(error.response.data);
      throw new Error(`Alpaca order for ${symbol} failed (${error.response.status}): ${detail}`);
    }
    throw error;
  }
}
