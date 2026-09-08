# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy==2.5.2", "opencv-python-headless==5.0.0.93", "pillow==12.3.0"]
# ///
"""Source and temporal regressions; these cannot certify perceived naturalness."""
import json
import sys
import unittest
import tempfile
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from source_tools import cells, SOURCE, NAMES
from registration import body_landmarks, registered
from palette import colour_frame
from run_poses import run_cycle, registered_keys, extract, CONFIG
from raster_animation import Tween
from compact_atlas import pack


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

    def test_front_cycle_uses_six_distinct_paintings_at_one_source_density(self):
        paintings,densities=extract('front')
        spec=CONFIG['views']['front']
        self.assertEqual(len(paintings),6)
        self.assertEqual(spec['keys'],list(range(6)))
        self.assertTrue(all(d==1 for d in densities))

    def test_rear_quarter_registration_does_not_snap_to_a_boot(self):
        colours=json.loads((SOURCE/'palette.json').read_text())['colours']
        _,records=registered_keys('back-quarter',colours)
        self.assertTrue(all(r['registration']=='reviewed-whole-pose' for r in records))
        heads=np.array([r['landmarks']['head'] for r in records])
        # The previous brown-mask anchor jumped from the belt to a boot: the
        # entire head snapped sideways by ten native pixels at the loop end.
        self.assertLess(np.ptp(heads[:,0]),2)
        # Preserve the accepted left view's body excursion instead of pinning the
        # previous over-leaning torso to its six obsolete belt heights.
        _,left=registered_keys('back-left',colours)
        left_heads=np.array([r['landmarks']['head'] for r in left])
        np.testing.assert_allclose(heads[:,0],256-left_heads[:,0],atol=.001)
        self.assertLessEqual(np.ptp(heads[:,1]),np.ptp(left_heads[:,1])+1)
        self.assertEqual(CONFIG['views']['back-quarter']['keys'],[3,4,5,0,1,2])

    def test_compact_atlas_reconstructs_every_direction_and_duplicate_exactly(self):
        # Different bounds and shared endpoints exercise packing rather than a mock.
        a=np.zeros((256,256,4),'uint8');a[80:190,110:140]=[30,60,90,255]
        b=a.copy();b[60:70,70:80]=[200,180,30,255]
        rows=[[a,b,a],[b,a,b]]
        with tempfile.TemporaryDirectory() as folder:
            clip=pack(Path(folder),'example',rows,{'frames':3},anchor=(128,190))
            sheet=np.array(Image.open(Path(folder)/'example.png'))
            self.assertEqual(clip['uniqueFrames'],2)
            self.assertEqual(clip['frameIndices'],[[0,1,0],[1,0,1]])
            w,h=clip['frame']['width'],clip['frame']['height']
            ax,ay=clip['frame']['anchor'].values()
            for r,row in enumerate(rows):
                for f,original in enumerate(row):
                    index=clip['frameIndices'][r][f]
                    x,y=index%clip['columns']*w,index//clip['columns']*h
                    restored=np.zeros_like(original)
                    restored[190-ay:190-ay+h,128-ax:128-ax+w]=sheet[y:y+h,x:x+w]
                    np.testing.assert_array_equal(restored,original)

    def test_action_registration_keeps_one_scale_per_painted_clip(self):
        for direction in NAMES:
            frames,records=registered('cast',direction)
            self.assertEqual(len({r['scale'] for r in records}),1)
            self.assertTrue(all(frame.shape==(256,256,4) for frame in frames))


if __name__=="__main__":
    unittest.main()
