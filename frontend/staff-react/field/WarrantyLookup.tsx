import { useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  WARRANTY_BRANDS,
  warrantyBrandId,
  normalizeDeviceSerial,
  isDeviceSerial,
  deviceSerialFromCode,
  warrantyOfficialDestination,
  warrantyConsumerChannel
} from '../../../shared/warranty.js';
import { ActivityContext, Modal, Notice, Scanner, api } from './ui';
import { SerialOcr } from './SerialOcr';
import './warranty.css';

type WarrantyStatus = 'unknown' | 'in_warranty' | 'expired';
type Props = { initialBrand?: string; onUseStatus?: (status: WarrantyStatus) => void };
type Provider = { id: string; available: boolean; mode?: 'automatic' | 'captcha'; message: string };
type Widget = {
  origin: string;
  type: number;
  lang: string;
  challenge: string;
  hcg: string;
  hct: string;
  nonce: string;
};
type Captcha = {
  brand: string;
  serial: string;
  image?: string;
  widget?: Widget;
  token: string;
  expiresAt: string;
};
type Result = {
  brand: string;
  serial: string;
  outcome: 'found' | 'not_found';
  status: WarrantyStatus;
  checkedAt: string;
  source: { name: string; url: string };
  note: string;
  services: {
    name: string;
    category: string;
    start: string;
    end: string;
    status: WarrantyStatus | 'pending';
  }[];
};
const statusLabels = {
  unknown: '暂无法确认',
  in_warranty: '有效期内',
  expired: '已到期',
  pending: '尚未生效'
};

export function WarrantyLookupButton({ initialBrand = '', onUseStatus }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="field-secondary" onClick={() => setOpen(true)}>
        查询保修
      </button>
      {open &&
        createPortal(
          <WarrantyLookup
            initialBrand={initialBrand}
            onUseStatus={onUseStatus}
            onClose={() => setOpen(false)}
          />,
          document.body
        )}
    </>
  );
}

function WarrantyLookup({ initialBrand, onUseStatus, onClose }: Props & { onClose: () => void }) {
  const active = useContext(ActivityContext);
  const [brandId, setBrandId] = useState(() => warrantyBrandId(initialBrand));
  const [serial, setSerial] = useState('');
  const [scan, setScan] = useState(false);
  const [message, setMessage] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerError, setProviderError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [answer, setAnswer] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const serialInput = useRef<HTMLInputElement>(null);
  const captchaInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const id = useId();
  const brand = WARRANTY_BRANDS.find((item) => item.id === brandId);
  const provider = providers.find((item) => item.id === brandId);
  const normalized = normalizeDeviceSerial(serial);
  const valid = isDeviceSerial(normalized);
  const destination = warrantyOfficialDestination(brandId, normalized);
  const channel = warrantyConsumerChannel(brandId);
  const goLabel =
    channel?.kind === 'miniapp' ? '复制序列号并查看小程序入口' : '复制序列号并前往官网';
  useEffect(() => {
    const controller = new AbortController();
    api<{ providers: Provider[] }>('/api/warranty/providers', { signal: controller.signal })
      .then((data) => setProviders(data.providers))
      .catch(() => {
        if (!controller.signal.aborted)
          setProviderError('无法读取自动查询服务状态，请关闭后重试。');
      });
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!active) {
      request.current?.abort();
      setLoading(false);
      setCaptcha(null);
      setAnswer('');
    }
  }, [active]);
  useEffect(() => {
    if (captcha && active) captchaInput.current?.focus();
  }, [captcha, active]);
  function invalidate() {
    request.current?.abort();
    request.current = null;
    setLoading(false);
    setResult(null);
    setCaptcha(null);
    setAnswer('');
    setMessage('');
    setCopyFailed(false);
  }
  function changeSerial(value: string) {
    invalidate();
    setSerial(value);
  }
  async function query(
    value = normalized,
    verification?: { token: string; answer?: string; proof?: string }
  ) {
    if (!provider?.available || !isDeviceSerial(value)) return;
    invalidate();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      if (provider.mode === 'captcha' && !verification) {
        const challenge = await api<Captcha>('/api/warranty/challenge', {
          method: 'POST',
          body: { brand: brandId, serial: value },
          signal: controller.signal
        });
        if (request.current === controller && !controller.signal.aborted) setCaptcha(challenge);
        return;
      }
      const data = await api<Result>('/api/warranty/query', {
        method: 'POST',
        body: {
          brand: brandId,
          serial: value,
          ...(verification
            ? {
                captchaToken: verification.token,
                ...(verification.proof
                  ? { captchaProof: verification.proof }
                  : { captchaAnswer: verification.answer })
              }
            : {})
        },
        signal: controller.signal
      });
      if (request.current === controller && !controller.signal.aborted) setResult(data);
    } catch (error) {
      if (request.current === controller && !controller.signal.aborted)
        setMessage(error instanceof Error ? error.message : '查询失败，请重试。');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }
  async function copyAndGo() {
    if (!destination || !valid || ocrBusy) return;
    if (!copyFailed) {
      try {
        await navigator.clipboard.writeText(normalized);
      } catch {
        setCopyFailed(true);
        serialInput.current?.focus();
        serialInput.current?.select();
        setMessage('浏览器未允许复制，已选中序列号。请手动复制后点击「已手动复制，前往官网」。');
        return;
      }
    }
    window.location.assign(destination.url);
  }
  async function copyOnly() {
    if (!valid || ocrBusy) return;
    try {
      await navigator.clipboard.writeText(normalized);
      setMessage(
        channel?.kind === 'miniapp'
          ? '序列号已复制，请打开微信搜索「机械革命服务」，绑定设备后查询保修。'
          : '序列号已复制，请由机主在小米商城 App「我的 → 退换/售后」中粘贴。'
      );
    } catch {
      serialInput.current?.focus();
      serialInput.current?.select();
      setMessage('浏览器未允许复制，已选中序列号，请长按手动复制。');
    }
  }
  return (
    <Modal title="查询设备保修" onClose={onClose} initialFocus="select">
      <div className="warranty-lookup">
        <p className="field-muted">
          扫描或拍照识别序列号，核对后复制并前往原厂消费者自查渠道。联想也可直接在本页查询。
        </p>
        <label htmlFor={id + '-brand'}>设备品牌</label>
        <select
          id={id + '-brand'}
          value={brandId}
          onChange={(event) => {
            invalidate();
            setBrandId(event.target.value);
            setSerial('');
            setOcrBusy(false);
            setScan(false);
          }}
        >
          <option value="">请选择品牌</option>
          {WARRANTY_BRANDS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
              {providers.find((p) => p.id === item.id)?.available
                ? providers.find((p) => p.id === item.id)?.mode === 'captcha'
                  ? ' · 人工验证码查询'
                  : ' · 已接通自动查询'
                : ''}
            </option>
          ))}
        </select>
        <Notice>{providerError}</Notice>
        {brand && channel && (
          <section className="warranty-official" aria-label="自动查询服务状态">
            <strong>
              {provider?.available && provider.mode === 'automatic'
                ? '本页自动查询与官网自查'
                : channel.title}
            </strong>
            <ol className="warranty-channel-steps">
              {channel.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <small>默认中国大陆官方渠道。海外购买的设备，请在原厂页面切换对应地区。</small>
          </section>
        )}
        <div className="warranty-serial-heading">
          <label htmlFor={id + '-serial'}>序列号 / S/N / Service Tag</label>
          <button
            type="button"
            disabled={!brand}
            aria-expanded={scan}
            onClick={() => setScan((value) => !value)}
          >
            {scan ? '收起扫描' : '扫描机身条码 / 二维码'}
          </button>
        </div>
        {scan && (
          <Scanner
            mode="serial"
            autoStart={false}
            onCode={(code) => {
              const value = deviceSerialFromCode(code);
              if (!value) {
                setMessage(
                  '未找到明确的设备序列号。请扫描 S/N 标签，不要扫描客户维修码或到岗签到码；也可手动输入。'
                );
                return;
              }
              changeSerial(value);
              setScan(false);
              if (provider?.available) void query(value);
              else setMessage('已读入序列号，此品牌自动查询尚未接通。');
            }}
          />
        )}
        {brand && <SerialOcr key={brandId} onSerial={changeSerial} onBusy={setOcrBusy} />}
        <input
          ref={serialInput}
          disabled={ocrBusy}
          id={id + '-serial'}
          value={serial}
          maxLength={80}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          aria-describedby={id + '-hint'}
          onChange={(event) => changeSerial(event.target.value)}
          placeholder="扫描或手动输入设备序列号"
        />
        <small id={id + '-hint'}>
          请区分 O / 0、I / 1。扫描成功即向所选原厂查询；手动输入后点击下方按钮。
        </small>
        {!!serial && !valid && (
          <Notice>请输入 4–40 位英数字、连字符或斜线，请勿输入型号、MAC 地址或预约编号。</Notice>
        )}
        {provider?.available && (
          <button
            type="button"
            disabled={!valid || ocrBusy || loading}
            onClick={() => void query()}
          >
            {loading
              ? '正在连接原厂…'
              : captcha
                ? '重新获取验证码'
                : provider?.mode === 'captcha'
                  ? '获取原厂验证码'
                  : '查询原厂保修'}
          </button>
        )}
        {brand && (
          <button
            type="button"
            disabled={!valid || ocrBusy || loading}
            onClick={() => void copyAndGo()}
          >
            {copyFailed
              ? channel?.kind === 'miniapp'
                ? '已手动复制，查看小程序入口'
                : '已手动复制，前往官网'
              : goLabel}
          </button>
        )}
        {brand && ['account', 'miniapp'].includes(channel?.kind) && (
          <button
            type="button"
            className="field-secondary"
            disabled={!valid || ocrBusy || loading}
            onClick={() => void copyOnly()}
          >
            只复制序列号，按上方步骤操作
          </button>
        )}
        {destination && (
          <small>
            {destination.prefilled
              ? '此品牌支持自动带入：序列号会随原厂网址传递，打开后仍需完成原厂验证。'
              : channel?.kind === 'miniapp'
                ? '序列号会先复制，打开官方说明后，可在微信小程序内粘贴；网页不是查询表。'
                : channel?.kind === 'account'
                  ? '序列号会先复制，打开官方售后渠道后，由机主登录并粘贴。'
                  : '序列号会先复制；打开官网后请在序列号栏粘贴。'}
          </small>
        )}
        {captcha && (
          <fieldset className="warranty-captcha">
            <legend>原厂人工验证</legend>
            <p>请你人工完成原厂验证，完成后由后台取得查询结果。</p>
            {captcha.widget ? (
              <HumanWarrantyWidget
                widget={captcha.widget}
                onProof={(proof) => void query(normalized, { token: captcha.token, proof })}
                onError={() => setMessage('原厂验证组件未能加载，请重新获取验证码。')}
              />
            ) : (
              <>
                <img
                  src={captcha.image}
                  alt={(captcha.brand === 'huawei' ? '华为' : 'Acer') + ' 原厂验证码，请人工阅读'}
                />
                <label htmlFor={id + '-captcha'}>原厂验证码</label>
                <input
                  ref={captchaInput}
                  id={id + '-captcha'}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="off"
                  maxLength={12}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && answer.trim()) {
                      event.preventDefault();
                      void query(normalized, { token: captcha.token, answer: answer.trim() });
                    }
                  }}
                />
                <small>
                  验证码在 {new Date(captcha.expiresAt).toLocaleTimeString('zh-CN')}{' '}
                  前有效。看不清时点击「重新获取验证码」。
                </small>
                <button
                  type="button"
                  disabled={loading || !/^[a-z0-9]{1,12}$/i.test(answer.trim())}
                  onClick={() =>
                    void query(normalized, { token: captcha.token, answer: answer.trim() })
                  }
                >
                  提交验证码并查询
                </button>
              </>
            )}
          </fieldset>
        )}
        <div role="status" aria-live="polite">
          <Notice>{message}</Notice>
        </div>
        {result && (
          <section className="warranty-result" aria-label="原厂查询结果" aria-live="polite">
            <strong>
              {result.outcome === 'not_found' ? '原厂未查到保修信息' : '已取得原厂保修明细'}
            </strong>
            <p>序列号：{result.serial}</p>
            <p>
              来源：{result.source.name} · 查询时间：
              {new Date(result.checkedAt).toLocaleString('zh-CN')}
            </p>
            {result.outcome === 'not_found' ? (
              <p>查无资料不代表已过保。请核对序列号、销售地区及产品线后重试。</p>
            ) : (
              <>
                <p>
                  {result.status === 'in_warranty'
                    ? '硬件保修服务中有有效项目'
                    : result.status === 'expired'
                      ? '已识别的硬件保修服务均已到期'
                      : '暂无法自动判定整机保修，请查看原厂明细'}
                </p>
                <ul className="warranty-services">
                  {result.services.map((item, index) => (
                    <li key={index}>
                      <strong>{item.name}</strong>
                      <span>
                        {item.category}
                        {item.start || item.end ? ' · ' + statusLabels[item.status] : ''}
                      </span>
                      {(item.start || item.end) && (
                        <span>
                          {item.start || '日期未提供'} 至 {item.end || '日期未提供'}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <small>{result.note}</small>
                {onUseStatus && result.status !== 'unknown' && (
                  <button
                    type="button"
                    onClick={() => {
                      onUseStatus(result.status);
                      onClose();
                    }}
                  >
                    采用此保修情况
                  </button>
                )}
                {onUseStatus && <small>采用结果只填写当前核验表单，仍需按原流程确认后保存。</small>}
              </>
            )}
          </section>
        )}
        {brand && (
          <details className="warranty-fallback">
            <summary>查看官方消费者渠道</summary>
            <p>{brand.hint}</p>
            <a
              href={brand.url}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >
              打开官方保修入口 ↗
            </a>
          </details>
        )}
        <p className="field-muted">
          本页查询时，序列号经后台发送给原厂；复制跳转使用剪贴板，支持带入的原厂链接也会包含序列号。照片仅在本机识别，序列号不写入预约记录。
        </p>
      </div>
    </Modal>
  );
}

function HumanWarrantyWidget({
  widget,
  onProof,
  onError
}: {
  widget: Widget;
  onProof: (proof: string) => void;
  onError: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const used = useRef(false);
  useEffect(() => {
    frame.current?.scrollIntoView({ block: 'center' });
  }, [widget.nonce]);
  const isolated =
    /^https?:\/\//.test(widget.origin) &&
    new URL(widget.origin).origin === widget.origin &&
    widget.origin !== window.location.origin;
  function start() {
    if (isolated)
      frame.current?.contentWindow?.postMessage(
        { channel: 'pioneer-warranty', kind: 'start', config: widget },
        widget.origin
      );
  }
  useEffect(() => {
    if (!isolated) return;
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== widget.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.channel !== 'pioneer-warranty'
      )
        return;
      if (event.data.kind === 'ready') {
        frame.current?.contentWindow?.postMessage(
          { channel: 'pioneer-warranty', kind: 'start', config: widget },
          widget.origin
        );
        return;
      }
      if (event.data.nonce !== widget.nonce || used.current) return;
      if (
        event.data.kind === 'proof' &&
        typeof event.data.proof === 'string' &&
        event.data.proof.length >= 8 &&
        event.data.proof.length <= 4096
      ) {
        used.current = true;
        onProof(event.data.proof);
      } else if (event.data.kind === 'error') onError();
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [widget, onProof, onError, isolated]);
  if (!isolated)
    return <Notice>华为验证组件必须使用与预约系统不同的独立来源，请联系管理员配置。</Notice>;
  return (
    <>
      <iframe
        ref={frame}
        src={widget.origin + '/index.html'}
        title="华为原厂人工滑块验证"
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        onLoad={start}
        className="warranty-widget"
      />
      <small>仅将原厂挑战参数发送至独立验证视窗，序列号与预约系统登录凭据不发送至该视窗。</small>
    </>
  );
}
