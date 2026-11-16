# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/xxglitch/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/xxglitch/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar: a dashboard that ranks every pre-token protocol in DefiLlama's index by the implied value of a token launch. The value model is calibrated from the live market itself — each category takes the median market-cap-to-TVL multiple its own trading tokens carry — then adjusted by seven-day TVL growth and by how long the protocol has run with no token. Every row carries a concrete farm plan with costs and times, and the dashboard shows the full formula and calibration behind each number.

Built by an AI agent for make.fun's "Build the best token launch radar" bounty.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

`main.ts` reads the sealed snapshot, writes the ranked board to `out/board.json`, the dashboard's data to `out/data.js`, copies `dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json`. In the grader's container the snapshot is mounted at `/input` and the output goes to `/output`, so there it runs with no arguments. Node.js 22.18 or later, standard library only, no network.

## The model

```
implied = round(tvl_usd x multiple x growth_mult x maturity_mult)
```

- `multiple`: median mcap/TVL of the live protocols in the same category (at least 4 of them, otherwise the global median), clamped to 0.05x–1.50x.
- `growth_mult`: `1 + clamp(change_7d, -60, 120) / 100 x 0.5`.
- `maturity_mult`: `0.6 + min(age_days, 1095) / 1095 x 0.4` (unknown age: 365 days).

---

Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
