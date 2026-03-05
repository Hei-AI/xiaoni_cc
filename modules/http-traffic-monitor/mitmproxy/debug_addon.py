from mitmproxy import http
import json

class DebugLogger:
    def response(self, flow: http.HTTPFlow):
        """
        当收到响应时触发，打印完整的请求和响应细节
        """
        print("\n" + "🚀" + "="*60)
        print(f"【URL】: {flow.request.pretty_url}")
        print(f"【Method】: {flow.request.method}")
        
        # 1. 打印请求头
        print("\n--- [Request Headers] ---")
        for k, v in flow.request.headers.items():
            print(f"{k}: {v}")
            
        # 2. 打印请求体
        print("\n--- [Request Body] ---")
        req_text = flow.request.get_text(indexed=True)
        if req_text:
            try:
                # 尝试美化 JSON
                print(json.dumps(json.loads(req_text), indent=2, ensure_ascii=False))
            except:
                print(req_text)
        else:
            print("[Empty Body]")
        
        print("\n" + "-"*40)
        
        # 3. 打印响应状态
        print(f"【Status】: {flow.response.status_code}")
        
        # 4. 打印响应头
        print("\n--- [Response Headers] ---")
        for k, v in flow.response.headers.items():
            print(f"{k}: {v}")
            
        # 5. 打印响应体
        print("\n--- [Response Body] ---")
        res_text = flow.response.get_text(indexed=True)
        if res_text:
            try:
                # 尝试美化 JSON
                print(json.dumps(json.loads(res_text), indent=2, ensure_ascii=False))
            except:
                print(res_text)
        else:
            print("[Empty Body]")
            
        print("="*62 + "\n")

addons = [DebugLogger()]
