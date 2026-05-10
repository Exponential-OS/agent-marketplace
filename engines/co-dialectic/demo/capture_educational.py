import asyncio
import os
import sys
from playwright.async_api import async_playwright

async def capture():
    async with async_playwright() as p:
        print("Launching browser...")
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={'width': 1080, 'height': 720})
        
        file_path = "file://" + os.path.abspath("codi-demo-product.html")
        print(f"Opening file: {file_path}")
        
        try:
            await page.goto(file_path, wait_until="networkidle")
        except Exception as e:
            print(f"Access failed: {e}")
            await browser.close()
            return

        # Complete 12-scene Full-Feature flow
        scenes = [
            {"id": 0,  "frames": 72,  "label": "01_hook"},          # 3s
            {"id": 1,  "frames": 72,  "label": "02_reveal"},        # 3s
            {"id": 2,  "frames": 96,  "label": "03_system"},        # 4s
            {"id": 3,  "frames": 144, "label": "04_sharpen"},       # 6s
            {"id": 4,  "frames": 120, "label": "05_research"},      # 5s
            {"id": 5,  "frames": 120, "label": "06_hallucinate"},   # 5s
            {"id": 6,  "frames": 144, "label": "07_crossfamily"},   # 6s
            {"id": 7,  "frames": 120, "label": "08_sycophancy"},    # 5s
            {"id": 8,  "frames": 120, "label": "09_fusion"},        # 5s
            {"id": 9,  "frames": 144, "label": "10_preflight"},     # 6s
            {"id": 10, "frames": 144, "label": "11_handoff"},       # 6s
            {"id": 11, "frames": 168, "label": "12_curve"}          # 7s
        ]
        
        frames_dir = os.path.join(os.getcwd(), "frames")
        if not os.path.exists(frames_dir):
            os.makedirs(frames_dir)
            
        # Clear existing frames
        for f in os.listdir(frames_dir):
            if f.endswith(".png"):
                os.remove(os.path.join(frames_dir, f))
            
        frame_count = 0
        for scene in scenes:
            print(f"Rendering scene: {scene['label']} (id={scene['id']})")
            await page.evaluate(f"window.gotoScene({scene['id']})")
            await asyncio.sleep(0.5)
            
            for _ in range(scene['frames']):
                path = os.path.join(frames_dir, f"f_{frame_count:04d}.png")
                await page.screenshot(path=path)
                frame_count += 1
                
        print(f"Capture complete. Total frames: {frame_count}")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(capture())
