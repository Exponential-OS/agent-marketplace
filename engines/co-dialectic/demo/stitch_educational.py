import imageio.v3 as iio
import numpy as np
from PIL import Image
import os

demo_dir = os.path.dirname(os.path.abspath(__file__))
frames_dir = os.path.join(demo_dir, "frames")
output = os.path.join(demo_dir, "codi-product-educational-v2.mp4")

frame_files = sorted([
    os.path.join(frames_dir, f)
    for f in os.listdir(frames_dir)
    if f.startswith("f_") and f.endswith(".png")
])

print(f"Found {len(frame_files)} frames in {frames_dir}")

frames_arr = []
for path in frame_files:
    img = Image.open(path).convert("RGB")
    arr = np.array(img)
    frames_arr.append(arr)

if frames_arr:
    total_s = len(frames_arr) / 24
    print(f"Total runtime: {len(frames_arr)} frames at 24fps = {total_s:.1f}s")
    
    iio.imwrite(
        output,
        frames_arr,
        fps=24,
        codec="libx264",
        quality=8,
        output_params=["-pix_fmt", "yuv420p"],
    )
    print(f"Written : {output}")
else:
    print("No frames found to stitch.")
