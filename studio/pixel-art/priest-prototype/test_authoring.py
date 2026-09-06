# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy==2.5.2", "opencv-python-headless==5.0.0.93", "pillow==12.3.0"]
# ///
"""Real-source regressions: colour boundaries must not become anatomical boundaries."""
import json
import unittest
import numpy as np
from PIL import Image
from source_tools import cells, SOURCE
from registration import body_landmarks, rest_image, registered
from palette import colour_frame
from motion_transfer import upper_body


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

    def test_upper_body_motion_keeps_planted_feet(self):
        frame=np.array(rest_image("front"))
        pelvis=body_landmarks(Image.fromarray(frame))["pelvis"]
        moved=upper_body(frame,np.array([.05,3,1]),orb=[166,94],pelvis=pelvis)
        # The central boots must keep their exact pixels while the shoulders move.
        np.testing.assert_array_equal(frame[170:192,109:145],moved[170:192,109:145])
        self.assertGreater(np.count_nonzero(frame[83:145]!=moved[83:145]),100)

    def test_source_density_is_uniform_through_both_steps(self):
        for direction in ["front","front-quarter","side","back-quarter","back"]:
            frames,records=registered("run",direction)
            self.assertEqual(len(frames),8)
            self.assertEqual(len({r["scale"] for r in records}),1)
            widths=[r["landmarks"]["head"][2]-r["landmarks"]["head"][0] for r in records]
            self.assertLess(max(widths)-min(widths),3)
            self.assertTrue(all(frame.shape==(256,256,4) for frame in frames))
            for i in [3,7]:
                neighbours=[records[j]["landmarks"]["pelvis"][1] for j in [i-1,(i+1)%8]]
                self.assertLess(records[i]["landmarks"]["pelvis"][1],sum(neighbours)/2,
                                "Flight must rise from the running support, not sink towards the idle root")


if __name__=="__main__":
    unittest.main()
