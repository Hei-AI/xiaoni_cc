# WSL2 简易 HTTPS 流量拦截与转发指南

本指南介绍如何在 WSL2 环境下，不使用 Docker 和复杂的 iptables 规则，通过 **显式代理 (Explicit Proxy)** 模式拦截特定域名的 HTTPS 流量，并将其转发至公司网关（上游代理）。

## 🚀 核心逻辑

1.  **mitmproxy**: 作为中间人，开启 `upstream` 模式。
2.  **上游代理**: 所有的流量在经过 mitmproxy 处理后，强制转发给公司网关。
3.  **流量过滤**: 仅解密/拦截指定域名，其他域名直接透传（Pass-through）。

## 🛠️ 操作步骤

### 1. 环境准备：安装 mitmproxy
在 WSL2 中建议通过 `pip` 安装最新版本的 `mitmproxy`：

```bash
# 确保已安装 python3-pip
sudo apt update && sudo apt install -y python3-pip

# 安装 mitmproxy
pip3 install mitmproxy
```

### 2. 生成并安装/信任证书 (拦截 HTTPS 必选)
HTTPS 拦截需要让系统信任 `mitmproxy` 的根证书。

1.  **生成证书**：
    首先运行一次 `mitmdump`（会自动在 `~/.mitmproxy` 生成证书文件）：
    ```bash
    mitmdump
    # 然后按 Ctrl+C 退出
    ```

2.  **信任证书**：
    将生成的证书文件拷贝到系统信任目录并更新系统证书库：
    ```bash
    # 拷贝证书
    sudo cp ~/.mitmproxy/mitmproxy-ca-cert.pem /usr/local/share/ca-certificates/mitmproxy.crt

    # 更新证书库
    sudo update-ca-certificates
    ```
    *看到输出 `1 added, 0 removed; done.` 表示安装成功。*

### 3. 启动拦截服务
在终端运行以下命令，启动拦截并实时打印日志：

```bash
# 1. 变量设置
export COMPANY_PROXY="http://your-company-proxy:port" # 公司网关地址
export TARGET_DOMAINS="api.github.com|.*\.google\.com" # 要拦截的域名（支持正则）
export ADDON_PATH="modules/http-traffic-monitor/mitmproxy/debug_addon.py" # 调试日志脚本

# 2. 启动服务
# --mode upstream: 将流量发往公司网关
# --ignore-hosts: 仅解密匹配 TARGET_DOMAINS 的流量，其余域名直接透传
mitmdump --mode upstream:$COMPANY_PROXY \
         --listen-port 15001 \
         --ignore-hosts "^(?!( $TARGET_DOMAINS ))" \
         -s $ADDON_PATH
```

### 4. 配置客户端环境变量
在发起请求的终端中设置代理：

```bash
export http_proxy=http://127.0.0.1:15001
export https_proxy=http://127.0.0.1:15001
```

## 🔍 验证拦截
运行以下命令验证流量是否经过拦截逻辑并打印了日志：

```bash
curl -v https://api.github.com
```

**你将会在 `mitmdump` 窗口看到如下打印：**
- 🚀 URL 和 Method
- 完整的 Request Headers 和 Request Body
- 响应状态码、Response Headers 和 Response Body

---

## 💡 进阶 Tips

### 只拦截特定进程
如果你不想全局设置环境变量，可以在命令前直接加前缀：
```bash
https_proxy=http://127.0.0.1:15001 python3 your_script.py
```

### 查看交互式界面
如果你想在一个类似可视化的窗口中查看流量（类似 Fiddler/Charles），把启动命令中的 `mitmdump` 换成 `mitmproxy` 即可。
