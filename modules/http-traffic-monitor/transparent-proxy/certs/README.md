# mitmproxy 证书存放目录

请将 `mitmproxy-ca-cert.pem`（或其他根证书）放入此目录，以便 Docker 镜像在构建或启动时复制到业务容器中。推荐文件名：

```
modules/http-traffic-monitor/transparent-proxy/certs/mitmproxy-ca-cert.pem
```

> 注意：证书文件不应提交到版本库，可参考同目录下的 `.gitignore`。
