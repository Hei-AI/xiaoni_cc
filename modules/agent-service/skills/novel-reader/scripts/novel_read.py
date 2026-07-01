#!/usr/bin/env python3
"""Read a local txt file in chunks, with automatic bookmark."""
import sys, os, json

BOOKMARK_FILE = '/xiaoni-runtime/reading/.bookmarks.json'

def load_bookmarks():
    if os.path.exists(BOOKMARK_FILE):
        with open(BOOKMARK_FILE, 'r') as f:
            return json.load(f)
    return {}

def save_bookmark(filepath, line):
    bm = load_bookmarks()
    bm[os.path.abspath(filepath)] = line
    os.makedirs(os.path.dirname(BOOKMARK_FILE), exist_ok=True)
    with open(BOOKMARK_FILE, 'w') as f:
        json.dump(bm, f)

def main():
    if len(sys.argv) < 2:
        print("Usage: novel_read.py <file.txt> [start_line|continue] [num_lines]")
        print("  start_line: 行号，或 'c' 接着上次读的地方")
        sys.exit(1)
    
    filepath = sys.argv[1]
    count = 30
    
    if len(sys.argv) > 2:
        arg2 = sys.argv[2]
        if arg2 in ('c', 'continue', '接着读'):
            bm = load_bookmarks()
            start = bm.get(os.path.abspath(filepath), 1)
        else:
            start = int(arg2)
    else:
        # 默认接着读
        bm = load_bookmarks()
        start = bm.get(os.path.abspath(filepath), 1)
    
    if len(sys.argv) > 3:
        count = int(sys.argv[3])
    
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    total = len(lines)
    s = max(0, start - 1)
    e = min(total, s + count)
    
    print(f"=== {os.path.basename(filepath)} · 第{s+1}-{e}行 / 共{total}行 ===\n")
    
    for i in range(s, e):
        print(lines[i], end='')
    
    # 保存书签
    next_line = e + 1  # 读完了保持在末尾之后
    save_bookmark(filepath, next_line)
    
    if e < total:
        print(f"\n\n--- 书签已存。下次直接: novel_read.py {filepath} ---")
    else:
        print(f"\n\n--- 读完了。书签已重置 ---")

if __name__ == '__main__':
    main()
