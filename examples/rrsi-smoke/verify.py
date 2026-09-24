"""External verifier for the tiny runner smoke case; not an RRSI benchmark."""
import importlib.util
from pathlib import Path
import sys

source = Path(sys.argv[1]) / "ports.py"
spec = importlib.util.spec_from_file_location("ports_under_test", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

for text, expected in [("1", 1), (" 42 ", 42), ("65535", 65535)]:
    assert module.parse_port(text) == expected, text
for text in ["0", "65536", "-1", "+1", "1.0", "x"]:
    try:
        module.parse_port(text)
    except ValueError:
        pass
    else:
        raise AssertionError(f"accepted invalid port {text!r}")
