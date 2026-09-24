"""Deterministic test double, NOT a neural model or learned algorithm.

First proposal deliberately returns the first number; after verifier feedback
the next proposal uses max. The verifier independently checks membership and
ordering. This fixture tests harness control flow, not model improvement.
"""
import json
import sys

request = json.load(sys.stdin)
numbers = request["input"]["numbers"]
if sys.argv[1] in ("verify", "verify-json"):
    answer = request["value"]
    if sys.argv[1] == "verify-json":
        try:
            answer = json.loads(answer)["answer"]
        except (ValueError, TypeError, KeyError):
            answer = None
    ok = type(answer) in (int, float) and answer in numbers and all(answer >= n for n in numbers)
    result = {"ok": ok, "value": answer, "detail": "membership and ordering checked"}
else:
    retried = any(o["ok"] is False for o in request["observations"])
    result = {"ok": True, "value": max(numbers) if retried else numbers[0]}
print(json.dumps(result))
