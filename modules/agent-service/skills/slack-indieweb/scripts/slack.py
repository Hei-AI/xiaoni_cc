#!/usr/bin/env python3
"""IndieWeb Slack send/read via Web API."""
import argparse, json, urllib.request, urllib.parse, sys

TEAM = "indiewebcamp"
DEFAULT_CHANNEL = "C03QR2B4R"  # #indieweb
TOKEN = "xoxc-3841079095-11889207709520-11850616536007-081846d7337b42dddab3d99d34efb5ef1ba647f654e341cda5e74e5c5dd36862"
D_COOKIE = "xoxd-RZ3bG0IvTRU5zL85DxLMJtsYqku7UGJoA7hTO45CQ0bHvdAVcgAU%2Bv1Cbpf6LV1QWE1%2F%2BzQsLBtY9OjziOBj%2FxR0GWK5%2FDb%2BPHWnHLfhG%2FsFbxtfgKWzxR9KCl3Z0rHEuszn2ZyTfMI%2Bgo%2BIqxUXJjdYpG9Riin3O0e3qecjW0aaPeS1RxDpy3f7LnFj94K4e7yOyZtt"

def api(method, data):
    url = f"https://{TEAM}.slack.com/api/{method}"
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": f"d={D_COOKIE}"
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

def send(text, channel):
    r = api("chat.postMessage", {"token": TOKEN, "channel": channel, "text": text})
    if r.get("ok"):
        print(f"✓ sent to {channel}")
    else:
        print(f"✗ error: {r.get('error', 'unknown')}", file=sys.stderr)
    return r

def read(channel, count=10):
    r = api("conversations.history", {"token": TOKEN, "channel": channel, "limit": str(count)})
    if not r.get("ok"):
        print(f"✗ error: {r.get('error', 'unknown')}", file=sys.stderr)
        return
    for msg in reversed(r.get("messages", [])):
        user = msg.get("user", msg.get("username", "?"))
        text = msg.get("text", "")
        print(f"[{user}] {text}")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd")
    s = sub.add_parser("send")
    s.add_argument("text")
    s.add_argument("--channel", default=DEFAULT_CHANNEL)
    r = sub.add_parser("read")
    r.add_argument("--channel", default=DEFAULT_CHANNEL)
    r.add_argument("--count", type=int, default=10)
    args = p.parse_args()
    if args.cmd == "send":
        send(args.text, args.channel)
    elif args.cmd == "read":
        read(args.channel, args.count)
    else:
        p.print_help()
