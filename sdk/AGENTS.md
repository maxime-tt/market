# AGENTS.md — sdk

`sdk/` is the portable, host-agnostic layer. This is the placement doctrine for
it. It was missing, and its absence is why the tree drifted; the drift is now
recorded as dated debt rows, not reshuffled in this pass.

## Placement rule

Place a module by what it _is_, not by which feature first needed it:

| directory     | holds                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`       | protocol capability, mechanism, or shared type with **no marketplace noun**: media, relays, signer, event-store, notifications, state, ports, utils. |
| `commerce/`   | seller/buyer flows involving listings, money, orders, capacity, or settlement.                                                                       |
| `extensions/` | optional capability contracts and adapters.                                                                                                          |
| `config/`     | instance/app configuration values and schemas.                                                                                                       |

If a module carries a marketplace noun it is not `core/`. If it carries no
seller/buyer flow it is not `commerce/`. If it is optional rather than required
by the protocol surface it is `extensions/`.

`D3.h2.media` (`sdk/core/media/`) is the first module placed by this rule and
sets the precedent: media is a protocol capability with no marketplace noun, so
it belongs in `core/`.

## Recorded debt (not moved now)

The tree drifted without this rule. These are dated debt rows, not a plan to
reshuffle in this commit:

- `sdk/commerce/curation`
- the social-vs-order split inside `sdk/commerce/messaging`
- `sdk/config/{wallet,cashu}.ts`
- the three wallet homes

Place new modules by the table above; leave the debt rows for their own slices.
