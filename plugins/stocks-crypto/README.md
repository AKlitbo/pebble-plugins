# Stocks + Crypto

A Pebble app plugin that puts stock and crypto prices on your watch, from Yahoo, or your own Finnhub, Twelve Data, or Alpha Vantage key.

Every watchface written for Pebble's own Stocks plugin reads Stocks + Crypto with no change. It serves the standard `finance/stock` source with the same properties in the same text, and adds `finance/crypto` for faces that show crypto on its own. Yahoo needs no key, so it serves the moment it is installed.

## Features

- Yahoo with no key, or your own Finnhub, Twelve Data, or Alpha Vantage key.
- Up to 8 stocks and 8 crypto pairs in one list, in the order you arrange them.
- A free key held inside its plan's limits, with a Paid Plan switch to lift them.
- The last good quote kept for a ticker the provider could not price for a moment.
- Your API keys kept in the phone's encrypted storage.

## Installation

1. **Turn Plugins On.** In the Pebble app, go to Settings, Plugins, and turn on Plugins / permissions preview.
2. **Install Stocks + Crypto** from the Pebble app store.
3. **Make It the Stocks Source.** Under Preferred Sources in the Pebble app's plugin settings, pick Stocks + Crypto for Stocks, and for Crypto if your watchface reads crypto. With no other stock plugin installed, the Pebble app uses it on its own. A face that names Pebble's Stocks itself keeps reading Pebble's.
4. **Pick a Watchface** that shows stock quotes.

## Configuration

Open Stocks + Crypto's settings in the Pebble app.

| Setting | What It Does |
| :-- | :-- |
| Data Source | Where the stock prices come from: Yahoo, the default, Finnhub, Twelve Data, or Alpha Vantage. Its description on the page says what its free key allows. |
| API Key | One per keyed provider, shown while that provider is picked. Switching provider and back keeps each key. |
| Paid Plan | One per keyed provider, off by default. Turn it on if your key is on a paid plan, and the plugin stops holding it to the free plan's limits. |
| Watchlist | Your tickers, one row each. Add a stock or a crypto pair, move rows up and down, and tap × to drop one. Up to 8 stocks and 8 crypto pairs. |
| Refresh Interval | How old the prices can get before the next run fetches them again, from 5 minutes to 1 hour, 5 minutes by default. It is a ceiling rather than a schedule, since the Pebble app decides when the plugin runs. |

> [!IMPORTANT]
> A watchface may show only the first few tickers in your watchlist. Put the ones you most want to see on your watch at the top.

**Crypto Comes from Yahoo.** Crypto prices always come from Yahoo, whatever Data Source you pick for stocks. Spell each pair the way Yahoo does, such as `BTC-USD` or `ETH-USD`.

**Spelling a Ticker.** Spell each stock the way your provider does, such as `^GSPC` for the S&P 500 on Yahoo. The plugin does not translate one provider's spelling into another's, since a wrong guess would show a different instrument with a real price.

### Getting an API Key

Yahoo needs none. Each of the others gives a free key when you sign up on its site.

- **Finnhub:** sign up at [finnhub.io](https://finnhub.io). The key is on your dashboard.
- **Twelve Data:** sign up at [twelvedata.com](https://twelvedata.com). The key is under API Keys in your account.
- **Alpha Vantage:** claim a free key at [alphavantage.co/support](https://www.alphavantage.co/support/#api-key).

> [!WARNING]
> An API key is tied to your account. Don't share it or post it anywhere. Stocks + Crypto keeps it in the phone's encrypted storage, which only the plugin can read.

## Permissions

The plugin asks for Internet once for each provider's site: `query1.finance.yahoo.com`, `finnhub.io`, `api.twelvedata.com`, and `www.alphavantage.co`. None is required, so you allow only the ones you use. Yahoo's is needed for crypto under any provider. A site you refused shows `NO PERMISSION` on its tickers.

## Data Source

Stocks + Crypto serves two items in the `finance` category, one instance per ticker.

- **`finance/stock`** serves the whole watchlist in your order, stocks and crypto as you arranged them.
- **`finance/crypto`** serves only the crypto pairs, in their order within the watchlist.

Both carry the same properties. The first five are Pebble's, in Pebble's text, and the rest are extra.

| Property | What It Holds |
| :-- | :-- |
| `ticker` | The ticker, such as `AAPL`. |
| `name` | The instrument's name, or the ticker when there is none. |
| `price` | The price, such as `$187.42`, with the change percent in its long form and the number beside it. |
| `day_change` | The day's change, such as `+$0.97`, with the number beside it. |
| `day_change_percent` | The day's change in percent, such as `+0.52%`, with the number beside it. |
| `currency` | The currency code, such as `USD` or `GBp` for pence. |
| `updated` | When the quote is from, with its time on the phone's clock. |
| `source` | The provider it came from. |
| `market` | New York's market state, `open`, `postclose`, or `closed`. |
| `status` | A word such as `NO ACCESS` or `RATE LIMIT`, on a ticker with no price. |

## How It Works

The plugin has no timers. The Pebble app runs it about every five minutes for each face reading it, after every save, and whenever a face starts reading. Each run starts cold, so everything below lives in `localStorage`.

* **The Copy.** Most runs answer from a copy of the last prices. Once the copy reaches the Refresh Interval, the next run fetches the stock tickers from the provider and the crypto pairs from Yahoo, side by side, and keeps the result. The copy carries the provider, the Paid Plan switch, and a fingerprint of the key, never the key itself, so changing any of them drops it. Any save has the next run fetch, as far as the provider's floors allow, though moving a ticker only changes the order served and fetches nothing. A save that changes which tickers are listed fetches past the floors at once, with the copy's quotes standing in for any ticker it cannot fetch yet.
* **A Ticker with No Price** goes out with its status word in `status`, such as `NO ACCESS` or `NO SYMBOL`, rather than being left out. A ticker the provider never answered, timed out on, or rate limited keeps its last good quote.
* **The Limits.** The framework's ledger counts every call a key sends to Twelve Data and Alpha Vantage, and says how many more fit: Twelve Data's 8 a clock minute and 800 a UTC day, and Alpha Vantage's 20 a routine day and 25 with a save, over a rolling 24 hours. Each call is stamped and saved as its request goes out, so a run the Pebble app cuts short still counts it. A call that never left the phone takes its stamp back off, and one that timed out keeps it, since it may have landed. The waits and the floors are the framework's own, the same ones a watchface's stock feature keeps to. A provider that timed out or sent a broken answer with nothing good beside it waits 15 minutes, doubling to 2 hours. A ticker that timed out beside good ones waits for the floor with the rest. When the provider turns away every ticker as `INVALID KEY`, the plugin leaves it alone until you save the page, or for a day. A single ticker answering `INVALID KEY`, as Twelve Data answers some mistyped tickers, stops nothing.
* **Asking Again.** A ticker refused for a minute's or a second's limit, or left out because the ledger had no room, is asked for again on its own at the first run after its wait is up, whether or not the copy is due, so the tickers that were priced do not spend a second call. Under Alpha Vantage's free key, a ticker that was lost, timed out, or refused for the day keeps no new stamp, so it is due again once the wait is up rather than at the next evening window, and it goes ahead of the others. A ticker is asked for on its own once. If it fails again it goes back to the schedule, so one bad ticker cannot hold every retry.

The API keys go to `Pebble.secureStorage`, which the phone encrypts and only the plugin can read. The other settings go to `localStorage`.

## What Each Free Key Allows

> [!NOTE]
> Last checked on 10 November 2026, from each provider's own pricing and documentation pages, with Alpha Vantage's one call a second confirmed by a live call. Providers change their free plans without notice, so check the provider's site if a figure here looks wrong.

The most the settings allow is 8 stocks and 8 crypto pairs at a 5 minute refresh. A copy counts as due a minute early, so rounds come at most 4 minutes apart, which is at most 360 a day.

| Provider | Free Limit | Most It Prices | Worst Day |
| :-- | :-- | :-- | :-- |
| Yahoo | None published. A 429 can last minutes or more than a day. | The 8 stocks and the 8 crypto pairs. | 16 calls a round, 5,760 a day. A 429 has it wait 15 minutes, doubling to 2 hours. |
| Finnhub | 60 a minute and 30 a second, US markets. | 8 | 8 calls a round, so 8 in any minute and 2,880 a day, with no daily cap to meet. |
| Twelve Data | 8 a minute and 800 a day, US markets, and 20+ markets on a paid plan. | 8 | 32 rounds of 8 on a weekday, which is 256 calls, never more than 8 in a minute. A save that changes the tickers every hour brings it to 368. |
| Alpha Vantage | 25 a day, and about one a second. | 4, one a run. | Each ticker once when first seen and three times after the close, which is 16 calls, never more than one in a minute. A routine day stops at 20, and a save that changes the tickers every hour still stops at 25. |

Crypto adds 8 Yahoo calls a round under the three keyed providers. A ticker that times out all day does not raise any of these, since it waits for the floor with the rest. Paid Plan lifts the counts for a keyed provider and fetches every ticker each Refresh Interval. A rate limit the provider answers still has it wait as on a free key.

**Sharing a Key with a Watchface.** The counts are the plugin's own. A watchface fetching stocks itself on the same free key keeps its own count, so together the two spend the key twice. On Alpha Vantage that can pass 25 and leave the close out for a day. Give each its own key, or turn the face's own stock fetching off.

## Rules the Plugin Keeps beyond the Framework's

* Alpha Vantage's free key prices 4 tickers, one a run, each with its own stamps, and waits a second after its last call. The plugin has no timers to space calls a second apart.
* After Alpha Vantage's daily limit on a free key, the plugin waits until New York's next day. The framework leaves that limit to the evening window, where each try would only meet the same refusal.
* A ticker that was refused, lost, or left out is asked for again on its own after the wait, since the plugin has no timer to bring the retry back.
* The stop after every ticker answers `INVALID KEY`, which lifts on any save or after a day.

## Known Limitations

**Coverage**

* Twelve Data's free key covers US markets only, and Finnhub's free key refuses most tickers outside the US and most indexes. Both answer `NO ACCESS`.
* `market` is New York's market state, not the ticker's own market's.
* Every face reading Stocks + Crypto gets the same watchlist.

**Prices**

* Prices can be delayed. They are for information only, not financial advice.
* Finnhub sends no currency, so its prices go out with no currency sign.

**Refreshing**

* The runtime has no timers, so a provider that never answers is only cut off where the runtime offers `AbortSignal.timeout`, after 8 seconds.
* Alpha Vantage's calls on a paid plan go out one after another with nothing between them, and stop starting after 10 seconds. A burst refusal leaves the rest for the next run.

**The Phone's Clock**

* A phone clock set a day ahead and back again can let a day's calls go out twice, since the counts read the phone's clock.

## Building

The unit pins [Pebble App Framework](https://github.com/AKlitbo/pebble-app-framework) in its `paf.config.json`, and needs `paf 2.2.0` or later.

```sh
paf sync
paf build stocks-crypto  # the .pbw, from WSL with Pebble SDK 4.44 and pebble-tool 5.1.2 or later
paf test
paf lint
paf typecheck
paf check
```

The pbw lands in `plugins/stocks-crypto/targets/stocks-crypto/build/`. The plugin's script starts in `src/plugin/index.ts` and its settings page in `src/config/index.ts`. The plugin's own caps sit in `src/limits.ts`, on top of the framework's free plans in `ts/stock/limits.ts` and its ledger in `ts/stock/ledger.ts`.
