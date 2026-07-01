#!/usr/bin/env python3
"""Download a web novel from its table-of-contents page into clean local txt files."""
import sys, os, re, urllib.request, html as html_mod

NAV_KEYWORDS = ['pova.cc', 'now about', '写  诗  散文', '记  日记  梦', '收  音乐']

def clean_html(raw):
    """Strip HTML to plain text, preserving paragraph breaks."""
    text = re.sub(r'<style[^>]*>.*?</style>', '', raw, flags=re.DOTALL)
    text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL)
    text = re.sub(r'<br\s*/?>', '\n', text)
    text = re.sub(r'</p>', '\n', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = html_mod.unescape(text)
    lines = [l.strip() for l in text.split('\n')]
    lines = [l for l in lines if l]
    return '\n\n'.join(lines)

def find_chapter_links(toc_html, base_url):
    """Find chapter links from TOC page."""
    from urllib.parse import urljoin
    hrefs = re.findall(r'href="([^"]*)"', toc_html)
    chapters = []
    seen = set()
    for href in hrefs:
        full = urljoin(base_url, href)
        if full.rstrip('/') == base_url.rstrip('/'):
            continue
        slug = href.rstrip('/').split('/')[-1]
        if not slug or slug in seen:
            continue
        if slug in ('rss.xml', 'index.html', '') or ('.' in slug and not slug.endswith('.html')) or 'font' in href.lower() or 'css' in href.lower():
            continue
        # Skip top-level nav links
        if href.startswith('/') and href.count('/') <= 2 and not re.search(r'ch\d', slug):
            continue
        seen.add(slug)
        chapters.append((slug, full))
    return chapters

def clean_content(text):
    """Remove nav junk, duplicated headers, and footer from pova.cc-style pages."""
    paragraphs = text.split('\n\n')
    
    # Find where the real content starts by skipping nav-heavy paragraphs
    content_start = 0
    for i, p in enumerate(paragraphs):
        if any(kw in p for kw in NAV_KEYWORDS):
            content_start = i + 1
            continue
        # Also skip if it's just a repeated chapter marker before nav
        if re.match(r'^第\d+章\s', p) and i < 3:
            content_start = i + 1
            continue
        if content_start > 0:
            break
    
    # Find where content ends (footer nav)
    content_end = len(paragraphs)
    for i in range(len(paragraphs) - 1, max(content_start, 0), -1):
        p = paragraphs[i]
        if re.search(r'(←\s*上一章|下一章\s*→|nan\s*·\s*\d{4})', p):
            content_end = i
        else:
            break
    
    result = '\n\n'.join(paragraphs[content_start:content_end])
    return result.strip()

def main():
    if len(sys.argv) < 3:
        print("Usage: novel_download.py <toc_url> <save_dir>")
        sys.exit(1)
    
    toc_url = sys.argv[1]
    save_dir = sys.argv[2]
    os.makedirs(save_dir, exist_ok=True)
    
    print(f"Fetching TOC: {toc_url}")
    toc_html = urllib.request.urlopen(toc_url).read().decode('utf-8')
    
    chapters = find_chapter_links(toc_html, toc_url)
    if not chapters:
        print("No chapter links found!")
        sys.exit(1)
    
    print(f"Found {len(chapters)} chapters")
    
    for slug, url in chapters:
        try:
            raw = urllib.request.urlopen(url).read().decode('utf-8')
            text = clean_html(raw)
            text = clean_content(text)
            
            fname = f"{slug}.txt"
            path = os.path.join(save_dir, fname)
            with open(path, 'w', encoding='utf-8') as f:
                f.write(text)
            
            chars = len(text)
            print(f"  {fname}: {chars} chars")
        except Exception as e:
            print(f"  {slug}: ERROR {e}")
    
    print(f"\nDone! {len(chapters)} chapters saved to {save_dir}")

if __name__ == '__main__':
    main()
