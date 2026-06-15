#!/usr/bin/env python3
import argparse, json, re, sys
from pathlib import Path


def read_text(path):
    if path == '-':
        return sys.stdin.read()
    return Path(path).read_text(errors='replace')


def blocks_from_markdown(text):
    text = text.replace('\r\n', '\n').replace('\r', '\n').strip()
    # Split at blank lines, but keep list runs reasonably together later.
    raw = [b.strip() for b in re.split(r'\n\s*\n+', text) if b.strip()]
    blocks = []
    for b in raw:
        # If a block is a long bullet list, split by bullet lines.
        lines = b.split('\n')
        if len(lines) > 4 and sum(1 for l in lines if re.match(r'^\s*(?:[-*+] |\d+\. )', l)) >= 3:
            cur = []
            for line in lines:
                if re.match(r'^\s*(?:[-*+] |\d+\. )', line) and cur:
                    blocks.append('\n'.join(cur).strip())
                    cur = [line]
                else:
                    cur.append(line)
            if cur:
                blocks.append('\n'.join(cur).strip())
        else:
            blocks.append(b)
    return blocks


def split_long_block(block, max_chars):
    if len(block) <= max_chars:
        return [block]
    # Prefer sentence-ish boundaries for prose; otherwise hard split.
    parts = []
    rest = block.strip()
    while len(rest) > max_chars:
        window = rest[:max_chars+1]
        cut = max(window.rfind(x) for x in ['。', '！', '？', '. ', '! ', '? ', '；', '; ', '，', ', '])
        if cut < max_chars * 0.45:
            cut = max_chars
        else:
            cut += 1
        parts.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    if rest:
        parts.append(rest)
    return parts


def split_messages(text, max_chars=650, title=None):
    blocks = blocks_from_markdown(text)
    messages = []
    cur = ''

    def flush():
        nonlocal cur
        if cur.strip():
            messages.append(cur.strip())
            cur = ''

    if title:
        messages.append(title.strip())

    for block in blocks:
        for piece in split_long_block(block, max_chars):
            if not cur:
                cur = piece
            elif len(cur) + 2 + len(piece) <= max_chars:
                cur += '\n\n' + piece
            else:
                flush()
                cur = piece
    flush()
    return messages


def main():
    ap = argparse.ArgumentParser(description='Split a long Markdown note into QQ-friendly messages.')
    ap.add_argument('path', help='Markdown/text file path, or - for stdin')
    ap.add_argument('--max-chars', type=int, default=650)
    ap.add_argument('--format', choices=['json','text'], default='json')
    ap.add_argument('--title', default='')
    ap.add_argument('--teaser', action='store_true', help='Output only the first 1-2 chunks as a QQ teaser; use when full text should live elsewhere.')
    args = ap.parse_args()
    msgs = split_messages(read_text(args.path), args.max_chars, args.title or None)
    if args.teaser and len(msgs) > 2:
        msgs = msgs[:2]
    if args.format == 'json':
        print(json.dumps(msgs, ensure_ascii=False, indent=2))
    else:
        for i,m in enumerate(msgs,1):
            print(f'--- message {i}/{len(msgs)} chars={len(m)} ---')
            print(m)
            print()

if __name__ == '__main__':
    main()
