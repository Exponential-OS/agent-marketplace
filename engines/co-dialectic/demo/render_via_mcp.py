import asyncio
import os
import sys

# Since I am an agent, I cannot call 'mcp_...' directly from a python script.
# I will output the instructions for the MAIN LOOP to execute.

scenes = [0, 1, 2, 3]

print("PLAN: Sequential MCP calls to capture product frames.")
for i in scenes:
    print(f"STEP {i}:")
    print(f"  - mcp_playwright_ms_browser_evaluate(function='() => window.gotoScene({i})')")
    print(f"  - mcp_playwright_ms_browser_take_screenshot(filename='product-frame-{i+1}.png')")
