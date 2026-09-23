#!/usr/bin/env python3
"""Retired Git job lifecycle; retained only to explain the migration."""
import sys

MESSAGE = """agit is retired: Git branch/checkout/merge job mutations are disabled.
Use jj workspaces and changes for local work; see docs/WORKTREE_LIFECYCLE.md.
Inspect with jj status and jj log; describe a candidate with jj describe.
Run the repository checks, then publish an authorized bookmark through jj git push.
Bend owns runtime task transitions. Existing Git notes/tags remain historical evidence.
"""

if __name__ == "__main__":
    help_requested = len(sys.argv) == 2 and sys.argv[1] in ("-h", "--help")
    print(MESSAGE, file=sys.stdout if help_requested else sys.stderr, end="")
    raise SystemExit(0 if help_requested else 2)
