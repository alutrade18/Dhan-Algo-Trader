# Dhan API Reference

Quick lookup for all Dhan API enum values used in this project.

---

## Exchange Segments

| Attribute    | Exchange | Segment             |
|--------------|----------|---------------------|
| IDX_I        | Index    | Index Value         |
| NSE_EQ       | NSE      | Equity Cash         |
| NSE_FNO      | NSE      | Futures & Options   |
| NSE_CURRENCY | NSE      | Currency            |
| BSE_EQ       | BSE      | Equity Cash         |
| BSE_FNO      | BSE      | Futures & Options   |
| BSE_CURRENCY | BSE      | Currency            |
| MCX_COMM     | MCX      | Commodity           |

---

## Product Types

| Attribute | Detail                                      |
|-----------|---------------------------------------------|
| CNC       | Cash & Carry (delivery equity)              |
| INTRADAY  | Intraday — Equity, Futures & Options        |
| MARGIN    | Margin trading                              |
| MTF       | Margin Trading Facility                     |
| CO        | Cover Order                                 |
| BO        | Bracket Order                               |

> **Super Orders are INTRADAY only** in this platform.

---

## Order Status

| Attribute   | Detail                                                                     |
|-------------|----------------------------------------------------------------------------|
| TRANSIT     | Did not reach the exchange server                                          |
| PENDING     | Awaiting execution                                                         |
| PART_TRADED | Partial quantity traded successfully                                       |
| TRADED      | Executed successfully                                                      |
| TRIGGERED   | Super Order: Target or Stop Loss leg has been triggered                    |
| CLOSED      | Super Order: both entry and exit orders have been placed (terminal)        |
| REJECTED    | Rejected by broker/exchange (terminal)                                     |
| CANCELLED   | Cancelled by user (terminal)                                               |

**Internal statuses** (set by our Super Order Monitor, stored in DB):

| Attribute    | Detail                                             |
|--------------|----------------------------------------------------|
| TARGET_HIT   | Monitor detected LTP reached target; exit placed   |
| STOP_LOSS_HIT| Monitor detected LTP hit stop loss; exit placed    |
| COMPLETED    | Both legs fully done (legacy/manual completion)    |

---

## Instruments

| Attribute | Detail                       |
|-----------|------------------------------|
| INDEX     | Index                        |
| FUTIDX    | Futures of Index             |
| OPTIDX    | Options of Index             |
| EQUITY    | Equity                       |
| FUTSTK    | Futures of Stock             |
| OPTSTK    | Options of Stock             |
| FUTCOM    | Futures of Commodity         |
| OPTFUT    | Options of Commodity Futures |

---

## Expiry Codes

| Code | Detail              |
|------|---------------------|
| 0    | Current / Near Expiry |
| 1    | Next Expiry         |
| 2    | Far Expiry          |

---

## Market Feed — Request Codes

| Code | Detail                        |
|------|-------------------------------|
| 11   | Connect Feed                  |
| 12   | Disconnect Feed               |
| 15   | Subscribe — Ticker Packet     |
| 16   | Unsubscribe — Ticker Packet   |
| 17   | Subscribe — Quote Packet      |
| 18   | Unsubscribe — Quote Packet    |
| 21   | Subscribe — Full Packet       |
| 22   | Unsubscribe — Full Packet     |
| 23   | Subscribe — Full Market Depth |
| 25   | Unsubscribe — Full Market Depth |

## Market Feed — Response Codes

| Code | Detail                |
|------|-----------------------|
| 1    | Index Packet          |
| 2    | Ticker Packet         |
| 4    | Quote Packet          |
| 5    | OI Packet             |
| 6    | Prev Close Packet     |
| 7    | Market Status Packet  |
| 8    | Full Packet           |
| 50   | Feed Disconnect       |

> Codes handled by `market-feed-ws.ts`: **2** (Ticker), **4** (Quote), **8** (Full), **50** (Disconnect).

---

## Exchange Segment Numeric IDs (for binary feed packets)

| Numeric ID | Segment      |
|------------|--------------|
| 0          | IDX_I        |
| 1          | NSE_EQ       |
| 2          | NSE_FNO      |
| 3          | NSE_CURRENCY |
| 4          | BSE_EQ       |
| 5          | BSE_FNO      |
| 6          | BSE_CURRENCY |
| 7          | MCX_COMM     |

---

## Trading API Errors

| Code   | Type                  | Message / When                                                       |
|--------|-----------------------|----------------------------------------------------------------------|
| DH-901 | Invalid Authentication| Client ID or access token invalid/expired                            |
| DH-902 | Invalid Access        | Data/Trading APIs not subscribed                                     |
| DH-903 | User Account          | Account errors (segments not activated, etc.)                        |
| DH-904 | Rate Limit            | Too many requests — throttle API calls                               |
| DH-905 | Input Exception       | Missing required fields, bad parameter values                        |
| DH-906 | Order Error           | Incorrect order request, cannot be processed                         |
| DH-907 | Data Error            | Incorrect parameters or no data present                              |
| DH-908 | Internal Server Error | Rare Dhan server error — retry                                       |
| DH-909 | Network Error         | API could not reach Dhan backend — retry                             |
| DH-910 | Others                | Miscellaneous errors                                                 |
| DH-911 | Invalid IP            | Server IP not whitelisted in Dhan portal                             |

> **Critical alerts** (Telegram): DH-901 (token expired), DH-911 (IP not whitelisted).

---

## Data API Errors

| Code | Description                                             |
|------|---------------------------------------------------------|
| 800  | Internal Server Error                                   |
| 804  | Requested instruments exceed limit                      |
| 805  | Too many requests/connections — may result in block     |
| 806  | Data APIs not subscribed                                |
| 807  | Access token expired                                    |
| 808  | Authentication failed — Client ID or Token invalid      |
| 809  | Access token invalid                                    |
| 810  | Client ID invalid                                       |
| 811  | Invalid expiry date                                     |
| 812  | Invalid date format (expected YYYY-MM-DD)               |
| 813  | Invalid Security ID                                     |
| 814  | Invalid request                                         |

---

## Rate Limits

| Category    | Per Second | Per Minute | Per Hour | Per Day   |
|-------------|-----------|------------|----------|-----------|
| Order APIs  | 25        | 250        | 1,000    | 7,000     |
| Data APIs   | 10        | 1,000      | 5,000    | Unlimited |
| Non-trading | 20        | Unlimited  | Unlimited| Unlimited |

Order modification cap: **25 modifications per order**.
