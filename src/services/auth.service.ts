/**
 * Authentication Service
 * Handles login/logout for NetEase Cloud Music and QQ Music
 */

import type {
  ApiResponse,
  LoginResult,
  MusicPlatform,
  UnifiedUser,
} from '@/types';
import { getNeteaseApiBaseUrl, getQQApiBaseUrl } from '@/config/platform.config';
import { canUseTauriInvoke } from '@/lib/runtime';
import { normalizeImageUrl } from '@/lib/image-url';

/**
 * NetEase API endpoints configuration
 */
const NETEASE_API_CONFIG = {
  baseUrl: getNeteaseApiBaseUrl(),
  timeout: 30000,
};

const QQ_API_CONFIG = {
  baseUrl: getQQApiBaseUrl(),
  timeout: 30000,
};

/**
 * Authentication Service
 */
class AuthService {
  private apiBase: string;
  private sessionCookie: string | null = null;
  private qqSessionCookie: string | null = null;

  constructor() {
    this.apiBase = NETEASE_API_CONFIG.baseUrl;
  }

  private isTauriRuntime(): boolean {
    return canUseTauriInvoke();
  }

  private normalizeSetCookieHeader(header: string): string {
    // Split on cookie boundaries (comma followed by next key=value), ignoring Expires commas.
    // Regex: comma + lookahead for "<cookie-name>=<value>".
    const parts = header.split(/,(?=\s*[^;=]+=[^;]*)/);

    const cookies = parts
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => part.split(';')[0].trim())
      .filter((part) => part.includes('='));

    return cookies.join('; ');
  }

  private appendNeteaseCookie(endpoint: string, cookie?: string | null): string {
    if (this.isTauriRuntime() || !cookie?.trim()) {
      return endpoint;
    }
    const separator = endpoint.includes('?') ? '&' : '?';
    return `${endpoint}${separator}cookie=${encodeURIComponent(cookie.trim())}`;
  }

  /**
   * Helper to make API requests
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    skipCodeCheck = false
  ): Promise<ApiResponse<T>> {
    try {
      const resolvedEndpoint = this.appendNeteaseCookie(endpoint, this.sessionCookie);
      const response = await fetch(`${this.apiBase}${resolvedEndpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(this.isTauriRuntime() && this.sessionCookie ? { Cookie: this.sessionCookie } : {}),
          ...options.headers as Record<string, string>,
        },
      });

      // Extract and store cookies from response
      const setCookieHeader = response.headers.get('Set-Cookie');
      if (setCookieHeader) {
        this.sessionCookie = setCookieHeader;
      }

      const data = await response.json();

      // Also check for cookie in response body (NetEase API pattern)
      if ((data as any).cookie) {
        this.sessionCookie = (data as any).cookie;
      }

      // Skip code validation for QR code status checks
      if (skipCodeCheck) {
        return {
          success: true,
          data,
          cookie: this.sessionCookie || undefined,
        };
      }

      if (!response.ok || data.code !== 200) {
        return {
          success: false,
          error: data.message || data.msg || 'Request failed',
          code: data.code,
        };
      }

      return {
        success: true,
        data,
        cookie: this.sessionCookie || undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network error';
      const isConnectionIssue = /failed to fetch|networkerror|err_connection_refused|fetch failed/i.test(message);

      return {
        success: false,
        error: isConnectionIssue
          ? `\u65e0\u6cd5\u8fde\u63a5\u7f51\u6613\u4e91\u63a5\u53e3\uff08${NETEASE_API_CONFIG.baseUrl}\uff09\uff0c\u8bf7\u786e\u8ba4 API \u670d\u52a1\u5df2\u542f\u52a8\u3002`
          : message,
      };
    }
  }


  private normalizeQQCookieValue(cookie: unknown): string | undefined {
    if (!cookie) {
      return undefined;
    }

    if (typeof cookie === 'string') {
      const normalized = cookie.trim();
      return normalized || undefined;
    }

    if (typeof cookie === 'object') {
      const pairs = Object.entries(cookie as Record<string, unknown>)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([key, value]) => `${key}=${String(value)}`);

      return pairs.length > 0 ? pairs.join('; ') : undefined;
    }

    return undefined;
  }

  private async qqRequest<T>(
    endpoint: string,
    options: RequestInit = {},
    skipCodeCheck = false
  ): Promise<ApiResponse<T>> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...options.headers as Record<string, string>,
      };

      if (this.qqSessionCookie) {
        if (this.isTauriRuntime()) {
          headers.Cookie = this.qqSessionCookie;
        } else {
          const bearer = `Bearer ${this.qqSessionCookie}`;
          headers.Authorization = bearer;
          headers.token = bearer;
        }
      }

      const response = await fetch(`${QQ_API_CONFIG.baseUrl}${endpoint}`, {
        ...options,
        headers,
      });

      const setCookieHeader = response.headers.get('Set-Cookie');
      if (setCookieHeader) {
        this.qqSessionCookie = this.isTauriRuntime()
          ? setCookieHeader
          : this.normalizeSetCookieHeader(setCookieHeader);
      }

      const data = await response.json();
      const cookieFromBody = this.normalizeQQCookieValue((data as any).cookie);
      if (cookieFromBody) {
        this.qqSessionCookie = cookieFromBody;
      }

      if (skipCodeCheck) {
        return {
          success: true,
          data,
          cookie: this.qqSessionCookie || undefined,
        };
      }

      if (!response.ok || ((data as any).code !== 200 && (data as any).code !== 0)) {
        return {
          success: false,
          error: (data as any).message || (data as any).msg || 'Request failed',
          code: (data as any).code,
        };
      }

      return {
        success: true,
        data,
        cookie: this.qqSessionCookie || undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network error';
      const isConnectionIssue = /failed to fetch|networkerror|err_connection_refused|fetch failed/i.test(message);

      return {
        success: false,
        error: isConnectionIssue
          ? `\u65e0\u6cd5\u8fde\u63a5 QQ \u63a5\u53e3\uff08${QQ_API_CONFIG.baseUrl}\uff09\uff0c\u8bf7\u786e\u8ba4 QQ API \u670d\u52a1\u5df2\u542f\u52a8\u3002`
          : message,
      };
    }
  }

  private normalizeQQQRCodeStatus(rawCode: unknown, message?: string, hasCookie = false): number {
    const numericCode = Number(rawCode);
    if (Number.isFinite(numericCode)) {
      if (numericCode === 803 || numericCode === 802 || numericCode === 801 || numericCode === 800) {
        return numericCode;
      }

      // Normalized status from /connect/qr/check.
      if (numericCode === 2 || numericCode === -798) {
        return 803;
      }
      if (numericCode === 1 || numericCode === -799) {
        return 802;
      }
      if (numericCode === 0 || numericCode === -800) {
        return hasCookie ? 803 : 801;
      }
      if (numericCode === -1 || numericCode === -801) {
        return 800;
      }

      // Status from qqmusic-api-python login module.
      if (numericCode === 65) {
        return 801;
      }
      if (numericCode === 66) {
        return 802;
      }
      if (numericCode === 67 || numericCode === 68 || numericCode === 86038) {
        return 800;
      }
      if ((numericCode === 200) && hasCookie) {
        return 803;
      }
    }

    const hint = (message || '').toLowerCase();
    if (hint.includes('success') || hint.includes('\u767b\u5f55\u6210\u529f') || hint.includes('\u786e\u8ba4\u6210\u529f') || hint.includes('authorized')) {
      return 803;
    }
    if (hint.includes('confirm') || hint.includes('???') || hint.includes('???') || hint.includes('???')) {
      return 802;
    }
    if (hint.includes('expired') || hint.includes('??')) {
      return 800;
    }
    return 801;
  }


  /**
   * NetEase Cloud Music - Cellphone login
   */
  async neteaseCellphoneLogin(
    phone: string,
    countrycode: string = '86',
    password: string
  ): Promise<LoginResult> {
    const response = await this.request<{
      cookie: string;
      account: { id: number };
      profile: { nickname: string; avatarUrl: string };
    }>('/login/cellphone', {
      method: 'POST',
      body: JSON.stringify({
        phone: `+${countrycode}${phone}`,
        password,
        countrycode,
      }),
    });

    if (!response.success || !response.data) {
      return {
        success: false,
        error: response.error || 'Login failed',
      };
    }

    const { cookie, account, profile } = response.data;

    return {
      success: true,
      user: {
        platform: 'netease',
        userId: String(account.id),
        nickname: profile.nickname,
        avatarUrl: normalizeImageUrl(profile.avatarUrl) || '',
        isLoggedIn: true,
      },
      cookie,
    };
  }

  /**
   * NetEase Cloud Music - Email login
   */
  async neteaseEmailLogin(
    email: string,
    password: string
  ): Promise<LoginResult> {
    const response = await this.request<{
      cookie: string;
      account: { id: number };
      profile: { nickname: string; avatarUrl: string };
    }>('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (!response.success || !response.data) {
      return {
        success: false,
        error: response.error || 'Login failed',
      };
    }

    const { cookie, account, profile } = response.data;

    return {
      success: true,
      user: {
        platform: 'netease',
        userId: String(account.id),
        nickname: profile.nickname,
        avatarUrl: normalizeImageUrl(profile.avatarUrl) || '',
        isLoggedIn: true,
      },
      cookie,
    };
  }

  /**
   * NetEase Cloud Music - Create QR code for login
   */
  async neteaseCreateQRCode(signal?: AbortSignal): Promise<ApiResponse<{
    qrurl: string;
    unikey: string;
    qrimg?: string;
  }>> {
    const timestamp = Date.now();

    // First get a fresh unikey (GET + timestamp avoids stale keys from cache/proxy).
    const keyResponse = await this.request<{ data?: { unikey?: string }; unikey?: string }>(
      `/login/qr/key?timestamp=${timestamp}`,
      { signal },
      true
    );

    if (!keyResponse.success || !keyResponse.data) {
      return keyResponse as ApiResponse<any>;
    }

    const unikey = (keyResponse.data as any).data?.unikey || (keyResponse.data as any).unikey;

    if (!unikey) {
      return {
        success: false,
        error: '获取二维码 key 失败，请重试。',
      };
    }

    // Then create the QR code with the unikey.
    const createResponse = await this.request<{ code?: number; data?: { qrurl?: string; qrimg?: string } }>(
      `/login/qr/create?key=${encodeURIComponent(unikey)}&qrimg=true&timestamp=${Date.now()}`,
      { signal, cache: 'no-store' },
      true
    );

    if (!createResponse.success || !createResponse.data) {
      return createResponse as ApiResponse<any>;
    }

    const createData = createResponse.data as any;
    const qrurl = createData.data?.qrurl || createData.qrurl;
    const qrimg = createData.data?.qrimg || createData.qrimg;

    if (!qrurl && !qrimg) {
      return {
        success: false,
        error: '二维码生成失败，请重试。',
      };
    }

    return {
      success: true,
      data: {
        unikey,
        qrurl: qrurl || '',
        qrimg,
      },
    };
  }

  /**
   * NetEase Cloud Music - Check QR code status
   * Returns: { code: number, cookie?: string }
   * Code 801 = waiting for scan, 802 = scanned waiting for confirm, 803 = confirmed, 800 = expired
   */
  async neteaseCheckQRCode(
    key: string,
    signal?: AbortSignal
  ): Promise<ApiResponse<{ code: number; cookie?: string; message?: string }>> {
    // Add timestamp and disable cache to avoid stale 801 responses from cache.
    const checkEndpoint = `/login/qr/check?key=${encodeURIComponent(key)}&timestamp=${Date.now()}`;
    const response = await this.request<{ code?: number | string; message?: string; cookie?: string; data?: { code?: number | string; message?: string; cookie?: string } }>(
      checkEndpoint,
      { signal, cache: 'no-store' },
      true
    );

    if (response.success && response.data) {
      const data = response.data as any;
      // Prefer nested `data.code` first because some API variants keep outer `code=200`.
      const rawCode = data.data?.code ?? data.code;
      const rawMessage = data.data?.message ?? data.message;
      const normalizedMessage = typeof rawMessage === 'string' ? rawMessage : undefined;
      const normalizedCookie = response.cookie || data.cookie || data.data?.cookie;

      let normalizedCode = Number(rawCode);
      if (!Number.isFinite(normalizedCode)) {
        const messageForInfer = (normalizedMessage || '').toLowerCase();
        if (messageForInfer.includes('success') || messageForInfer.includes('登录成功') || messageForInfer.includes('确认成功') || messageForInfer.includes('authorized')) {
          normalizedCode = 803;
        } else if (messageForInfer.includes('confirm') || messageForInfer.includes('待确认') || messageForInfer.includes('授权中') || messageForInfer.includes('已扫码')) {
          normalizedCode = 802;
        } else if (messageForInfer.includes('expired') || messageForInfer.includes('过期')) {
          normalizedCode = 800;
        } else {
          normalizedCode = 801;
        }
      }

      return {
        success: true,
        data: {
          code: normalizedCode,
          cookie: normalizedCookie,
          message: normalizedMessage,
        },
        cookie: normalizedCookie,
      };
    }
    return {
      success: false,
      error: response.error || 'QR check failed',
      code: response.code,
    };
  }

  /**
   * NetEase Cloud Music - QR Code Login flow
   * Polls the QR code status until login is confirmed
   */
  async neteaseQRCodeLogin(
    onQRCodeUrl: (url: string) => void,
    onStatusChange?: (status: string) => void,
    signal?: AbortSignal
  ): Promise<LoginResult> {
    // Create QR code
    if (signal?.aborted) {
      return {
        success: false,
        error: 'QR code login cancelled',
      };
    }

    const createResponse = await this.neteaseCreateQRCode(signal);

    if (!createResponse.success || !createResponse.data) {
      return {
        success: false,
        error: createResponse.error || 'Failed to create QR code',
      };
    }

    let { unikey, qrurl, qrimg } = createResponse.data;

    // Use qrimg (base64) if available, otherwise use qrurl
    const displayUrl = qrimg || qrurl;
    onQRCodeUrl(displayUrl);

    // Poll for QR code status
    let attempts = 0;
    let refreshCount = 0;
    const maxAttempts = 120; // 2 minutes with 1 second intervals
    const maxRefreshOnExpire = 2;

    while (attempts < maxAttempts) {
      if (signal?.aborted) {
        return {
          success: false,
          error: 'QR code login cancelled',
        };
      }

      const checkResponse = await this.neteaseCheckQRCode(unikey, signal);

      if (!checkResponse.success || !checkResponse.data) {
        await this.delay(1000);
        attempts++;
        continue;
      }

      const { code, cookie } = checkResponse.data;

      switch (code) {
        case 801:
          onStatusChange?.('等待扫码...');
          break;
        case 802:
          onStatusChange?.('已扫码，请在手机上确认登录。');
          break;
        case 800:
          if (refreshCount < maxRefreshOnExpire) {
            refreshCount += 1;
            onStatusChange?.('二维码已过期，正在自动刷新...');

            const refreshResponse = await this.neteaseCreateQRCode(signal);
            if (!refreshResponse.success || !refreshResponse.data) {
              return {
                success: false,
                error: refreshResponse.error || '二维码已过期，自动刷新失败，请重试。',
              };
            }

            ({ unikey, qrurl, qrimg } = refreshResponse.data);
            onQRCodeUrl(qrimg || qrurl);
            attempts = 0;
            continue;
          }

          return {
            success: false,
            error: '二维码已过期，请刷新后重试。',
          };
        case 803:
          onStatusChange?.('已确认，正在登录...');

          if (!cookie) {
            return {
              success: false,
              error: '已确认登录，但未获取到有效登录凭证。',
            };
          }

          // Some API responses are eventually consistent after 803; retry briefly.
          for (let profileAttempt = 0; profileAttempt < 5; profileAttempt++) {
            if (signal?.aborted) {
              return {
                success: false,
                error: 'QR code login cancelled',
              };
            }

            try {
              const accountResponse = await this.request<{ profile: { userId: number; nickname: string; avatarUrl: string } }>(
                '/user/account',
                { signal },
                true
              );

              if (accountResponse.success && accountResponse.data) {
                const accountData = accountResponse.data as any;
                const userProfile = accountData.profile || accountData.data?.profile;
                const fallbackAccount = accountData.account || accountData.data?.account;
                const userId = userProfile?.userId || fallbackAccount?.id;

                if (userId) {
                  return {
                    success: true,
                    user: {
                      platform: 'netease',
                      userId: String(userId),
                      nickname: userProfile?.nickname || 'NetEase User',
                      avatarUrl: userProfile?.avatarUrl || '',
                      isLoggedIn: true,
                    },
                    cookie,
                  };
                }
              }
            } catch (e) {
              console.error('Failed to fetch user profile:', e);
            }

            await this.delay(500);
          }

          return {
            success: false,
            error: '已确认登录，但获取用户信息失败，请重试。',
          };
        default:
      }

      await this.delay(1000);
      attempts++;
    }

    return {
      success: false,
      error: '二维码登录超时，请重试。',
    };
  }


  async qqCreateQRCode(signal?: AbortSignal): Promise<ApiResponse<{
    qrurl: string;
    unikey: string;
    qrimg?: string;
  }>> {
    const timestamp = Date.now();
    const keyEndpoints = [
      `/connect/qr/key?timestamp=${timestamp}`,
      `/login/qr/key?timestamp=${timestamp}`,
      `/qr/key?timestamp=${timestamp}`,
      `/user/login/qr/key?timestamp=${timestamp}`,
    ];

    let unikey = '';
    let lastError: string | null = null;
    for (const endpoint of keyEndpoints) {
      const keyResponse = await this.qqRequest<{ data?: { unikey?: string; key?: string }; unikey?: string; key?: string }>(
        endpoint,
        { signal, cache: 'no-store' },
        true
      );

      if (!keyResponse.success || !keyResponse.data) {
        if (keyResponse.error) {
          lastError = keyResponse.error;
        }
        continue;
      }

      const keyData = keyResponse.data as any;
      unikey = keyData.data?.unikey || keyData.data?.key || keyData.unikey || keyData.key || '';
      if (!unikey) {
        const keyMessage = keyData.data?.message || keyData.data?.msg || keyData.message || keyData.msg;
        if (typeof keyMessage === 'string' && keyMessage.trim()) {
          lastError = keyMessage;
        }
      }

      if (unikey) {
        break;
      }
    }

    if (!unikey) {
      return {
        success: false,
        error: lastError || 'QQ \u626b\u7801\u670d\u52a1\u672a\u5c31\u7eea\uff0c\u672a\u83b7\u53d6\u5230\u4e8c\u7ef4\u7801 key\u3002',
      };
    }

    const createEndpoints = [
      `/connect/qr/create?key=${encodeURIComponent(unikey)}&qrimg=true&timestamp=${Date.now()}`,
      `/login/qr/create?key=${encodeURIComponent(unikey)}&qrimg=true&timestamp=${Date.now()}`,
      `/login/qr/create?unikey=${encodeURIComponent(unikey)}&qrimg=true&timestamp=${Date.now()}`,
      `/qr/create?key=${encodeURIComponent(unikey)}&qrimg=true&timestamp=${Date.now()}`,
    ];

    for (const endpoint of createEndpoints) {
      const createResponse = await this.qqRequest<{ data?: { qrurl?: string; qrimg?: string; url?: string; mimetype?: string }; qrurl?: string; qrimg?: string; url?: string; mimetype?: string }>(
        endpoint,
        { signal, cache: 'no-store' },
        true
      );

      if (!createResponse.success || !createResponse.data) {
        if (createResponse.error) {
          lastError = createResponse.error;
        }
        continue;
      }

      const createData = createResponse.data as any;
      let qrurl = createData.data?.qrurl || createData.data?.url || createData.qrurl || createData.url;
      const qrimg = createData.data?.qrimg || createData.qrimg;
      const mimetype = createData.data?.mimetype || createData.mimetype || 'image/png';

      // Some adapters return base64 content in `qrurl`; convert it to a data URL for <img src>.
      if (!qrimg && typeof qrurl === 'string' && qrurl && !qrurl.startsWith('http') && !qrurl.startsWith('data:')) {
        qrurl = `data:${mimetype};base64,${qrurl}`;
      }

      if (!qrurl && !qrimg) {
        const createMessage = createData.data?.message || createData.data?.msg || createData.message || createData.msg;
        if (typeof createMessage === 'string' && createMessage.trim()) {
          lastError = createMessage;
        }
        continue;
      }

      return {
        success: true,
        data: {
          unikey,
          qrurl: typeof qrurl === 'string' ? qrurl : '',
          qrimg,
        },
      };
    }

    return {
      success: false,
      error: lastError || 'QQ \u4e8c\u7ef4\u7801\u751f\u6210\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002',
    };
  }


  async qqCheckQRCode(
    key: string,
    signal?: AbortSignal
  ): Promise<ApiResponse<{ code: number; cookie?: string; message?: string }>> {
    const checkEndpoints = [
      `/connect/qr/check?key=${encodeURIComponent(key)}&timestamp=${Date.now()}`,
      `/login/qr/check?key=${encodeURIComponent(key)}&timestamp=${Date.now()}`,
      `/login/qr/check?unikey=${encodeURIComponent(key)}&timestamp=${Date.now()}`,
      `/qr/check?key=${encodeURIComponent(key)}&timestamp=${Date.now()}`,
    ];

    for (const endpoint of checkEndpoints) {
      const response = await this.qqRequest<{
        code?: number | string;
        status?: number | string;
        message?: string;
        cookie?: string | Record<string, unknown>;
        data?: {
          code?: number | string;
          status?: number | string;
          message?: string;
          cookie?: string | Record<string, unknown>;
        };
      }>(endpoint, { signal, cache: 'no-store' }, true);

      if (!response.success || !response.data) {
        continue;
      }

      const data = response.data as any;
      const rawMessage = data.data?.message ?? data.message;
      const normalizedMessage = typeof rawMessage === 'string' ? rawMessage : undefined;

      const responseCookie = this.normalizeQQCookieValue(response.cookie);
      const bodyCookie = this.normalizeQQCookieValue(data.cookie || data.data?.cookie);
      const normalizedCookie = responseCookie || bodyCookie;

      const rawCode = data.data?.status ?? data.status ?? data.data?.code ?? data.code;
      const normalizedCode = this.normalizeQQQRCodeStatus(rawCode, normalizedMessage, Boolean(normalizedCookie));

      return {
        success: true,
        data: {
          code: normalizedCode,
          cookie: normalizedCookie,
          message: normalizedMessage,
        },
        cookie: normalizedCookie,
      };
    }

    return {
      success: false,
      error: 'QQ \u4e8c\u7ef4\u7801\u72b6\u6001\u68c0\u67e5\u5931\u8d25\u3002',
    };
  }


  async qqQRCodeLogin(
    onQRCodeUrl: (url: string) => void,
    onStatusChange?: (status: string) => void,
    signal?: AbortSignal
  ): Promise<LoginResult> {
    if (signal?.aborted) {
      return {
        success: false,
        error: 'QQ 扫码登录已取消。',
      };
    }

    const createResponse = await this.qqCreateQRCode(signal);
    if (!createResponse.success || !createResponse.data) {
      return {
        success: false,
        error: createResponse.error || 'QQ 二维码生成失败。',
      };
    }

    let { unikey, qrurl, qrimg } = createResponse.data;
    onQRCodeUrl(qrimg || qrurl);

    let attempts = 0;
    let refreshCount = 0;
    const maxAttempts = 120;
    const maxRefreshOnExpire = 2;

    while (attempts < maxAttempts) {
      if (signal?.aborted) {
        return {
          success: false,
          error: 'QQ 扫码登录已取消。',
        };
      }

      const checkResponse = await this.qqCheckQRCode(unikey, signal);
      if (!checkResponse.success || !checkResponse.data) {
        await this.delay(1000);
        attempts += 1;
        continue;
      }

      const { code, cookie } = checkResponse.data;

      switch (code) {
        case 801:
          onStatusChange?.('等待扫码...');
          break;
        case 802:
          onStatusChange?.('已扫码，请在手机上确认登录。');
          break;
        case 800:
          if (refreshCount < maxRefreshOnExpire) {
            refreshCount += 1;
            onStatusChange?.('二维码已过期，正在自动刷新...');

            const refreshResponse = await this.qqCreateQRCode(signal);
            if (!refreshResponse.success || !refreshResponse.data) {
              return {
                success: false,
                error: refreshResponse.error || '二维码已过期，自动刷新失败，请重试。',
              };
            }

            ({ unikey, qrurl, qrimg } = refreshResponse.data);
            onQRCodeUrl(qrimg || qrurl);
            attempts = 0;
            continue;
          }

          return {
            success: false,
            error: '二维码已过期，请刷新后重试。',
          };
        case 803: {
          onStatusChange?.('已确认，正在登录...');

          if (!cookie) {
            return {
              success: false,
              error: '已确认登录，但未获取到有效登录凭证。',
            };
          }

          const user = await this.getUserInfo('qq', cookie);
          if (user) {
            return {
              success: true,
              user,
              cookie,
            };
          }

          return {
            success: true,
            user: {
              platform: 'qq',
              userId: this.extractQQUserId(cookie),
              nickname: 'QQ 音乐用户',
              avatarUrl: '',
              isLoggedIn: true,
            },
            cookie,
          };
        }
        default:
          break;
      }

      await this.delay(1000);
      attempts += 1;
    }

    return {
      success: false,
      error: '二维码登录超时，请重试。',
    };
  }

  private async fetchQQProfile(cookie: string): Promise<{ userId: string; nickname: string; avatarUrl: string } | null> {
    const endpoints = ['/connect/status', '/user/detail'];
    const authHeaders = {
      token: `Bearer ${cookie}`,
      Authorization: `Bearer ${cookie}`,
    };

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(`${QQ_API_CONFIG.baseUrl}${endpoint}`, {
          headers: authHeaders,
        });

        if (!response.ok) {
          continue;
        }

        const data = await response.json();

        if (endpoint === '/connect/status') {
          const payload = data?.data || data;
          const userId = payload?.id || payload?.userId;
          const nickname = payload?.name || payload?.nickname;
          if (userId || nickname) {
            return {
              userId: String(userId || this.extractQQUserId(cookie)),
              nickname: nickname || 'QQ \u97f3\u4e50\u7528\u6237',
              avatarUrl: payload?.avatar || payload?.avatarUrl || '',
            };
          }
          continue;
        }

        const profile = data?.data?.profile || data?.profile || data?.data?.user;
        const account = data?.data?.account || data?.account;
        const userId = profile?.userId || profile?.uid || account?.id;
        const nickname = profile?.nickname || profile?.nick;
        if (userId || nickname) {
          return {
            userId: String(userId || this.extractQQUserId(cookie)),
            nickname: nickname || 'QQ \u97f3\u4e50\u7528\u6237',
            avatarUrl: normalizeImageUrl(profile?.avatarUrl || profile?.avatar || profile?.headpic) || '',
          };
        }
      } catch {
        // Ignore endpoint-level errors and continue with fallback endpoint.
      }
    }

    return null;
  }

  /**
   * Renew login session
   */
  async renewLogin(platform: MusicPlatform, cookie: string): Promise<boolean> {
    if (platform === 'netease') {
      const normalizedCookie = cookie?.trim();
      if (!normalizedCookie) {
        return false;
      }

      if (this.sessionCookie !== normalizedCookie) {
        this.sessionCookie = normalizedCookie;
      }

      const endpoint = this.appendNeteaseCookie(`/login/refresh?timestamp=${Date.now()}`, normalizedCookie);
      try {
        const response = await fetch(`${this.apiBase}${endpoint}`, {
          method: 'POST',
          headers: this.isTauriRuntime() ? { Cookie: normalizedCookie } : undefined,
          cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));

        const setCookieHeader = response.headers.get('Set-Cookie');
        if (setCookieHeader) {
          this.sessionCookie = setCookieHeader;
        }
        const cookieFromBody = (data as { cookie?: unknown }).cookie;
        if (typeof cookieFromBody === 'string') {
          this.sessionCookie = cookieFromBody;
        }

        if (response.ok && ((data as { code?: number; data?: { code?: number } }).code === 200
          || (data as { data?: { code?: number } }).data?.code === 200)) {
          return true;
        }
      } catch {
        // Fall through to verification fallback.
      }

      return this.verifyLogin('netease', normalizedCookie);
    }

    if (platform === 'qq') {
      return this.verifyLogin('qq', cookie);
    }

    return false;
  }

  /**
   * Verify login status
   */
  async verifyLogin(platform: MusicPlatform, cookie: string): Promise<boolean> {
    if (platform === 'netease') {
      const endpoint = this.appendNeteaseCookie('/login/status', cookie);
      const response = await fetch(`${this.apiBase}${endpoint}`, {
        headers: this.isTauriRuntime() ? { Cookie: cookie } : undefined,
        cache: 'no-store',
      });
      const data = await response.json();
      return data.data?.code === 200 || data.code === 200;
    }

    if (platform === 'qq') {
      if (!cookie?.trim()) {
        return false;
      }

      const profile = await this.fetchQQProfile(cookie);
      if (profile) {
        return true;
      }

      // Fallback: if cookie contains key auth tokens, treat as logged in for local mode.
      return this.hasQQAuthTokens(cookie);
    }

    return false;
  }

  /**
   * Get user info
   */
  async getUserInfo(platform: MusicPlatform, cookie: string): Promise<UnifiedUser | null> {
    if (platform === 'netease') {
      const endpoint = this.appendNeteaseCookie('/user/account', cookie);
      const response = await fetch(`${this.apiBase}${endpoint}`, {
        headers: this.isTauriRuntime() ? { Cookie: cookie } : undefined,
        cache: 'no-store',
      });
      const data = await response.json();

      if (data.code === 200 && data.profile) {
        return {
          platform: 'netease',
          userId: String(data.profile.userId),
          nickname: data.profile.nickname,
          avatarUrl: data.profile.avatarUrl || '',
          isLoggedIn: true,
        };
      }
    }

    if (platform === 'qq') {
      const profile = await this.fetchQQProfile(cookie);
      if (profile) {
        return {
          platform: 'qq',
          userId: profile.userId,
          nickname: profile.nickname,
          avatarUrl: normalizeImageUrl(profile.avatarUrl) || '',
          isLoggedIn: true,
        };
      }

      if (this.hasQQAuthTokens(cookie)) {
        return {
          platform: 'qq',
          userId: this.extractQQUserId(cookie),
          nickname: 'QQ \u97f3\u4e50\u7528\u6237',
          avatarUrl: '',
          isLoggedIn: true,
        };
      }
    }

    return null;
  }

  /**
   * Logout
   */
  async logout(platform: MusicPlatform, cookie: string): Promise<boolean> {
    if (platform === 'netease') {
      const endpoint = this.appendNeteaseCookie('/logout', cookie);
      const response = await fetch(`${this.apiBase}${endpoint}`, {
        method: 'POST',
        headers: this.isTauriRuntime() ? { Cookie: cookie } : undefined,
        cache: 'no-store',
      });
      const data = await response.json();
      return data.code === 200;
    }

    if (platform === 'qq') {
      // QQ MVP login only stores cookie locally; logout means clearing local auth.
      return true;
    }

    return false;
  }

  private hasQQAuthTokens(cookie: string): boolean {
    const lowerCookie = cookie.toLowerCase();
    if (['uin=', 'p_uin=', 'qqmusic_key=', 'p_skey=', 'qm_keyst=', 'musicid=', 'musickey=']
      .some((token) => lowerCookie.includes(token))) {
      return true;
    }

    if (cookie.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(cookie) as Record<string, unknown>;
        return Boolean(parsed.musicid || parsed.str_musicid || parsed.musickey || parsed.qqmusic_key);
      } catch {
        return false;
      }
    }

    return false;
  }

  private extractQQUserId(cookie: string): string {
    const matchers = [
      /(?:^|;\s*)uin=o?(\d+)/i,
      /(?:^|;\s*)p_uin=o?(\d+)/i,
      /(?:^|;\s*)qqmusic_uin=(\d+)/i,
      /(?:^|;\s*)musicid=(\d+)/i,
    ];

    for (const matcher of matchers) {
      const matched = cookie.match(matcher);
      if (matched?.[1]) {
        return matched[1];
      }
    }

    const trimmed = cookie.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        const candidates = [parsed.musicid, parsed.str_musicid, parsed.uin, parsed.p_uin, parsed.qqmusic_uin];

        for (const candidate of candidates) {
          const digits = String(candidate ?? '').match(/(\d+)/)?.[1];
          if (digits) {
            return digits;
          }
        }
      } catch {
        // Ignore invalid JSON payloads.
      }
    }

    // Stable fallback userId derived from cookie content.
    let hash = 0;
    for (let i = 0; i < cookie.length; i++) {
      hash = (hash * 31 + cookie.charCodeAt(i)) >>> 0;
    }
    return `qq_${hash}`;
  }

  /**
   * Helper function for delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * QQ Music cookie login fallback.
   * QR login is handled by qqQRCodeLogin and depends on backend QR endpoints.
   */
  async qqMusicLogin(cookie: string, nickname?: string): Promise<LoginResult> {
    const normalizedCookie = cookie.trim();
    if (!normalizedCookie) {
      return {
        success: false,
        error: '请输入 QQ 音乐 Cookie。',
      };
    }

    if (!this.hasQQAuthTokens(normalizedCookie)) {
      return {
        success: false,
        error: 'Cookie 缺少必要鉴权字段（uin / qqmusic_key / p_skey）。',
      };
    }

    let resolvedNickname = nickname?.trim() || 'QQ 音乐用户';
    let resolvedAvatar = '';
    let resolvedUserId = this.extractQQUserId(normalizedCookie);

    try {
      const profile = await this.fetchQQProfile(normalizedCookie);
      if (profile) {
        resolvedUserId = profile.userId;
        resolvedNickname = profile.nickname || resolvedNickname;
        resolvedAvatar = profile.avatarUrl || resolvedAvatar;
      }
    } catch {
      // In local mode, QQ API service may be unavailable; cookie-only login still works.
    }

    return {
      success: true,
      user: {
        platform: 'qq',
        userId: resolvedUserId,
        nickname: resolvedNickname,
        avatarUrl: resolvedAvatar,
        isLoggedIn: true,
      },
      cookie: normalizedCookie,
    };
  }
}

// Singleton instance
export const authService = new AuthService();
