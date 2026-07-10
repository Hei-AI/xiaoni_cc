#!/usr/bin/env python3
"""xiaoni-memory-compress: atomically write 小腻's compressed 近况 to the output file.

Reads the memory text from stdin, validates it is non-empty, and writes it to --out via a
temp-file + rename so the compression fork never reads a half-written file. This is the commit
channel for Spec B (compress_core_memory is no longer a wire tool): the compression fork guides
the model to run this, then reads <out> back to install the new <小腻近况>.
"""
import argparse
import os
import sys
import tempfile


def main() -> int:
    parser = argparse.ArgumentParser(description="Write 小腻's compressed 近况 to a file.")
    parser.add_argument('--out', required=True, help='destination path for the 近况 file')
    args = parser.parse_args()

    text = sys.stdin.read().strip()
    if not text:
        print('ERROR: empty memory text on stdin; nothing written', file=sys.stderr)
        return 1

    out_path = os.path.abspath(args.out)
    out_dir = os.path.dirname(out_path)
    os.makedirs(out_dir, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(dir=out_dir, prefix='.compress-', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(text)
        os.replace(tmp_path, out_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

    print(f'OK: wrote {len(text)} chars to {out_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
