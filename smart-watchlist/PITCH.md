# Product Pitch (100 words)

Most watchlists just show numbers — you still have to figure out what
matters. This one computes a volatility-normalized "significance score" per
stock, so a 1% move gets flagged on a sleepy stock but ignored on a volatile
one, and surfaces a ranked "what changed since you last checked" digest
instead of a wall of prices. State persists server-side per user, so your
watchlist and baseline follow you across devices. A simulated market engine
deliberately injects delayed and conflicting ticks so the system visibly
handles staleness rather than hiding it — every price shows its own age and
confidence, and conflicts resolve by latest-timestamp, not silently.
