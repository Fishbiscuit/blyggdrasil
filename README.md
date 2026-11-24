# Blyggdrasil

**One tree for everywhere you post.** Your [blyg](https://blygger.org/) is the trunk. Your accounts on X, Bluesky, Mastodon and GitHub are branches, each proven by one line you post there. A key you hold lets the whole tree move with you if a platform drops you.

**[See a tree](https://fishbiscuit.me/blyggdrasil/)** · **[Plant yours](https://fishbiscuit.me/blyggdrasil/new/)** · **[Spec](SPEC.md)**

Blygger was first called Ygg, after Yggdrasil ([the original concept](https://github.com/blygger/blygger-spec/blob/main/docs/ygg-initial-spec.md)). Blyggdrasil gives the tree back its name.

## What it does

1. **Connect.** Make a key. List your accounts in one signed post on your blyg, and put one line naming your key on each account. Anyone can check every link in their own browser, with no server involved.
2. **Reinstate.** Lose an account, your domain or even the key, and the tree carries on:
   - a new account proves itself with the same key;
   - a tree published at a new blyg keeps its branches;
   - a recovery key you set aside takes over from a lost main key.
3. **Reconstitute.** Bring your public posts from X and Bluesky back to your own blyg. They keep their original dates and link back to where they first appeared. DMs, likes and private posts stay on your machine.

## How it fits Blygger

Blygger keeps identity out of its protocol (decision #11), and Blyggdrasil keeps that rule. It adds nothing to Blygger's wire. It builds the practice Blygger has already written down: **decision #35, ["a person is a URL they control"](https://github.com/blygger/blygger-spec/blob/main/docs/proposals/identity-practice-proposal.md)**, with its two proofs:

- **A reciprocal link.** Each branch points back at your blyg or your key.
- **A signature over `content_hash`.** Every post on [fishbiscuit.me/blyg](https://fishbiscuit.me/blyg/) carries `author.sig`, and the viewer checks it.

#35 becomes a technical note "once one client emits a proof and a second client verifies it". This project is both halves. It also uses TN-6's `author.ids`, §5.10 `syndication`, §10.6 `stub_of` and §16.13's move rule. There are no counts, scores or rankings, and readers must show a claim as a claim.

## Command line

Node 20 or newer, no dependencies.

```sh
node bin/blyggdrasil.mjs keygen                      # main key in ~/.blyggdrasil/main.json
node bin/blyggdrasil.mjs keygen --label recovery     # keep this one offline
node bin/blyggdrasil.mjs proof --trunk https://you.example/blyg/ --key ~/.blyggdrasil/main.json
node bin/blyggdrasil.mjs tree --trunk https://you.example/blyg/ --key ~/.blyggdrasil/main.json \
  --recovery ~/.blyggdrasil/recovery.json \
  --branch https://github.com/you --branch https://x.com/you/status/123 --out tree.md
node bin/blyggdrasil.mjs verify you.example/blyg
node bin/blyggdrasil.mjs ingest bluesky you.bsky.social --out archive
node bin/blyggdrasil.mjs ingest x ~/Downloads/twitter-archive --out archive
```

Publish `tree.md` as a post on your blyg. Then point your blyg at it: Blygger Studio users add a profile link labelled `Blyggdrasil`, and static blygs add `"blyggdrasil": "<post URL>"` to `blyg.json`.

## Files

| Path | What it is |
| --- | --- |
| [`SPEC.md`](SPEC.md) | Blyggdrasil 0.1: keys, the tree, branch checks, signed bylines, reinstating and reconstituting |
| [`lib/blyggdrasil.js`](lib/blyggdrasil.js) | Core library for browsers and Node: `did:key`, the claims format, signatures, discovery |
| [`lib/resolvers.js`](lib/resolvers.js) | Branch checks for GitHub, Bluesky, Mastodon, X, other blygs and web pages |
| [`lib/ingest.js`](lib/ingest.js) | Bluesky and X archive importers (Node) |
| [`bin/blyggdrasil.mjs`](bin/blyggdrasil.mjs) | The command line |
| [`index.html`](index.html), [`new/`](new/) | The viewer and the setup page |
| [`assets/world.js`](assets/world.js) | The world tree at night: a procedural 3D tree whose branches light up as each account is verified |
| [`test/`](test/) | Test vectors and the conformance run: `node --test test/run.mjs` |
| [`AGENTS.md`](AGENTS.md) | Optional instructions for a coding agent that drives the command line |

## Tests

```sh
node --test test/run.mjs
```

The vectors pin RFC 8032's test key, a `did:key` encoding, signed trees (including rotation and recovery), recorded responses from every network with their expected verdicts, signed bylines and the X archive importer. Ed25519 is deterministic, so any implementation can reproduce them exactly. The keys in `test/vectors.json` are test keys, published on purpose.

## Status

Three.js r180 is included under its [MIT license](vendor/three.LICENSE.txt). Draft 0.1, built for the [Blygger hackathon](https://protocol-institute.org/events/blygger-hackathon-2026/) in November 2026. MIT licensed. The viewer runs every check in the reader's browser. GitHub, Bluesky, Mastodon and X's embed service all allow it, as of 25 November 2026.
