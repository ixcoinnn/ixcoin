import { db } from "@workspace/db";
import { priceHistoryTable } from "@workspace/db";
import { desc, gte } from "drizzle-orm";

const BASE_PRICE = 0.50;
let currentPrice = BASE_PRICE;
let priceInitialized = false;

function randomWalk(current: number, volatility = 0.02): number {
  const change = (Math.random() - 0.48) * volatility * current;
  const next = current + change;
  return Math.max(0.001, next);
}

export async function initializeMarket(): Promise<void> {
  if (priceInitialized) return;
  priceInitialized = true;

  const existing = await db
    .select()
    .from(priceHistoryTable)
    .orderBy(desc(priceHistoryTable.timestamp))
    .limit(1);

  if (existing.length > 0) {
    currentPrice = parseFloat(existing[0].priceUsd);
  } else {
    await seedPriceHistory();
  }

  setInterval(async () => {
    currentPrice = randomWalk(currentPrice);
    await db.insert(priceHistoryTable).values({
      priceUsd: currentPrice.toString(),
      volume: (Math.random() * 100000).toString(),
    });
  }, 30_000);
}

async function seedPriceHistory(): Promise<void> {
  const now = Date.now();
  const points = [];
  let price = BASE_PRICE;

  for (let i = 720; i >= 0; i--) {
    price = randomWalk(price, 0.015);
    points.push({
      priceUsd: price.toString(),
      volume: (Math.random() * 500000 + 50000).toString(),
      timestamp: new Date(now - i * 5 * 60 * 1000),
    });
  }

  await db.insert(priceHistoryTable).values(points);
  currentPrice = price;
}

export function getCurrentPrice(): number {
  return currentPrice;
}

export async function getPriceHistory(period: string): Promise<Array<{ timestamp: Date; priceUsd: string; volume: string }>> {
  const now = new Date();
  let cutoff: Date;

  switch (period) {
    case "1h":
      cutoff = new Date(now.getTime() - 60 * 60 * 1000);
      break;
    case "7d":
      cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "30d":
      cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  return await db
    .select()
    .from(priceHistoryTable)
    .where(gte(priceHistoryTable.timestamp, cutoff))
    .orderBy(priceHistoryTable.timestamp);
}
