import importlib.util
from pathlib import Path
import tempfile
import unittest
from PIL import Image
spec=importlib.util.spec_from_file_location('comparison',Path(__file__).with_name('compare-reference.py'))
lib=importlib.util.module_from_spec(spec);spec.loader.exec_module(lib)
class ComparisonTests(unittest.TestCase):
 def test_dimensions_never_resized(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);a=root/'a.png';b=root/'b.png'
   Image.new('RGB',(10,10)).save(a);Image.new('RGB',(11,10)).save(b)
   with self.assertRaisesRegex(ValueError,'sizes differ'):lib.compare(a,b,root/'out')
 def test_one_pixel_difference_and_explicit_mask(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);a=root/'a.png';b=root/'b.png'
   Image.new('RGB',(10,10)).save(a);im=Image.new('RGB',(10,10));im.putpixel((1,2),(255,0,0));im.save(b)
   r=lib.compare(a,b,root/'out');self.assertEqual(r['different_pixels'],1);self.assertEqual(r['compared_pixels'],100)
   r=lib.compare(a,b,root/'masked',[{'name':'test','reason':'known changing pixel','rect':[1,2,1,1]}]);self.assertEqual(r['different_pixels'],0);self.assertEqual(r['compared_pixels'],99)
 def test_transparency_is_not_silently_discarded(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);a=root/'a.png';b=root/'b.png'
   Image.new('RGBA',(10,10),(0,0,0,0)).save(a);Image.new('RGBA',(10,10),(0,0,0,255)).save(b)
   with self.assertRaisesRegex(ValueError,'discard alpha'):lib.compare(a,b,root/'out')
 def test_full_mask_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);a=root/'a.png';Image.new('RGB',(10,10)).save(a)
   with self.assertRaisesRegex(ValueError,'entire image'):lib.compare(a,a,root/'out',[{'name':'bad','reason':'test','rect':[0,0,10,10]}])
if __name__=='__main__':unittest.main()
