# Blyggdrasil 0.1

**One tree for everywhere you post.** Your blyg is the trunk, your accounts elsewhere are branches, and a key lets the tree survive a move.

Status: draft, 25 November 2026. This is recommended practice built on [Blygger 0.4](https://blygger.org/spec/0.4/), never protocol. It adds nothing to Blygger's wire. A reader that ignores all of it stays fully conformant to Blygger.

Blygger was first called Ygg, after Yggdrasil ([ygg-initial-spec](https://github.com/blygger/blygger-spec/blob/main/docs/ygg-initial-spec.md)). This document borrows the tree back.

## 1. What this builds on

Blygger refuses to put identity in the protocol (invariant 4, decision #11). This document keeps that refusal. It implements the practice Blygger has already written down:

- **Decision #35, [identity practice](https://github.com/blygger/blygger-spec/blob/main/docs/proposals/identity-practice-proposal.md): "a person is a URL they control".** It defines two proofs: a reciprocal link, and a detached signature over an item's `content_hash`. Its rule for becoming technical note TN-2 is "one client emits a proof and a second client verifies it". Section 6 is that signature, and section 5 is the reciprocal link, generalised to accounts on other networks.
- **[TN-6](https://blygger.org/notes/tn-6/)'s conventional `author.ids` member** (ruling 5): an unordered array of `https:`, `acct:` and `did:` URIs.
- **§5.10 `syndication`, §10.6 `stub_of {url}`, §8 pins and §16.13 `moved_from`** for republishing, history and moves.

Blyggdrasil adds three things, all of them outside the wire: a key format, a signed list of accounts carried in an ordinary post, and a fixed way to check each account.

**Conventions.** "MUST", "SHOULD" and "MAY" carry their usual meanings, for Blyggdrasil publishers and readers only. Every check needs nothing beyond what a programming language ships with: UTF-8, base64url, SHA-256, Ed25519, HTTPS and JSON. Ed25519 is in WebCrypto in current browsers and in Node.

## 2. Terms

- **Trunk:** the blyg's identity origin, as Blygger §12.2 defines it, for example `https://fishbiscuit.me/blyg/`.
- **Key:** an Ed25519 key pair. The public key is written as a `did:key`.
- **Tree:** a blyg item whose `content_md` carries a claims block and its signatures (section 4).
- **Branch:** an account or page elsewhere that the tree claims (section 5).
- **Back-reference:** text on a branch that points back at the tree. That is either the key (strong) or the trunk URL (link).
- **Verdict:** the outcome of checking one branch: `verified`, `failed`, `unreachable` or `claimed`.

## 3. Keys

A public key is written as a `did:key`: the string `did:key:z`, followed by the base58btc (Bitcoin alphabet) encoding of the bytes `0xed 0x01` and then the 32-byte Ed25519 public key. Every such key begins `did:key:z6Mk`.

Signatures are Ed25519 (RFC 8032), written in base64url (RFC 4648 §5) with no padding.

The private key never appears on any public surface. A publisher SHOULD also create a **recovery key** at setup, keep it offline, and list it in the tree (section 7.2).

## 4. The tree

### 4.1 Where it lives

The tree is an ordinary Blygger item, a fragment or a thread, at the trunk. It is versioned, pinned and withdrawn like any other item:
- Publishing a new version updates the tree.
- Pinning a version promises to serve it permanently, which section 7.2 relies on.
- Withdrawing the item withdraws the tree.

### 4.2 The claims block

`content_md` MUST contain exactly one fenced code block whose opening fence line is exactly ```` ```blyggdrasil ````. The **claims** are the lines between the opening fence and the next line that is exactly ```` ``` ````. Before parsing, lines are split at LF, with a CR immediately before an LF removed.

```blyggdrasil
blyggdrasil 1
trunk https://fishbiscuit.me/blyg/
key did:key:z6MkExample…
branch https://github.com/Fishbiscuit
branch https://bsky.app/profile/example.com
branch https://x.com/example/status/1990000000000000000
recovery did:key:z6MkRecovery…
```

**Grammar:**
- The first line is exactly `blyggdrasil 1`.
- Every other line is a field name, one space, and a value. Neither may contain a space, and there are no blank lines.
- At most 256 lines in all.

| Field | Count | Value |
| --- | --- | --- |
| `trunk` | exactly 1 | The trunk: an `https:` URL ending in `/` |
| `key` | exactly 1 | The current key, as a `did:key` |
| `branch` | 0–64 | An absolute `https:` URL of an account, profile or proof post |
| `recovery` | 0–4 | A recovery key, as a `did:key` |
| `previous` | 0–1 | The key this one replaces (section 7.1) |
| `recovered-from` | 0–1 | A version number `v<n>` of this same item (section 7.2) |
| `moved-from` | 0–8 | A former trunk (section 7.3) |

Readers MUST ignore lines with unknown field names. Those lines are still signed. A block that breaks this grammar makes the tree **invalid**.

### 4.3 Signatures

Each signature is its own fenced block, after the claims block, opened by exactly ```` ```blyggdrasil-signature ````:

```blyggdrasil-signature
key did:key:z6MkExample…
sig 3q2-7w…
```

- **What is signed:** the UTF-8 bytes of the claims, which are the lines of the claims block joined by LF, with no trailing LF. Nothing else is signed. There is no JSON to canonicalize, and the bytes are exactly the bytes readers see.
- A signature block has exactly two lines, `key` and `sig`.
- A tree MUST carry a valid signature by its `key`. Section 7 says which other signatures each L2 statement needs.
- The rest of `content_md` is free text for human readers. A publisher SHOULD explain the tree in one or two sentences and link to a viewer.

### 4.4 Validity

A reader that fetched the tree from origin `O` accepts it when all of these hold:

1. The claims parse.
2. `trunk` equals `O`. Comparison is byte for byte after lowercasing the scheme and host.
3. A signature block whose `key` equals the claims' `key` verifies.
4. If `previous` or `recovered-from` is present, the rules of section 7 hold.

Otherwise the tree is **invalid**, and the reader shows the reason. An invalid tree's branches are not checked.

### 4.5 Finding the tree from a trunk

Given a blyg URL, a reader resolves the trunk and manifest by Blygger §12. It then looks for a pointer, in this order:

1. A manifest member `blyggdrasil`: the URL of the tree's page or item document. This is an unknown member to Blygger, so other Blygger readers ignore it.
2. The first entry in `author.links` whose `label`, lowercased, is `blyggdrasil`. Blygger Studio users can add this entry without new software.

The pointer's item id is the last 26-character Crockford id in its path. The reader fetches the item document through the manifest's `item` template (Blygger §6.1). A reader MAY also accept a tree post URL directly.

With no pointer, there is no tree. A reader MAY still show the manifest's `author.links` and `https:` entries of `author.ids` as branches with link-only checks (section 5.3). This gives every blyg a view today, honestly labelled.

## 5. Branches

### 5.1 What proves a branch

A branch is **verified** when a fixed fetch of it (section 5.2) finds a back-reference:

- **key:** the text contains the tree's `key`, or a key section 7 accepts, exactly as written.
- **link:** a link or URL on the branch equals the trunk, or starts with it. Comparison ignores the scheme, a leading `www.` and a trailing `/`, and lowercases the host.
- **handle:** for Bluesky only, the account's handle is the trunk's host. The domain owner bound it through DNS or `.well-known`.

A key back-reference survives a move of the trunk. A link back-reference does not, and is #35 §4.1's proof. Readers SHOULD show which kind they found.

### 5.2 How each branch is checked

Each branch URL is matched against these patterns in order. A reader makes at most 3 fetches per branch, with no credentials and no cookies.

| Branch URL | Fetches | Text and links checked | Account |
| --- | --- | --- | --- |
| `https://github.com/{user}` | `api.github.com/users/{user}`; then `api.github.com/users/{user}/gists?per_page=100`; then the `raw_url` of the first file named `blyggdrasil.txt` | `bio`, `blog`, the gist file's text | the user |
| `https://bsky.app/profile/{actor}` | `public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor={actor}` | `description`, handle | `did` |
| `https://bsky.app/profile/{actor}/post/{rkey}` | getProfile as above; then `app.bsky.feed.getPosts?uris=at://{did}/app.bsky.feed.post/{rkey}` | the post's `record.text` and every facet link `uri` | `did` |
| `https://x.com/{user}/status/{id}` (or `twitter.com`) | `publish.x.com/oembed?url=https://x.com/{user}/status/{id}&omit_script=1&dnt=true` | the text of `html`. `author_url` must be `https://x.com/{user}`, compared without case | the user |
| `https://medium.com/@{user}` (a profile or any story URL), or `https://{user}.medium.com/` | `medium.com/feed/@{user}` | the `content:encoded` text and links of each feed item | the user |
| `https://x.com/{user}`, LinkedIn, Instagram, Threads, Facebook, TikTok | none | — | — |
| `https://{host}/@{user}` (Mastodon-family) | `https://{host}/api/v1/accounts/lookup?acct={user}` | `note` and each `fields[].value`, as text and as `href`s | `acct` |
| `https://{host}/@{user}/{id}` | `https://{host}/api/v1/statuses/{id}` | `content`. `account.acct` must equal `{user}` | `acct` |
| any other `https:` URL | `{url}/blyg.json`; if it parses as a manifest, that blyg's tree (section 4.5) | the other tree's keys include this tree's key | that trunk |
| otherwise | the page | `rel="me"` links and text | the page |

Notes on the table:
- The X-profile row gets the verdict `claimed`: these networks offer no public read, so a reader can't check them. To prove an X account, use a proof post (the X status row).
- A branch equal to the trunk itself is `verified` by link.
- Medium sends no cross-origin header (checked 25 November 2026), so in a browser the Medium row is `unreachable`. A reader outside the browser, such as the command line, can read the feed. The proof is a Medium story containing the proof line.
- When a `/@{user}` host does not answer as a Mastodon server (a JSON object with `acct`), the reader moves on to the remaining rows. YouTube and Medium use the same path shape.

HTML fields are read as text by removing tags and decoding character references. Their `href` values are collected for link matching.

### 5.3 Verdicts

| Verdict | When |
| --- | --- |
| `verified` | A back-reference was found. The reader shows which kind: key, link or handle |
| `failed` | The fetch succeeded and no back-reference was found, or the account no longer exists (404) |
| `unreachable` | Network error, a cross-origin block, 429, a 5xx response, or an unexpected response shape. Retry later |
| `claimed` | No check is defined for this branch |

Readers MUST show `verified` differently from every other verdict, and MUST NOT present `claimed` or `unreachable` as verified. Following #35's reader rules:
- No counts, scores or rankings are derived from trees or verdicts.
- No two people's posts are merged on the strength of a tree unless that branch is verified.
- Nothing is gated on identity.

### 5.4 The proof line

A publisher posts one line on each branch, in the account's bio or in a post:

```
Blyggdrasil: did:key:z6Mk… https://fishbiscuit.me/blyg/
```

The key makes it a key back-reference, and the URL helps human readers. The line is under 120 characters, so it fits anywhere. For GitHub, a public gist with a file named `blyggdrasil.txt` containing the line also works.

## 6. Signed bylines (#35 §4.2)

A publisher MAY sign each item version. Item `author` carries a member `sig`:

```json
"author": { "name": "qz", "url": "https://fishbiscuit.me/blyg/",
            "ids": ["did:key:z6Mk…", "https://github.com/Fishbiscuit"],
            "sig": { "key": "did:key:z6Mk…", "value": "<base64url>" } }
```

- The signed message is the UTF-8 bytes of the item's `content_hash` string, such as `sha256:9f86…`, exactly as #35 §4.2 describes. Withdrawal endcaps are signed the same way.
- #35 leaves the member unnamed. This document proposes `sig`.
- A reader that holds a valid tree shows a version signed by the tree's key, or by a key section 7 accepts, as signed by that tree. This holds wherever the item is read: imported, quoted, or found after a move.
- Blygger §5.5's pass-through rule applies: clients that re-emit item JSON carry `author` verbatim.
- Publishers SHOULD list the key and verified branches in `author.ids` (TN-6 ruling 5), in both the manifest and the items.

## 7. Reinstating (L2)

### 7.1 Rotating a key

The tree is republished as a new version:
- `key` names the new key and `previous` names the old one.
- It carries signatures by both keys.

Readers then accept back-references and bylines that name either key. Before rotating further, a publisher SHOULD re-post proof lines with the new key, because only the immediately previous key is carried.

### 7.2 Recovering from a lost key

1. At setup, the publisher lists `recovery` keys and **pins** that tree version (Blygger §8), so it stays fetchable.
2. When the main key is lost, the new version names:
   - `key` (new),
   - `previous` (the lost key),
   - `recovered-from v<n>` (the pinned version).
3. The new version carries signatures by the new key and by one of the recovery keys.

A reader fetches the pinned version through the `pin` template and confirms three things: that version is itself a valid tree, its `key` equals `previous`, and it lists the signing recovery key.

### 7.3 Moving the trunk

The tree is published at the new trunk with `moved-from` naming the old one, signed by the same key (or by a rotation, section 7.1). Branches whose back-reference is the key keep verifying. Link back-references to the old trunk count only while the old trunk's manifest redirects permanently to the new one, which is Blygger §16.13's statement of succession. The publisher SHOULD also follow §16.13: redirect the old manifest and list it in `moved_from`.

### 7.4 Losing or replacing an account

Remove the branch, add the new account and post a proof line on it. Nothing else changes.

## 8. Reconstituting (L3)

### 8.1 The archive

An archive is a folder of Markdown files, one per post, on the publisher's own machine:

```markdown
---
network: x
url: https://x.com/example/status/1990000000000000000
created: 2025-03-02T11:01:00Z
kind: post
visibility: public
reply_to:
---

The post's own text.
```

- `kind` is `post`, `reply`, `repost`, `dm` or `like`.
- `visibility` is `public` or `private`, and comes only from the export's own fields, never from a judgement:
  - Direct messages, likes, follow lists, protected or followers-only posts, and posts the export marks deleted are `private`.
  - Posts the network served publicly are `public`.
- Reposts and likes keep only the URL, never the other person's words.

### 8.2 Republishing

A public `post` or `reply` MAY be republished as a blyg item:

- `created` is the original time. Blygger timestamps are the publisher's claim (§13.7).
- `syndication` lists `{ "url": <the original>, "version": 1 }` (§5.10).
- A reply is a thread with `stub_of { "url": <reply_to> }` (§10.6). Its body is only the publisher's own words.
- Items are published in one authoring act, which Blygger readers fold as a burst (§7, §13.7).
- `private` files are never published.

## 9. Conformance

- **Publisher L1:** a valid tree (section 4) and a proof line on each branch it lists.
- **Publisher L1+:** signed bylines (section 6).
- **Reader L1:** section 4.4 validity, section 4.5 discovery, section 5 checks and verdicts, and section 5.3's display rules.
- **L2:** section 7, for publishers and readers.
- **L3:** section 8, for publishers.

The [test vectors](test/vectors.json) fix a test key, claims, signatures, recorded network responses and expected verdicts. An implementation conforms at a level when it reproduces every vector for that level.

## 10. What this does not do

- It does not say who a person is. A verified tree says one keyholder controls these accounts and this trunk, and nothing more (#35 §4.1).
- It puts nothing on Blygger's wire. Every member and block here is either content or an extension point Blygger already grants.
- It does not rank, count or score anyone, and readers must not use it to.
- It cannot stop a network from deleting a proof. A deleted proof reads as `failed`, which is the truth.
