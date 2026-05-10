import asyncio
import os
from playwright.async_api import async_playwright

async def capture():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={'width': 1080, 'height': 720})
        
        # Load the new product-level HTML
        file_path = "file://" + os.path.abspath("codi-demo-product.html")
        await page.goto(file_path)
        
        # Number of scenes in the HTML
        num_scenes = 4
        
        for i in range(num_scenes):
            print(f"Capturing scene {i+1}...")
            # Trigger the scene change via JS
            await page.evaluate(f"window.gotoScene({i})")
            # Wait for animation to settle
            await asyncio.sleep(1.0) 
            
            # Save screenshot
            await page.screenshot(path=f"product-frame-{i+1}.png")
            
        await browser.close()

if __name__ == "__main__":
    asyncio.run(capture())
