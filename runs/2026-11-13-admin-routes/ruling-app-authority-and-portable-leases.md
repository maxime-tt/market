# Ruling — the app is its own authority; routes are the app's foundation; is portable leasing desirable?

Owner, 2026-11-13, verbatim (transcribed from voice — the ASR has errors; the meaning is taken from the
argument, not the wording):

> "…none of them really inspired me deeply… I think just like how you consolidate over all of them I
> think I will do something similar, but I will differ from you in some cases. So the first thing that
> I want you to know is that the previous market repo over-optimised to put everything on Nostr which
> to me can be an anti-pattern because of the fact that, for example, if you are, let's say for
> example, the app settings. The app settings of the previous app were posted on Nostr, and they were
> expected to be read from the Nostr Relay. But what we see today is that if the server program boots
> before the Nostr Relay program, then the server program is not able to read the Nostr Relay and the
> app doesn't even initialise with its own settings. So that's the kind of anti-pattern that we want to
> avoid, which is basically like, I'm going to go ahead and read this stuff from Nostr when in fact
> it's my responsibility to have it and to serve it. So this is my take with the app. So we are
> multiplying the responsibilities on the app routes system. The app's route system, currently it's
> like vanity URLs and maybe we have a few shopkeepers who keep their vanity URL. But anyways you can
> always end up on their page by typing in their name or something like that. What I'm suggesting here
> is that our app's routing system will become the foundation of how all the pages in the app will be
> built. And of course that might have some exceptions, some pre-made pages that are set up, but anyone
> should be able to reroute the pages of the app, such that if I type in a dashboard, I end up on a new
> dashboard page instead of on the default one. So this is the kind of thing that I want to be extra
> clear is that the app needs to be its own authority. And in fact, I would consider publishing over
> Nostr to be relatively unimportant. What's more important is the fact that you are purchasing from an
> app provider such as Plebeian Market or whoever else is hosting the lease on that route. Now I think
> there is a case to be made that the purchase and the lease should be public because then what that
> would allow us to do is, for example, as part of an app instance, you could say, I want to honour the
> lease of everyone who's bought a lease from Plebeian Market. That way, you can run your own instance
> of Plebeian Market and your app would basically look to verify the purchases of all the different
> leases that have happened on Plebeian Market itself. And then you could, for example, publish your
> list saying, hey, look, this person has bought from my domain. And so basically allows everybody to
> potentially share the space… So that's an interesting bonus that we would get from sharing, but the
> sharing is not the same as the primary mechanism. And I would have you evaluate whether that's a
> mechanism that is desirable at all. Basically, test my assumption, see whether it makes sense. See if
> it's something that we should keep in the first place. So those are my main two points."

## 1. The ruling that binds: the app is the authority

**The app owns its own settings and its own routes, and serves them. It does not read its own
configuration out of a relay it does not control.**

The measured anti-pattern he names: **the app settings live on Nostr and the app expects to read them
from the relay — so if the server boots before the relay, the app cannot initialise with its own
settings.** That is the failure of the deploy-topology kind, not the kind, and it is exactly the
decomposition error the two-stream work is trying to avoid elsewhere. This is the same ruling language
as the auctions read path, applied the other way round: there, the read path is 100% Nostr because
auction state *is* a public market's state; here, **app configuration and routing are the operator's own
responsibility and must not depend on a relay being up.**

**Consequence — and it settles X1 of the adjudication.** "Where the record of a name lives" is not
A-vs-B-vs-C. The owner's answer is: **the app's database is the authority.** Publishing to Nostr is
explicitly **relatively unimportant** and must never be on the critical path of serving a page or
booting the app.

## 2. The multiplication: routing becomes the app's page foundation

Today the route system is vanity URLs for a handful of shopkeepers. **Going forward it is the
foundation of how all pages in the app are built.** Pre-made/default pages may exist as exceptions, but
**anyone should be able to re-route the app's pages** — the owner's example: *"if I type in `/dashboard`,
I end up on a new dashboard page instead of on the default one."*

This is materially bigger than "manage custom routes":

- the **whole app surface becomes routable**, including routes that are currently compiled-in
  (`/dashboard`, `/auctions`, `/profile`, `/browse` …);
- so the route table is not a vanity side-table — it is **the page registry of the instance**;
- and the reserved-name list stops being a way to protect compiled-in routes and becomes the set of
  routes that **have not yet been handed to someone**;
- which means R1–R4 (hundreds of pages per author, unique paths, series paths resolving to the newest,
  the home as just another path) are the *small* part of the requirement, not the whole of it.

## 3. The bonus to evaluate: portable, shareable leases — the owner asked for the assumption to be tested

The proposed mechanism, stated so it can be refuted: *a lease purchased from an app provider is
**publicly verifiable**, so **another instance can choose to honour it** — "I want to honour the lease of
everyone who bought from Plebeian Market" — and a purchaser can **publish a list of the providers whose
leases they hold**, so buying once can mean holding the same name on several sites.*

The owner's own framing, which the evaluation must respect: **the sharing is a bonus, not the primary
mechanism.** So the test is not "is portability mandatory" but **"is the mechanism worth keeping in the
first place"** — i.e. does it earn its cost, and does it create obligations we would regret.

**What must be tested, not assumed:**

1. **Federation vs squatting.** If any instance may honour any provider's leases, then a purchase at a
   cheap or hostile provider can claim a name on an instance that never agreed. Is a lease scoped to
   the **provider** (who may be trusted/untrusted per instance) or to the **name** (which is global and
   therefore claimable)? This is the load-bearing question.
2. **Whose ledger?** Verification needs to be possible without asking the provider's server (else the
   anti-pattern returns). What exactly is verifiable — a receipt, a hash chain, a per-name record?
3. **Double-claim and precedence across providers.** Two providers sell the same name to two people.
   Whose wins, and how does the *second* instance decide?
4. **Cost to the primary mechanism.** Does designing for shareability force the name record out of the
   database and onto public media — the very thing he just said is unimportant? If yes, the bonus is
   eating the baseline and should be dropped or deferred.
5. **Is it actually desirable?** A name that works on many sites is a network effect *and* a
   coordination problem. Nobody has asked users; the cheapest way to find out is to ship the primary
   mechanism first and add sharing only if someone wants it.
