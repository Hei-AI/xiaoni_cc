#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request


DEFAULT_ENDPOINT = os.environ.get("XIAONI_BROWSER_MCP_URL", "http://127.0.0.1:9978/mcp")
DEFAULT_HOST_HEADER = os.environ.get("XIAONI_BROWSER_MCP_HOST_HEADER", "localhost:9978")
HELPER_IMAGE = os.environ.get("XIAONI_BROWSER_HELPER_IMAGE", "node:20-alpine")
SESSION_FILE = os.environ.get("XIAONI_BROWSER_SESSION_FILE", "/xiaoni-runtime/browser/xiaoni-browser-session.json")


def sse_json(text):
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("data:"):
            return json.loads(line[5:].strip())
    if text.strip():
        return json.loads(text)
    return None


def http_post(endpoint, payload, session_id=None):
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Host": DEFAULT_HOST_HEADER,
    }
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(endpoint, data=data, method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=20) as response:
        text = response.read().decode("utf-8")
        return response.headers, sse_json(text)


def read_session_id():
    try:
        with open(SESSION_FILE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        session_id = data.get("session_id")
        return session_id if isinstance(session_id, str) and session_id else None
    except Exception:
        return None


def write_session_id(session_id):
    try:
        os.makedirs(os.path.dirname(SESSION_FILE), exist_ok=True)
        with open(SESSION_FILE, "w", encoding="utf-8") as handle:
            json.dump({"session_id": session_id}, handle)
    except Exception:
        pass


def clear_session_id():
    try:
        os.unlink(SESSION_FILE)
    except FileNotFoundError:
        pass
    except Exception:
        pass


def call_direct_existing(tool_name, arguments, session_id):
    call = {
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments},
    }
    _headers, result = http_post(DEFAULT_ENDPOINT, call, session_id)
    if result and "error" in result:
        raise RuntimeError(json.dumps(result["error"], ensure_ascii=False))
    return result


def call_direct_new(tool_name, arguments):
    init = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": "xiaoni-browser", "version": "0.1.0"},
        },
    }
    headers, init_result = http_post(DEFAULT_ENDPOINT, init)
    session_id = headers.get("mcp-session-id")
    if not session_id:
        raise RuntimeError("MCP initialize did not return mcp-session-id")
    http_post(DEFAULT_ENDPOINT, {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}, session_id)
    result = call_direct_existing(tool_name, arguments, session_id)
    write_session_id(session_id)
    return result


NODE_HELPER = r"""
const http = require('http');
const endpoint = new URL(process.env.XIAONI_BROWSER_MCP_URL || 'http://127.0.0.1:9978/mcp');
const hostHeader = process.env.XIAONI_BROWSER_MCP_HOST_HEADER || 'localhost:9978';
const request = JSON.parse(process.env.XIAONI_BROWSER_REQUEST);
let nextId = 1;

function post(payload, sessionId) {
  const body = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Content-Length': Buffer.byteLength(body),
    'Host': hostHeader,
  };
  if (sessionId)
    headers['Mcp-Session-Id'] = sessionId;
  const options = {
    method: 'POST',
    hostname: endpoint.hostname,
    port: endpoint.port || 80,
    path: endpoint.pathname + endpoint.search,
    headers,
  };
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => text += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300)
          return reject(new Error(`HTTP ${res.statusCode}: ${text}`));
        let parsed = null;
        for (const line of text.split(/\r?\n/)) {
          if (line.startsWith('data:')) {
            parsed = JSON.parse(line.slice(5).trim());
            break;
          }
        }
        if (!parsed && text.trim())
          parsed = JSON.parse(text);
        resolve({ headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('request timeout')));
    req.write(body);
    req.end();
  });
}

(async () => {
  let sessionId = request.sessionId;
  if (!sessionId) {
    const init = await post({
      jsonrpc: '2.0',
      id: nextId++,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'xiaoni-browser', version: '0.1.0' },
      },
    });
    sessionId = init.headers['mcp-session-id'];
    if (!sessionId)
      throw new Error('MCP initialize did not return mcp-session-id');
    await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, sessionId);
  }
  const calls = request.calls || [{ tool: request.tool, arguments: request.arguments || {} }];
  const bodies = [];
  for (const item of calls) {
    const call = await post({
      jsonrpc: '2.0',
      id: nextId++,
      method: 'tools/call',
      params: { name: item.tool, arguments: item.arguments || {} },
    }, sessionId);
    if (call.body && call.body.error)
      throw new Error(JSON.stringify(call.body.error));
    bodies.push(call.body);
  }
  console.log(JSON.stringify({ sessionId, body: bodies.length === 1 ? bodies[0] : bodies }, null, 2));
})().catch(error => {
  console.error('XIAONI_BROWSER_ERROR ' + error.message);
  process.exit(1);
});
"""


def call_via_docker(tool_name, arguments, session_id=None, calls=None):
    payload = {"sessionId": session_id}
    if calls is not None:
        payload["calls"] = calls
    else:
        payload.update({"tool": tool_name, "arguments": arguments})
    request = json.dumps(payload, ensure_ascii=False)
    cmd = [
        "docker",
        "run",
        "--rm",
        "--network",
        "host",
        "-e",
        f"XIAONI_BROWSER_REQUEST={request}",
        "-e",
        f"XIAONI_BROWSER_MCP_URL={DEFAULT_ENDPOINT}",
        "-e",
        f"XIAONI_BROWSER_MCP_HOST_HEADER={DEFAULT_HOST_HEADER}",
        HELPER_IMAGE,
        "node",
        "-e",
        NODE_HELPER,
    ]
    completed = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout).strip())
    payload = json.loads(completed.stdout)
    if payload.get("sessionId"):
        write_session_id(payload["sessionId"])
    return payload.get("body")


def call_with_transport(tool_name, arguments, session_id=None):
    try:
        if session_id:
            return call_direct_existing(tool_name, arguments, session_id)
        return call_direct_new(tool_name, arguments)
    except Exception as direct_error:
        if not os.path.exists("/var/run/docker.sock"):
            raise RuntimeError(f"direct bridge call failed and docker helper is unavailable: {direct_error}")
        return call_via_docker(tool_name, arguments, session_id)


def call_tool(tool_name, arguments):
    session_id = read_session_id()
    if session_id:
        try:
            return call_with_transport(tool_name, arguments, session_id)
        except Exception:
            clear_session_id()
    return call_with_transport(tool_name, arguments)


def call_existing_session_only(tool_name, arguments):
    session_id = read_session_id()
    if not session_id:
        raise RuntimeError("no cached browser session; run goto or sequence to connect and immediately navigate")
    try:
        return call_with_transport(tool_name, arguments, session_id)
    except Exception as error:
        clear_session_id()
        raise RuntimeError(f"cached browser session is no longer valid: {error}")


def call_sequence(calls):
    session_id = read_session_id()
    if not os.path.exists("/var/run/docker.sock"):
        results = []
        if not session_id:
            first = calls[0]
            results.append(call_direct_new(first["tool"], first.get("arguments", {})))
            session_id = read_session_id()
            remaining = calls[1:]
        else:
            remaining = calls
        for item in remaining:
            results.append(call_direct_existing(item["tool"], item.get("arguments", {}), session_id))
        return results
    try:
        payload = call_via_docker("", {}, session_id, calls)
    except Exception:
        clear_session_id()
        payload = call_via_docker("", {}, None, calls)
    return payload if isinstance(payload, list) else [payload]


def print_result(result):
    saw_error = False
    content = ((result or {}).get("result") or {}).get("content")
    if isinstance(content, list):
        for item in content:
            if item.get("type") == "text":
                text = item.get("text", "")
                if text.startswith("### Error"):
                    saw_error = True
                print(text)
            else:
                print(json.dumps(item, ensure_ascii=False, indent=2))
        return 1 if saw_error else 0
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def build_call(args):
    if args.command == "tool":
        return args.tool_name, json.loads(args.arguments_json)
    if args.command == "status":
        return "browser_tabs", {"action": "list"}
    if args.command == "tabs":
        return "browser_tabs", {"action": "list"}
    if args.command == "tab-new":
        return "browser_tabs", {"action": "new"}
    if args.command == "tab-select":
        return "browser_tabs", {"action": "select", "index": args.index}
    if args.command == "tab-close":
        payload = {"action": "close"}
        if args.index is not None:
            payload["index"] = args.index
        return "browser_tabs", payload
    if args.command == "close":
        return "browser_close", {}
    if args.command == "resize":
        return "browser_resize", {"width": args.width, "height": args.height}
    if args.command == "goto":
        return "browser_navigate", {"url": args.url}
    if args.command == "back":
        return "browser_navigate_back", {}
    if args.command == "snapshot":
        payload = {}
        if args.filename:
            payload["filename"] = args.filename
        return "browser_snapshot", payload
    if args.command == "screenshot":
        payload = {"type": "png", "fullPage": args.full_page}
        if args.filename:
            payload["filename"] = args.filename
        return "browser_take_screenshot", payload
    if args.command == "click":
        return "browser_click", {"target": args.target, "element": args.element or args.target}
    if args.command == "fill":
        return "browser_fill_form", {"fields": [{"target": args.target, "element": args.element or args.target, "type": "textbox", "value": args.text}]}
    if args.command == "type":
        return "browser_type", {"text": args.text}
    if args.command == "press":
        return "browser_press_key", {"key": args.key}
    if args.command == "hover":
        return "browser_hover", {"target": args.target, "element": args.element or args.target}
    if args.command == "drag":
        return "browser_drag", {"startTarget": args.start, "endTarget": args.end}
    if args.command == "select":
        return "browser_select_option", {"target": args.target, "values": [args.value], "element": args.element or args.target}
    if args.command == "upload":
        return "browser_file_upload", {"paths": args.paths}
    if args.command == "drop":
        payload = {"target": args.target, "element": args.element or args.target}
        if args.paths:
            payload["paths"] = args.paths
        if args.data_json:
            payload["data"] = json.loads(args.data_json)
        return "browser_drop", payload
    if args.command == "dialog-accept":
        payload = {"accept": True}
        if args.prompt:
            payload["promptText"] = args.prompt
        return "browser_handle_dialog", payload
    if args.command == "dialog-dismiss":
        return "browser_handle_dialog", {"accept": False}
    if args.command == "console":
        payload = {"level": args.level, "all": args.all}
        if args.filename:
            payload["filename"] = args.filename
        return "browser_console_messages", payload
    if args.command == "requests":
        payload = {"includeStatic": args.include_static}
        if args.filename:
            payload["filename"] = args.filename
        return "browser_network_requests", payload
    if args.command == "request":
        return "browser_network_request", {"index": args.index}
    if args.command == "wait":
        payload = {}
        if args.text:
            payload["text"] = args.text
        if args.time:
            payload["time"] = args.time
        return "browser_wait_for", payload
    if args.command == "run-code":
        return "browser_run_code_unsafe", {"code": args.code}
    if args.command == "eval":
        return "browser_evaluate", {"function": args.function}
    raise AssertionError(args.command)


def op_to_call(op):
    ns = argparse.Namespace(command=op.get("cmd") or op.get("command"))
    if ns.command == "goto":
        ns.url = op["url"]
    elif ns.command == "tool":
        ns.tool_name = op["tool"]
        ns.arguments_json = json.dumps(op.get("arguments", {}), ensure_ascii=False)
    elif ns.command in ("tab-new", "close", "back", "dialog-dismiss"):
        pass
    elif ns.command in ("tab-select", "tab-close"):
        ns.index = op.get("index")
    elif ns.command == "resize":
        ns.width = int(op["width"])
        ns.height = int(op["height"])
    elif ns.command == "snapshot":
        ns.filename = op.get("filename")
    elif ns.command == "screenshot":
        ns.filename = op.get("filename")
        ns.full_page = bool(op.get("full_page") or op.get("fullPage"))
    elif ns.command in ("click", "hover"):
        ns.target = op["target"]
        ns.element = op.get("element")
    elif ns.command == "drag":
        ns.start = op["start"]
        ns.end = op["end"]
    elif ns.command == "select":
        ns.target = op["target"]
        ns.value = op["value"]
        ns.element = op.get("element")
    elif ns.command == "upload":
        ns.paths = op["paths"]
    elif ns.command == "drop":
        ns.target = op["target"]
        ns.element = op.get("element")
        ns.paths = op.get("paths")
        ns.data_json = json.dumps(op["data"], ensure_ascii=False) if "data" in op else None
    elif ns.command == "dialog-accept":
        ns.prompt = op.get("prompt")
    elif ns.command == "fill":
        ns.target = op["target"]
        ns.text = op["text"]
        ns.element = op.get("element")
    elif ns.command == "type":
        ns.text = op["text"]
    elif ns.command == "press":
        ns.key = op["key"]
    elif ns.command == "console":
        ns.level = op.get("level", "info")
        ns.all = bool(op.get("all", False))
        ns.filename = op.get("filename")
    elif ns.command == "requests":
        ns.include_static = bool(op.get("includeStatic") or op.get("include_static") or False)
        ns.filename = op.get("filename")
    elif ns.command == "request":
        ns.index = int(op["index"])
    elif ns.command == "wait":
        ns.text = op.get("text")
        ns.time = op.get("time")
    elif ns.command == "run-code":
        ns.code = op["code"]
    elif ns.command == "eval":
        ns.function = op["function"]
    elif ns.command in ("status", "tabs"):
        pass
    else:
        raise ValueError(f"unsupported sequence command: {ns.command}")
    tool, arguments = build_call(ns)
    return {"tool": tool, "arguments": arguments}


def main(argv):
    parser = argparse.ArgumentParser(description="Control Xiaoni's host Chrome through the Playwright bridge.")
    sub = parser.add_subparsers(dest="command", required=True)
    raw = sub.add_parser("tool")
    raw.add_argument("tool_name")
    raw.add_argument("arguments_json")
    sub.add_parser("status")
    sub.add_parser("tabs")
    sub.add_parser("tab-new")
    tab_select = sub.add_parser("tab-select")
    tab_select.add_argument("index", type=int)
    tab_close = sub.add_parser("tab-close")
    tab_close.add_argument("index", nargs="?", type=int)
    sub.add_parser("close")
    resize = sub.add_parser("resize")
    resize.add_argument("width", type=int)
    resize.add_argument("height", type=int)
    goto = sub.add_parser("goto")
    goto.add_argument("url")
    sub.add_parser("back")
    snapshot = sub.add_parser("snapshot")
    snapshot.add_argument("filename", nargs="?")
    screenshot = sub.add_parser("screenshot")
    screenshot.add_argument("filename", nargs="?")
    screenshot.add_argument("--full-page", action="store_true")
    click = sub.add_parser("click")
    click.add_argument("target")
    click.add_argument("element", nargs="?")
    fill = sub.add_parser("fill")
    fill.add_argument("target")
    fill.add_argument("text")
    fill.add_argument("element", nargs="?")
    typ = sub.add_parser("type")
    typ.add_argument("text")
    press = sub.add_parser("press")
    press.add_argument("key")
    hover = sub.add_parser("hover")
    hover.add_argument("target")
    hover.add_argument("element", nargs="?")
    drag = sub.add_parser("drag")
    drag.add_argument("start")
    drag.add_argument("end")
    select = sub.add_parser("select")
    select.add_argument("target")
    select.add_argument("value")
    select.add_argument("element", nargs="?")
    upload = sub.add_parser("upload")
    upload.add_argument("paths", nargs="+")
    drop = sub.add_parser("drop")
    drop.add_argument("target")
    drop.add_argument("--element")
    drop.add_argument("--paths", nargs="+")
    drop.add_argument("--data-json")
    dialog_accept = sub.add_parser("dialog-accept")
    dialog_accept.add_argument("prompt", nargs="?")
    sub.add_parser("dialog-dismiss")
    console = sub.add_parser("console")
    console.add_argument("level", nargs="?", default="info", choices=["error", "warning", "info", "debug"])
    console.add_argument("--all", action="store_true")
    console.add_argument("--filename")
    requests = sub.add_parser("requests")
    requests.add_argument("--include-static", action="store_true")
    requests.add_argument("--filename")
    request = sub.add_parser("request")
    request.add_argument("index", type=int)
    wait = sub.add_parser("wait")
    wait.add_argument("--text")
    wait.add_argument("--time", type=float)
    run_code = sub.add_parser("run-code")
    run_code.add_argument("code")
    ev = sub.add_parser("eval")
    ev.add_argument("function")
    seq = sub.add_parser("sequence")
    seq.add_argument("operations_json")
    args = parser.parse_args(argv)
    if args.command == "sequence":
        try:
            operations = json.loads(args.operations_json)
            if not isinstance(operations, list):
                raise ValueError("operations_json must be a JSON array")
            calls = [op_to_call(op) for op in operations]
            exit_code = 0
            for result in call_sequence(calls):
                if print_result(result) != 0:
                    exit_code = 1
            return exit_code
        except Exception as error:
            print(f"XIAONI_BROWSER_ERROR {error}", file=sys.stderr)
            return 1
    tool_name, arguments = build_call(args)
    try:
        if args.command not in ("goto",):
            return print_result(call_existing_session_only(tool_name, arguments))
        return print_result(call_tool(tool_name, arguments))
    except Exception as error:
        print(f"XIAONI_BROWSER_ERROR {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
