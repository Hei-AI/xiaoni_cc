#!/usr/bin/env python3
"""自动定时检查gmail。有新未读时通过notify skill投递通知。"""

import subprocess
import sys
import time
import os

CHECK_SCRIPT = os.path.join(os.path.dirname(__file__), "check_email.py")
NOTIFY_SCRIPT = "/workspace/qq_bot/modules/agent-service/skills/notify/scripts/notify.py"
DEFAULT_INTERVAL = 30  # minutes
LAST_COUNT_FILE = "/xiaoni-runtime/tmp/last_email_count.txt"

def get_last_count():
    try:
        with open(LAST_COUNT_FILE) as f:
            return int(f.read().strip())
    except:
        return 0

def set_last_count(n):
    os.makedirs(os.path.dirname(LAST_COUNT_FILE), exist_ok=True)
    with open(LAST_COUNT_FILE, "w") as f:
        f.write(str(n))

def notify(text, source="check-email"):
    subprocess.run([
        sys.executable, NOTIFY_SCRIPT,
        "--from", source, text,
    ], check=False)

def check_once():
    result = subprocess.run(
        [sys.executable, CHECK_SCRIPT],
        capture_output=True, text=True, timeout=60
    )
    line = result.stdout.strip()
    if line.startswith("UNREAD:"):
        count = int(line.split(":")[1].split("|")[0].strip())
        return count, line
    elif line.startswith("NO_UNREAD"):
        return 0, line
    else:
        return -1, line

def main():
    interval = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_INTERVAL
    print(f"[auto-check-email] 每{interval}分钟检查一次。用notify投递。")
    
    while True:
        try:
            count, msg = check_once()
            last = get_last_count()
            
            if count > 0 and count != last:
                notify(f"收件箱有 {count} 封未读邮件")
                set_last_count(count)
            elif count == 0 and last > 0:
                set_last_count(0)
            
        except Exception as e:
            print(f"[ERROR] {e}")
        
        time.sleep(interval * 60)

if __name__ == "__main__":
    main()
