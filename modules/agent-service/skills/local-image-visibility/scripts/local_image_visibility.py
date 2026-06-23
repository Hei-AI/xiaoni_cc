#!/usr/bin/env python3
import argparse, base64, binascii, os, struct, subprocess, sys, zlib

PNG_SIG=b'\x89PNG\r\n\x1a\n'

def read_png(path):
    raw=open(path,'rb').read()
    if raw[:8]!=PNG_SIG: raise SystemExit('not a PNG')
    pos=8; data=b''; w=h=bd=ct=None
    while pos<len(raw):
        ln=struct.unpack('>I',raw[pos:pos+4])[0]; typ=raw[pos+4:pos+8]; ch=raw[pos+8:pos+8+ln]; pos+=12+ln
        if typ==b'IHDR': w,h,bd,ct,comp,flt,inter=struct.unpack('>IIBBBBB',ch)
        elif typ==b'IDAT': data+=ch
        elif typ==b'IEND': break
    if bd!=8 or ct not in (2,6): raise SystemExit(f'unsupported PNG: bit_depth={bd} color_type={ct}; only RGB/RGBA 8-bit supported')
    bpp=4 if ct==6 else 3; stride=w*bpp; scan=zlib.decompress(data); rows=[]; i=0; prev=[0]*stride
    for y in range(h):
        f=scan[i]; i+=1; cur=list(scan[i:i+stride]); i+=stride
        for x in range(stride):
            a=cur[x-bpp] if x>=bpp else 0; b=prev[x]; c=prev[x-bpp] if x>=bpp else 0
            if f==1: cur[x]=(cur[x]+a)&255
            elif f==2: cur[x]=(cur[x]+b)&255
            elif f==3: cur[x]=(cur[x]+((a+b)//2))&255
            elif f==4:
                p=a+b-c; pa=abs(p-a); pb=abs(p-b); pc=abs(p-c); pr=a if pa<=pb and pa<=pc else (b if pb<=pc else c); cur[x]=(cur[x]+pr)&255
            elif f!=0: raise SystemExit(f'unsupported PNG filter {f}')
        rows.append(cur); prev=cur
    return w,h,ct,bpp,rows

def png_chunk(t,d):
    return struct.pack('>I',len(d))+t+d+struct.pack('>I',binascii.crc32(t+d)&0xffffffff)

def write_thumb(src, out, nw, nh):
    w,h,ct,bpp,rows=read_png(src); out_rows=[]
    for yy in range(nh):
        sy=yy*h//nh; row=rows[sy]; line=bytearray()
        for xx in range(nw):
            sx=xx*w//nw; idx=sx*bpp; line.extend(row[idx:idx+3])
        out_rows.append(bytes([0])+bytes(line))
    png=PNG_SIG+png_chunk(b'IHDR',struct.pack('>IIBBBBB',nw,nh,8,2,0,0,0))+png_chunk(b'IDAT',zlib.compress(b''.join(out_rows),9))+png_chunk(b'IEND',b'')
    open(out,'wb').write(png)
    return out

def classify(r,g,b):
    lum=.2126*r+.7152*g+.0722*b
    if lum<18: return ' '
    if lum<42: return '.'
    if r>190 and g>185 and b>170: return 'W'
    if r>g*1.35 and r>b*1.25: return 'R'
    if g>r*1.2 and g>b*1.05: return 'G'
    if b>r*1.2 and b>g*1.05: return 'B'
    if r>145 and g>100 and b<105: return 'Y'
    if lum>115: return '*'
    return 'o'

def ascii_report(src, out, cw=80, ch=40):
    w,h,ct,bpp,rows=read_png(src)
    lines=[f'legend: space=very dark, .=dark detail, B=blue, G=green, R=red, Y=warm/yellow, W=white, *=bright neutral, o=mid', f'size {w} {h} color_type {ct}']
    for gy in range(ch):
        line=''
        for gx in range(cw):
            xs=gx*w//cw; xe=(gx+1)*w//cw; ys=gy*h//ch; ye=(gy+1)*h//ch
            rr=gg=bb=n=0; stepy=max(1,(ye-ys)//4); stepx=max(1,(xe-xs)//4)
            for yy in range(ys,ye,stepy):
                row=rows[yy]
                for xx in range(xs,xe,stepx):
                    idx=xx*bpp; rr+=row[idx]; gg+=row[idx+1]; bb+=row[idx+2]; n+=1
            line+=classify(rr/n,gg/n,bb/n)
        lines.append(line.rstrip())
    open(out,'w').write('\n'.join(lines)+'\n')
    return out

def default_thumb_path(src,w,h):
    base=os.path.splitext(os.path.basename(src))[0]
    return f'/xiaoni-runtime/picture/{base}-thumb-{w}x{h}.png'

def main():
    ap=argparse.ArgumentParser()
    sub=ap.add_subparsers(dest='cmd', required=True)
    p=sub.add_parser('info'); p.add_argument('path')
    p=sub.add_parser('thumb'); p.add_argument('path'); p.add_argument('--out'); p.add_argument('--width',type=int,default=128); p.add_argument('--height',type=int,default=85)
    p=sub.add_parser('ascii'); p.add_argument('path'); p.add_argument('--out', required=True); p.add_argument('--cols',type=int,default=80); p.add_argument('--rows',type=int,default=40)
    p=sub.add_parser('browser-thumb'); p.add_argument('path'); p.add_argument('--width',type=int,default=96); p.add_argument('--height',type=int,default=64)
    args=ap.parse_args()
    if args.cmd=='info':
        w,h,ct,bpp,rows=read_png(args.path); print({'path':args.path,'exists':os.path.exists(args.path),'bytes':os.path.getsize(args.path),'width':w,'height':h,'color_type':ct})
    elif args.cmd=='thumb':
        out=args.out or default_thumb_path(args.path,args.width,args.height); print(write_thumb(args.path,out,args.width,args.height))
    elif args.cmd=='ascii':
        print(ascii_report(args.path,args.out,args.cols,args.rows))
    elif args.cmd=='browser-thumb':
        out=default_thumb_path(args.path,args.width,args.height); write_thumb(args.path,out,args.width,args.height)
        url='data:image/png;base64,'+base64.b64encode(open(out,'rb').read()).decode()
        cmd=['python3','/workspace/qq_bot/modules/agent-service/skills/xiaoni-browser/scripts/xiaoni_playwright_cli.py','--','-s=xiaoni-host','goto',url]
        print('thumbnail:',out,'url_length:',len(url), file=sys.stderr)
        r=subprocess.run(cmd, text=True, capture_output=True, timeout=20)
        print(r.stdout); print(r.stderr, file=sys.stderr)
        sys.exit(r.returncode)
if __name__=='__main__': main()
