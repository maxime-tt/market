/**
 * `arenaParamsRead.test.ts` — the escrow-terms read, verified the way the app
 * verifies a kind-1445 verdict.
 *
 * The two fixtures are **real relay events taken with `nak`** (including their
 * tags and signatures) from `wss://relay.playday.it` on 2026-11-17:
 *
 * - `LIVE_EVENT` — height 344, the live deployment, signed by `1e17774d…`;
 * - `FOREIGN_EVENT` — height 20, a short-lived test chain on the same relay,
 *   signed by `8b9a2583…` and self-consistent (its own roster lists its own
 *   signer), which is exactly why height — not the roster — must order the two.
 *
 * The synthetic fixtures are signed with a deterministic key so that a tampered
 * signature, a wrong schema, a disagreeing anchor and a non-roster signer each
 * reach their own named refusal.
 */
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, getPublicKey } from 'nostr-tools'
import type { EventReadContext, NostrEventLike } from '@sdk/core'
import { ARENA_PARAMS_KIND } from '@sdk/commerce/auctions/constants'
import {
	ARENA_PARAMS_REFUSAL_ANCHOR_MISMATCH,
	ARENA_PARAMS_REFUSAL_BAD_ANCHOR,
	ARENA_PARAMS_REFUSAL_BAD_KIND,
	ARENA_PARAMS_REFUSAL_BAD_SCHEMA,
	ARENA_PARAMS_REFUSAL_BAD_SIGNATURE,
	ARENA_PARAMS_REFUSAL_SIGNER_NOT_IN_ROSTER,
	ARENA_PARAMS_REFUSAL_UNANCHORED,
	ArenaParamsError,
	isVerifiedArenaParamsEvent,
	parseArenaParamsEvent,
	readArenaParams,
	selectNewestArenaParams,
	type ArenaParamsEventLike,
	type ArenaParamsRefusalName,
} from './arenaParamsRead'

// ---------- The real fixtures ---------------------------------------------

const LIVE_EVENT: ArenaParamsEventLike = {
	id: 'fab54d6044cdc8b437618616132ac18e3d6fab06faa2d452cf9c5bd55f1e74a0',
	pubkey: '1e17774d0db6fbffc4488b607d4b9e3c8295212fd1c556d54ee68df9d7e00e38',
	kind: 1448,
	created_at: 1794941149,
	tags: [
		['height', '344'],
		['hash', 'b14bcdd68be8a35f9f5135ce37faceb7b8fc0601b9d984e0ce013324fd11dad7'],
		['p', '1e17774d0db6fbffc4488b607d4b9e3c8295212fd1c556d54ee68df9d7e00e38'],
	],
	content: `{"schema":"arena.params.v1","height":344,"app_hash":"b14bcdd68be8a35f9f5135ce37faceb7b8fc0601b9d984e0ce013324fd11dad7","params_version":"71ca57eb83d61d0bc59a2aebdd8557916acd4b9f34865e3c36d7ed7d1311298b","group_key":"03be47f12cc26f63cedb617ecc5dae10485aab91a63bd7ba808ae7c4f23e853da4","mint_url":"http://127.0.0.1:3338","keyset_id":"0102b930f4dc2d6a8cb29b56e30d3e16436337859f54b77849ad1a1297be2880a1","keys":{"1":"02007e8bbfab13726995088c8a539dcaac86dd7af264e7309432a15645ab60f9fe","1024":"03b7c457f25cd20139f055e91a265d076348539f5d22d2421def33b8291c43410e","1048576":"03d95a61687b14cbffd4442edfbb9f974294935d0b1331b6ee88e5ed1f5f698eca","1073741824":"021357d541e69149285c8aec853148bcae55ed7c989c542bb11df025724b08285f","1099511627776":"031c3393aa178eecdb38b2667aafca6402cff8e00729c6dd5d44a29ab0ac7fe9bd","1125899906842624":"032f64c058cef627759ebc2de44f91481ee881bca44616ad53258390fde1f173e4","1152921504606846976":"03f0e5c5b9d7ecd3a9edf18c8e0da0a671ca84b1fa4fcef751acaa90973d7bdb52","128":"03a95b4a679974ee0ee4486689e5a075663e82e50dc9d409d1c6320d86f338ab0a","131072":"025e67142b7818c79f31d68c11272b3844d5539f084a077c7ef4380e9fb56fdd4e","134217728":"0253e9180d3ad169a72f816eda99955905ce6be414104b621aa1995ba8870274dc","137438953472":"03778f5f4db613fbf38e83e0898407e76848a5f1524be019e8c2fa3ade54ad696a","140737488355328":"02e47a1f33018e573503ba45cd38378ace80c5539dcadcc6e579210c6b60b5ce82","144115188075855872":"02e53909d66827c6e734219aa6377134770f22aea788e6166fb418816ff57ed741","16":"02e2291be3aa7bc74d9ee62da3d06a87a0e038a154fa4f0bcdb80a2806eae3e9a8","16384":"0226cdbfd1fa2ba77c6f63e4c0f805780880313c6e8d7a0971ce0197677a4f69ab","16777216":"02c031b86bf154c8a66178d06429d89de257baf7f2cb711681f5f7881ddc549c04","17179869184":"03841ce9eba9955cb5ba04500ee3ff08bcd8d462fb03ad492cdebdb625122e39fc","17592186044416":"02a5b85e6df091e3925a611d71fcc4813406f34f8ee7973d1f8f45299f283807fa","18014398509481984":"032f3df9b2f58a912e39244bbf6f19200c44599be91de1596def70880612710257","2":"0370d49c09ddf75b7705abaa7d03f86896779b5ba8ba212abb5dbad9829ebb6289","2048":"02a8f0fa85edd3ea1638eee282a75ded8ea5014df328354f0a0d44a6dd78a270f6","2097152":"038f09069aa605cd17ccecd2d3a8187466ce1ffd95ab95cd6b2174c9adbe757293","2147483648":"036956ff15d54d1d60eda37a4274d8186af68f13e0a3460b5d9dad5809d06b43ef","2199023255552":"03405a29571c2c1d7756633a40d4b04521ab8e1a17ded06103f18e5e5a07f16da7","2251799813685248":"030c6a099c4b6203e1a14896fbc15930cbcf04f34e6e3aad85179aead38e44d0f1","2305843009213693952":"03b220879d4ec85a5d54add6b7afb21b3a1c94baa9bfe463fd6cbdea75cd921c53","256":"0337b662eb0b53b30234e5c2bf3f9a577c534443fad18b789a46146e38032b137b","262144":"0322b503a5e2e6b81b1882730ff0be7168e69c5d7d34d060ee5a8f9f45476c3211","268435456":"03f7e874b4ffeb1ae0c155992a674748d9ae294211ece5b29f235f11b65f309b17","274877906944":"0340c4b5a9b525df3a74368fda3637df2e041ec178fbdc3964ddc07ed2c4eaee28","281474976710656":"0212b124abefb4db87b1d60a3cd81888f25d20ec245c7e5b47020a3d4dcdc9d2a9","288230376151711744":"023e8ddbaeb54bfa5fce00536d77c78da5db175ae786aa39e7fbf5f0e26e693acc","32":"020861ebdaae5c1f42720e6e76e32680f4b008ecd4b05b4b2ba6b20cc2ccb6cf82","32768":"02d7fbdbc1162070acbb42dc4aa595a1eefe5555eb214d533c776305eb4c75f013","33554432":"022afff411360bb626516c0a5bdb5a138baf6f823b54a65610ea9d3410553bc7f0","34359738368":"03219236857a511e0711dec2a14cf5865dccbbabebacce122d549d90062e8b1a45","35184372088832":"02e130355e588716bb8a6d9a9a00008f6eaade7fd6528cc730a0613392f33634b9","36028797018963968":"03854bc6162a321d2211cb7e47ba1e8f9782113bb12aab82183edebf2c61457c37","4":"02f4bbf033d6fc87ccbcba9e055f9c19566e2d646a69e9698743f933a46cefd8e7","4096":"038b4e6343c0aa69b5e9b0cca6e988607b8686ceb6c5cd7ed02a53685cda97c91a","4194304":"0330e688fe58bd0a5708001a02cf3ae675d7d8c0f2bcd89e1ae3418453eb920470","4294967296":"03890b52ee0e184718ae3d58d15301502f03fc30388b208d48d4b8b151cd6f7f05","4398046511104":"038fe7a8b6d6804a47ab7c072b77bbd60fda729c13112e12c7fcf70a095a5c855d","4503599627370496":"03a410b8c80a4046904e587d2045b9c91c473fb6d49184099206eccf709522d522","4611686018427387904":"027d992c18009c046436f70156625c4ffe27939dd92f1ce6f60cac476be52f0e6c","512":"0371809ea97b6b820bbebdc7ba2b0c2a3fc0012bee3664b9aca1f4095a1017b78a","524288":"02644073552b034ee2f5f4a0a822f3aa76007d1c768cd65830447bf5a8287531f2","536870912":"0279353b07da2d9caca34714a67281ac8a4106f5064384396cbd4866814ab0f032","549755813888":"02d333978377ba46288e3b5e84074bdf6cf467d48709e196e542683a9ec9c14ecc","562949953421312":"03d358365a119698c70bf213c17990621aac514feded69bbbaf821cacb8ab1e742","576460752303423488":"038cbb07d3df8a767ddb0fc42c1999ab63f5e6357d40ba3d187a234320e6a8334f","64":"02381006b17d0ffe633e595841679b3a186641f637eb3c3d53a453ce609b9d0f4a","65536":"020b21542e2b171b9c4538c7fec6d22064d252dc1522e3fa0e07b44c98437386cb","67108864":"02064322e8ace358d8a78e36ce14ba6aaeb85c6d618ad192b6faffb3c6316dd858","68719476736":"03a42cd2ae48a871d5ec6cd1ce85b639679655d3d2cc09e33db57a6e4b63417bf9","70368744177664":"03a53dcb6be1e75ed72c8082b7163493139938438b29124b16b75aca263e0ca85b","72057594037927936":"02b8e2ade8f8efe70a2773d9e53529445870f1af44abac22511e7ec43f35cebb10","8":"02be8a127c99ce44c862ea7923c8f75956ec433e3d4b7699ea400ee804936bad2f","8192":"022e180b38a741104399cc5ed879735cfff1e4995e00cd494e069a2534c48f1fab","8388608":"03b668d8120feb4efaba94480eadc45821436b69b7d5c67c86f909c4ced813af89","8589934592":"0377d76d45ade26792b47ae198edb8348fa89e715dfa0a3aa3bc34d28779ed24ba","8796093022208":"030eade4a62b9cb577b33ccfe6314264a06b38d0403cba705fc54dc5f3647e1db6","9007199254740992":"0207d30f1f751703818cec6ab58bf481dc219226215547eb18619228fa0c4aabb3","9223372036854775808":"0349d295e8ee7b525484cc464efead1d470bf651fe2b4c7f0f2b52f43c19bc2f2b"},"settlement_safety_sec":900,"bid_to_consensus_latency_sec":15,"min_window_sec":60,"max_window_sec":900,"min_duration_sec":20,"max_duration_sec":259200,"max_proofs":64,"threshold":3,"validators":[{"pubkey":"1e17774d0db6fbffc4488b607d4b9e3c8295212fd1c556d54ee68df9d7e00e38","name":"Validator 1","index":1},{"pubkey":"42178359d5ccb5aa975507fa0d46af19e9be70e18829613bb1a75e9e2ecb5a50","name":"Validator 2","index":2},{"pubkey":"b81658ebbfcf2cd6f7bbcbe470852bd47d2ef058444ac0bb53eef3d0d287b512","name":"Validator 3","index":3},{"pubkey":"4e1c04b91a63ac4ea41f4a2663fd1c0ac0343b5360abfdaf94057cff5425c0fe","name":"Validator 4","index":4}]}`,
	sig: 'edea477afef1569256fe65b80b5b49aa879d5b5590630014a870922e0d603a13d63f816805206a297d6e38e99594cc24a2f8c77506e1ed9892b07ce5cda4f1ab',
}

/** kind 1448, height 20 — a foreign short-lived test chain on the same relay. */
const FOREIGN_EVENT: ArenaParamsEventLike = {
	id: 'bedc192d41f3d50823c1308620ddb5fd42b7e6cfcdc97892961e3dbf4c03d501',
	pubkey: '8b9a25836a1749a77ccdfaaaf64890d47c329e9be8365bc94b4f5168da776bb5',
	kind: 1448,
	created_at: 1794931235,
	tags: [
		['height', '20'],
		['hash', '7741214fe4cd8ced4771c5fd780288c70d62db3cecd88ae5b57e4f78f88d3d16'],
		['p', '8b9a25836a1749a77ccdfaaaf64890d47c329e9be8365bc94b4f5168da776bb5'],
	],
	content: `{"schema":"arena.params.v1","height":20,"app_hash":"7741214fe4cd8ced4771c5fd780288c70d62db3cecd88ae5b57e4f78f88d3d16","params_version":"0c8756c71e5fda83150109ce266c1cd1f93241b9931389d3fcb0aa38f70313fa","group_key":"0273626a7e17fa343e7b48e1263c749f13353e315c8f7a1c907a2f41ab52e5d436","mint_url":"http://127.0.0.1:3338","keyset_id":"0102b930f4dc2d6a8cb29b56e30d3e16436337859f54b77849ad1a1297be2880a1","keys":{"1":"02007e8bbfab13726995088c8a539dcaac86dd7af264e7309432a15645ab60f9fe","1024":"03b7c457f25cd20139f055e91a265d076348539f5d22d2421def33b8291c43410e","1048576":"03d95a61687b14cbffd4442edfbb9f974294935d0b1331b6ee88e5ed1f5f698eca","1073741824":"021357d541e69149285c8aec853148bcae55ed7c989c542bb11df025724b08285f","1099511627776":"031c3393aa178eecdb38b2667aafca6402cff8e00729c6dd5d44a29ab0ac7fe9bd","1125899906842624":"032f64c058cef627759ebc2de44f91481ee881bca44616ad53258390fde1f173e4","1152921504606846976":"03f0e5c5b9d7ecd3a9edf18c8e0da0a671ca84b1fa4fcef751acaa90973d7bdb52","128":"03a95b4a679974ee0ee4486689e5a075663e82e50dc9d409d1c6320d86f338ab0a","131072":"025e67142b7818c79f31d68c11272b3844d5539f084a077c7ef4380e9fb56fdd4e","134217728":"0253e9180d3ad169a72f816eda99955905ce6be414104b621aa1995ba8870274dc","137438953472":"03778f5f4db613fbf38e83e0898407e76848a5f1524be019e8c2fa3ade54ad696a","140737488355328":"02e47a1f33018e573503ba45cd38378ace80c5539dcadcc6e579210c6b60b5ce82","144115188075855872":"02e53909d66827c6e734219aa6377134770f22aea788e6166fb418816ff57ed741","16":"02e2291be3aa7bc74d9ee62da3d06a87a0e038a154fa4f0bcdb80a2806eae3e9a8","16384":"0226cdbfd1fa2ba77c6f63e4c0f805780880313c6e8d7a0971ce0197677a4f69ab","16777216":"02c031b86bf154c8a66178d06429d89de257baf7f2cb711681f5f7881ddc549c04","17179869184":"03841ce9eba9955cb5ba04500ee3ff08bcd8d462fb03ad492cdebdb625122e39fc","17592186044416":"02a5b85e6df091e3925a611d71fcc4813406f34f8ee7973d1f8f45299f283807fa","18014398509481984":"032f3df9b2f58a912e39244bbf6f19200c44599be91de1596def70880612710257","2":"0370d49c09ddf75b7705abaa7d03f86896779b5ba8ba212abb5dbad9829ebb6289","2048":"02a8f0fa85edd3ea1638eee282a75ded8ea5014df328354f0a0d44a6dd78a270f6","2097152":"038f09069aa605cd17ccecd2d3a8187466ce1ffd95ab95cd6b2174c9adbe757293","2147483648":"036956ff15d54d1d60eda37a4274d8186af68f13e0a3460b5d9dad5809d06b43ef","2199023255552":"03405a29571c2c1d7756633a40d4b04521ab8e1a17ded06103f18e5e5a07f16da7","2251799813685248":"030c6a099c4b6203e1a14896fbc15930cbcf04f34e6e3aad85179aead38e44d0f1","2305843009213693952":"03b220879d4ec85a5d54add6b7afb21b3a1c94baa9bfe463fd6cbdea75cd921c53","256":"0337b662eb0b53b30234e5c2bf3f9a577c534443fad18b789a46146e38032b137b","262144":"0322b503a5e2e6b81b1882730ff0be7168e69c5d7d34d060ee5a8f9f45476c3211","268435456":"03f7e874b4ffeb1ae0c155992a674748d9ae294211ece5b29f235f11b65f309b17","274877906944":"0340c4b5a9b525df3a74368fda3637df2e041ec178fbdc3964ddc07ed2c4eaee28","281474976710656":"0212b124abefb4db87b1d60a3cd81888f25d20ec245c7e5b47020a3d4dcdc9d2a9","288230376151711744":"023e8ddbaeb54bfa5fce00536d77c78da5db175ae786aa39e7fbf5f0e26e693acc","32":"020861ebdaae5c1f42720e6e76e32680f4b008ecd4b05b4b2ba6b20cc2ccb6cf82","32768":"02d7fbdbc1162070acbb42dc4aa595a1eefe5555eb214d533c776305eb4c75f013","33554432":"022afff411360bb626516c0a5bdb5a138baf6f823b54a65610ea9d3410553bc7f0","34359738368":"03219236857a511e0711dec2a14cf5865dccbbabebacce122d549d90062e8b1a45","35184372088832":"02e130355e588716bb8a6d9a9a00008f6eaade7fd6528cc730a0613392f33634b9","36028797018963968":"03854bc6162a321d2211cb7e47ba1e8f9782113bb12aab82183edebf2c61457c37","4":"02f4bbf033d6fc87ccbcba9e055f9c19566e2d646a69e9698743f933a46cefd8e7","4096":"038b4e6343c0aa69b5e9b0cca6e988607b8686ceb6c5cd7ed02a53685cda97c91a","4194304":"0330e688fe58bd0a5708001a02cf3ae675d7d8c0f2bcd89e1ae3418453eb920470","4294967296":"03890b52ee0e184718ae3d58d15301502f03fc30388b208d48d4b8b151cd6f7f05","4398046511104":"038fe7a8b6d6804a47ab7c072b77bbd60fda729c13112e12c7fcf70a095a5c855d","4503599627370496":"03a410b8c80a4046904e587d2045b9c91c473fb6d49184099206eccf709522d522","4611686018427387904":"027d992c18009c046436f70156625c4ffe27939dd92f1ce6f60cac476be52f0e6c","512":"0371809ea97b6b820bbebdc7ba2b0c2a3fc0012bee3664b9aca1f4095a1017b78a","524288":"02644073552b034ee2f5f4a0a822f3aa76007d1c768cd65830447bf5a8287531f2","536870912":"0279353b07da2d9caca34714a67281ac8a4106f5064384396cbd4866814ab0f032","549755813888":"02d333978377ba46288e3b5e84074bdf6cf467d48709e196e542683a9ec9c14ecc","562949953421312":"03d358365a119698c70bf213c17990621aac514feded69bbbaf821cacb8ab1e742","576460752303423488":"038cbb07d3df8a767ddb0fc42c1999ab63f5e6357d40ba3d187a234320e6a8334f","64":"02381006b17d0ffe633e595841679b3a186641f637eb3c3d53a453ce609b9d0f4a","65536":"020b21542e2b171b9c4538c7fec6d22064d252dc1522e3fa0e07b44c98437386cb","67108864":"02064322e8ace358d8a78e36ce14ba6aaeb85c6d618ad192b6faffb3c6316dd858","68719476736":"03a42cd2ae48a871d5ec6cd1ce85b639679655d3d2cc09e33db57a6e4b63417bf9","70368744177664":"03a53dcb6be1e75ed72c8082b7163493139938438b29124b16b75aca263e0ca85b","72057594037927936":"02b8e2ade8f8efe70a2773d9e53529445870f1af44abac22511e7ec43f35cebb10","8":"02be8a127c99ce44c862ea7923c8f75956ec433e3d4b7699ea400ee804936bad2f","8192":"022e180b38a741104399cc5ed879735cfff1e4995e00cd494e069a2534c48f1fab","8388608":"03b668d8120feb4efaba94480eadc45821436b69b7d5c67c86f909c4ced813af89","8589934592":"0377d76d45ade26792b47ae198edb8348fa89e715dfa0a3aa3bc34d28779ed24ba","8796093022208":"030eade4a62b9cb577b33ccfe6314264a06b38d0403cba705fc54dc5f3647e1db6","9007199254740992":"0207d30f1f751703818cec6ab58bf481dc219226215547eb18619228fa0c4aabb3","9223372036854775808":"0349d295e8ee7b525484cc464efead1d470bf651fe2b4c7f0f2b52f43c19bc2f2b"},"settlement_safety_sec":900,"bid_to_consensus_latency_sec":15,"min_window_sec":60,"max_window_sec":900,"min_duration_sec":20,"max_duration_sec":259200,"max_proofs":64,"threshold":3,"validators":[{"pubkey":"1e5519637fd96b7472f49fda9d5a745f4567c212116d8cff5aba4d585e73e8b4","name":"Validator 1","index":1},{"pubkey":"a42d297193ccedb100149cce1d65f590c37cf9f0b9a2d1e627d13d72f7938dd9","name":"Validator 2","index":2},{"pubkey":"378f53e0ea9df20d3627f2e2f9480899a48bf852825f99e887b1f48fde7fe5c0","name":"Validator 3","index":3},{"pubkey":"8b9a25836a1749a77ccdfaaaf64890d47c329e9be8365bc94b4f5168da776bb5","name":"Validator 4","index":4}]}`,
	sig: 'd786380c34b4a9970cc8c87605f94fcd087c79952481ba1a9503eddf77f4357c362a7207d37a5dac9e8bb0560ec036df2af8b4075959caf390e078c701b8a59a',
}

/** The live event's own parameters, for overrides. */
const LIVE_CONTENT = JSON.parse(LIVE_EVENT.content) as Record<string, unknown>

// ---------- Synthetic helpers ---------------------------------------------

const getSk = (seed: number): Uint8Array => new Uint8Array(32).fill(seed)
const SIGNER = (() => {
	const sk = getSk(7)
	return { sk, pubkey: getPublicKey(sk) }
})()

/** Sign a params event with the deterministic roster key (unless overridden). */
function signedParams(
	content: Record<string, unknown>,
	over: { tags?: string[][]; kind?: number; sk?: Uint8Array; pubkey?: string; created_at?: number } = {},
): ArenaParamsEventLike {
	const sk = over.sk ?? SIGNER.sk
	const pubkey = over.pubkey ?? SIGNER.pubkey
	const tags = over.tags ?? [
		['height', String(content.height)],
		['hash', String(content.app_hash)],
		['p', pubkey],
	]
	return finalizeEvent(
		{ kind: over.kind ?? ARENA_PARAMS_KIND, created_at: over.created_at ?? 1_794_941_149, tags, content: JSON.stringify(content) },
		sk,
	) as unknown as ArenaParamsEventLike
}

/** A valid event in every respect: signed by a key that IS on its own roster. */
const rosterSigned = (over: { content?: Record<string, unknown>; tags?: string[][] } = {}): ArenaParamsEventLike =>
	signedParams({ ...LIVE_CONTENT, validators: [{ pubkey: SIGNER.pubkey, name: 'Validator 1', index: 1 }], ...over.content }, over)

const refusalOf = (event: ArenaParamsEventLike): ArenaParamsRefusalName => {
	try {
		parseArenaParamsEvent(event)
	} catch (error) {
		if (error instanceof ArenaParamsError) return error.refusal
		throw error
	}
	throw new Error('expected a refusal, got a parsed params')
}

// ==========================================================================
// The parser
// ==========================================================================

describe('parseArenaParamsEvent — the live relay fixture', () => {
	test('parses a signed, anchored, on-roster params event', () => {
		const parsed = parseArenaParamsEvent(LIVE_EVENT)
		expect(parsed.eventId).toBe(LIVE_EVENT.id)
		expect(parsed.signerPubkey).toBe('1e17774d0db6fbffc4488b607d4b9e3c8295212fd1c556d54ee68df9d7e00e38')
		expect(parsed.height).toBe(344)
		expect(parsed.appHash).toBe('b14bcdd68be8a35f9f5135ce37faceb7b8fc0601b9d984e0ce013324fd11dad7')
		expect(parsed.paramsVersion).toBe('71ca57eb83d61d0bc59a2aebdd8557916acd4b9f34865e3c36d7ed7d1311298b')
		expect(isVerifiedArenaParamsEvent(LIVE_EVENT)).toBe(true)
	})

	test('exposes every escrow term the relay committed', () => {
		const { terms } = parseArenaParamsEvent(LIVE_EVENT)
		expect(terms.group_key).toBe('03be47f12cc26f63cedb617ecc5dae10485aab91a63bd7ba808ae7c4f23e853da4')
		expect(terms.mint_url).toBe('http://127.0.0.1:3338')
		expect(terms.keyset_id).toBe('0102b930f4dc2d6a8cb29b56e30d3e16436337859f54b77849ad1a1297be2880a1')
		expect(Object.keys(terms.keys ?? {})).toHaveLength(64)
		expect(terms.settlement_safety_sec).toBe(900)
		expect(terms.bid_to_consensus_latency_sec).toBe(15)
		expect(terms.min_window_sec).toBe(60)
		expect(terms.max_window_sec).toBe(900)
		expect(terms.min_duration_sec).toBe(20)
		expect(terms.max_duration_sec).toBe(259200)
		expect(terms.max_proofs).toBe(64)
		expect(terms.threshold).toBe(3)
		expect(terms.validators?.map((validator) => validator.pubkey)).toEqual([
			'1e17774d0db6fbffc4488b607d4b9e3c8295212fd1c556d54ee68df9d7e00e38',
			'42178359d5ccb5aa975507fa0d46af19e9be70e18829613bb1a75e9e2ecb5a50',
			'b81658ebbfcf2cd6f7bbcbe470852bd47d2ef058444ac0bb53eef3d0d287b512',
			'4e1c04b91a63ac4ea41f4a2663fd1c0ac0343b5360abfdaf94057cff5425c0fe',
		])
		expect(terms.validators?.[0]).toEqual({
			pubkey: '1e17774d0db6fbffc4488b607d4b9e3c8295212fd1c556d54ee68df9d7e00e38',
			name: 'Validator 1',
			index: 1,
		})
	})

	test('exposes the create-content rules the chain publishes as code', () => {
		// The rules travel on `ParamsContent` only, so `params_version` is
		// unchanged by them. Signed and anchored like any reading.
		const event = signedParams({
			...LIVE_CONTENT,
			validators: [{ pubkey: SIGNER.pubkey, name: 'Validator 1', index: 1 }],
			max_title_chars: 120,
			max_description_chars: 2000,
			max_image_chars: 500,
			max_category_chars: 40,
			max_name_chars: 40,
			image_rule: 'same-site-or-https',
			start_price_min: 1,
			start_price_max: 10_000_000,
			increment_min: 1,
			increment_max: 1_000_000,
		})
		const { terms } = parseArenaParamsEvent(event)
		expect(terms.max_title_chars).toBe(120)
		expect(terms.max_description_chars).toBe(2000)
		expect(terms.max_image_chars).toBe(500)
		expect(terms.max_category_chars).toBe(40)
		expect(terms.max_name_chars).toBe(40)
		expect(terms.image_rule).toBe('same-site-or-https')
		expect(terms.start_price_min).toBe(1)
		expect(terms.start_price_max).toBe(10_000_000)
		expect(terms.increment_min).toBe(1)
		expect(terms.increment_max).toBe(1_000_000)
	})

	test('every term the relay did not carry is null — never a default, never a 0', () => {
		// A signed, anchored, on-roster event whose content carries ONLY the schema,
		// the anchor and the roster: every escrow term is absent.
		const sparse = signedParams({
			schema: 'arena.params.v1',
			height: 344,
			app_hash: 'b14bcdd68be8a35f9f5135ce37faceb7b8fc0601b9d984e0ce013324fd11dad7',
			validators: [{ pubkey: SIGNER.pubkey }],
		})
		const parsed = parseArenaParamsEvent(sparse)
		expect(parsed.paramsVersion).toBeNull()
		expect(parsed.terms).toEqual({
			group_key: null,
			mint_url: null,
			keyset_id: null,
			keys: null,
			settlement_safety_sec: null,
			bid_to_consensus_latency_sec: null,
			min_window_sec: null,
			max_window_sec: null,
			min_duration_sec: null,
			max_duration_sec: null,
			max_proofs: null,
			threshold: null,
			validators: [{ pubkey: SIGNER.pubkey, name: null, index: null }],
			max_title_chars: null,
			max_description_chars: null,
			max_image_chars: null,
			max_category_chars: null,
			max_name_chars: null,
			image_rule: null,
			start_price_min: null,
			start_price_max: null,
			increment_min: null,
			increment_max: null,
		})
	})
})

describe('the verifications the verdict path applies, each refused by name', () => {
	test('a tampered signature is refused as arena.params.bad_signature', () => {
		const tampered = { ...LIVE_EVENT, sig: `${LIVE_EVENT.sig.slice(0, -2)}${LIVE_EVENT.sig.endsWith('00') ? '11' : '00'}` }
		expect(refusalOf(tampered)).toBe(ARENA_PARAMS_REFUSAL_BAD_SIGNATURE)
	})

	test('an unsigned event is refused as arena.params.bad_signature', () => {
		expect(refusalOf({ ...LIVE_EVENT, sig: '' })).toBe(ARENA_PARAMS_REFUSAL_BAD_SIGNATURE)
	})

	test('a wrong schema is refused as arena.params.bad_schema', () => {
		expect(refusalOf(rosterSigned({ content: { schema: 'arena.params.v2' } }))).toBe(ARENA_PARAMS_REFUSAL_BAD_SCHEMA)
	})

	test('a tag anchor that disagrees with the content anchor is refused as arena.params.anchor_mismatch', () => {
		// The content height moved, the tags left at the canonical anchor.
		const canonicalAnchor: string[][] = [
			['height', String(LIVE_CONTENT.height)],
			['hash', String(LIVE_CONTENT.app_hash)],
			['p', SIGNER.pubkey],
		]
		expect(refusalOf(rosterSigned({ content: { height: 999 }, tags: canonicalAnchor }))).toBe(ARENA_PARAMS_REFUSAL_ANCHOR_MISMATCH)
		// The tag height moved, the content left at the canonical anchor.
		expect(
			refusalOf(
				rosterSigned({
					tags: [
						['height', '999'],
						['hash', String(LIVE_CONTENT.app_hash)],
						['p', SIGNER.pubkey],
					],
				}),
			),
		).toBe(ARENA_PARAMS_REFUSAL_ANCHOR_MISMATCH)
		// The tag hash moved, the content app_hash left at the canonical anchor.
		expect(
			refusalOf(
				signedParams(
					{ ...LIVE_CONTENT, validators: [{ pubkey: SIGNER.pubkey }] },
					{
						tags: [
							['height', String(LIVE_CONTENT.height)],
							['hash', 'f'.repeat(64)],
							['p', SIGNER.pubkey],
						],
					},
				),
			),
		).toBe(ARENA_PARAMS_REFUSAL_ANCHOR_MISMATCH)
	})

	test('a non-roster signer is refused as arena.params.signer_not_in_roster', () => {
		// Signed by SIGNER (valid signature), but the committed roster is the live
		// four validators, which do not include SIGNER.
		expect(refusalOf(signedParams({ ...LIVE_CONTENT }))).toBe(ARENA_PARAMS_REFUSAL_SIGNER_NOT_IN_ROSTER)
	})

	test('a missing anchor is refused as arena.params.unanchored', () => {
		const noAnchor = signedParams({ schema: 'arena.params.v1', validators: [{ pubkey: SIGNER.pubkey }] }, { tags: [['p', SIGNER.pubkey]] })
		expect(refusalOf(noAnchor)).toBe(ARENA_PARAMS_REFUSAL_UNANCHORED)
	})

	test('a malformed hash anchor is refused as arena.params.bad_anchor', () => {
		const badHash = signedParams(
			{ schema: 'arena.params.v1', height: 344, app_hash: 'nothex', validators: [{ pubkey: SIGNER.pubkey }] },
			{
				tags: [
					['height', '344'],
					['hash', 'nothex'],
					['p', SIGNER.pubkey],
				],
			},
		)
		expect(refusalOf(badHash)).toBe(ARENA_PARAMS_REFUSAL_BAD_ANCHOR)
	})

	test('a wrong kind is refused as arena.params.bad_kind', () => {
		const wrongKind = signedParams({ ...LIVE_CONTENT, validators: [{ pubkey: SIGNER.pubkey }] }, { kind: 1447 })
		expect(refusalOf(wrongKind)).toBe(ARENA_PARAMS_REFUSAL_BAD_KIND)
	})
})

describe('params_version is an opaque comparison token, compared and never recomputed', () => {
	test('it is carried verbatim from the wire', () => {
		const parsed = parseArenaParamsEvent(LIVE_EVENT)
		expect(parsed.paramsVersion).toBe(String(LIVE_CONTENT.params_version))
	})

	test('two readings with identical terms keep their own, differing token', () => {
		const base = { ...LIVE_CONTENT, validators: [{ pubkey: SIGNER.pubkey, name: 'Validator 1', index: 1 }] }
		const a = parseArenaParamsEvent(signedParams({ ...base }))
		const b = parseArenaParamsEvent(signedParams({ ...base, params_version: 'f'.repeat(64) }))
		// The terms are byte-identical, so nothing here is derived from them.
		expect(a.terms).toEqual(b.terms)
		expect(a.paramsVersion).toBe(String(LIVE_CONTENT.params_version))
		expect(b.paramsVersion).toBe('f'.repeat(64))
		expect(a.paramsVersion).not.toBe(b.paramsVersion)
	})
})

// ==========================================================================
// The selection
// ==========================================================================

describe('selectNewestArenaParams', () => {
	test('a foreign event at a lower anchored height never shadows the live one', () => {
		for (const order of [
			[FOREIGN_EVENT, LIVE_EVENT],
			[LIVE_EVENT, FOREIGN_EVENT],
		]) {
			const selection = selectNewestArenaParams(order)
			expect(selection.params?.eventId).toBe(LIVE_EVENT.id)
			expect(selection.params?.height).toBe(344)
			expect(selection.refusals).toEqual([])
		}
	})

	test('a refused event is recorded by name and never becomes the reading', () => {
		const tampered = { ...LIVE_EVENT, id: 'ff'.repeat(32), sig: `${LIVE_EVENT.sig.slice(0, -2)}11` }
		const selection = selectNewestArenaParams([FOREIGN_EVENT, tampered])
		expect(selection.params?.eventId).toBe(FOREIGN_EVENT.id)
		expect(selection.refusals).toEqual([{ eventId: tampered.id, refusal: ARENA_PARAMS_REFUSAL_BAD_SIGNATURE, detail: expect.any(String) }])
	})

	test('nothing that arrived is a reading of null, not a guess', () => {
		expect(selectNewestArenaParams([])).toEqual({ params: null, refusals: [] })
	})
})

// ==========================================================================
// The read
// ==========================================================================

const readContextOf = (events: ArenaParamsEventLike[]): EventReadContext<NostrEventLike> => ({
	store: {} as unknown as EventReadContext<NostrEventLike>['store'],
	stream: async function* () {
		for (const event of events) yield { type: 'event', event: event as unknown as NostrEventLike }
		yield { type: 'caught-up', info: { eose: [], pending: [], complete: true } }
	},
	fetch: async () => events as unknown as NostrEventLike[],
})

describe('readArenaParams', () => {
	test('keeps the newest anchored reading from the relay stream', async () => {
		const selection = await readArenaParams({ context: readContextOf([FOREIGN_EVENT, LIVE_EVENT]) })
		expect(selection.params?.eventId).toBe(LIVE_EVENT.id)
		expect(selection.params?.height).toBe(344)
		// The foreign event is valid and on its own roster, so it is not refused —
		// it simply loses on anchored height.
		expect(selection.refusals).toEqual([])
	})

	test('a relay that delivers nothing is a null reading, never an error', async () => {
		const selection = await readArenaParams({ context: readContextOf([]) })
		expect(selection).toEqual({ params: null, refusals: [] })
	})
})
