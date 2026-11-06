(function attachPlebeianUI(root, factory) {
  const helpers = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = helpers;
  root.PlebeianUI = helpers;
})(typeof window !== "undefined" ? window : globalThis, function buildPlebeianUI() {
  function formatSats(value) { return Number.isSafeInteger(value) ? value.toLocaleString("en-US") : "—"; }
  function formatTime(unixSeconds) {
    const value = Number(unixSeconds);
    if (!Number.isFinite(value) || value <= 0) return "Unknown";
    return new Date(value * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }
  function countdown(endTime, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (!Number.isSafeInteger(endTime) || endTime <= 0 || !Number.isFinite(nowSeconds)) return { ended: false, label: "Time unknown" };
    const remaining = endTime - nowSeconds;
    if (remaining <= 0) return { ended: true, label: "Ended" };
    const hours = Math.floor(remaining / 3600), minutes = Math.floor((remaining % 3600) / 60), seconds = remaining % 60;
    return { ended: false, label: hours > 0 ? `${hours}h ${minutes}m remaining` : `${minutes}m ${String(seconds).padStart(2, "0")}s remaining` };
  }
  function minimumBid(auction) {
    const high = Number(auction?.high_bid), start = Number(auction?.starting_bid), increment = Number(auction?.min_increment);
    if (![high, start, increment].every(Number.isSafeInteger) || start < 1 || increment < 1 || high < 0) return null;
    if (high === 0) return start;
    return high <= Number.MAX_SAFE_INTEGER - increment ? high + increment : null;
  }
  function filterAuctions(auctions, query) {
    const needle = String(query || "").trim().toLowerCase();
    return needle ? auctions.filter((auction) => `${auction.title || ""} ${auction.seller || ""}`.toLowerCase().includes(needle)) : auctions;
  }
  function fundingAmount(raw, maximum) {
    const value = String(raw ?? "");
    if (!/^[1-9][0-9]*$/.test(value)) return { ok: false, reason: "Enter a positive whole number." };
    const amount = Number(value);
    if (!Number.isSafeInteger(amount)) return { ok: false, reason: "Amount exceeds the safe integer range." };
    if (!Number.isSafeInteger(maximum) || maximum < 1 || amount > maximum) return { ok: false, reason: `Runtime policy allows at most ${formatSats(maximum)} fake sats per request.` };
    return { ok: true, amount };
  }
  function bidAmount(raw, minimum) {
    const value = String(raw ?? "");
    if (!/^[1-9][0-9]*$/.test(value)) return { ok: false, reason: "Enter a positive whole-number bid." };
    const amount = Number(value);
    if (!Number.isSafeInteger(amount)) return { ok: false, reason: "Bid exceeds the safe integer range." };
    if (!Number.isSafeInteger(minimum) || minimum < 1) return { ok: false, reason: "Committed bid minimum is unavailable." };
    if (amount < minimum) return { ok: false, reason: `Bid must be at least ${formatSats(minimum)} fake sats.` };
    return { ok: true, amount };
  }
  function imageURL(raw) {
    const value = String(raw ?? "").trim();
    if (value === "") return { ok: true, url: "" };
    if (value.length > 512) return { ok: false, reason: "Image URL may not exceed 512 characters." };
    let parsed;
    try { parsed = new URL(value); }
    catch { return { ok: false, reason: "Image URL is invalid." }; }
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || parsed.hash) {
      return { ok: false, reason: "Image URL must be HTTPS, contain no credentials, and contain no fragment." };
    }
    return { ok: true, url: value };
  }
  function scopeKey(actor, deployment) { return actor && deployment ? `${deployment}\u0000${actor}` : ""; }
  function validatorEvidence(validator) {
    // Prefer the explicit boolean: the server now states whether this slot's
    // signature was actually found in the commit it read.  The string match is
    // kept as a fallback for older payloads.
    const signed = validator?.observed_signature === true
      || String(validator?.observation || "").includes("canonical commit signature observed");
    if (!validator?.online) return { state: "unknown", label: "Unreachable", detail: "RPC unavailable · state unknown" };
    if (!signed) {
      // Reachable but no signature in the commit it read is a real absence, not
      // an unknown.  Saying "unknown" here made healthy local validators render
      // as offline.
      const evaluated = String(validator?.observation || "").includes("signature absent")
        || String(validator?.observation || "").includes("no signatures present");
      return evaluated
        ? { state: "absent", label: "Signature absent", detail: "No signature in the observed commit" }
        : { state: "unknown", label: "Signature unknown", detail: "RPC reachable · signature not evaluated" };
    }
    return { state: "observed", label: "Signed commit", detail: `Commit ${formatSats(validator.canonical_commit_height)}` };
  }
  return { formatSats, formatTime, countdown, minimumBid, filterAuctions, fundingAmount, bidAmount, imageURL, scopeKey, validatorEvidence };
});
