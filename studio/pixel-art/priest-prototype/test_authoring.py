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
import cv2
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from source_tools import cells, SOURCE, NAMES, head_box
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

    def test_directional_body_size_and_compact_stride(self):
        colours=json.loads((SOURCE/'palette.json').read_text())['colours']
        heights,spans={},{}
        for direction in NAMES:
            keys,records=registered_keys(direction,colours)
            for r in records:
                self.assertAlmostEqual(r['scale']*r['sourceBodyHeight'],96.5)
            # Measure rendered bodies, excluding the staff and the small flight
            # translation. This catches a bad source landmark or wrong placement,
            # not just a configuration value copied into the report.
            measured=[];widths=[]
            for key,r in zip(keys,records):
                a=key.astype('int16');red,green,blue=a[:,:,0],a[:,:,1],a[:,:,2]
                boots=(red>25)&(red<180)&(green<130)&(blue<100)&(red>green*1.08)&(green>blue*1.04)&(a[:,:,3]>0)
                boots[:155]=False
                # The brown staff can extend below the hips too. Its narrow
                # component is not a foot and must not inflate the stride width.
                count,labels,stats,_=cv2.connectedComponentsWithStats(boots.astype('uint8'),8)
                boots=np.isin(labels,[i for i in range(1,count) if stats[i,cv2.CC_STAT_WIDTH]>=7 and stats[i,cv2.CC_STAT_AREA]>=25 and stats[i,cv2.CC_STAT_HEIGHT]<stats[i,cv2.CC_STAT_WIDTH]*2+3])
                yy,xx=np.nonzero(boots)
                measured.append(float(np.quantile(yy,.995))+1-head_box(Image.fromarray(key))[1])
                widths.append(float(np.quantile(xx,.98)-np.quantile(xx,.02)))
            heights[direction]=float(np.median(measured))
            spans[direction]=max(widths)
        self.assertLessEqual(max(heights.values())-min(heights.values()),2)
        for candidate,reference in [('side-left','side'),('back-left','front-left'),('back-quarter','front-quarter')]:
            self.assertEqual(CONFIG['views'][candidate]['motionReference'],reference)
            self.assertLessEqual(spans[candidate],spans[reference]+4,f'{candidate}: overextended stride')

    def test_left_profile_does_not_snap_from_belt_to_staff_hand(self):
        colours=json.loads((SOURCE/'palette.json').read_text())['colours']
        _,left=registered_keys('side-left',colours)
        _,right=registered_keys('side',colours)
        a=np.array([r['landmarks']['head'][0] for r in left])
        b=np.array([r['landmarks']['head'][0] for r in right])
        np.testing.assert_allclose(a,256-b,atol=.001)
        self.assertLess(np.max(np.abs(np.roll(a,-1)-a)),4.1)

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
