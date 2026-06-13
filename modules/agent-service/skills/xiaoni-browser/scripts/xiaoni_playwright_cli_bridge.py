#!/usr/bin/env python3
import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 9977
NODE_EXE = "/mnt/c/Program Files/nodejs/node.exe"
POWERSHELL_EXE = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
CLI_SCRIPT_WIN = "C:\\temp\\xiaoni-playwright-cli\\node_modules\\@playwright\\cli\\playwright-cli.js"
CLI_WRAPPER_WIN = "C:\\temp\\xiaoni-playwright-cli\\xiaoni-playwright-cli.ps1"
CLI_SCRIPT_WSL = "/mnt/c/temp/xiaoni-playwright-cli/xiaoni-playwright-cli.ps1"
INSTALL_DIR_WSL = "/mnt/c/temp/xiaoni-playwright-cli"
RUNTIME_HOST_ROOT = os.environ.get("XIAONI_RUNTIME_HOST_ROOT", "/home/liahua/.qqbot-local/xiaoni-runtime")
RUNTIME_CONTAINER_ROOT = os.environ.get("XIAONI_RUNTIME_CONTAINER_ROOT", "/xiaoni-runtime")
CDP_ENDPOINT = os.environ.get("XIAONI_BROWSER_CDP_ENDPOINT", "http://127.0.0.1:9222")
CDP_PORT = os.environ.get("XIAONI_BROWSER_CDP_PORT", "9222")
CHROME_EXE_WIN = os.environ.get("XIAONI_CHROME_EXE_WIN", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
CHROME_USER_DATA_DIR_WIN = os.environ.get("XIAONI_CHROME_USER_DATA_DIR_WIN", "C:\\Users\\a8517\\AppData\\Local\\Google\\Chrome\\User Data")
CHROME_CDP_USER_DATA_DIR_WIN = os.environ.get("XIAONI_CHROME_CDP_USER_DATA_DIR_WIN", "C:\\Users\\a8517\\AppData\\Local\\Google\\Chrome\\Xiaoni CDP User Data")
CHROME_PROFILE_DIRECTORY = os.environ.get("XIAONI_CHROME_PROFILE_DIRECTORY", "Profile 2")
WEBSTORE_EXTENSION_ID = "mmlmfjhmonkocbjadbfplnigmagldckm"
EXTENSION_KEY = os.environ.get(
    "XIAONI_PLAYWRIGHT_EXTENSION_KEY",
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAroG8VIkUo4gqqV/HugPAhm4Y2szeaak+jYEhAHG+5C3yjFz14+WJJmrj4c30dsbMGzuZ5hN8bHy/AcB3evS9SlSmTZ79h1trFU7tMtbLbtjZgLT8WqNqFNjSF02s3O/TmsC1rZh1CsAKI1vRu6/fEoikK32ZybHLuzJBpLq2coQu6CYec//6POLNmvy58LBcKsF2a0UJ/2gBjYMNKa5g4LvrVFRTXH6UWubcsSXDO5wr4f3MPLf8w4+WO/wja8XbXbdBmlfupmkf6S+ZIu3SwSLbzu2xxnCmwkUTXLC631UOpJkmMjcrAILcUBECkoUcNRhxJ0iwC2aHZkf4vQbP9wIDAQAB",
)
EXTENSION_ID = os.environ.get("XIAONI_PLAYWRIGHT_EXTENSION_ID", "")
if not EXTENSION_ID:
    digest = hashlib.sha256(base64.b64decode(EXTENSION_KEY)).digest()
    alphabet = "abcdefghijklmnop"
    EXTENSION_ID = "".join(alphabet[byte >> 4] + alphabet[byte & 0x0F] for byte in digest[:16])
EXTENSION_VERSION = "0.2.1"
EXTENSION_DIR_WSL = os.environ.get("XIAONI_PLAYWRIGHT_EXTENSION_DIR_WSL", f"/mnt/c/temp/xiaoni-playwright-extension-{EXTENSION_ID}-{EXTENSION_VERSION}")
EXTENSION_DIR_WIN = os.environ.get("XIAONI_PLAYWRIGHT_EXTENSION_DIR_WIN", f"C:\\temp\\xiaoni-playwright-extension-{EXTENSION_ID}-{EXTENSION_VERSION}")
EXTENSION_CRX_URL = os.environ.get(
    "XIAONI_PLAYWRIGHT_EXTENSION_CRX_URL",
    "https://clients2.google.com/service/update2/crx?"
    "response=redirect&prodversion=149.0.7827.103&acceptformat=crx2,crx3&"
    f"x=id%3D{WEBSTORE_EXTENSION_ID}%26installsource%3Dondemand%26uc",
)
CLI_EXTENSION_FILES = [
    "/mnt/c/temp/xiaoni-playwright-cli/node_modules/playwright-core/lib/coreBundle.js",
    "/mnt/c/temp/xiaoni-playwright-cli/node_modules/playwright-core/lib/tools/utils/extension.js",
]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        self._json(200, {"ok": True})

    def do_POST(self):
        if self.path != "/run":
            self.send_error(404)
            return
        length = int(self.headers.get("content-length", "0"))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            args = payload.get("args")
            if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
                raise ValueError("args must be a string array")
            if args and args[0] == "ensure-cdp":
                result = _ensure_cdp("--restart" in args)
                self._json(200, {
                    "ok": bool(result.get("ok")),
                    "returncode": 0 if result.get("ok") else 2,
                    "stdout": json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                    "stderr": "",
                })
                return
            if args and args[0] == "ensure-extension":
                result = _ensure_extension("--restart" in args)
                self._json(200, {
                    "ok": bool(result.get("ok")),
                    "returncode": 0 if result.get("ok") else 2,
                    "stdout": json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                    "stderr": "",
                })
                return
            is_extension_attach = "attach" in args and any(arg.startswith("--extension") for arg in args)
            timeout_seconds = int(payload.get("timeout_seconds") or 120)
            if is_extension_attach:
                timeout_seconds = min(timeout_seconds, 45)
            try:
                completed = subprocess.run(
                    [POWERSHELL_EXE, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", CLI_WRAPPER_WIN, *args],
                    cwd=INSTALL_DIR_WSL,
                    env=_windows_cli_env(),
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=timeout_seconds,
                )
                self._json(200, {
                    "ok": completed.returncode == 0,
                    "returncode": completed.returncode,
                    "stdout": _augment_browser_artifacts(completed.stdout, args),
                    "stderr": completed.stderr,
                })
            except subprocess.TimeoutExpired as error:
                stdout = _decode_timeout_output(error.stdout)
                stderr = _decode_timeout_output(error.stderr)
                attach_created = is_extension_attach and "Session `" in stdout and " created" in stdout
                self._json(200, {
                    "ok": attach_created,
                    "returncode": 0 if attach_created else 124,
                    "stdout": stdout,
                    "stderr": stderr + ("\n[bridge] attach command timed out after session creation; continuing with daemon session.\n" if attach_created else ""),
                    "timed_out": True,
                })
        except Exception as error:
            self._json(500, {"ok": False, "error": str(error)})

    def log_message(self, fmt, *args):
        return

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="Bridge Xiaoni executor commands to host patched playwright-cli.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"xiaoni playwright-cli bridge listening on {args.host}:{args.port}", flush=True)
    server.serve_forever()


def _decode_timeout_output(value):
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def _windows_cli_env():
    env = os.environ.copy()
    if os.path.exists(CLI_SCRIPT_WSL):
        with open(CLI_SCRIPT_WSL, "r", encoding="utf-8-sig") as handle:
            for line in handle:
                match = re.match(r'\s*\$env:([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"', line)
                if match:
                    env[match.group(1)] = match.group(2)
    env.setdefault("PLAYWRIGHT_MCP_EXECUTABLE_PATH", CHROME_EXE_WIN)
    return env


def _ensure_extension(restart):
    extension_dir = Path(EXTENSION_DIR_WSL)
    _prepare_extension_dir(extension_dir)
    _patch_playwright_cli_extension_id()
    launch_result = _launch_chrome_with_extension(restart)
    launch_result.update({
        "ok": bool(launch_result.get("ok")),
        "sourceExtensionId": WEBSTORE_EXTENSION_ID,
        "extensionId": EXTENSION_ID,
        "extensionVersion": EXTENSION_VERSION,
        "extensionDir": EXTENSION_DIR_WIN,
        "profile": CHROME_PROFILE_DIRECTORY,
        "userDataDir": CHROME_USER_DATA_DIR_WIN,
    })
    return launch_result


def _prepare_extension_dir(extension_dir):
    manifest_path = extension_dir / "manifest.json"
    connect_path = extension_dir / "lib" / "ui" / "connect.js"
    background_path = extension_dir / "lib" / "background.mjs"
    if not _extension_dir_is_current(manifest_path, connect_path, background_path):
        _download_and_extract_extension(extension_dir)
    _patch_extension(connect_path, background_path)


def _extension_dir_is_current(manifest_path, connect_path, background_path):
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        return (
            manifest.get("version") == EXTENSION_VERSION
            and manifest.get("key") == EXTENSION_KEY
            and manifest.get("update_url") is None
            and connect_path.exists()
            and background_path.exists()
        )
    except Exception:
        return False


def _download_and_extract_extension(extension_dir):
    extension_dir.parent.mkdir(parents=True, exist_ok=True)
    temp_dir = extension_dir.parent / f".{extension_dir.name}.download"
    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True)
    crx_path = temp_dir / "extension.crx"
    zip_path = temp_dir / "extension.zip"
    urllib.request.urlretrieve(EXTENSION_CRX_URL, crx_path)
    crx_bytes = crx_path.read_bytes()
    if crx_bytes[:4] != b"Cr24":
        raise RuntimeError("downloaded Playwright extension is not a CRX file")
    version = int.from_bytes(crx_bytes[4:8], "little")
    if version == 2:
        public_key_len = int.from_bytes(crx_bytes[8:12], "little")
        signature_len = int.from_bytes(crx_bytes[12:16], "little")
        zip_offset = 16 + public_key_len + signature_len
    elif version == 3:
        header_len = int.from_bytes(crx_bytes[8:12], "little")
        zip_offset = 12 + header_len
    else:
        raise RuntimeError(f"unsupported CRX version: {version}")
    zip_path.write_bytes(crx_bytes[zip_offset:])
    extract_dir = temp_dir / "extracted"
    with zipfile.ZipFile(zip_path) as archive:
        archive.extractall(extract_dir)
    metadata_dir = extract_dir / "_metadata"
    if metadata_dir.exists():
        shutil.rmtree(metadata_dir)
    manifest = json.loads((extract_dir / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("version") != EXTENSION_VERSION:
        raise RuntimeError(f"unexpected Playwright extension version: {manifest.get('version')}")
    if extension_dir.exists():
        shutil.rmtree(extension_dir)
    shutil.move(str(extract_dir), str(extension_dir))
    shutil.rmtree(temp_dir)


def _patch_extension(connect_path, background_path):
    manifest_path = connect_path.parents[2] / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["key"] = EXTENSION_KEY
    manifest.pop("update_url", None)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    connect = connect_path.read_text(encoding="utf-8")
    token_override = _windows_cli_env().get("PLAYWRIGHT_MCP_EXTENSION_TOKEN", "")
    token_guard = "token === expectedToken"
    if token_override:
        token_guard += f" || token === {json.dumps(token_override)}"
    if "const pickAutoConnectTab =" not in connect:
        connect = connect.replace(
            "const SUPPORTED_PROTOCOL_VERSION = 2;",
            """const SUPPORTED_PROTOCOL_VERSION = 2;
const pickAutoConnectTab = (response) => {
  if (!(response == null ? void 0 : response.success) || !Array.isArray(response.tabs))
    return;
  const visibleTabs = response.tabs.filter((tab) => {
    if (!tab.url)
      return false;
    return !["chrome:", "chrome-extension:", "edge:", "devtools:"].some((scheme) => tab.url.startsWith(scheme));
  });
  const score = (tab) => {
    let value = 0;
    if (tab.url && tab.url.startsWith("https://gemini.google.com/"))
      value += 1000000000000000;
    if (tab.active)
      value += 1000000000000;
    if (typeof tab.lastAccessed === "number")
      value += tab.lastAccessed;
    return value;
  };
  return [...visibleTabs].sort((a, b) => score(b) - score(a) || a.index - b.index)[0];
};""",
        )
    auto_connect_block = """      if (__TOKEN_GUARD__) {
        const tabResponse = await chrome.runtime.sendMessage({ type: "getTabs" });
        const targetTab = pickAutoConnectTab(tabResponse);
        await handleConnectToTab(targetTab);
        return;
      }""".replace("__TOKEN_GUARD__", token_guard)
    connect = re.sub(
        r"""      if \(token === expectedToken(?: \|\| token === "[^"]+")?\) \{\n        (?:await handleConnectToTab\(\);|const tabResponse = await chrome\.runtime\.sendMessage\(\{ type: "getTabs" \}\);\n        const targetTab = pickAutoConnectTab\(tabResponse\);\n        await handleConnectToTab\(targetTab\);)\n        return;\n      \}""",
        auto_connect_block,
        connect,
    )
    connect_path.write_text(connect, encoding="utf-8")

    background = background_path.read_text(encoding="utf-8")
    background = background.replace(
        'const NON_DEBUGGABLE_SCHEMES = ["chrome:", "edge:", "devtools:"];',
        'const NON_DEBUGGABLE_SCHEMES = ["chrome:", "chrome-extension:", "edge:", "devtools:"];',
    )
    background_path.write_text(background, encoding="utf-8")


def _patch_playwright_cli_extension_id():
    for file_name in CLI_EXTENSION_FILES:
        path = Path(file_name)
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        patched = re.sub(
            r'playwrightExtensionId = "[a-p]{32}"',
            f'playwrightExtensionId = "{EXTENSION_ID}"',
            text,
        )
        patched = patched.replace(
            "if (userDataDir && !await isPlaywrightExtensionInstalled(userDataDir))\n      throw new Error(`Playwright Extension not found in \"${userDataDir}\". Install it from ${playwrightExtensionInstallUrl}`);",
            "if (false && userDataDir && !await isPlaywrightExtensionInstalled(userDataDir))\n      throw new Error(`Playwright Extension not found in \"${userDataDir}\". Install it from ${playwrightExtensionInstallUrl}`);",
        )
        if patched != text:
            path.write_text(patched, encoding="utf-8")


def _launch_chrome_with_extension(restart):
    restart_literal = "$true" if restart else "$false"
    script = f"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$chrome = '{CHROME_EXE_WIN}'
$userDataDir = '{CHROME_USER_DATA_DIR_WIN}'
$profile = '{CHROME_PROFILE_DIRECTORY}'
$extensionDir = '{EXTENSION_DIR_WIN}'
$restart = {restart_literal}
function Root-ChromeProcesses {{
  Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" |
    Where-Object {{
      $_.CommandLine -and
      $_.CommandLine -notmatch '--type=' -and
      (
        $_.CommandLine -match [regex]::Escape($userDataDir) -or
        $_.CommandLine -match [regex]::Escape('{CHROME_CDP_USER_DATA_DIR_WIN}') -or
        $_.CommandLine -match 'chrome.exe"\\s*$'
      )
    }}
}}
if ($restart) {{
  $processes = Root-ChromeProcesses
  foreach ($process in $processes) {{
    $p = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
    if ($p) {{
      try {{ [void]$p.CloseMainWindow() }} catch {{ }}
    }}
  }}
  Start-Sleep -Seconds 3
  foreach ($process in $processes) {{
    $p = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
    if ($p) {{
      try {{ Stop-Process -Id $process.ProcessId -Force }} catch {{ }}
    }}
  }}
}}
if (-not (Test-Path $extensionDir)) {{
  [Console]::Out.Write((@{{ ok = $false; error = 'Extension directory does not exist'; extensionDir = $extensionDir }} | ConvertTo-Json -Compress))
  exit 0
}}
$roots = Root-ChromeProcesses
if (($roots | Measure-Object).Count -eq 0 -or $restart) {{
  $escapedUserDataDir = $userDataDir.Replace('"', '\"')
  $escapedProfile = $profile.Replace('"', '\"')
  $escapedExtensionDir = $extensionDir.Replace('"', '\"')
  $arguments = '--user-data-dir="' + $escapedUserDataDir + '" --profile-directory="' + $escapedProfile + '" --disable-extensions-except="' + $escapedExtensionDir + '" --load-extension="' + $escapedExtensionDir + '" --restore-last-session --no-first-run'
  Start-Process -FilePath $chrome -ArgumentList $arguments
  Start-Sleep -Seconds 3
}}
[Console]::Out.Write((@{{ ok = $true; restarted = $restart; extensionDir = $extensionDir; profile = $profile; userDataDir = $userDataDir }} | ConvertTo-Json -Compress))
exit 0
"""
    encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    completed = subprocess.run(
        [POWERSHELL_EXE, "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=60,
    )
    stdout = _strip_clixml(completed.stdout).strip()
    try:
        result = json.loads(stdout) if stdout else {}
    except json.JSONDecodeError:
        result = {"ok": False, "stdout": stdout}
    if completed.stderr.strip():
        result["stderr"] = _strip_clixml(completed.stderr).strip()
    result["returncode"] = completed.returncode
    if completed.returncode != 0:
        result["ok"] = False
    return result


def _ensure_cdp(restart):
    restart_literal = "$true" if restart else "$false"
    script = f"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$endpoint = '{CDP_ENDPOINT}'
$port = '{CDP_PORT}'
$chrome = '{CHROME_EXE_WIN}'
$realUserDataDir = '{CHROME_USER_DATA_DIR_WIN}'
$cdpUserDataDir = '{CHROME_CDP_USER_DATA_DIR_WIN}'
$profile = '{CHROME_PROFILE_DIRECTORY}'
function Read-CdpVersion {{
  try {{
    return Invoke-RestMethod -Uri ($endpoint.TrimEnd('/') + '/json/version') -TimeoutSec 2
  }} catch {{
    return $null
  }}
}}
$version = Read-CdpVersion
if ($version -and -not {restart_literal}) {{
  [Console]::Out.Write((@{{ ok = $true; already_running = $true; endpoint = $endpoint; browser = $version.Browser }} | ConvertTo-Json -Compress))
  exit 0
}}
if (-not {restart_literal}) {{
  [Console]::Out.Write((@{{ ok = $false; needs_restart = $true; endpoint = $endpoint; error = 'Chrome is not listening on the CDP endpoint' }} | ConvertTo-Json -Compress))
  exit 0
}}
$processes = Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" |
  Where-Object {{
    $_.CommandLine -and
    $_.CommandLine -notmatch '--type=' -and
    (
      $_.CommandLine -match [regex]::Escape($realUserDataDir) -or
      $_.CommandLine -match [regex]::Escape($cdpUserDataDir) -or
      $_.CommandLine -match 'chrome.exe"\\s*$'
    )
  }}
foreach ($process in $processes) {{
  $p = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
  if ($p) {{
    try {{ [void]$p.CloseMainWindow() }} catch {{ }}
  }}
}}
Start-Sleep -Seconds 3
foreach ($process in $processes) {{
  $p = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
  if ($p) {{
    try {{ Stop-Process -Id $process.ProcessId -Force }} catch {{ }}
  }}
}}
New-Item -ItemType Directory -Force -Path $cdpUserDataDir | Out-Null
Set-Location $env:TEMP
function Ensure-Junction($linkPath, $targetPath) {{
  if (Test-Path $linkPath) {{
    $item = Get-Item $linkPath -Force
    if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {{
      throw "Refusing to replace non-link path: $linkPath"
    }}
    return
  }}
  cmd /c mklink /J "$linkPath" "$targetPath" | Out-Null
}}
function Ensure-HardLink($linkPath, $targetPath) {{
  if (Test-Path $linkPath) {{
    return
  }}
  cmd /c mklink /H "$linkPath" "$targetPath" | Out-Null
}}
Ensure-Junction (Join-Path $cdpUserDataDir $profile) (Join-Path $realUserDataDir $profile)
if (Test-Path (Join-Path $realUserDataDir 'Default')) {{
  Ensure-Junction (Join-Path $cdpUserDataDir 'Default') (Join-Path $realUserDataDir 'Default')
}}
Ensure-HardLink (Join-Path $cdpUserDataDir 'Local State') (Join-Path $realUserDataDir 'Local State')
$escapedUserDataDir = $cdpUserDataDir.Replace('"', '\"')
$escapedProfile = $profile.Replace('"', '\"')
$arguments = '--remote-debugging-port=' + $port + ' --remote-debugging-address=127.0.0.1 --remote-allow-origins=http://127.0.0.1:' + $port + ' --user-data-dir="' + $escapedUserDataDir + '" --profile-directory="' + $escapedProfile + '" --restore-last-session'
Start-Process -FilePath $chrome -ArgumentList $arguments
for ($i = 0; $i -lt 60; $i++) {{
  Start-Sleep -Milliseconds 500
  $version = Read-CdpVersion
  if ($version) {{
    [Console]::Out.Write((@{{ ok = $true; restarted = $true; endpoint = $endpoint; browser = $version.Browser; cdpUserDataDir = $cdpUserDataDir; profile = $profile }} | ConvertTo-Json -Compress))
    exit 0
  }}
}}
[Console]::Out.Write((@{{ ok = $false; restarted = $true; endpoint = $endpoint; error = 'Timed out waiting for Chrome CDP endpoint' }} | ConvertTo-Json -Compress))
exit 0
"""
    encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    completed = subprocess.run(
        [POWERSHELL_EXE, "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=80,
    )
    stdout = _strip_clixml(completed.stdout).strip()
    try:
        result = json.loads(stdout) if stdout else {}
    except json.JSONDecodeError:
        result = {"ok": False, "stdout": stdout}
    if completed.stderr.strip():
        result["stderr"] = _strip_clixml(completed.stderr).strip()
    result["returncode"] = completed.returncode
    return result


def _strip_clixml(value):
    return re.sub(r"#< CLIXML[\s\S]*$", "", value or "").strip()


def _augment_browser_artifacts(stdout, args):
    if "screenshot" not in args:
        return stdout
    copied_paths = []
    for raw_path in _extract_markdown_artifact_paths(stdout):
        source_path = _resolve_cli_artifact_path(raw_path)
        if not source_path or not source_path.exists() or source_path.suffix.lower() != ".png":
            continue
        copied_paths.append(_copy_to_runtime_picture_dir(source_path))
    if not copied_paths:
        return stdout
    lines = ["", "### Xiaoni runtime artifacts"]
    lines.extend(f"- {path}" for path in copied_paths)
    return stdout.rstrip() + "\n" + "\n".join(lines) + "\n"


def _extract_markdown_artifact_paths(stdout):
    return re.findall(r"\]\(([^)\r\n]+\.(?:png|jpg|jpeg|webp))\)", stdout, flags=re.IGNORECASE)


def _resolve_cli_artifact_path(raw_path):
    normalized = raw_path.replace("\\", "/")
    if re.match(r"^[A-Za-z]:/", normalized):
        drive = normalized[0].lower()
        return Path(f"/mnt/{drive}/{normalized[3:]}")
    path = Path(normalized)
    if path.is_absolute():
        return path
    return Path(INSTALL_DIR_WSL) / path


def _copy_to_runtime_picture_dir(source_path):
    picture_dir = Path(RUNTIME_HOST_ROOT) / "picture"
    picture_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination_name = f"xiaoni-browser-{timestamp}-{source_path.name}"
    destination = picture_dir / destination_name
    shutil.copy2(source_path, destination)
    return f"{RUNTIME_CONTAINER_ROOT}/picture/{destination_name}"


if __name__ == "__main__":
    main()
