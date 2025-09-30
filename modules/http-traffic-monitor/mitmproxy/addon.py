#!/usr/bin/env python3
"""
HTTP流量监控mitmproxy插件
用于拦截、记录和分析QQ机器人项目的HTTP出站流量

作者: QQ Bot Team
版本: 1.0.0
"""

import json
import uuid
import asyncio
import traceback
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List
from urllib.parse import urlparse, parse_qs
import os
import re
from ipaddress import ip_address, ip_network

from mitmproxy import http, ctx
from mitmproxy.script import concurrent
from mitmproxy.connection import Address
import ujson  # 更快的JSON处理
from loguru import logger
import threading
from pathlib import Path


class HTTPTrafficLogger:
    """HTTP流量记录器 - mitmproxy插件核心类"""

    def __init__(self):
        """初始化流量记录器"""
        self.db_pool = None
        self.ai_api_patterns = {
            'gemini': [
                r'generativelanguage\.googleapis\.com',
                r'ai\.google\.dev'
            ],
            'openai': [
                r'api\.openai\.com',
                r'openai\.azure\.com'
            ],
            'claude': [
                r'api\.anthropic\.com'
            ],
            'cohere': [
                r'api\.cohere\.ai'
            ],
            'huggingface': [
                r'api-inference\.huggingface\.co'
            ]
        }

        # 配置参数
        self.config = {
            'enable_logging': os.getenv('ENABLE_TRAFFIC_LOGGING', 'true').lower() == 'true',
            'enable_response_body': os.getenv('ENABLE_RESPONSE_BODY_LOGGING', 'true').lower() == 'true',
            'enable_binary_logging': os.getenv('ENABLE_BINARY_DATA_LOGGING', 'false').lower() == 'true',
            'max_body_size': int(os.getenv('MAX_BODY_SIZE', '1048576')),  # 1MB
            'log_dir': os.getenv('TRAFFIC_LOG_DIR', '/app/logs/traffic'),
        }

        # 日志文件相关
        self.current_log_file = None
        self.current_date = None
        self.file_lock = threading.Lock()

        # 确保日志目录存在
        Path(self.config['log_dir']).mkdir(parents=True, exist_ok=True)

        # 配置日志 - 使用同一日志目录
        mitmproxy_log_path = os.path.join(self.config['log_dir'], "mitmproxy.log")
        logger.add(mitmproxy_log_path, rotation="100 MB", retention="30 days")

        # fake-ip 支持配置
        fake_ip_range = os.getenv('FAKE_IP_RANGE', '198.18.0.0/15')
        try:
            self.fake_ip_network = ip_network(fake_ip_range)
        except ValueError:
            logger.warning(f"非法的 FAKE_IP_RANGE 配置 {fake_ip_range}，使用默认 198.18.0.0/15")
            self.fake_ip_network = ip_network('198.18.0.0/15')

        # 优先使用显式环境变量，其次读取 HTTP_PROXY/http_proxy 值
        proxy_candidates = [
            os.getenv('CLASH_PROXY_URL'),
            os.getenv('CLASH_PROXY'),
            os.getenv('CLASH_PROXY_HOST'),  # 兼容旧配置，仅 host 或 host:port
            os.getenv('HTTP_PROXY') or os.getenv('http_proxy')
        ]

        raw_proxy = next((p for p in proxy_candidates if p), None)
        default_host = '127.0.0.1'
        default_port = 7890

        clash_host = default_host
        clash_port = default_port

        if raw_proxy:
            raw_proxy = raw_proxy.strip()
            if raw_proxy and '://' not in raw_proxy:
                candidate = f'http://{raw_proxy}'
            else:
                candidate = raw_proxy

            parsed = urlparse(candidate)
            if parsed.hostname:
                clash_host = parsed.hostname
            if parsed.port:
                clash_port = parsed.port
            elif parsed.scheme in ('socks5', 'socks5h'):
                clash_port = 1080

        host_override = os.getenv('CLASH_PROXY_HOST')
        port_override = os.getenv('CLASH_PROXY_PORT')
        if host_override:
            clash_host = host_override.strip() or clash_host
        if port_override:
            try:
                clash_port = int(port_override.strip())
            except ValueError:
                logger.warning(f"非法的 CLASH_PROXY_PORT 配置 {port_override}，使用检测到的端口 {clash_port}")

        if clash_host:
            try:
                self.clash_proxy_address = Address((clash_host, int(clash_port)))
            except ValueError:
                logger.warning(f"无法解析代理端口 {clash_port}，禁用上游代理转发")
                self.clash_proxy_address = None
        else:
            self.clash_proxy_address = None

        logger.info("HTTP流量监控插件初始化完成")
        logger.info(f"配置: {self.config}")

    def load(self, loader):
        """插件加载时调用"""
        try:
            self._init_log_file()
            logger.info("日志文件初始化成功")
        except Exception as e:
            logger.error(f"日志文件初始化失败: {e}")
            ctx.log.error(f"Log file initialization failed: {e}")

    def _init_log_file(self):
        """初始化日志文件"""
        today = datetime.now().strftime('%Y-%m-%d')
        self.current_date = today
        log_file_path = os.path.join(self.config['log_dir'], f'traffic-{today}.jsonl')

        # 如果文件不存在，创建并写入文件头信息
        if not os.path.exists(log_file_path):
            with open(log_file_path, 'w', encoding='utf-8') as f:
                header = {
                    'type': 'log_file_header',
                    'created_at': datetime.now(timezone.utc).isoformat(),
                    'version': '1.0.0',
                    'format': 'jsonl',
                    'description': 'HTTP traffic monitoring logs'
                }
                f.write(ujson.dumps(header) + '\n')

        self.current_log_file = log_file_path
        logger.info(f"日志文件初始化: {log_file_path}")

    @concurrent
    def request(self, flow: http.HTTPFlow) -> None:
        """请求拦截 - 记录请求开始信息"""
        if not self.config['enable_logging']:
            return

        try:
            # 处理 fake-ip 场景：将fake-ip地址替换为真实域名
            # 注意：上游代理已通过 --set upstream_http 配置，这里只需修正地址
            server_address = flow.server_conn.address
            if server_address and self.fake_ip_network:
                try:
                    # mitmproxy 11.x 中 Address 就是 tuple: (host, port)
                    host, port = server_address
                    target_ip = ip_address(host)
                    if target_ip in self.fake_ip_network:
                        # 将fake-ip替换为真实域名
                        real_host = flow.request.host or host
                        flow.server_conn.address = Address((real_host, port))
                        logger.debug(
                            "Fake-IP detected, using real host",
                            fake_ip=host,
                            real_host=real_host,
                            port=port
                        )
                except ValueError:
                    pass

            # 生成唯一标识
            flow.metadata['request_id'] = str(uuid.uuid4())
            flow.metadata['start_time'] = datetime.now(timezone.utc)
            flow.metadata['trace_id'] = self._extract_trace_id(flow)

            logger.debug(f"拦截请求: {flow.request.method} {flow.request.pretty_url}")

        except Exception as e:
            logger.error(f"请求拦截处理失败: {e}")

    @concurrent
    def response(self, flow: http.HTTPFlow) -> None:
        """响应拦截 - 记录完整HTTP交互"""
        if not self.config['enable_logging']:
            return

        try:
            # 计算性能指标
            end_time = datetime.now(timezone.utc)
            start_time = flow.metadata.get('start_time', end_time)
            duration_ms = int((end_time - start_time).total_seconds() * 1000)

            # 分析请求特征
            api_info = self._analyze_api_request(flow)

            # 构造日志记录
            log_record = self._build_log_record(flow, duration_ms, api_info, start_time, end_time)

            # 添加到批量处理队列
            self._queue_log_record(log_record)

            logger.debug(f"记录响应: {flow.request.method} {flow.request.pretty_url} -> {flow.response.status_code} ({duration_ms}ms)")

        except Exception as e:
            logger.error(f"响应记录处理失败: {e}")
            logger.error(traceback.format_exc())

    def _extract_trace_id(self, flow: http.HTTPFlow) -> Optional[str]:
        """从请求中提取追踪ID"""
        # 尝试从请求头中提取
        for header in ['x-trace-id', 'trace-id', 'x-request-id', 'request-id']:
            trace_id = flow.request.headers.get(header)
            if trace_id:
                return trace_id

        # 尝试从URL参数中提取
        parsed_url = urlparse(flow.request.pretty_url)
        query_params = parse_qs(parsed_url.query)
        for param in ['trace_id', 'traceId', 'request_id', 'requestId']:
            if param in query_params:
                return query_params[param][0]

        return None

    def _analyze_api_request(self, flow: http.HTTPFlow) -> Dict[str, Any]:
        """分析API请求类型和特征"""
        host = flow.request.pretty_host.lower()
        path = flow.request.path

        api_info = {
            'is_ai_request': False,
            'api_type': 'other',
            'api_version': None,
            'endpoint_pattern': None
        }

        # 检测AI API类型
        for api_type, patterns in self.ai_api_patterns.items():
            if any(re.search(pattern, host) for pattern in patterns):
                api_info['is_ai_request'] = True
                api_info['api_type'] = api_type
                api_info['endpoint_pattern'] = self._extract_endpoint_pattern(path, api_type)
                api_info['api_version'] = self._extract_api_version(path)
                break

        return api_info

    def _extract_endpoint_pattern(self, path: str, api_type: str) -> str:
        """提取API端点模式"""
        if api_type == 'gemini':
            # /v1beta/models/gemini-pro:generateContent -> /v1beta/models/*/generateContent
            return re.sub(r'/models/[^/]+', '/models/*', path)
        elif api_type == 'openai':
            # 保留原始路径，OpenAI路径相对规范
            return path
        elif api_type == 'claude':
            # /v1/messages -> /v1/messages
            return path
        else:
            return path

    def _extract_api_version(self, path: str) -> Optional[str]:
        """提取API版本"""
        version_match = re.search(r'/v(\d+(?:\.\d+)*(?:beta|alpha)?)', path)
        return version_match.group(1) if version_match else None

    def _build_log_record(self, flow: http.HTTPFlow, duration_ms: int,
                         api_info: Dict[str, Any], start_time: datetime,
                         end_time: datetime) -> Dict[str, Any]:
        """构建完整的日志记录"""

        # 基础信息
        parsed_url = urlparse(flow.request.pretty_url)
        query_params = dict(parse_qs(parsed_url.query)) if parsed_url.query else {}

        # 请求信息处理
        request_headers = dict(flow.request.headers)
        request_body = self._safe_extract_body(flow.request.content, flow.request.headers.get('content-type', ''))

        # 响应信息处理
        response_headers = dict(flow.response.headers) if flow.response else {}
        response_body = None
        if flow.response and self.config['enable_response_body']:
            response_body = self._safe_extract_body(flow.response.content, flow.response.headers.get('content-type', ''))

        # 构建记录
        record = {
            # 基础标识
            'request_id': flow.metadata.get('request_id'),
            'trace_id': flow.metadata.get('trace_id'),
            'container_name': os.getenv('CONTAINER_NAME', 'qqbot-core'),
            'service_name': os.getenv('SERVICE_NAME', 'http-traffic-monitor'),

            # 请求信息
            'method': flow.request.method,
            'url': flow.request.pretty_url,
            'host': flow.request.pretty_host,
            'path': flow.request.path,
            'query_params': ujson.dumps(query_params) if query_params else None,
            'request_headers': ujson.dumps(request_headers),
            'request_body': request_body,
            'request_content_type': flow.request.headers.get('content-type'),
            'request_size': len(flow.request.content),

            # 响应信息
            'response_status': flow.response.status_code if flow.response else None,
            'response_headers': ujson.dumps(response_headers) if response_headers else None,
            'response_body': response_body,
            'response_content_type': flow.response.headers.get('content-type') if flow.response else None,
            'response_size': len(flow.response.content) if flow.response else 0,

            # 性能信息
            'duration_ms': duration_ms,
            'request_timestamp': start_time,
            'response_timestamp': end_time if flow.response else None,

            # API分类
            'is_ai_request': api_info['is_ai_request'],
            'api_type': api_info['api_type'],
            'api_version': api_info['api_version'],

            # 网络信息
            'user_agent': flow.request.headers.get('user-agent'),
            'referer': flow.request.headers.get('referer'),

            # 错误信息
            'error_message': None,
            'error_code': None,
            'is_truncated': len(request_body or '') > self.config['max_body_size'] if request_body else False,
            'is_binary_data': self._is_binary_data(flow.request.content),
        }

        # 处理错误情况
        if flow.response and flow.response.status_code >= 400:
            record['error_code'] = str(flow.response.status_code)
            record['error_message'] = self._extract_error_message(response_body, flow.response.status_code)

        return record

    def _safe_extract_body(self, content: bytes, content_type: str) -> Optional[str]:
        """安全提取请求/响应体内容"""
        if not content:
            return None

        # 检查是否为二进制数据
        if self._is_binary_data(content):
            if not self.config['enable_binary_logging']:
                return f'<binary data: {len(content)} bytes>'
            else:
                # 对于二进制数据，只记录类型和大小
                return f'<binary:{content_type}:{len(content)} bytes>'

        # 尝试解码文本内容
        try:
            text_content = content.decode('utf-8')

            # 限制内容大小
            if len(text_content) > self.config['max_body_size']:
                text_content = text_content[:self.config['max_body_size']] + '...[truncated]'

            return text_content

        except UnicodeDecodeError:
            try:
                # 尝试其他编码
                text_content = content.decode('latin1')
                if len(text_content) > self.config['max_body_size']:
                    text_content = text_content[:self.config['max_body_size']] + '...[truncated]'
                return text_content
            except:
                return f'<encoding error: {len(content)} bytes>'

    def _is_binary_data(self, content: bytes) -> bool:
        """判断是否为二进制数据"""
        if not content:
            return False

        # 检查是否包含空字节
        if b'\x00' in content:
            return True

        # 检查非文本字符的比例
        try:
            content.decode('utf-8')
            return False
        except UnicodeDecodeError:
            # 如果解码失败，检查前1024字节中非ASCII字符的比例
            sample = content[:1024]
            non_text_chars = sum(1 for b in sample if b < 32 or b > 126)
            return (non_text_chars / len(sample)) > 0.3

    def _extract_error_message(self, response_body: Optional[str], status_code: int) -> Optional[str]:
        """从响应体中提取错误消息"""
        if not response_body:
            return f"HTTP {status_code} Error"

        try:
            # 尝试解析JSON错误
            error_data = ujson.loads(response_body)

            # 常见错误字段
            for field in ['error', 'message', 'error_description', 'detail', 'msg']:
                if field in error_data:
                    error_info = error_data[field]
                    if isinstance(error_info, dict):
                        return error_info.get('message', str(error_info))
                    return str(error_info)

            return f"HTTP {status_code} Error"

        except:
            # 非JSON响应，提取前200字符作为错误信息
            return response_body[:200] + ('...' if len(response_body) > 200 else '')

    def _queue_log_record(self, record: Dict[str, Any]) -> None:
        """直接写入日志文件"""
        try:
            # 检查是否需要轮转日志文件
            self._check_log_rotation()

            # 写入日志记录
            self._write_log_record(record)

        except Exception as e:
            logger.error(f"写入日志记录失败: {e}")
            logger.error(traceback.format_exc())

    def _check_log_rotation(self) -> None:
        """检查是否需要轮转日志文件（按天轮转）"""
        today = datetime.now().strftime('%Y-%m-%d')

        if self.current_date != today:
            logger.info(f"日志文件轮转: {self.current_date} -> {today}")
            self._init_log_file()

    def _write_log_record(self, record: Dict[str, Any]) -> None:
        """写入单条日志记录到文件"""
        with self.file_lock:
            try:
                # 转换datetime为ISO字符串
                record_copy = record.copy()
                if isinstance(record_copy.get('request_timestamp'), datetime):
                    record_copy['request_timestamp'] = record_copy['request_timestamp'].isoformat()
                if isinstance(record_copy.get('response_timestamp'), datetime):
                    record_copy['response_timestamp'] = record_copy['response_timestamp'].isoformat()

                # 写入JSONL文件
                with open(self.current_log_file, 'a', encoding='utf-8') as f:
                    f.write(ujson.dumps(record_copy) + '\n')
                    f.flush()  # 立即刷新到磁盘

                logger.debug(f"成功写入日志记录: {record_copy.get('method')} {record_copy.get('url')}")

            except Exception as e:
                logger.error(f"写入日志文件失败: {e}")
                # 尝试写入错误日志备份
                self._fallback_to_file_logging(record)

    def _fallback_to_file_logging(self, record: Dict[str, Any]) -> None:
        """写入失败时的备份日志"""
        try:
            fallback_file = '/app/logs/traffic_error.jsonl'

            # 添加错误标记
            error_record = record.copy()
            error_record['_error'] = True
            error_record['_error_time'] = datetime.now(timezone.utc).isoformat()

            # 转换datetime为ISO字符串
            if isinstance(error_record.get('request_timestamp'), datetime):
                error_record['request_timestamp'] = error_record['request_timestamp'].isoformat()
            if isinstance(error_record.get('response_timestamp'), datetime):
                error_record['response_timestamp'] = error_record['response_timestamp'].isoformat()

            with open(fallback_file, 'a', encoding='utf-8') as f:
                f.write(ujson.dumps(error_record) + '\n')

            logger.warning(f"记录写入错误备份文件: {fallback_file}")

        except Exception as e:
            logger.error(f"错误备份文件写入也失败: {e}")

    def done(self) -> None:
        """插件结束时调用"""
        logger.info("HTTP流量监控插件已停止")


# 注册插件
addons = [HTTPTrafficLogger()]

# 添加便于调试的函数
def get_addon_instance():
    """获取插件实例，用于调试"""
    return addons[0] if addons else None
