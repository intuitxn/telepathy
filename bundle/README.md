# bundle

Digest-pinned bundle for `mundus` 0.1.0 (bend 2.0.21) on one node.

## Files
- `manifest.json`: `{name, version, created, bend, contents[], digest}`
- `verify.sh`: re-walks the covered set, rehashes, compares, exits 0 iff match.

## Covered set (deterministic, `LC_ALL=C sort -u`)
- `runtime/**/*.bend` (excludes `.git`, `node_modules`, `.local`, `ops/runs`, `*.log`, `secrets/`)
- `scripts/*.sh` (top level only)
- `mundus` (singleton; if missing, recorded as `{"path":"mundus","status":"absent"}`)
- `tasks/frozen/**` all regular files except `*.log` (so `runs.log` excluded; same global excludes)
- Entry: `{"path","sha256"}` if present, else `{"path","status":"absent"}`.

## Digest
`digest = sha256(canonical JSON of {name, version, contents})`,
canonical = `json.dumps(obj, sort_keys=True, separators=(',',':'))` UTF-8.
Check: `python3 -c 'import json,hashlib; m=json.load(open("bundle/manifest.json")); o={"name":m["name"],"version":m["version"],"contents":m["contents"]}; print(hashlib.sha256(json.dumps(o,sort_keys=True,separators=(",",":")).encode()).hexdigest())'`

## Verify
- `sh bundle/verify.sh` (or `./bundle/verify.sh`); needs `shasum` (fallback `sha256sum`) + `python3`.
- Prints `OK <path>` per file, else `MISMATCH`/`ABSENT`/`EXTRA`; then `digest <hex>` and `RESULT PASS|FAIL`.
- No network, no repo deletes, no daemon. Deterministic: same manifest + tree => byte-identical output including digest.
- Hash with `shasum -a 256` (fallback `sha256sum`).

## Rollback
Rollback = keep the previous `manifest.json` (copy aside, e.g. `manifest.<digest>.json`) and re-run `verify.sh`; a rollback is accepted only if `verify.sh` against the restored manifest prints `RESULT PASS`. The bundle itself never auto-restores files.
