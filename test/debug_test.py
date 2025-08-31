#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
调试测试脚本
"""

print("=== Debug Test Started ===")

try:
    print("1. Testing basic imports...")
    import asyncio
    print("   ✓ asyncio imported")
    
    import sys
    print("   ✓ sys imported")
    
    import os
    print("   ✓ os imported")
    
    print("2. Testing path setup...")
    current_dir = os.path.dirname(os.path.abspath(__file__))
    main_dir = os.path.join(current_dir, '..', 'main')
    print(f"   Current dir: {current_dir}")
    print(f"   Main dir: {main_dir}")
    print(f"   Main dir exists: {os.path.exists(main_dir)}")
    
    sys.path.insert(0, main_dir)
    print(f"   Added {main_dir} to Python path")
    
    print("3. Testing websocket_client import...")
    from websocket_client import WebSocketClient
    print("   ✓ WebSocketClient imported successfully")
    
    print("4. Testing client creation...")
    client = WebSocketClient()
    print("   ✓ WebSocketClient instance created")
    
    print("5. Testing connection...")
    async def test_connect():
        try:
            result = await client.connect()
            print(f"   Connection result: {result}")
            if result:
                await client.disconnect()
                print("   ✓ Disconnected successfully")
            return result
        except Exception as e:
            print(f"   ✗ Connection error: {e}")
            return False
    
    print("   Running async test...")
    result = asyncio.run(test_connect())
    print(f"   Final result: {result}")
    
except Exception as e:
    print(f"✗ Error: {e}")
    import traceback
    traceback.print_exc()

print("=== Debug Test Completed ===")
