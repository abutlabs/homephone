# Spec: restoring a Polkadot App account from its recovery phrase on a headless Pi

Read-only source study, 2026-11-20. Nothing in the clones was built or run. The only code I ran was a 40-line Python script of my own (`scratchpad/vecscript/vec.py`, `hashlib.blake2b` + `cryptography` X25519). It reproduces every upstream keyed-hash vector exactly (§1.6).

**Goal.** A Node process on the Pi holds only the recovery phrase of `landline.01`. It derives every key the account uses, then acts as that account's phone: it sends and receives chat and calls and signs Statement Store statements, with no other device running.

| Alias | Source | Head |
|---|---|---|
| `pac` | Polkadot-Community-Foundation/polkadot-android-community (**primary**) | `e7617c4`, 2026-11-17 |
| `pic` | iOS community app | `1574dff` |
| `tua` | trinity-user-agents (Rust TrUAPI core, CLI, JS) | as in `linked-device-spec.md` |
| `res` | `src/indiv/pallets/resources` (individuality, the `Resources` pallet) | `7137a05` |
| `LDS` | `homephone/docs/linked-device-spec.md` | |

Android paths are abbreviated: `…/feature_X_impl/` stands for `feature/X/impl/src/main/{java,kotlin}/io/paritytech/polkadotapp/feature_X_impl/`. **[inferred]** marks a conclusion I did not read directly in code. **[verify]** marks something to confirm on the devnet before relying on it.

---

## 0. Answer in brief

1. **Phrase to root.** Standard Substrate. `entropy` is the BIP-39 entropy (16 bytes for the App's 12 words). The mini-secret is `PBKDF2-HMAC-SHA512(entropy, "mnemonic", 2048)[0..32]` with an **empty password**. The root is the sr25519 keypair from that mini-secret, Ed25519 expansion, no path; it is pairing's `root_account_id`. Two further non-sr25519 trees hang off the raw entropy through keyed BLAKE2b-256: `ecdh` (X25519 keys) and `ring-vrf` (bandersnatch keys).
2. **Identity account** = sr25519 HDKD from the root: `//product//peopl.<tld>/<index_bytes(0)>`. That is two hard junctions, then one **soft** junction holding a 32-byte raw chain code. `<tld>` is read from the People chain (`NetworkSuffix.NetworkSuffix`). This account owns the username, signs pairing answers, is the phone's roster `stmt`, and holds the lite-person allowance.
3. **Identity chat key** = X25519 private `blake2b256(key = cc("chat"), msg = blake2b256(key = "ecdh", msg = entropy))`. `//wallet//chat` is a dead legacy value.
4. **Device encryption key** (`device_enc_pub_key`, roster `encPub`) is **random per install** and not derivable from the phrase. A restored install has a new one and must re-announce it.
5. **Chat signer.** The Android main session (chat + calls) signs with a **per-contact account** `//product//chat.<tld>//peer-statement//0x<peer id>`. That account gets its allowance from a **daily ring-VRF slot** (`Resources.set_statement_store_account`). If no slot can be had, it falls back to the identity account, with the user's consent. The identity channel and pairing answers are signed by the identity account; chat requests and acceptances by one-shot per-request accounts. **No receiver checks who signed**: only the signature itself is verified.
6. **Allowances.** The identity account's `50 / 512000` comes from `register_lite_person` (`LitePersonStatementLimit`). It is **permanent**: nothing in `Resources` ever decreases it for a lite person. Every other allowance (per-chat signers, linked devices, notification slots) is a 1-day slot that needs a fresh bandersnatch ring-VRF proof every UTC day.
7. **Restore** keeps the same username, identity account, chat key and ring-VRF member keys, because all are deterministic. No attestation and no re-registration are needed. Lost: contacts, rosters, messages, linked devices, and the device key, which is regenerated.
8. **Feasibility: yes, with no ring-VRF, backend or attestation.** The Pi signs **everything with the identity account** (its permanent 50-statement allowance). Receivers accept any valid signer. The cost is metadata privacy: the account behind every statement is public. Ring-VRF is optional, for privacy or more capacity, and is available natively in Rust (`truapi-host alloc-check --submit`, prebuilt aarch64 musl) or as WASM (`truapi_verifiable` inside `@parity/truapi-host@0.31.0`).

---

## 1. From the phrase to the roots

### 1.1 Mnemonic, entropy, mini-secret, root

- The App generates **12 words**: `MnemonicCreator.randomMnemonic(Mnemonic.Length.TWELVE)` (`…/feature_account_impl/domain/usecase/RealCreateNewAccountUseCase.kt:14`).
- Restore accepts the typed words, converts them to entropy and calls `initAccounts(entropy)`. Only the **entropy** is ever stored or backed up (`…/feature_backup_impl/ManualMnemonicInteractor.kt:22-27`; cloud backup `RealImportAccountFromBackupUseCase.kt:18-27` → `initAccounts(backup.value)`).
- `RealAccountSecretsFactory.create` (`…/feature_account_impl/data/storage/accountSecrets/RealAccountSecretsFactory.kt:15-34`):

```kotlin
val seed = SubstrateSeedFactory.deriveSeed32(mnemonic.words, password = null)
val junctions = SubstrateJunctionDecoder.decode(derivationPath)?.junctions.orEmpty()
val keypair = SubstrateKeypairFactory.generate(encryptionType, seed.seed, junctions)
return MetaAccountSecrets(entropy = mnemonic.entropy, seed = seed.seed, ...)
```

- `deriveSeed32` takes the first 32 bytes of the 64-byte seed (`chains/src/main/java/io/paritytech/polkadotapp/chains/util/SubstrateSdk.kt:156-163`).
- `SubstrateSeedFactory` is Nova's `substrate-sdk-android`, which is not vendored. Its seed is the substrate-bip39 one: `PBKDF2-HMAC-SHA512(password = entropy, salt = "mnemonic" ‖ password, 2048 iterations)`. **[inferred from the library; corroborated below]**
  - iOS does the same with `password: ""` and `seed.miniSeed` (`pic/Packages/KeyDerivation/Sources/WalletMnemonicKeypairFactory.swift`, `resolveDerivation` / `performKeypairDerivation`).
  - TrUAPI calls `substrate_bip39::mini_secret_from_entropy(entropy, "")` then `expand_to_keypair(ExpansionMode::Ed25519)`, documented as matching the phones (`tua/rust/crates/truapi/src/host_logic/product_account.rs:72-81`).
- **Root keypair** = sr25519 from the mini-secret, Ed25519 expansion, **no junctions**.
  - Its public key is pairing's `root_account_id`. `RealAccountDerivationUseCase.deriveRootAccount()` calls `create(..., derivationPath = null)` (`…/feature_account_impl/domain/usecase/RealAccountDerivationUseCase.kt:23-25,31-44`), used in `RealSsoHandshakeUseCase.kt:47`.
  - This matches the devnet fact that `root_account_id` (`5ERm7CR6…`) differs from the identity.

**Every sr25519 path in the App derives from this root mini-secret.** `AccountDerivationUseCase.deriveKeypair(path)` re-runs `create(mnemonic, SR25519, path)`. A path is always relative to the root, never to the identity account.

### 1.2 What `ACCOUNT_ENTROPY` is

In `KeyedEntropyDerivationTest.kt:11`, `ACCOUNT_ENTROPY = ByteArray(32) { it.toByte() }` is a test fixture (bytes 0..31).

In production the same role is played by `mnemonic.entropy`, the **raw BIP-39 entropy** (16 bytes for 12 words), read from the WALLET meta account's stored mnemonic:

- `RealSharedSecretDerivationUseCase.kt:26-29`
- `RealRingVrfEntropyDeriver.kt:24-26`
- `RealDeriveEntropyUseCase.kt:31-33`

Comment at `RealRingVrfEntropyDeriver.kt:22-23`: "every meta account shares the mnemonic, so its root is the tree's root".

### 1.3 Junction encoding (chain codes)

Substrate SURI paths: `//x` is a hard junction and `/x` a soft one. Each junction becomes a 32-byte chain code `cc(x)`:

| Junction text | `cc(x)` |
|---|---|
| `0x…` hex (even length) | the raw bytes, zero-padded to 32 (blake2b-256 if longer than 32) |
| all decimal digits | the integer as u64 little-endian (8 bytes), zero-padded to 32 |
| anything else | SCALE `str` = compact(len) ‖ utf8, zero-padded to 32; if longer than 32 bytes, `blake2b256(encoded)` |

Sources:

- **Hex rule.** `DerivationIndex32.kt:18-22`: "SubstrateJunctionDecoder maps a hex segment straight to the raw chain code". Pinned by `DerivationIndex32Test.kt:61-68`. iOS `ChatKeyPaths.swift:36`: "The 0x prefix makes the junction parser take the peer id as raw chain code".
- **String and number rules.** TrUAPI `create_chain_code` / `normalize_chain_code` (`product_account.rs:275-295`), with the test `chain_code_matches_dotli_encoding_rules` (`product_account/tests.rs:322-330`): `cc("product")[..8] = 1c 70 72 6f 64 75 63 74`.
- **JS equivalent.** `@polkadot/util-crypto` `DeriveJunction` / `keyExtractPath` has the same three rules (hex → raw, number → LE, string → compact-prefixed). **[inferred from library knowledge; check against §1.6 vectors]**

| Junction | Chain code (hex) |
|---|---|
| `chat` | `1063686174` + 27×`00` |
| `peopl.paseo` | `2c70656f706c2e706173656f` + 20×`00` |

### 1.4 `deriveKeyedEntropy`: keyed-hash HDKD (RFC-0022), for the ECDH and ring-VRF trees

`feature/account/api/src/main/java/io/paritytech/polkadotapp/feature_account_api/domain/derivation/KeyedEntropyDerivation.kt:11-19`:

```kotlin
fun deriveKeyedEntropy(root: ByteArray, path: String): ByteArray {
    val junctions = SubstrateJunctionDecoder.decode(path).junctions
    require(junctions.all { it.type == JunctionType.HARD }) { ... }        // soft junctions rejected
    return junctions.fold(root) { parent, junction -> parent.blake2b256(key = junction.chaincode) }
}
```

`ByteArray.blake2b256(key)` is BouncyCastle `Blake2bDigest(key, 32, null, null)` over the message `this` (`common/src/main/java/io/paritytech/polkadotapp/common/utils/Hashing.kt:6-18`). So:

```
kh(msg, key) = BLAKE2b(digest = 32 bytes, key = key, no salt, no personalization)(msg)
deriveKeyedEntropy(root, "//j1//j2…") = kh(kh(root, cc(j1)), cc(j2)) …     // key = full 32-byte padded chain code
```

The tree roots use short **unpadded** ASCII keys:

```
ecdhRoot    = kh(entropy, "ecdh")              // RealSharedSecretDerivationUseCase.kt:15,29
ringVrfRoot = kh(entropy, "ring-vrf")          // RealRingVrfEntropyDeriver.kt:14,26
```

### 1.5 Upstream test assertions

`KeyedEntropyDerivationTest.kt` asserts structure only, with no fixed outputs:

- fold order (`:15-24`);
- soft-junction rejection (`:26-29`);
- `ring-vrf` ≠ `ecdh` roots (`:32-37`);
- `//peopl.dot//0x00` ≠ `//peopl.dot//0x01`, 32 bytes (`:40-46`). These are **toy paths**: `0x00` is a 1-byte raw chain code, not the real index form (§2.2).
- `//chat`, `//sso` and `//game` all differ (`:49-55`).

Fixed vectors exist elsewhere:

| Vector | Source |
|---|---|
| `INDEX_MAGIC = blake2b256("product-account-index")[..28] = 12e86013736c5498f050b03cdc16957dff0e422fb92ca77ec3ab168f` | `DerivationIndex32Test.kt:15-20`; `tua …/product_account/tests.rs:86-91` |
| `ringVrfRoot(entropy = 01..20) = 372b08255c7798fe3193756296005adc4c44adb9f3986fb718aa98a48b4bf725` | `tua …/product_account/tests.rs:143-157` ("matches_ios_vectors") |
| full / lite person ring-VRF entropy, `dot`: `c47086f9…ef60af` / `8d7f5e15…3d16a9f` | same |
| `paseo`: full `50a2adfe7b557a72521789d3961795e71619ac8a19f9cb42b581f3fb703d7453`, lite `a0e869e303f9828ccfd006682798ab0e91c29ce3f1ce3d93c640449be4a157dc` | `:160-205` (cross-checked against `@web3-citizenship/accounts`) |
| root public key, entropy `AB×16` = `0062ba8ae929ea64bc2ad6f21359e96a29e236a41d376d1c5ba76491da94fc72` (self-computed pin) | `:294-309` |
| identity address, entropy `AB×16`: `paseo` → `5CM1iRJQs1fceofARxxpvmUbaS7kU3WtKPj5QS6ihwWWtYBG`, `testnet` → `5DWk4cZyixLSTtudEUVjKYmJb5cjAjj5Vq7QpQSGaurN3FNf`, `dot` → `5FhRx3HstiFQ8vx3fJhUHQpTJoEwG8RG6XSv48haMuzxrUGT` | `:230-281` |
| product account `//product//myapp.dot/<index_bytes(0)>`, entropy `AB×16` = `1c1ae478b564572f806ffa6352b4273d612beb01610b19f4e5bf444521cd5b5c` | `:102-123` |

`index_bytes(i) = u32le(i) ‖ INDEX_MAGIC`. So `index_bytes(0) = 00000000 12e86013…168f` and `index_bytes(1) = 01000000 12e86013…168f`.

### 1.6 Independent vectors computed for this spec (my script; it reproduces every upstream vector above)

| Input | Output |
|---|---|
| `ecdhRoot(entropy = 00..1f)` | `ee1158b3de393e8bbf9a2fa50593af97519c89add0ae0fde21c2e5eaa34ad35f` |
| chat priv / pub (`entropy = 00..1f`) | `ed8db94455f249a2b7e66d09416e3482b739f27333cf9d6dda8a2f856fbfaf73` / `d08180828082ba4a715b474c2a029026b6cdddbcc7dad5c235724a3ad4058607` |
| sso priv / pub (`entropy = 00..1f`) | `cd37fde9fe0ebe40347bf97464699025930bb4add0c154953e53a60b29b5d7c6` / `a64251e966e662dba0fb0658da5b6a6bdba27e58165dae9e4bd584b739b6cd33` |
| `ecdhRoot(entropy = AB×16)` | `02e68192427f2ad80428ca186dc2d8d25e371ec6fd2bac979bfa0eda15bdcc0a` |
| chat priv / pub (`entropy = AB×16`) | `e9a4ba42ad134d0a8294286faccc0fb7a5ea5e8ad44138c49f6c51a9e64ca680` / `fd5d29bfc104b18ab472c663eb71660b58c0a6976e04637ec68cbdd5132f7277` |
| sso pub (`entropy = AB×16`) | `7ddb367a577297d1ef062f214b136707932c9e531a3ea07560c1c12fd5d0427a` |
| `rootEntropySource(entropy = AB×16)` | `cb47970b71eba888a6965180220050421888109b59d2e8b2acea218c2b3e734e` |

The pub column is X25519 with RFC 7748 clamping applied by the curve library. The stored private key is the **unclamped** 32-byte hash, and `X25519PrivateKey.fromDerivedBytes` keeps it as is (`common/…/domain/model/X25519Keys.kt:36-40`).

**Live check, the strongest one available.** `X25519.pub(chat priv)` derived from `landline.01`'s phrase must equal `Resources.Consumers[identity].identifier_key[1..33]`. The identity itself must equal `Resources.UsernameOwnerOf("landline.01")`.

---

## 2. Every key an account uses

All sr25519 rows derive from the **root mini-secret** with the given path (Ed25519 expansion; hard = `hard_derive_mini_secret_key(cc, "")` then expand; soft = `derived_key_simple(cc, [])`).

| # | Key | Type / derivation | Path or formula | Source |
|---|---|---|---|---|
| R | **root** (`root_account_id`) | sr25519, no path | — | `RealAccountDerivationUseCase.kt:23-25` |
| W | **identity / WALLET** (`identity_account_id`, username owner, roster `stmt` of the phone) | sr25519 HDKD | `//product//peopl.<tld>/0x<index_bytes(0)>` | `ProductDerivationModule.kt:26-31`; `DerivationPaths.kt:18-19`; test `ReservedProductAccountDerivationProviderTest.kt:18-26` |
| D | DEPOSIT (funding) | sr25519 | `//product//fund.<tld>/0x<index_bytes(0)>` | `ProductDerivationModule.kt:33-38` |
| C | CANDIDATE (game / full-person candidate) | sr25519 | `//product//dim2.<tld>/0x<index_bytes(0)>` | `:40-45` |
| A | ALIAS accounts | sr25519 | `//<bandersnatch context as string>` | `RealAccountRepository.kt:144-158,170` |
| P | product accounts | sr25519 | `//product//<productId>/0x<idx32>`; subtree `//product//<productId>` | `DerivationPaths.kt:12-19` |
| X | **identity chat key** | X25519 | `kh(kh(entropy,"ecdh"), cc("chat"))` | `RealSharedSecretDerivationUseCase.kt:24-33`; `SharedSecretDerivationDomain.kt:10` |
| S | SSO encryption key (`sso_enc_pub_key`) | X25519 | `kh(kh(entropy,"ecdh"), cc("sso"))` | `SsoDerivationDomains.kt:6`; `RealSsoHandshakeUseCase.kt:70-71` |
| E | `root_entropy_source` | 32 B | `kh(entropy, "product-entropy-derivation")`; per product `kh(res, blake2b256(utf8 productId))`, then `kh(…, userKey)` | `RealDeriveEntropyUseCase.kt:11,18-34` |
| VL | **lite-person ring-VRF** (LitePeople member; WALLET) | bandersnatch secret from 32-byte entropy | `kh(kh(kh(entropy,"ring-vrf"), cc("peopl.<tld>")), index_bytes(1))` | `ProductDerivationModule.kt:21,54-59`; `DerivationPaths.kt:24-25`; `RealRingVrfEntropyDeriver.kt` |
| VF | full-person ring-VRF (People member; CANDIDATE) | bandersnatch | same with `index_bytes(0)` | `ProductDerivationModule.kt:20,47-52` |
| K | **per-chat statement signer** X(A,B) | sr25519 | `//product//chat.<tld>//peer-statement//0x<B.identity 32 B hex>` | `ChatSignerAccountDerivation.kt:12,26-29`; test `ChatSignerAccountDerivationTest.kt:24-28`; iOS `ChatKeyPaths.swift:10-12,37-40` |
| Tq | chat-request delivery account | sr25519 | `//chat-request//<requestId>//<period>` | `ChatRequestDeliveryKeypairDerivation.kt:23-39`; test `…DeliveryKeypairDerivationTest.kt:24-29` |
| Ta | chat-acceptance delivery account | sr25519 | `//chat-accept//<requestId>//<period>` | same, `:44-50` |
| H | HOP (attachments) upload account | sr25519 | `//product//chat.<tld>//hop` | `…/feature_chats_impl/data/hop/auth/HopSigner.kt:35-43` |
| AL | allowance accounts for products | sr25519 | `//allowance//{bulletin\|statement-store}//<productId>` | `…/feature_products_impl/domain/accountsProtocol/AllowanceAccountDerivation.kt:9-27` (products' host API only; **not chat**) |
| DS | coinage datastore | sr25519 | `//datastore` | `…/feature_coinage_impl/data/dataStore/DataStoreAccountKeys.kt:35,52` |
| CO | coinage coins | sr25519 | `//coinage//<purse>//<installation>` + child | `CoinKeypairDerivation.kt:61-62` |
| **DEV** | **device encryption key** (`device_enc_pub_key`, roster `encPub`) | X25519, **random** | — | `…/feature_statement_store_impl/domain/RealOurDeviceKeypairProvider.kt:16,40-49` |
| JWT | backend client key | sr25519, **random** | — | `common/…/data/keypair/ClientKeypairStore.kt` (`jwt_client_keypair_v1`) |

**`<tld>`** is the network's dotNS suffix, read from the People chain storage `NetworkSuffix::NetworkSuffix` (bytes → utf8; `[a-z0-9][a-z0-9-]{0,62}`). Sources: `…/feature_dotns_impl/data/repository/RealNetworkSuffixRepository.kt:15-19`; `RealDotNsTldProvider.kt`.

- The App waits for it before deriving any key: "a path derived from a guessed TLD would mint keys that belong to no network" (`ReservedProductAccountDerivationProvider.kt:11-15`; `DotNsTldProvider.kt:25-35`).
- **[verify]** Read it on devnet People 1004. It is probably `paseo` or `testnet`.
- If unsure, derive the identity for every candidate and pick the one equal to `UsernameOwnerOf("landline.01")` (expected `0x…` of the house account, analogous to `abutlabs.01`'s `0xcc8b6f…`).

`DEPOSIT`, `CANDIDATE`, `ALIAS`, product, coinage, HOP and datastore keys are not needed for chat or calls.

---

## 3. The identity account (Q2)

- **Path.** `//product//peopl.<tld>/0x<index_bytes(0)>`, starting from the root mini-secret.
  - `product` and `peopl.<tld>` are **hard**: string chain codes.
  - The last junction is **soft**, with the 32 raw bytes `00000000 12e86013736c5498f050b03cdc16957dff0e422fb92ca77ec3ab168f` as its chain code.
  - Sources: `DerivationPaths.kt:14-19` ("soft below the product boundary"); TrUAPI `derive_identity_keypair` (`product_account.rs:107-120`).
- **Type.** sr25519, by HDKD. It is **not** a mini-secret of its own.
- **Not the root.** The App creates the WALLET meta account with this path at `initAccounts` (`RealAccountRepository.kt:89-106,112-138`). `walletAccount.defaultAccountId()` = this public key (`MetaAccount.kt:53-55`).
- **Uses:**
  - Pairing `identity_account_id` (`RealSsoHandshakeUseCase.kt:76`).
  - Signer of pairing answers: `handshakeRepository.submitHandshakeAnswer(…, walletAccount)` (`:48,54`).
  - The phone's roster entry `stmt`: `RealOurDevicesProvider.kt:17-19` and `IncomingChatRequestProcessor.kt:432-438` (`DeviceInfo(statementAccountId = walletAccount.defaultAccountId(), encryptionPublicKey = ourDeviceKeypairProvider.publicKey())`).
  - The `localAccount` in every chat `SessionId`, i.e. topics (`RealContactChatSessionManager.kt:128-137`).
  - Signer of the identity channel (`:401`, created with `create(account)` → `createKeyPairProver(metaAccount)` = WALLET keypair, `RealStatementStoreMessageProverFactory.kt:13-15`).
  - Fallback chat signer (§5).
  - The username registration signatures (`CreateClaimParamsUseCase.kt:94-107,121-152`).

**Node recipe** **[inferred API; check against the §1.5 / §1.6 vectors]**:

```js
import { cryptoWaitReady, mnemonicToEntropy, mnemonicToMiniSecret, sr25519PairFromSeed,
         keyExtractPath, keyFromPath, blake2AsU8a } from '@polkadot/util-crypto';
await cryptoWaitReady();
const entropy = mnemonicToEntropy(phrase);             // 16 bytes
const root    = sr25519PairFromSeed(mnemonicToMiniSecret(phrase, ''));   // == root_account_id
const MAGIC   = blake2AsU8a(new TextEncoder().encode('product-account-index'), 256).slice(0, 28);
const idx0    = u8aToHex(u8aConcat(new Uint8Array(4), MAGIC));          // 0x00000000 12e8…168f
const identity = keyFromPath(root, keyExtractPath(`//product//peopl.${tld}/${idx0}`).path, 'sr25519');
```

`@scure/sr25519` (`secretFromSeed`, `HDKD.secretHard/secretSoft`) is a pure-JS alternative.

**Secret format.** The statement prover in `@novasamatech/statement-store` wants the 64-byte Ed25519-expanded secret (LDS §1.2 note). polkadot.js `sr25519PairFromSeed`'s `secretKey` is already in that "half-ed25519" form **[verify: re-derive the public key from it and compare]**.

---

## 4. The identity chat X25519 key (Q3)

```
chatPriv = blake2b256(key = cc("chat") = 1063686174 00…00 (32 B),
                      msg = blake2b256(key = "ecdh", msg = BIP39-entropy))
chatPub  = X25519.basepoint(chatPriv)          // clamped by the curve op
```

- **Source.** `RealSharedSecretDerivationUseCase.kt:22-33,39`: `root = mnemonic.entropy.blake2b256(key = ECDH_ROOT_KEY)`, `deriveKeyedEntropy(root, "//chat")`, `X25519PrivateKey.fromDerivedBytes`.
- **Comment there:** "the ECDH tree hangs off the account entropy directly, not off an sr25519 derivation".
- **TrUAPI is identical:** `derive_identity_chat_private_key` (`tua …/host_logic/sso/pairing.rs:303-323`).
- **Sent at pairing** as `identity_chat_private_key`: the unclamped 32-byte hash (`RealSsoHandshakeUseCase.kt:67-68`).
- **On chain** as `Resources.Consumers.identifier_key` = `0x00 ‖ chatPub ‖ 32×00` (65 bytes; `CreateClaimParamsUseCase.kt:114-119`).
- **Restore.** Deterministic, so a restored install has the same chat identity and needs no `update_identifier_key`.

**`//wallet//chat`** is legacy. It was the old per-contact `sharedSecretDerivationPath` default written by `Migration10To11.kt:11-12,51`, from before RFC-0022. There is no migration to the new form.

- Today contacts store the **domain string** `"chat"` (`ContactMappers.kt:23,47`; `RealAddContactUseCase.kt:129`; `StartChatDataUseCase.kt:59`).
- The derivation always prepends `//` (`RealSharedSecretDerivationUseCase.kt:39`).
- A pre-RFC-0022 install is not interoperable with the current App, and nothing on chain uses the old key **[inferred]**. Ignore it.

**SSO key** (`sso_enc_pub_key`): the same construction with domain `sso`. The Pi needs it only if it answers pairing requests as the phone.

---

## 5. The phone's own device encryption key (Q4)

- **Random per install, never derived from the phrase.** `RealOurDeviceKeypairProvider.kt:40-49` loads `our_device_private_key` from encrypted prefs, or generates `keyGenerator.generateRandomKeypair()` and persists it.
- **Same design in TrUAPI:** `tua …/host_logic/device_key.rs:1-7`: "random rather than derived from the identity entropy: two devices restoring the same identity must not collapse onto the same key … a regenerated key silently strands peers still addressing the old one."

### 5.1 How a new key reaches contacts

Contact rosters are keyed by `(contactAccountId, statementAccountId)`, and writes are **upserts** (`database/…/model/ContactDeviceLocal.kt` `primaryKeys = ["contactAccountId","statementAccountId"]`; `ContactDevicesRepository.kt:47-49`).

- A restored phone keeps `stmt = identity` with a new `encPub`. Any `deviceAdded` / `deviceChatAccepted` it sends therefore **replaces** its old roster row at the contact.
  - `DeviceLifecycleMessageProcessor.kt:13-52`: "Acceptances are stored regardless of whether we still have a pending outgoing request: a contact that reinstalled re-accepts our old request with a fresh device key."
- **Chicken-and-egg.** A contact listens for our device on `SessionId(X25519(B.chatPriv, ourOld.encPub), identity, B.id)`. A message on the *main* session from the new key lands on a topic the contact does not watch. The new key must therefore arrive through:
  - (a) the **identity channel**, keyed only by `A.chatPriv` / `B.chatPub`, as `deviceChatAccepted` / `deviceAdded`; or
  - (b) the chat-request path: the restored side sends a chat request, whose V2 content carries `deviceEncPubKey`. The established contact auto-accepts, via the "reestablishContact" branch (`IncomingChatRequestProcessor.kt:146-150,191-204`).
- **Real App, after restore.** Contacts are lost locally, so the user re-adds people. That sends chat requests (b). Afterwards `ContactDeviceFanOutService` re-announces all our devices on the main session (`ContactDeviceFanOutService.kt:30-75`; `RealOurDevicesProvider.kt:15-28`).
- **Oddity [verify].** On path (b) the contact records the requester's device with `stmt = the chat-request statement **signer**`: the one-shot `Tq` account, or the identity in the fallback case. It does **not** use the identity (`IncomingChatRequestProcessor.kt:353,367,460-475`). The phone's real topics use the identity, so that row is a phantom. The later main-session fan-out adds the correct `(identity, encPub)` row.

### 5.2 Consequences for the Pi

- **(Recommended) Keep the linked-device identity the Pi already has**: `D.stmt`, `D.encPub` / `D.encPriv` from pairing.
  - The house phone has already fanned `D` out to `landline.01`'s contacts, so it is in their rosters. All the Pi's topics and envelopes (LDS §2.4) stay valid.
  - The **only** change is the statement **signer** (§6). No announcement is needed.
- **If the Pi must become the "phone" device** (`stmt = identity`), it gets a new random `encPub`. It must then send `deviceChatAccepted{requestId, {identity, newEncPub}}` (or `deviceAdded`) to every contact on the identity channel. **Do not do this while another install of `landline.01` (the Private Space phone) is alive**: both would claim `stmt = identity` and one would go deaf.
- **A fresh random `D'`** (new `stmt` and `encPub`) works too, announced the same way on the identity channel **[verify: Android applies `deviceAdded` arriving on the identity route; it does apply `deviceChatAccepted` there, as observed 20 Nov]**.

---

## 6. Who signs which statement, and with which allowance (Q5)

### 6.1 The rule on the receive side: nobody checks the signer

- `RealIncomingStatementsStream.kt:49-50`: `prover.verifyMessageProof(statement.body, statement.proof)`, then topic match and decrypt.
- `KeypairSigningStatementStoreMessageProver.kt:30-42` verifies against `proof.publicKey`, the key **embedded in the statement**. Nothing compares it with a roster `stmt`, the identity, or any derivation.
- Sender authenticity comes from the topic plus AEAD keys (`K_in` from `A.chatPriv` / `B'.encPub`) and the envelope slot (keyed by the device `stmt`, not the signer).
- Desktop / `@novasamatech/statement-store` behave the same (LDS §2.2).
- **The signer is free to choose.** The only constraint is the Statement Store's: the signer must hold a `:statement_allowance:`, and the store keeps one statement per (signer, channel).
- **Exception: chat requests from strangers.** These carry an `IdentityProof = kh(SCALE{identity, statementSigner, "mds-chat-request"}, key = X25519(A.chatPriv, B.chatPub))`, which binds the anonymous signer to the identity (`IdentityProofCodec.kt:21-33,53-64`; verified in `IncomingChatRequestVerifier.kt:24-43`).

### 6.2 What Android signs with

| Traffic | Signer | Allowance | Source |
|---|---|---|---|
| **Main (multi-device) session**: all chat content, `deviceAdded` fan-out, **call signalling** (`dataChannelOffer` / `Answer` / candidates / closed go through `chatEngine.sendUserMessage` → main session) | **K = per-chat account** `//product//chat.<tld>//peer-statement//0x<B.id>` | **a daily ring-VRF slot** (`AccountsApiAllowance` 2 stmts / 500 KiB), tag `chat-signer`, priority **Critical**, allocated by `ensureSlot` | `RealContactChatSessionManager.kt:302-305` (`createLazyKeyPairProver { chatSigners.keypairFor(contact) }`); `ContactChatSignerResolver.kt:27,39-81`; `RealExternalCallSignaling.kt:32-60`; `RealContactChatSession.kt:120-135` |
| … fallback when `allocate` fails with `NoAllocationAvailable` | **identity (W)**, only after the user consents for that chat (`IdentitySigningGate`) | lite-person allowance 50 / 500 KiB | `ContactChatSignerResolver.kt:47-50,83-87`; `IdentitySigningGate.kt` (RFC-0005 §4) |
| Signer lifetime | re-resolved every period (UTC day); slot renewed by the renewer | | `ContactChatSigners.kt:81-91` |
| **Identity channel** (single-device form; `deviceChatAccepted` etc.) | **identity (W)**. The App "never signs an acceptance" there: acceptances go out one-shot, and incoming acceptances are not acked | lite 50 | `RealContactChatSessionManager.kt:90-93,399-410`; `RealContactChatSession.kt:40-42,130-135` |
| Chat request (first delivery) | `Tq` `//chat-request//<id>//<period>`; fallback identity with consent | **notification slot** (ring-VRF, `NotificationAllowance` 1 / 10 KiB), else lite 50 | `ChatRequestDeliveryAccountResolver.kt:18-74` |
| Chat acceptance (`deviceChatAccepted`, one-shot on the identity route) | `Ta` `//chat-accept//<id>//<period>`; fallback identity | same | same; `IncomingChatRequestProcessor.kt:401-411` |
| Pairing answers (Pending / Success) | identity (W) | lite 50 | `RealSsoHandshakeUseCase.kt:48,54` |
| Linked device's own statements | the device's random `D.stmt` | slot allocated **and renewed by the phone** (priority High) | LDS §1.4; `RealRegisterDeviceUseCase.kt` |

**Correction to LDS.** LDS says "Android phones' statement account is the identity account". That holds for the **roster `stmt`**, for pairing answers and for the identity channel. For **chat and call statements on the main session**, current Android (and iOS, `ChatSignerManager.swift:33-49`) signs with the per-chat account `K` and slot-funds it. The identity signs those only as a consented fallback.

---

## 7. Allowances (Q6)

### 7.1 The identity's 50 / 512000

- `Resources.register_lite_person` → `register_lite_consumer_inner` → `increase_allowance_by(account, T::LitePersonStatementLimit::get())` (`res/src/lib.rs:677-692,1724-1769`, line 1766).
- Paseo-next parameters: `LitePersonStatementLimit = {max_size 500*1024, max_count 50}` (`src/indiv/runtimes/next-people-paseo/src/parameters.rs:46-48`). This matches the devnet value `50 / 512000`.
- **Permanent [inferred from the absence of any decrement].** The only `decrease_allowance_by` calls in `Resources` are:
  - `demote_auth_expired`: full persons only, removes the *extra* person allowance (`:852-858`);
  - clearing notification slots (`:944`);
  - replacing or clearing statement-store slots (`:983,1035`).
- Nothing expires a lite consumer, and there is no periodic touch for lite persons. **Nothing has to be renewed.**
- A full person (`register_person`) gets +150 / +512 KiB, but must `touch_person_authorization` within `PersonAuthDuration` or be demoted back to lite level (`:736-777,852-858`). `landline.01` is lite.

### 7.2 Slot allowances (per-chat signers, linked devices): `RegisterStatementStoreAllowance`

- **Call.** `Resources.set_statement_store_account(period: u32, seq: u32, target: AccountId)`, call index 10 (`res lib.rs:961-1001`). It grants `AccountsApiAllowance` = **2 stmts / 500 KiB** to `target`.
- **Origin.** Unsigned General (v5) extrinsic with the `AsResources` transaction extension, variant `RegisterStatementStoreAllowance(proof: BandersnatchProof, ringIndex, revision, collection: People | LitePeople)` (`…/feature_statement_store_impl/data/extension/AsResourcesInfoScale.kt:19-26`; `AsResourcesProofExtension.kt:20-46`; `RealStatementStoreOrigins.kt:24-31`).
  - Proof message = `blake2b256(inheritedImplication.encoded())`.
  - Proof context = `blake2b256("product/peopl.<tld>/" ‖ suffix32)`, where `suffix32 = "sys/" ‖ u32le(2) ‖ u32le(period) ‖ u32le(seq) ‖ 16×00` (`BandersnatchContextSss.kt:9-20`; `feature/people/api/…/PersonhoodProductContext.kt`; `ProductContext.kt:13-17`).
  - The prover is the **lite-person ring-VRF key VL** for `LitePeople`, or VF for `People` (`RealPeopleMembershipProver.kt`, `resolveMetaId`).
  - The ring is the member list of that collection's ring on People (Members pallet, ring index and revision).
- **Limits.**
  - `period = floor(unix / 86400)` (`CurrentPeriodProvider.kt:10,20-22`).
  - `LiteStmtStoreSlotsPerPeriod = 10` (full: 20). One alias per (period, seq).
  - Replacement cooldown 60 s; grace window 2 days after the period ends, after which the slot is cleared and its statements evicted within about 30 s (`parameters.rs:53-61`; `research-chain.md` §3).
- **Schedule.**
  - `StatementStoreSlotRenewalWorker` runs **hourly** (WorkManager, needs network), `renewer.renew(context, priorityAccount = null)` (`StatementStoreSlotRenewalWorker.kt:30-64`).
  - The renewer takes local rows whose `latestRenewedPeriod < current`, sorts them by priority (Critical > High > Normal), then most recent first. It pairs them with free seqs of the **current** period across collections and submits one `set_statement_store_account(period, seq, row.account)` per row with a fresh proof. Overflow rows are dropped (`RealStatementStoreSlotRenewer.kt:29-90,126-130`).
  - `allocate` also renews stale rows first (`RealStatementStoreSlotAllocator.kt:59-79,117-131`).
- **Net requirement.** A phrase holder must, **once per UTC day** (Android checks hourly), produce one ring-VRF proof per slot it wants to keep. A slot claimed on day *d* stays valid until about *d+3* 00:00 UTC.
- **The `//allowance//<system>//<productId>` accounts** (`AllowanceAccountDerivation.kt`) are product (dApp) allowance accounts requested through the host API (`ResourceAllocationRequestInteractor`). They have nothing to do with chat.

### 7.3 What a phone must do on a schedule to keep chat working

- **Android as shipped:** the hourly slot renewal (above). It covers per-chat signer slots and paired linked devices, plus notification slots on demand for chat requests.
- **A Pi that signs with the identity account:** **nothing.** The lite allowance does not expire.
- Watch the **count**: 50 live statements across all (signer = identity, channel) pairs. Statement expiry is effectively infinite (`(0xFFFFFFFF << 32) | priority`, LDS §2.2), so each channel the identity ever wrote keeps one slot of the count until it is replaced or evicted.
  - Per contact, budget about 2 (main request + response channel) plus at most 1 (identity channel).
  - On `accountFull{min_expiry}`, the store lets a higher priority evict the account's lowest one (LDS §2.2 retry).
  - Android caps chat statements at 100 KiB (`RealContactChatSessionManager.kt:119`); keep statements small, since the size cap is 500 KiB in total.

---

## 8. Restore on a new phone (Q7)

**What the App does** (`RecoverMnemonicViewModel.recover` → `restoreAccountWithEnteredMnemonic` → `initAccounts(entropy)`):

1. Waits for the TLD from chain, then creates meta accounts WALLET (`peopl`), DEPOSIT (`fund`) and CANDIDATE (`dim2`) at their paths, storing entropy, seed and keypair (`RealAccountRepository.kt:89-106`).
2. Username: `RealRecoverUsernameUseCase` reads `Resources.Consumers[identity]`. If present, it stores the lite and full usernames locally and the user counts as onboarded (`RealRecoverUsernameUseCase.kt:22-38`; `RealObserveAccountOnboardingStatusUseCase.kt`). **No attestation, no backend claim, no extrinsic.** The claim flow (`CreateClaimParamsUseCase`, attester, integrity tokens) runs only when no username exists.
3. Rebuilt lazily from the phrase on first use:
   - chat and SSO X25519 keys;
   - bandersnatch entropies (cached as the additional secret `BandersnatchEntropy` per meta account, `RealBandersnatchSecretsStorage.kt:29-52`);
   - per-chat, HOP and request accounts.
4. **Same as before:** identity account, username, chat identity (`identifier_key`), ring-VRF member keys. The lite member key is still in the LitePeople ring, so slot proofs keep working.
5. **New:** device encryption key, JWT client key, push tokens.
6. **Lost:** contacts, rosters, messages, consents, the slot-allocation table and SSO sessions (linked devices). Slots claimed by the old install stay on chain until they expire. The per-chat accounts are deterministic, so the new install simply re-claims slots for the same accounts.
7. **Re-establishment:** through chat requests (§5.1 path b), followed by device fan-out.

**Can a restored install keep the same username and chat identity?** Yes. Nothing about them is per-install. The device key, and with it the roster entry, is per-install.

---

## 9. Feasibility: a phrase-only Node process (Q8)

### 9.1 Minimum to implement

| # | Item | Notes |
|---|---|---|
| 1 | Phrase → entropy, root, **identity (W)**, **chatPriv (X)** | §1, §3, §4. Check against chain: `UsernameOwnerOf(landline.01) == W.pub`, `Consumers[W].identifier_key[1..33] == X25519.pub(X)`. Hard fail otherwise (wrong TLD or path). |
| 2 | Device identity | Reuse the paired `D` (160-byte `PairingDeviceIdentity`) as roster `stmt`/`encPub`. Or a fresh random `D'` / `stmt = identity` plus an announcement on the identity channel (§5.2). |
| 3 | **Statement prover = identity (W)** for every statement the Pi writes: main-session requests and acks, call signalling, identity channel, and pairing answers if it pairs devices | Replaces the 2-statement linked-device slot. Signature format per LDS §2.2 (sr25519, context `substrate`). |
| 4 | Everything in LDS §2-§3 (sessions, envelope, call signalling) unchanged | Topics use `D.stmt` and `A.id = W.pub`, not the signer. |
| 5 | Own contact/roster store | Device sync with a phone disappears once the phone is gone. Persist the contacts and rosters learned so far; keep applying live `deviceAdded` / `deviceRemoved` / `deviceChatAccepted`; resolve chat keys from `Resources.Consumers`. |
| 6 | Optional: incoming chat requests | Day/full topics `blake2b256(SCALE{"chat-request", acceptor = W, day?})` (`ChatRequestTopicDerivation.kt`). Accept by sending `deviceChatAccepted` signed by W. Notification slots are not needed. |
| 7 | Budget management | ≤ 50 live statements; reuse channels; small payloads (§7.3). |

### 9.2 What is not needed

- **Ring-VRF / bandersnatch.**
- **Identity backend / JWT / attestation.** The username already exists, and restore is a chain read.
- **Hourly renewals.**
- **A phone.**

TURN is unrelated to keys. The App's TURN still needs a Play Integrity / App Attest JWT, so bring your own (LDS §5.2).

### 9.3 Costs and risks

- **Privacy.** Every statement the Pi writes is publicly attributable to `landline.01`'s identity. Android avoids this with per-chat accounts and asks consent before the identity fallback. For a house phone this is probably acceptable; it is a policy choice, not a protocol barrier.
- **Shared budget with any other live `landline.01` install.** If the Private Space phone also falls back to identity signing, the two share the 50. On the identity channel they would overwrite each other's statement, since the channel and signer are the same for every device of A.
- **Phantom rosters.** When the Private Space phone is deleted, its `(identity, oldEncPub)` row stays in contacts' rosters. Senders keep wrapping a key for it (wasted bytes, harmless). The Pi may send `deviceRemoved{identity}` on the identity channel once that phone is gone **[verify]**.
- **Do not rely on per-path derivation drift.** Paths depend on the chain-reported TLD. An App release that changes RFC-0022 / RFC-0028 paths would move the identity, so pin and verify item 1 at every start.

### 9.4 Optional: Android-equivalent per-chat signers (needs ring-VRF)

**What the Pi would do:**

- Derive `K` per contact (§2).
- Each UTC day, for each contact, submit `set_statement_store_account(period, seq, K)` with a LitePeople proof from VL. 10 slots per day, so up to 10 contacts.

**Libraries:**

- The App uses `paritytech/verifiable` at rev `1f9f67524acce0d9c46dbbb566f84ce52757b114` (`BandersnatchVrfVerifiable::{new_secret, member_from_secret, alias_in_context, open, create}`) through a JNI cdylib (`bindings/bandersnatch-crypto/rust/Cargo.toml`, `src/lib.rs`; GPL-3.0).
- **JS/WASM:** `@parity/truapi-host@0.31.0` ships `dist/wasm/web/truapi_verifiable_bg.wasm` and `truapi_verifiable.js`, with exports `member(entropy)`, `sign`, `alias(entropy, ctx)`, `prove(entropy, domain, member, members, ctx, msg)`.
  - Built from `tua/rust/crates/truapi-verifiable` (verifiable rev `19b03deb…`, MIT); about 4.5 MiB of powers-of-tau.
  - Each export returns a SCALE `Result`.
  - It is the web build, so loading it in Node may need a manual `WebAssembly.instantiate` **[verify]**.
- **Native, simplest:** `truapi-host alloc-check --mnemonic "<phrase>" --target <K hex> --network … --submit`. Prebuilt for `aarch64-unknown-linux-musl`. It does the ring lookup, slot choice, proof and unsigned v5 extrinsic (`tua/rust/crates/truapi-host-cli/README.md` (command table), `SPEC.md` §19.3; core `truapi/src/runtime/statement_allowance*.rs`). A daily systemd timer would do.
  - Check that its `--network` matches the devnet stack.
  - Check that it uses the **LitePeople** collection for `landline.01`.
- **Not suitable:** `@novasamatech/substrate-slot-sr25519-wasm` is an sr25519 helper, not bandersnatch.

### 9.5 Verdict

**Feasible, indefinitely, with no phone.** The phrase deterministically yields the identity account, the chat key and the ring-VRF keys, and restore needs no attestation. The identity's lite allowance (50 / 500 KiB) is permanent and receivers do not check signers. A Pi that signs with the identity account therefore needs no ring-VRF, no backend and no renewals.

The work is small:

- derive W and X;
- swap the prover;
- keep `D`;
- maintain its own contact and roster store.

The real costs are metadata privacy and the 50-statement budget. Ring-VRF per-chat signers are an optional upgrade. They are available today through `truapi-host alloc-check` (native ARM) or the `truapi_verifiable` WASM.

### 9.6 To verify on devnet before building

1. `NetworkSuffix::NetworkSuffix` on People 1004, and that `W(phrase, tld) == UsernameOwnerOf("landline.01")`.
2. `X25519.pub(X) == identifier_key[1..33]` for `landline.01`.
3. A main-session chat statement signed by W (not `D.stmt`) is accepted by `statement_submit` and decoded by the Pixel. Expected yes (§6.1).
4. Android applies a `deviceAdded` / `deviceRemoved` received on the identity route (only needed if the Pi changes device identity).
5. polkadot.js `secretKey` layout versus what the statement-store prover expects.
