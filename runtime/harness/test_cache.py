"""Build cache integrity/invalidation, without invoking the compiler."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import run as harness


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "system.bend"
        self.source.write_text("source")
        self.compiler = self.root / "bend"
        self.compiler.write_text("compiler")
        self.package = self.root / "bend2"
        self.package.mkdir()
        self.library = self.package / "base.bend"
        self.library.write_text("library")
        for name, value in (("ROOT", self.root), ("SOURCE", self.source)):
            context = patch.object(harness, name, value)
            context.start()
            self.addCleanup(context.stop)

    def kernel(self):
        kernel = harness.Kernel.__new__(harness.Kernel)
        kernel.bend, kernel.version = str(self.compiler), "test"
        kernel.engine_version = "node-test"
        kernel.source_hash = harness.file_digest(self.source)
        return kernel

    def test_reuse_corruption_and_toolchain_changes(self):
        builds = []

        def compile(kernel, stage):
            builds.append(stage)
            kernel.check = "All terms check."
            kernel.binary = str(stage / "system.cjs")
            Path(kernel.binary).write_text("compiled")

        def load():
            kernel = self.kernel()
            kernel._cached_build(self.package)
            return kernel

        with patch.object(harness.Kernel, "_compile", compile):
            first = load()
            self.assertEqual(load().binary, first.binary)
            self.assertEqual(len(builds), 1)
            Path(first.binary).write_text("corrupt")
            self.assertEqual(Path(load().binary).read_text(), "compiled")
            self.assertEqual(len(builds), 2)
            self.library.write_text("changed library")
            self.assertNotEqual(load().binary, first.binary)
            self.assertEqual(len(builds), 3)
            self.source.write_text("changed source")
            self.assertNotEqual(load().binary, first.binary)
            self.assertEqual(len(builds), 4)

    def test_source_change_during_build_never_publishes(self):
        kernel = self.kernel()

        def compile(stage):
            kernel.check = "All terms check."
            (stage / "system.cjs").write_text("binary")
            self.source.write_text("changed during build")

        with patch.object(kernel, "_compile", compile):
            with self.assertRaisesRegex(RuntimeError, "changed during build"):
                kernel._cached_build(self.package)
            self.assertEqual(list((self.root / ".local/harness/builds").glob("*/build.json")), [])
