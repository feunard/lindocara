"""Guard future authoring against dropping the named style or character reference."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import shutil
from style_system import ROOT, sprite_prompt, check_references
from quality_floor import MINIMUM, BASELINE_COMMIT, check_quality_floor


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
        self.assertIn("approved Priest at commit e9f4b440",prompt)
        self.assertIn("every new or modified character and monster",prompt)
        self.assertIn("in-engine visual comparison",prompt)
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
            self.assertIn("approved Priest at commit e9f4b440",jobs[0]["prompt"])
            self.assertEqual(Path(jobs[0]["image"]).name,"canonical-native.png")
            self.assertFalse((Path(temporary)/"sprite.png").exists())

    def test_frozen_quality_reference_is_complete(self):
        lock=check_quality_floor()
        self.assertEqual(lock['referenceCommit'],BASELINE_COMMIT)
        self.assertEqual(len(lock['runtimeSha256']),19)

    def test_changed_visual_witness_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix='lcpixel-floor-') as temporary:
            folder=Path(temporary)/'minimum'
            shutil.copytree(MINIMUM,folder)
            (folder/'run-review.png').write_bytes(b'not the approved motion')
            with self.assertRaisesRegex(ValueError,'Frozen quality witness changed'):
                check_quality_floor(folder)

    def test_floor_cannot_silently_drop_monsters_or_change_reference(self):
        with tempfile.TemporaryDirectory(prefix='lcpixel-floor-') as temporary:
            folder=Path(temporary)/'minimum'
            shutil.copytree(MINIMUM,folder)
            file=folder/'baseline.lock.json';original=json.loads(file.read_text())
            for field,value in [('scope',['new-character']),('referenceCommit','0'*40)]:
                changed={**original,field:value}
                file.write_text(json.dumps(changed),encoding='utf-8')
                with self.assertRaisesRegex(ValueError,'quality floor or its scope changed'):
                    check_quality_floor(folder)


if __name__=="__main__":
    unittest.main()
