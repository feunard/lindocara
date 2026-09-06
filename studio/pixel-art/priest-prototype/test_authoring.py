# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy==2.5.2", "opencv-python-headless==5.0.0.93", "pillow==12.3.0"]
# ///
"""Source and temporal regressions; these cannot certify perceived naturalness."""
import json
import sys
import unittest
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from source_tools import cells, SOURCE, NAMES
from registration import body_landmarks, registered
from palette import colour_frame
from run_poses import run_cycle, registered_keys, extract, CONFIG
from raster_animation import Tween


class PriestAuthoringTest(unittest.TestCase):
    def test_palette_reduction_does_not_move_neck_to_eyes(self):
        colours=json.loads((SOURCE/"palette.json").read_text())["colours"]
        for image in cells("turnaround",5,1):
            a=np.array(image.resize((123,123),Image.Resampling.LANCZOS))
            a[:,:,3]=(a[:,:,3]>=128).astype("uint8")*255
            a[a[:,:,3]==0]=0
            before=body_landmarks(Image.fromarray(a))
            after=body_landmarks(Image.fromarray(colour_frame(a,colours)))
            self.assertLessEqual(np.linalg.norm(np.array(before["neck"])-after["neck"]),2)

    def test_every_running_key_survives_tweening_exactly(self):
        colours=json.loads((SOURCE/"palette.json").read_text())["colours"]
        for direction in NAMES:
            keys,records=registered_keys(direction,colours)
            frames,_=run_cycle(direction)
            self.assertEqual(len(frames),36)
            self.assertEqual(len({r['sourceIndex'] for r in records}),6)
            self.assertEqual(len({r['scale'] for r in records}),1)
            for key,record in zip(keys,records):
                np.testing.assert_array_equal(frames[record['frame']],key)
            self.assertGreater(np.count_nonzero(keys[0][155:,:,3]!=keys[3][155:,:,3]),50)
            # Closing segment is a true last-key -> first-key tween, not a pause.
            closing=Tween(keys[-1],keys[0])
            np.testing.assert_array_equal(closing.at(1),frames[0])
            np.testing.assert_array_equal(colour_frame(closing.at(5/6),colours),frames[-1])

    def test_single_pose_edit_uses_canvas_density_not_a_partial_hair_mask(self):
        paintings,densities=extract('front')
        spec=CONFIG['views']['front']
        self.assertEqual(densities[-1],paintings[spec['extraReferenceCell']].width/paintings[-1].width)
        self.assertTrue(all(d==1 for d in densities[:-1]))

    def test_action_registration_keeps_one_scale_per_painted_clip(self):
        for direction in NAMES:
            frames,records=registered('cast',direction)
            self.assertEqual(len({r['scale'] for r in records}),1)
            self.assertTrue(all(frame.shape==(256,256,4) for frame in frames))


if __name__=="__main__":
    unittest.main()
