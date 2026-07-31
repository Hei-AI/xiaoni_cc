import { NapcatWebuiLoginStatus, formatNapcatWebuiError } from './napcat-webui-client';

export type NapcatLoginProbe = {
  reachable: boolean;
  selfId?: number | null;
  error?: string;
};

export type NapcatLoginStatusPayload = {
  napcatReachable: boolean;
  qqLoggedIn: boolean;
  qqAccountId: string | null;
  qrAvailable: boolean;
  qrPayload: string | null;
  qrPayloadType: string | null;
  webuiConfigured: boolean;
  message: string | null;
  lastCheckedAt: string;
};

export type NapcatLoginStatusDeps = {
  probe: () => Promise<NapcatLoginProbe>;
  webui: {
    isConfigured(): boolean;
    checkLoginStatus(): Promise<NapcatWebuiLoginStatus>;
    requestLoginQrcode(): Promise<NapcatWebuiLoginStatus>;
  };
};

export function buildNapcatLoginStatusPayload(
  probe: NapcatLoginProbe,
  webuiConfigured: boolean,
  webuiStatus?: NapcatWebuiLoginStatus,
  errorMessage?: string | null
): NapcatLoginStatusPayload {
  // WebUI 的 isLogin 是唯一能授予「已登录」的事实源。probe 只说明 OneBot HTTP 端口可达 ——
  // get_login_info 在账号被踢下线后仍然照常返回 user_id，所以 reachable 不等于已登录。
  //
  // 拿不到 WebUI 结论时一律判未登录：宁可让面板亮出「未登录 + 原因」让人去处理，
  // 也不能在无证据时谎称已登录 —— 后者正是这个按钮在唯一需要它的时刻失效的原因。
  // probe 的信号原样放在 napcatReachable 里，面板自己区分「进程没了」和「账号掉了」。
  const qqLoggedIn = Boolean(webuiStatus?.isLogin);
  const qrPayload = qqLoggedIn
    ? null
    : webuiStatus?.qrPayload || null;

  return {
    napcatReachable: probe.reachable,
    qqLoggedIn,
    qqAccountId: probe.selfId ? String(probe.selfId) : null,
    qrAvailable: Boolean(qrPayload),
    qrPayload,
    qrPayloadType: qrPayload ? 'url' : null,
    webuiConfigured,
    message: qqLoggedIn ? null : errorMessage || webuiStatus?.message || probe.error || null,
    lastCheckedAt: new Date().toISOString()
  };
}

export async function resolveNapcatLoginStatus(
  deps: NapcatLoginStatusDeps,
  refreshQrcode: boolean
): Promise<NapcatLoginStatusPayload> {
  const probe = await deps.probe();
  const webuiConfigured = deps.webui.isConfigured();

  if (!webuiConfigured) {
    return buildNapcatLoginStatusPayload(probe, false, undefined, 'NapCat WebUI token is not configured');
  }

  try {
    const status = await deps.webui.checkLoginStatus();
    if (status.isLogin || !refreshQrcode) {
      return buildNapcatLoginStatusPayload(probe, true, status);
    }

    try {
      return buildNapcatLoginStatusPayload(probe, true, await deps.webui.requestLoginQrcode());
    } catch (error) {
      // 被踢下线后 NapCat 停在终态，GetQQLoginQrcode 回 "QRCode Get Error"，
      // 要重启容器才会重新进扫码流程。保留 CheckLoginStatus 的掉线原因，
      // 再把「需要重启」这个可执行结论一起送到面板上。
      return buildNapcatLoginStatusPayload(
        probe,
        true,
        status,
        `${status.message || formatNapcatWebuiError(error)}（NapCat 未处于扫码状态，需重启 napcat 容器后重试）`
      );
    }
  } catch (error) {
    return buildNapcatLoginStatusPayload(probe, true, undefined, formatNapcatWebuiError(error));
  }
}
