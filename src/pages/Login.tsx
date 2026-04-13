import { useEffect, useRef, useState } from 'react';
import { useAlertStore, useAuthStore } from '@/stores';
import { authService } from '@/services/auth.service';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { UiVersionSwitcher } from '@/components/theme/ui-version-switcher';
import { normalizeImageUrl } from '@/lib/image-url';

type LoginTab = 'netease' | 'qq';

interface LoginPageProps {
  localApiReady: boolean;
}

export function LoginPage({ localApiReady }: LoginPageProps) {
  const { setUser, users } = useAuthStore();
  const pushAlert = useAlertStore((state) => state.pushAlert);

  const [activeTab, setActiveTab] = useState<LoginTab>('netease');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const qrLoginAbortRef = useRef<AbortController | null>(null);
  const [qqQrStatus, setQqQrStatus] = useState('');
  const [qqQrCodeUrl, setQqQrCodeUrl] = useState<string | null>(null);
  const qqQrLoginAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const loadCredentials = async () => {
      await useAuthStore.getState().loadStoredCredentials();
    };
    loadCredentials();
  }, []);

  useEffect(() => () => {
    qrLoginAbortRef.current?.abort();
    qqQrLoginAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    setError(null);
  }, [activeTab]);

  useEffect(() => {
    if (localApiReady) {
      return;
    }

    qrLoginAbortRef.current?.abort();
    qqQrLoginAbortRef.current?.abort();
  }, [localApiReady]);

  const localApiPendingMessage = '本地 API 启动中，请等待启动完成后再试。';
  const loginActionDisabled = isLoading || !localApiReady;

  useEffect(() => {
    if (!error) {
      return;
    }

    pushAlert({
      level: 'error',
      title: activeTab === 'netease' ? '网易云登录失败' : 'QQ 音乐登录失败',
      message: error,
      source: activeTab === 'netease' ? 'login.netease' : 'login.qq',
      dedupeKey: `login:${activeTab}:${error}`,
    });
  }, [activeTab, error, pushAlert]);

  const handleQRCodeLogin = async () => {
    if (!localApiReady) {
      setError(localApiPendingMessage);
      return;
    }

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
    setQrStatus('正在生成二维码...');

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
        controller.signal,
      );

      if (controller.signal.aborted) {
        return;
      }

      if (result.success && result.user && result.cookie) {
        await setUser('netease', result.user, result.cookie);
      } else {
        const errorMessage = result.error || '二维码登录失败';
        setError(errorMessage);

        const shouldDiscardPrevious = /expired|过期/i.test(errorMessage);
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

      const shouldDiscardPrevious = /expired|过期/i.test(errorMessage);
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

  const handleQQQRCodeLogin = async () => {
    if (!localApiReady) {
      setError(localApiPendingMessage);
      return;
    }

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
    setQqQrStatus('正在生成 QQ 二维码...');

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
        controller.signal,
      );

      if (controller.signal.aborted) {
        return;
      }

      if (result.success && result.user && result.cookie) {
        await setUser('qq', result.user, result.cookie);
      } else {
        const errorMessage = result.error || 'QQ 二维码登录失败';
        setError(errorMessage);

        const shouldDiscardPrevious = /expired|过期/i.test(errorMessage);
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

      const shouldDiscardPrevious = /expired|过期/i.test(errorMessage);
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

  const qrDisplayStatus = !localApiReady
    ? localApiPendingMessage
    : (qrStatus || (qrCodeUrl ? '请使用网易云音乐 App 扫码登录' : '点击生成二维码开始登录'));
  const qqQrDisplayStatus = !localApiReady
    ? localApiPendingMessage
    : (qqQrStatus || (qqQrCodeUrl ? '请使用 QQ 音乐 App 扫码登录' : '点击生成 QQ 二维码开始登录'));

  const handleLogout = async (platform: 'netease' | 'qq') => {
    try {
      await useAuthStore.getState().removeUser(platform);
    } catch (err) {
      const message = err instanceof Error ? err.message : '退出登录失败，请稍后重试。';
      setError(message);
    }
  };

  return (
    <div className="am-screen min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="am-title-gradient text-4xl font-bold mb-2">
            ALLMusic
          </h1>
          <p className="text-slate-300">登录以同步你的音乐库</p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <UiVersionSwitcher compact align="left" triggerLabel="切换主题" />
          </div>
        </div>

        <div className="flex gap-2 mb-6">
          <Button
            variant={activeTab === 'netease' ? 'primary' : 'ghost'}
            className="flex-1"
            onClick={() => setActiveTab('netease')}
          >
            网易云音乐
          </Button>
          <Button
            variant={activeTab === 'qq' ? 'primary' : 'ghost'}
            className="flex-1"
            onClick={() => setActiveTab('qq')}
          >
            QQ 音乐
            <span className="ml-2 text-xs opacity-60">Beta</span>
          </Button>
        </div>

        {activeTab === 'netease' && (
          <Card>
            <CardHeader>
              {users.netease ? (
                <div className="flex items-center gap-4">
                  <img
                    src={normalizeImageUrl(users.netease.avatarUrl) || 'https://p.qlogo.cn/gh/0/0/100'}
                    alt={users.netease.nickname}
                    className="w-16 h-16 rounded-full"
                  />
                  <div className="flex-1">
                    <p className="font-semibold">{users.netease.nickname}</p>
                    <p className="text-sm text-slate-400">已登录网易云音乐</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleLogout('netease')}>
                    退出
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">扫码登录</p>
                    <p className="text-sm text-slate-400">仅支持使用网易云 App 扫码登录</p>
                  </div>
                  <span className="rounded-full border border-cyan-400/40 bg-cyan-500/15 px-3 py-1 text-xs text-cyan-100">
                    QR Only
                  </span>
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
                        disabled={loginActionDisabled}
                      >
                        刷新二维码
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="primary"
                      className="w-full"
                      onClick={handleQRCodeLogin}
                      disabled={loginActionDisabled}
                    >
                      {isLoading ? <Spinner /> : '生成二维码'}
                    </Button>
                  )}
                </div>
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
                    src={normalizeImageUrl(users.qq.avatarUrl) || 'https://p.qlogo.cn/gh/0/0/100'}
                    alt={users.qq.nickname}
                    className="w-16 h-16 rounded-full"
                  />
                  <div className="flex-1">
                    <p className="font-semibold">{users.qq.nickname}</p>
                    <p className="text-sm text-slate-400">已登录 QQ 音乐</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleLogout('qq')}>
                    退出
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">扫码登录</p>
                    <p className="text-sm text-slate-400">仅支持使用 QQ 音乐 App 扫码登录</p>
                  </div>
                  <span className="rounded-full border border-cyan-400/40 bg-cyan-500/15 px-3 py-1 text-xs text-cyan-100">
                    QR Only
                  </span>
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
                        disabled={loginActionDisabled}
                      >
                        刷新二维码
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="primary"
                      className="w-full"
                      onClick={handleQQQRCodeLogin}
                      disabled={loginActionDisabled}
                    >
                      {isLoading ? <Spinner /> : '生成二维码'}
                    </Button>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
