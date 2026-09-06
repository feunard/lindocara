"""Guard future authoring against dropping the named style or character reference."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from style_system import ROOT, sprite_prompt, check_references


class StyleContractTest(unittest.TestCase):
    def test_style_and_identity_are_both_injected(self):
        config=json.loads((ROOT/"theme.json").read_text(encoding="utf-8"))["pixel_art"]
        character=json.loads((ROOT/"characters.json").read_text(encoding="utf-8"))["priest-prototype"]
        prompt=sprite_prompt(config,"casting towards the right",character)
        self.assertIn("LCPixel",prompt)
        self.assertIn("2.65 heads high",prompt)
        self.assertIn("104 px (96-116)",prompt)
        self.assertIn("48-colour palette",prompt)
        self.assertIn("Outer outline 1-2 native px",prompt)
        self.assertIn(character["description"],prompt)
        self.assertTrue(prompt.startswith(config["trigger"]))
        self.assertIn("casting towards the right",prompt)
        self.assertTrue((ROOT/character["sprite_ref"]).is_file())

    def test_explicit_raw_research_mode(self):
        config=json.loads((ROOT/"theme.json").read_text(encoding="utf-8"))["pixel_art"]
        self.assertEqual(sprite_prompt(config,"raw experiment",no_theme=True),"raw experiment")

    def test_reviewed_references(self):
        style,lock=check_references()
        self.assertEqual(style["name"],"LCPixel")
        self.assertGreaterEqual(len(lock["sha256"]),10)

    def test_real_batch_dry_run_keeps_character_reference_and_style(self):
        with tempfile.TemporaryDirectory(prefix="lcpixel-test-") as temporary:
            manifest=Path(temporary)/"batch.json"
            manifest.write_text(json.dumps([{"character":"priest-prototype","prompt":"running to the right","out":str(Path(temporary)/"sprite.png")}]),encoding="utf-8")
            result=subprocess.run([sys.executable,str(ROOT/"studio.py"),"sprite","--manifest",str(manifest),"--dry-run"],capture_output=True,text=True,encoding="utf-8",env={**os.environ,"STUDIO_BACKEND":"cuda","PYTHONIOENCODING":"utf-8"},check=True)
            jobs=json.loads(result.stdout[result.stdout.index("[\n"):])
            self.assertIn("LCPixel",jobs[0]["prompt"])
            self.assertIn("short full dark beard",jobs[0]["prompt"])
            self.assertEqual(Path(jobs[0]["image"]).name,"canonical-native.png")
            self.assertFalse((Path(temporary)/"sprite.png").exists())


if __name__=="__main__":
    unittest.main()
