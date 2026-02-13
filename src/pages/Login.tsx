import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores';
import { authService } from '@/services/auth.service';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

type LoginTab = 'netease' | 'qq';
type NeteaseMethod = 'email' | 'phone' | 'qrcode';
type QQMethod = 'qrcode' | 'cookie';
type UiVersion = 'current' | 'v4-glam';
type UiBridge = {
  switchUiVersion?: (next: UiVersion) => Promise<void>;
};

const UI_VERSION_STORAGE_KEY = 'allmusic_ui_version_v1';

function resolveUiBridge(): UiBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const bridge = (window as Window & { __ALLMUSIC_BRIDGE__?: UiBridge }).__ALLMUSIC_BRIDGE__;
  return bridge || null;
}

export function LoginPage() {
  const { setUser, users } = useAuthStore();

  const [activeTab, setActiveTab] = useState<LoginTab>('netease');
  const [neteaseMethod, setNeteaseMethod] = useState<NeteaseMethod>('qrcode');
  const [qqMethod, setQqMethod] = useState<QQMethod>('qrcode');

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('86');
  const [qqCookie, setQqCookie] = useState('');
  const [qqNickname, setQqNickname] = useState('');

  // Loading and error states
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState('');

  // NetEase QR state
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const qrLoginAbortRef = useRef<AbortController | null>(null);

  // QQ QR state
  const [qqQrStatus, setQqQrStatus] = useState('');
  const [qqQrCodeUrl, setQqQrCodeUrl] = useState<string | null>(null);
  const qqQrLoginAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const loadCredentials = async () => {
      await useAuthStore.getState().loadStoredCredentials();
    };
    loadCredentials();
  }, []);

  useEffect(() => {
    return () => {
      qrLoginAbortRef.current?.abort();
      qqQrLoginAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (neteaseMethod !== 'qrcode') {
      qrLoginAbortRef.current?.abort();
      qrLoginAbortRef.current = null;
      setIsLoading(false);
      setQrCodeUrl(null);
      setQrStatus('');
    }
  }, [neteaseMethod]);

  useEffect(() => {
    if (qqMethod !== 'qrcode') {
      qqQrLoginAbortRef.current?.abort();
      qqQrLoginAbortRef.current = null;
      setIsLoading(false);
      setQqQrCodeUrl(null);
      setQqQrStatus('');
    }
  }, [qqMethod]);

  useEffect(() => {
    setError(null);
  }, [activeTab]);

  const handleNeteaseLogin = async () => {
    setIsLoading(true);
    setError(null);

    try {
      let result;

      if (neteaseMethod === 'email') {
        result = await authService.neteaseEmailLogin(email, password);
      } else if (neteaseMethod === 'phone') {
        result = await authService.neteaseCellphoneLogin(phone, countryCode, password);
      } else {
        return;
      }

      if (result.success && result.user && result.cookie) {
        await setUser('netease', result.user, result.cookie);
      } else {
        setError(result.error || '鐧诲綍澶辫触');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '鐧诲綍澶辫触');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQRCodeLogin = async () => {
    qrLoginAbortRef.current?.abort();
    const controller = new AbortController();
    qrLoginAbortRef.current = controller;
    const previousQrCodeUrl = qrCodeUrl;
    const isRefreshing = Boolean(previousQrCodeUrl);

    setIsLoading(true);
    setError(null);
    if (!isRefreshing) {
      setQrCodeUrl(null);
    }
    setQrStatus('姝ｅ湪鐢熸垚浜岀淮鐮?..');

    try {
      const result = await authService.neteaseQRCodeLogin(
        (url) => {
          if (!controller.signal.aborted) {
            setQrCodeUrl(url);
          }
        },
        (status) => {
          if (!controller.signal.aborted) {
            setQrStatus(status);
          }
        },
        controller.signal
      );

      if (controller.signal.aborted) {
        return;
      }

      if (result.success && result.user && result.cookie) {
        await setUser('netease', result.user, result.cookie);
      } else {
        const errorMessage = result.error || '二维码登录失败';
        setError(errorMessage);

        const shouldDiscardPrevious = /expired|杩囨湡/i.test(errorMessage);
        if (!isRefreshing || shouldDiscardPrevious) {
          setQrCodeUrl(null);
        } else {
          setQrCodeUrl(previousQrCodeUrl);
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      const errorMessage = err instanceof Error ? err.message : '二维码登录失败';
      setError(errorMessage);

      const shouldDiscardPrevious = /expired|杩囨湡/i.test(errorMessage);
      if (!isRefreshing || shouldDiscardPrevious) {
        setQrCodeUrl(null);
      } else {
        setQrCodeUrl(previousQrCodeUrl);
      }
    } finally {
      if (qrLoginAbortRef.current === controller) {
        qrLoginAbortRef.current = null;
        setIsLoading(false);
        setQrStatus('');
      }
    }
  };

  const qrDisplayStatus = qrStatus || (qrCodeUrl ? '请使用网易云音乐 App 扫码登录' : '点击生成二维码开始登录');

  const handleQQLogin = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await authService.qqMusicLogin(qqCookie.trim(), qqNickname.trim() || undefined);
      if (result.success && result.user && result.cookie) {
        await setUser('qq', result.user, result.cookie);
      } else {
        setError(result.error || '鐧诲綍 QQ 闊充箰澶辫触');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '鐧诲綍 QQ 闊充箰澶辫触');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQQQRCodeLogin = async () => {
    qqQrLoginAbortRef.current?.abort();
    const controller = new AbortController();
    qqQrLoginAbortRef.current = controller;
    const previousQrCodeUrl = qqQrCodeUrl;
    const isRefreshing = Boolean(previousQrCodeUrl);

    setIsLoading(true);
    setError(null);
    if (!isRefreshing) {
      setQqQrCodeUrl(null);
    }
    setQqQrStatus('姝ｅ湪鐢熸垚 QQ 浜岀淮鐮?..');

    try {
      const result = await authService.qqQRCodeLogin(
        (url) => {
          if (!controller.signal.aborted) {
            setQqQrCodeUrl(url);
          }
        },
        (status) => {
          if (!controller.signal.aborted) {
            setQqQrStatus(status);
          }
        },
        controller.signal
      );

      if (controller.signal.aborted) {
        return;
      }

      if (result.success && result.user && result.cookie) {
        await setUser('qq', result.user, result.cookie);
      } else {
        const errorMessage = result.error || 'QQ 二维码登录失败';
        setError(errorMessage);

        const shouldDiscardPrevious = /expired|杩囨湡/i.test(errorMessage);
        if (!isRefreshing || shouldDiscardPrevious) {
          setQqQrCodeUrl(null);
        } else {
          setQqQrCodeUrl(previousQrCodeUrl);
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }

      const errorMessage = err instanceof Error ? err.message : 'QQ 二维码登录失败';
      setError(errorMessage);

      const shouldDiscardPrevious = /expired|杩囨湡/i.test(errorMessage);
      if (!isRefreshing || shouldDiscardPrevious) {
        setQqQrCodeUrl(null);
      } else {
        setQqQrCodeUrl(previousQrCodeUrl);
      }
    } finally {
      if (qqQrLoginAbortRef.current === controller) {
        qqQrLoginAbortRef.current = null;
        setIsLoading(false);
        setQqQrStatus('');
      }
    }
  };

  const qqQrDisplayStatus = qqQrStatus || (qqQrCodeUrl ? '请使用 QQ 音乐 App 扫码登录' : '点击生成 QQ 二维码开始登录');

  const handleLogout = async (platform: 'netease' | 'qq') => {
    try {
      await useAuthStore.getState().removeUser(platform);
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const handleSwitchToV4 = useCallback(async () => {
    const bridge = resolveUiBridge();
    if (bridge && typeof bridge.switchUiVersion === 'function') {
      await bridge.switchUiVersion('v4-glam');
      return;
    }

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(UI_VERSION_STORAGE_KEY, 'v4-glam');
      window.location.reload();
    }
  }, []);

  return (
    <div className="am-screen min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="am-title-gradient text-4xl font-bold mb-2">
            ALLMusic
          </h1>
          <p className="text-slate-300">鐧诲綍浠ュ悓姝ヤ綘鐨勯煶涔愬簱</p>
          <div className="mt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleSwitchToV4()}
              title="切换到 V4 UI"
            >
              ✨ 切换到 V4 UI
            </Button>
          </div>
        </div>

        <div className="flex gap-2 mb-6">
          <Button
            variant={activeTab === 'netease' ? 'primary' : 'ghost'}
            className="flex-1"
            onClick={() => setActiveTab('netease')}
          >
            缃戞槗浜戦煶涔?
          </Button>
          <Button
            variant={activeTab === 'qq' ? 'primary' : 'ghost'}
            className="flex-1"
            onClick={() => setActiveTab('qq')}
          >
            QQ 闊充箰
            <span className="ml-2 text-xs opacity-60">Beta</span>
          </Button>
        </div>

        {activeTab === 'netease' && (
          <Card>
            <CardHeader>
              {users.netease ? (
                <div className="flex items-center gap-4">
                  <img
                    src={users.netease.avatarUrl || 'https://p.qlogo.cn/gh/0/0/100'}
                    alt={users.netease.nickname}
                    className="w-16 h-16 rounded-full"
                  />
                  <div className="flex-1">
                    <p className="font-semibold">{users.netease.nickname}</p>
                    <p className="text-sm text-slate-400">宸茬櫥褰曠綉鏄撲簯闊充箰</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleLogout('netease')}>
                    閫€鍑?
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant={neteaseMethod === 'qrcode' ? 'default' : 'ghost'}
                    className="flex-1"
                    size="sm"
                    onClick={() => setNeteaseMethod('qrcode')}
                  >
                    浜岀淮鐮?
                  </Button>
                  <Button
                    variant={neteaseMethod === 'email' ? 'default' : 'ghost'}
                    className="flex-1"
                    size="sm"
                    onClick={() => setNeteaseMethod('email')}
                  >
                    閭
                  </Button>
                  <Button
                    variant={neteaseMethod === 'phone' ? 'default' : 'ghost'}
                    className="flex-1"
                    size="sm"
                    onClick={() => setNeteaseMethod('phone')}
                  >
                    鎵嬫満鍙?
                  </Button>
                </div>
              )}
            </CardHeader>

            {!users.netease && (
              <CardContent>
                {error && (
                  <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">
                    {error}
                  </div>
                )}

                {neteaseMethod === 'qrcode' && (
                  <div className="text-center">
                    <div className="mb-4 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-300 flex items-center justify-center gap-2">
                      {isLoading && !qrCodeUrl && <Spinner size="sm" />}
                      <span>{qrDisplayStatus}</span>
                    </div>
                    {qrCodeUrl ? (
                      <div>
                        <img
                          src={qrCodeUrl}
                          alt="QR Code"
                          className="mx-auto w-48 h-48 border-4 border-white rounded-lg"
                        />
                        <p className="mt-4 text-sm text-slate-400">{qrDisplayStatus}</p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-4"
                          onClick={handleQRCodeLogin}
                          disabled={isLoading}
                        >
                          鍒锋柊浜岀淮鐮?
                        </Button>
                      </div>
                    ) : (
                      <div>
                        <Button
                          variant="primary"
                          className="w-full"
                          onClick={handleQRCodeLogin}
                          disabled={isLoading}
                        >
                          {isLoading ? <Spinner /> : '生成二维码'}
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {neteaseMethod === 'email' && (
                  <div className="space-y-4">
                    <Input
                      type="email"
                      placeholder="閭"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={isLoading}
                    />
                    <Input
                      type="password"
                      placeholder="瀵嗙爜"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={isLoading}
                      onKeyPress={(e) => e.key === 'Enter' && handleNeteaseLogin()}
                    />
                    <Button
                      variant="primary"
                      className="w-full"
                      onClick={handleNeteaseLogin}
                      disabled={isLoading || !email || !password}
                    >
                      {isLoading ? <Spinner size="sm" /> : '鐧诲綍'}
                    </Button>
                  </div>
                )}

                {neteaseMethod === 'phone' && (
                  <div className="space-y-4">
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        placeholder="+86"
                        value={countryCode}
                        onChange={(e) => setCountryCode(e.target.value)}
                        disabled={isLoading}
                        className="w-20"
                      />
                      <Input
                        type="tel"
                        placeholder="手机号"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        disabled={isLoading}
                      />
                    </div>
                    <Input
                      type="password"
                      placeholder="瀵嗙爜"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={isLoading}
                      onKeyPress={(e) => e.key === 'Enter' && handleNeteaseLogin()}
                    />
                    <Button
                      variant="primary"
                      className="w-full"
                      onClick={handleNeteaseLogin}
                      disabled={isLoading || !phone || !password}
                    >
                      {isLoading ? <Spinner size="sm" /> : '鐧诲綍'}
                    </Button>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        )}

        {activeTab === 'qq' && (
          <Card>
            <CardHeader>
              {users.qq ? (
                <div className="flex items-center gap-4">
                  <img
                    src={users.qq.avatarUrl || 'https://p.qlogo.cn/gh/0/0/100'}
                    alt={users.qq.nickname}
                    className="w-16 h-16 rounded-full"
                  />
                  <div className="flex-1">
                    <p className="font-semibold">{users.qq.nickname}</p>
                    <p className="text-sm text-slate-400">宸茬櫥褰?QQ 闊充箰</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleLogout('qq')}>
                    閫€鍑?
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant={qqMethod === 'qrcode' ? 'default' : 'ghost'}
                    className="flex-1"
                    size="sm"
                    onClick={() => setQqMethod('qrcode')}
                  >
                    浜岀淮鐮?
                  </Button>
                  <Button
                    variant={qqMethod === 'cookie' ? 'default' : 'ghost'}
                    className="flex-1"
                    size="sm"
                    onClick={() => setQqMethod('cookie')}
                  >
                    Cookie
                  </Button>
                </div>
              )}
            </CardHeader>

            {!users.qq && (
              <CardContent className="space-y-4">
                {error && (
                  <div className="mb-1 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">
                    {error}
                  </div>
                )}

                {qqMethod === 'qrcode' && (
                  <div className="text-center">
                    <div className="mb-4 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-300 flex items-center justify-center gap-2">
                      {isLoading && !qqQrCodeUrl && <Spinner size="sm" />}
                      <span>{qqQrDisplayStatus}</span>
                    </div>
                    {qqQrCodeUrl ? (
                      <div>
                        <img
                          src={qqQrCodeUrl}
                          alt="QQ QR Code"
                          className="mx-auto w-48 h-48 border-4 border-white rounded-lg"
                        />
                        <p className="mt-4 text-sm text-slate-400">{qqQrDisplayStatus}</p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-4"
                          onClick={handleQQQRCodeLogin}
                          disabled={isLoading}
                        >
                          鍒锋柊浜岀淮鐮?
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="primary"
                        className="w-full"
                        onClick={handleQQQRCodeLogin}
                        disabled={isLoading}
                      >
                        {isLoading ? <Spinner /> : '生成二维码'}
                      </Button>
                    )}
                  </div>
                )}

                {qqMethod === 'cookie' && (
                  <>
                    <Input
                      type="text"
                      placeholder="QQ 鏄电О锛堝彲閫夛級"
                      value={qqNickname}
                      onChange={(e) => setQqNickname(e.target.value)}
                      disabled={isLoading}
                    />
                    <Input
                      type="password"
                      placeholder="绮樿创 QQ 闊充箰 Cookie"
                      value={qqCookie}
                      onChange={(e) => setQqCookie(e.target.value)}
                      disabled={isLoading}
                    />
                    <p className="text-xs text-slate-500 text-left">
                      闇€瑕佸寘鍚?uin / qqmusic_key / p_skey 绛夊瓧娈典箣涓€銆?
                    </p>
                    <Button
                      variant="primary"
                      className="w-full"
                      onClick={handleQQLogin}
                      disabled={isLoading || !qqCookie.trim()}
                    >
                      {isLoading ? <Spinner size="sm" /> : '鐧诲綍 QQ 闊充箰'}
                    </Button>
                  </>
                )}
              </CardContent>
            )}
          </Card>
        )}

      </div>
    </div>
  );
}

