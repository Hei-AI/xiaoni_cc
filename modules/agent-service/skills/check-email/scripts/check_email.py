#!/usr/bin/env python3
"""检查gmail未读邮件数。用xiaoni-browser的playwright CLI。"""

import subprocess
import sys
import re
import json

BROWSER_CLI = "/workspace/qq_bot/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py"

def run_browser_cmd(args_str):
    """Run a xiaoni-browser CLI command and return stdout."""
    cmd = f"python3 {BROWSER_CLI} -- -s=xiaoni-host {args_str}"
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
    return result.stdout

def check_unread():
    """Check gmail for unread count. Returns (unread_count, title_text)."""
    # Navigate to gmail
    run_browser_cmd('goto "https://mail.google.com/mail/u/1/#inbox"')
    
    # Get page title
    output = run_browser_cmd('eval "document.title"')
    
    # Parse title for unread count
    # Title format: "收件箱 (3) - xiaoni.liahuas@gmail.com - Gmail"
    # or "收件箱 - xiaoni.liahuas@gmail.com - Gmail" (no unread)
    title_match = re.search(r'["\'](.+?)["\']', output)
    if not title_match:
        return -1, "could not parse title"
    
    title = title_match.group(1)
    
    # Look for (N) pattern
    unread_match = re.search(r'\((\d+)\)', title)
    if unread_match:
        return int(unread_match.group(1)), title
    else:
        return 0, title

def main():
    try:
        count, title = check_unread()
        if count < 0:
            print(f"ERROR: {title}")
            sys.exit(1)
        elif count == 0:
            print(f"NO_UNREAD | {title}")
        else:
            print(f"UNREAD:{count} | {title}")
    except subprocess.TimeoutExpired:
        print("ERROR: timeout")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
