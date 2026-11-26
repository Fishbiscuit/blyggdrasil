# Verify the same editions with two readers

The [edition proof packet](proof-packet.json) contains the public manifest, signed tree, pinned version 1, and current version 2 from the [edit-and-pin demo](https://fishbiscuit.me/blyggdrasil/demo/edit-and-pin/). It supplies the demo publisher’s public key as the trust anchor for this exercise.

Each case identifies an item document and its version. Two cases replace Markdown in a local copy. The first leaves the original hash in place. The second also replaces the hash and keeps the original signature.

| Case | Content hash | Signature over the recorded hash |
| --- | --- | --- |
| Pinned version 1 | Valid | Valid |
| Current version 2 | Valid | Valid |
| Changed Markdown | Invalid | Valid |
| Changed Markdown with a recomputed hash | Valid | Invalid |

## Compare the results

The comparison uses Node 20 or later and Python 3. Install the Python [dependency](requirements.txt) in your environment before running the comparison.

```sh
python3 -m pip install -r interop/requirements.txt
node interop/compare.mjs
```

The comparison runs offline. It invokes the Python reader as a subprocess and checks both readers against the expected verdicts. Both recompute the content hash, verify the Ed25519 signature over the recorded hash, and compare the signing key with the supplied public key. JavaScript also checks whether the signed tree authorizes the key, reported as `treeSigner`.

## Check a pinned edition independently

```sh
python3 interop/blyg_read.py https://fishbiscuit.me/blyggdrasil/demo/edit-and-pin/blyg/ \
  --item 1hk3fv43xwpgckk19k4wf3v9ts --pin 1 \
  --expect-key did:key:z6MkghmaYVEtVFUbbn7ZbugRi6yK3gxN5pQPDnocfhXa8YwY --json
```

Supply `--expect-key` from a source you already trust. With `--pin`, the reader requires the named version and a pinned marker in the response. For an offline item JSON file, use `--file path/to/item.json` with the same key and pin options. The live reader uses `curl` for HTTPS.
