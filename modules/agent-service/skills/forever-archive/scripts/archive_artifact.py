#!/usr/bin/env python3
from pathlib import Path
import argparse, hashlib, shutil, datetime, sys

SAFE_ROOT=Path('/xiaoni-runtime/forever')

def sha256(p: Path) -> str:
    h=hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024), b''):
            h.update(chunk)
    return h.hexdigest()

def parse_file(spec: str):
    if ':' in spec:
        src, name = spec.split(':', 1)
    else:
        src, name = spec, Path(spec).name
    src=Path(src)
    if not src.exists() or not src.is_file():
        raise SystemExit(f'missing file: {src}')
    if '/' in name or name in {'', '.', '..'}:
        raise SystemExit(f'bad archive name: {name}')
    return src, name

ap=argparse.ArgumentParser(description='Copy artifact files into /xiaoni-runtime/forever and write restore manifest.')
ap.add_argument('--category', required=True, help='archive category, e.g. site, reading, images, toys')
ap.add_argument('--slug', required=True, help='safe folder slug')
ap.add_argument('--public-url', default='', help='public URL if any')
ap.add_argument('--route', default='', help='public route if any')
ap.add_argument('--note', default='', help='extra note for the manifest')
ap.add_argument('--file', action='append', required=True, help='source_path[:archive_name], repeatable')
args=ap.parse_args()
if any(part in args.category for part in ['..','/']) or any(part in args.slug for part in ['..','/']):
    raise SystemExit('category and slug must be simple path segments')

dest=SAFE_ROOT/args.category/args.slug
dest.mkdir(parents=True, exist_ok=True)
items=[]
for spec in args.file:
    src, name=parse_file(spec)
    out=dest/name
    shutil.copy2(src, out)
    items.append((src, out, sha256(out)))

now=datetime.datetime.now().astimezone().strftime('%Y-%m-%d %H:%M:%S %Z')
manifest=[
    f'# Forever manifest — {args.category}/{args.slug}',
    '',
    f'- Archived at: {now}',
    f'- Forever folder: `{dest}`',
]
if args.public_url:
    manifest.append(f'- Public URL: {args.public_url}')
if args.route:
    manifest.append(f'- Route: {args.route}')
if args.note:
    manifest.extend(['', '## Note', '', args.note])
manifest.extend(['', '## Files', ''])
for src,out,digest in items:
    manifest.append(f'- `{out.name}` — sha256 `{digest}` — copied from `{src}`')
manifest.extend(['', '## Restore rule', '', 'Treat public/build outputs as replaceable. Restore source/rendered files from this folder first, then rebuild or republish.'])
(dest/'FOREVER_MANIFEST.md').write_text('\n'.join(manifest)+'\n')
with (dest/'SHA256SUMS.txt').open('w') as f:
    for src,out,digest in items:
        f.write(f'{digest}  {out.name}\n')
    f.write(f'{sha256(dest/"FOREVER_MANIFEST.md")}  FOREVER_MANIFEST.md\n')
print(dest)
for _,out,digest in items:
    print(f'{digest}  {out.name}')
print(f'{sha256(dest/"FOREVER_MANIFEST.md")}  FOREVER_MANIFEST.md')
