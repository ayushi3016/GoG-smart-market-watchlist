// Minimal in-memory rate limiter — deliberately NOT using a package like
// express-rate-limit, since installing new deps this close to a deadline
// is its own risk. This is enough to stop naive brute-forcing of
// /api/auth/login without adding infrastructure (e.g. Redis) that a
// hackathon judge running this locally would need to spin up.
//
// Tradeoff, worth stating if asked: this resets on server restart and
// doesn't share state across multiple server instances. Fine for this
// app's actual scale; the documented next step if this went to real
// production would be a shared store (Redis) instead of in-memory Map.

function createRateLimiter({ windowMs = 60_000, max = 10 } = {}) {
  const hits = new Map(); // key (e.g. IP) -> array of timestamps

  // Periodic cleanup so this Map doesn't grow unbounded over a long-running process.
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of hits) {
      const fresh = timestamps.filter(t => t > cutoff);
      if (fresh.length === 0) hits.delete(key);
      else hits.set(key, fresh);
    }
  }, windowMs).unref();

  return function rateLimit(req, res, next) {
    const key = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (hits.get(key) || []).filter(t => t > cutoff);

    if (timestamps.length >= max) {
      return res.status(429).json({ error: 'Too many attempts. Please try again shortly.' });
    }

    timestamps.push(now);
    hits.set(key, timestamps);
    next();
  };
}

module.exports = { createRateLimiter };