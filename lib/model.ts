// Launch Radar's value model: one sealed snapshot in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot can rank: the 40 on
// the house watchlist (the floor, never the ceiling) plus every other
// pre-token protocol below it that passes the same rule, strongest implied
// value first. A protocol is pre-token when its record carries no token at
// all: no market cap, no CoinGecko id, no symbol. Protocols whose token
// already trades are kept apart in a Live view and never mixed into the
// ranking -- but they calibrate it.
//
// A wrapped, staked or bridged product of a token that already trades is not
// a protocol still waiting on a launch of its own, so the board leaves them
// out, by the house watchlist's own rule: a wrapped, staked or bridged
// category, a wrapped / staked / staking word in the name, an exchange's name
// at the start of it, or a version marker at the end. One part of that rule
// the snapshot does not carry -- DefiLlama's parent protocol -- so the board
// reads it off the watchlist itself: a protocol at or above the floor that
// the watchlist leaves out fails the full rule on that one hidden field (a
// sub-product of a parent protocol, such as a regional arm or a curator line),
// and is set aside with the rest. Below the floor the watchlist cannot speak,
// so every protocol passing the visible rule is ranked: the early radar.
//
// Implied value is the market cap the protocol's token would carry if the
// protocol launched today at the multiple its own category trades at:
//
//   multiple   = median mcap/TVL of the live protocols in the same category
//                (at least 4 of them; otherwise the global median across all
//                live protocols), clamped to [0.05, 1.50]
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x 0.5
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365)
//   implied    = max(1, round(tvl_usd x multiple x growthMult x maturity))
//
// Every input is a figure from the snapshot itself: TVL, seven-day growth, and
// how long the protocol has run with no token. No protocol name is ever
// special-cased, and no number is hand-picked per protocol: the same function
// scores every row, and the dashboard shows the calibration table it came from.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  min_category_n: number;
  multiple_min: number;
  multiple_max: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  min_category_n: 4,
  multiple_min: 0.05,
  multiple_max: 1.5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'launch-radar-1';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's calibration: the multiple the market gives it, and the sample behind it. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  n: number;
}

/** The calibration: a global multiple plus one per category with enough live protocols. */
export interface Calibration {
  global_multiple: number;
  global_n: number;
  by_category: CategoryMultiple[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_source: 'category' | 'global';
    multiple_n: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  multiple: number;
  multiple_source: 'category' | 'global';
  multiple_n: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration, the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  calibration: Calibration;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A whole wrapped / staked / staking word in a name, in any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** An exchange's name at the start of a name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/**
 * Whether a protocol is one the board may rank: pre-token, not a wrapped,
 * staked or bridged product by category or name, not a versioned pool, and --
 * where the watchlist can speak -- not a sub-product of a parent protocol.
 * The snapshot carries no parent-protocol field, so a protocol at or above
 * the floor that the watchlist leaves out is read as failing the full rule
 * on that hidden field and is set aside; below the floor the visible rule
 * is the whole of it.
 */
export function isRankable(p: SnapshotProtocol, snapshot: Snapshot): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (p.tvl_usd >= snapshot.floor_usd && !snapshot.watchlist.includes(p.slug)) return false;
  return true;
}

/**
 * Calibrate the value multiple from the snapshot's own live market: for each
 * category with at least `min_category_n` live protocols carrying a market cap,
 * the median mcap/TVL of those protocols; every other category falls back to
 * the global median across all live protocols. Multiples are clamped so one
 * thin or frothy category cannot bend the board.
 */
export function calibrate(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): Calibration {
  const live = protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.tvl_usd > 0 && p.category !== 'CEX');
  const clamp = (x: number): number => Math.min(model.multiple_max, Math.max(model.multiple_min, x));
  const globalMultiple = live.length > 0 ? clamp(median(live.map((p) => p.mcap_usd! / p.tvl_usd))) : 0.2;
  const perCategory = new Map<string, number[]>();
  for (const p of live) {
    if (p.category === null) continue;
    const list = perCategory.get(p.category) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    perCategory.set(p.category, list);
  }
  const byCategory: CategoryMultiple[] = [...perCategory.entries()]
    .filter(([, ratios]) => ratios.length >= model.min_category_n)
    .map(([category, ratios]) => ({ category, multiple: clamp(median(ratios)), n: ratios.length }))
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { global_multiple: globalMultiple, global_n: live.length, by_category: byCategory };
}

/** The multiple one protocol gets: its category's, or the global one when its category is thin. */
export function multipleFor(p: SnapshotProtocol, calibration: Calibration): { multiple: number; source: 'category' | 'global'; n: number } {
  if (p.category !== null) {
    const hit = calibration.by_category.find((c) => c.category === p.category);
    if (hit !== undefined) return { multiple: hit.multiple, source: 'category', n: hit.n };
  }
  return { multiple: calibration.global_multiple, source: 'global', n: calibration.global_n };
}

/** The multipliers and the implied value one protocol gets under the calibrated model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; multipleSource: 'category' | 'global'; multipleN: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, source, n } = multipleFor(protocol, calibration);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, multiple, multipleSource: source, multipleN: n, growthPct, growthMult, maturityMult, age };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, calibration: Calibration, model: ModelConstants = MODEL): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => isRankable(p, snapshot));
  const scored = chosen.map((p) => {
    const v = impliedValue(p, snapshot.as_of, calibration, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watchlist.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    // The breakdown keeps full precision, never rounded: the dashboard
    // recomputes each row's implied value from these factors, and a factor
    // rounded to four places would make its answer differ from the board's
    // by a visible margin on the largest rows. Display rounds; data does not.
    model: {
      multiple: s.v.multiple,
      multiple_source: s.v.multipleSource,
      multiple_n: s.v.multipleN,
      growth_pct: s.v.growthPct,
      growth_multiplier: s.v.growthMult,
      maturity_multiplier: s.v.maturityMult,
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Chains where a transaction costs well under a dollar, by the name DefiLlama gives them. */
const CHEAP_CHAINS = new Set(
  [
    'solana',
    'base',
    'arbitrum',
    'optimism',
    'polygon',
    'bsc',
    'bnb chain',
    'avalanche',
    'gnosis',
    'celo',
    'fantom',
    'moonbeam',
    'aurora',
    'linea',
    'scroll',
    'blast',
    'mantle',
    'mode',
    'zksync era',
    'starknet',
    'fraxtal',
    'sei',
    'sui',
    'aptos',
    'near',
    'tron',
    'polygon zkevm',
    'opbnb',
    'merlin',
    'bitlayer',
    'bob',
    'taiko',
    'kroma',
    'manta',
    'zora',
    'redstone',
    'lisk',
    'world chain',
    'ink',
    'soneium',
    'unichain',
    'abstract',
    'berachain',
    'sonic',
    'hyperliquid',
    'plasma',
    'monad',
  ].map((c) => c.toLowerCase()),
);

/** The gas a single transaction costs on a chain, in the words a farmer can budget. */
function gasFor(chain: string): { once: string; weekly: string } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { once: 'about $8–$25 of gas on Ethereum', weekly: 'about $3–$8 of gas a week' };
  if (c === 'bitcoin') return { once: 'about $2–$10 of network fees', weekly: 'about $2–$5 of fees a week' };
  if (CHEAP_CHAINS.has(c)) return { once: 'under $1 of gas', weekly: 'under $1 of gas a week' };
  return { once: 'about $1–$5 of gas', weekly: 'about $1–$3 of gas a week' };
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and leave the position open so the protocol counts the deposit.`;
  if (c.includes('dex')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and hold the LP position.`;
  if (c.includes('leveraged farm') || c.includes('yield') || c.includes('farm')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and let the yield compound.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC through ${name} to ${chain}, then use the bridged funds inside its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and hold the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take one position in an active market.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('stable')) return `Mint or hold $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('launchpad')) return `Hold $${capital} of the launch asset on ${name} and join one allocation round.`;
  if (c.includes('options')) return `Deposit $${capital} as collateral on ${name} and open one small option position.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  if (c.includes('payment') || c.includes('card')) return `Route $${capital} of spending through ${name} on ${chain} across the month.`;
  if (c.includes('privacy')) return `Run $${capital} through ${name}'s shielded pool on ${chain} and hold the private balance.`;
  if (c.includes('ai agent') || c.includes('decentralized ai')) return `Deposit $${capital} into ${name}'s agent vault on ${chain} and keep the position.`;
  if (c.includes('governance')) return `Lock $${capital} of the governance asset on ${name} and vote once.`;
  if (c.includes('nft')) return `List or buy one item through ${name} on ${chain} with $${capital} of funds.`;
  if (c.includes('otc')) return `Place one $${capital} order through ${name}'s desk on ${chain}.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and store its recovery phrase offline, never in a screenshot or a note on your phone.`,
      cost: 'no cost to create the wallet',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas.once}`,
      time: '15 minutes to set up',
    },
    {
      text: `Return once a week and make one real action: a deposit, a borrow, a swap, a vote or a claim, whichever the protocol's app offers.`,
      cost: gas.weekly,
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days, so the activity lands in more than one snapshot window.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check the protocol's own site or docs for a points or rewards program, and claim only from a link the protocol itself publishes.`,
      cost: 'no fee to check, and never pay anyone to claim',
      time: '10 minutes',
    },
    {
      text: `Size the position so a contract bug or a depeg cannot hurt you: keep it a small share of your funds, and revoke the token approval when you leave.`,
      cost: 'one small approval transaction',
      time: '5 minutes',
    },
    {
      text: `Record the wallet, the dates and every transaction hash in a farm log, so you can repeat the position, prove the activity, or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    multiple_source: row.model.multiple_source,
    multiple_n: row.model.multiple_n,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const calibration = calibrate(snapshot.protocols, model);
  const board = buildBoard(snapshot, calibration, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    calibration,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate needs`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
