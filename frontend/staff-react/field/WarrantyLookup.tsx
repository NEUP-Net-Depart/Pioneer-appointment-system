import { track } from '../../../shared/telemetry-client.js';
import { Select } from '../SelectionControls.jsx';
import { useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ChevronUp, Images } from 'lucide-react';
import {
  WARRANTY_BRANDS,
  warrantyBrandId,
  normalizeDeviceSerial,
  isDeviceSerial,
  deviceSerialCandidatesFromText,
  warrantyOfficialDestination,
  warrantyConsumerChannel
} from '../../../shared/warranty.js';
import { ActivityContext, Modal, Notice, api } from './ui';
import { SerialOcr } from './SerialOcr';
import './warranty.css';

type WarrantyStatus = 'unknown' | 'in_warranty' | 'expired';
type Props = { initialBrand?: string; onUseStatus?: (status: WarrantyStatus) => void };
type Provider = {
  id: string;
  available: boolean;
  mode?: 'automatic' | 'captcha';
  message: string;
  captchaOrigin?: string;
};
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
type AlbumResult = { source: 'scan' | 'ocr'; candidates: string[]; raw: string };
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
      <button
        data-track="staff.field.warrantylookup.button.1"
        type="button"
        className="field-secondary"
        onClick={() => setOpen(true)}
      >
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
  const [captureMode, setCaptureMode] = useState<'scan' | 'ocr' | null>(null);
  const [message, setMessage] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerError, setProviderError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [answer, setAnswer] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [albumBusy, setAlbumBusy] = useState(false);
  const [albumNotice, setAlbumNotice] = useState('');
  const [albumResult, setAlbumResult] = useState<AlbumResult | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [officialBlocked, setOfficialBlocked] = useState(false);
  const serialInput = useRef<HTMLInputElement>(null);
  const albumInput = useRef<HTMLInputElement>(null);
  const albumRequest = useRef<AbortController | null>(null);
  const captchaInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const copyAttempt = useRef(0);
  const id = useId();
  const brand = WARRANTY_BRANDS.find((item) => item.id === brandId);
  const provider = providers.find((item) => item.id === brandId);
  const normalized = normalizeDeviceSerial(serial);
  const valid = isDeviceSerial(normalized);
  const destination = warrantyOfficialDestination(brandId, normalized);
  const channel = warrantyConsumerChannel(brandId);
  useEffect(() => {
    const controller = new AbortController();
    api<{ providers: Provider[] }>('/api/warranty/providers', { signal: controller.signal })
      .then((data) =>
        setProviders(
          data.providers.map((item) =>
            item.id === 'huawei' &&
            (!__WARRANTY_CAPTCHA_ORIGIN__ ||
              item.captchaOrigin !== __WARRANTY_CAPTCHA_ORIGIN__ ||
              item.captchaOrigin === window.location.origin)
              ? {
                  ...item,
                  available: false,
                  message: '华为验证配置错误，请联系维护人员。'
                }
              : item
          )
        )
      )
      .catch(() => {
        if (!controller.signal.aborted)
          setProviderError('无法读取自动查询服务状态，请关闭后重试。');
      });
    return () => {
      controller.abort();
      request.current?.abort();
      albumRequest.current?.abort();
      copyAttempt.current++;
    };
  }, []);
  useEffect(() => {
    if (!active) {
      request.current?.abort();
      albumRequest.current?.abort();
      copyAttempt.current++;
      setLoading(false);
      setAlbumBusy(false);
      setCopyBusy(false);
      setCaptcha(null);
      setAnswer('');
    }
  }, [active]);
  useEffect(() => {
    if (captcha && active) captchaInput.current?.focus();
  }, [captcha, active]);
  function invalidate() {
    copyAttempt.current++;
    request.current?.abort();
    request.current = null;
    setLoading(false);
    setResult(null);
    setCaptcha(null);
    setAnswer('');
    setMessage('');
    setCopyFailed(false);
    setCopyBusy(false);
    setOfficialBlocked(false);
  }
  function changeSerial(value: string) {
    invalidate();
    setAlbumResult(null);
    setAlbumNotice('');
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
    if (!destination || !valid || ocrBusy || albumBusy || copyBusy) return;
    const attempt = ++copyAttempt.current;
    const destinationUrl = destination.url;
    if (!copyFailed) {
      setCopyBusy(true);
      setMessage('请在当前页面完成复制授权…');
      try {
        await navigator.clipboard.writeText(normalized);
      } catch {
        if (copyAttempt.current !== attempt) return;
        setCopyBusy(false);
        setCopyFailed(true);
        setOfficialBlocked(false);
        serialInput.current?.focus();
        serialInput.current?.select();
        setMessage('浏览器未允许复制，已选中序列号。请手动复制后再打开官网。');
        return;
      }
      if (copyAttempt.current !== attempt) return;
      setCopyBusy(false);
    }
    // Open only after clipboard permission resolves, so its prompt stays on this page.
    const official = window.open('about:blank', '_blank');
    if (official) {
      official.opener = null;
      const referrer = official.document.createElement('meta');
      referrer.name = 'referrer';
      referrer.content = 'no-referrer';
      official.document.head.append(referrer);
    }
    if (official && !official.closed) {
      official.location.replace(destinationUrl);
      setOfficialBlocked(false);
      setMessage('已在新标签页打开官网。');
    } else {
      setOfficialBlocked(true);
      setMessage('浏览器拦截了新标签页，请点击下方链接打开官网。');
    }
  }
  async function copyOnly() {
    if (!valid || ocrBusy || albumBusy) return;
    try {
      await navigator.clipboard.writeText(normalized);
      setMessage('序列号已复制，请在微信搜索「机械革命服务」小程序，绑定设备后查询。');
    } catch {
      serialInput.current?.focus();
      serialInput.current?.select();
      setMessage('浏览器未允许复制，已选中序列号，请长按手动复制。');
    }
  }
  function applyRecognizedSerial(value: string, source: 'scan' | 'ocr') {
    changeSerial(value);
    setCaptureMode(null);
    serialInput.current?.focus();
    if (source === 'scan' && provider?.available) void query(value);
    else if (source === 'scan')
      setMessage(
        channel?.kind === 'miniapp'
          ? '已识别并填入序列号，请复制后在官方小程序查询。'
          : '已识别并填入序列号，请核对后前往原厂查询。'
      );
  }
  async function scanAlbum(file: File): Promise<boolean> {
    albumRequest.current?.abort();
    const controller = new AbortController();
    albumRequest.current = controller;
    const current = () => albumRequest.current === controller && !controller.signal.aborted;
    const previousMode = captureMode;
    setCaptureMode(null);
    setAlbumBusy(true);
    setAlbumResult(null);
    setAlbumNotice('正在扫描图片…');
    try {
      const { inspectDeviceImage } = await import('./scanner.js');
      const scanned = await inspectDeviceImage(file, current);
      if (!current()) return false;
      if (scanned.candidates.length === 1) {
        applyRecognizedSerial(scanned.candidates[0], 'scan');
        return true;
      }
      if (scanned.candidates.length > 1 || scanned.foundOtherCode) {
        setAlbumResult({
          source: 'scan',
          candidates: scanned.candidates,
          raw: scanned.unrecognizedCodes.join('\n')
        });
        setAlbumNotice(
          scanned.candidates.length
            ? '识别到多个编号，请核对机身序列号后采用。'
            : '扫到编码，但未识别为序列号。可复制原始内容。'
        );
        setCaptureMode(null);
        return true;
      }
      setAlbumNotice('正在识别标签文字…');
      const { recognizeSerialPhoto } = await import('./serial-ocr.js');
      if (!current()) return false;
      const recognized = await recognizeSerialPhoto(file, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (current()) setAlbumNotice(progress);
        }
      });
      if (!current()) return false;
      const raw = recognized.text.trim();
      if (!raw) {
        setAlbumNotice('未识别到编码或文字，请换一张清晰的标签照片。');
        setCaptureMode(previousMode);
        return false;
      }
      const candidates = deviceSerialCandidatesFromText(raw);
      setAlbumResult({ source: 'ocr', candidates, raw });
      setAlbumNotice(
        candidates.length
          ? '未扫到编码，已识别到文字。请核对序列号候选后采用。'
          : '未扫到编码，已识别到文字。可复制后手动填写。'
      );
      setCaptureMode(null);
      return true;
    } catch (error) {
      if (current()) {
        setAlbumNotice(error instanceof Error ? error.message : '图片识别失败，请重试。');
        setCaptureMode(previousMode);
      }
      return false;
    } finally {
      if (albumRequest.current === controller) {
        albumRequest.current = null;
        setAlbumBusy(false);
      }
    }
  }
  return (
    <Modal title="查询设备保修" onClose={onClose} initialFocus="select" className="warranty-dialog">
      <div className="warranty-lookup">
        <label htmlFor={id + '-brand'}>设备品牌</label>
        <Select
          data-track="staff.field.warrantylookup.select.2"
          id={id + '-brand'}
          value={brandId}
          onChange={(event) => {
            invalidate();
            albumRequest.current?.abort();
            setAlbumResult(null);
            setAlbumNotice('');
            setAlbumBusy(false);
            setBrandId(event.target.value);
            setSerial('');
            setOcrBusy(false);
            setCaptureMode(null);
          }}
        >
          <option value="">请选择品牌</option>
          {WARRANTY_BRANDS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
        <Notice>{providerError}</Notice>
        {provider?.id === 'huawei' && !provider.available && <Notice>{provider.message}</Notice>}
        <label htmlFor={id + '-serial'}>序列号 / S/N / Service Tag</label>
        <div className="warranty-serial-control">
          <input
            data-track="staff.field.warrantylookup.input.3"
            ref={serialInput}
            disabled={ocrBusy || albumBusy}
            id={id + '-serial'}
            value={serial}
            maxLength={80}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => changeSerial(event.target.value)}
            placeholder="输入机身序列号"
          />
          <button
            data-track="staff.field.warrantylookup.button.4"
            type="button"
            className="warranty-icon-button"
            title="打开摄像头"
            aria-label="打开摄像头识别设备标签"
            disabled={!brand || ocrBusy || albumBusy}
            aria-expanded={captureMode !== null}
            aria-controls={id + '-capture'}
            onClick={() => setCaptureMode('scan')}
          >
            <Camera aria-hidden="true" size={20} />
          </button>
          <button
            data-track="staff.field.warrantylookup.button.5"
            type="button"
            className="warranty-icon-button"
            title="从相册识别"
            aria-label="从相册识别设备标签"
            disabled={!brand || ocrBusy || albumBusy}
            onClick={() => albumInput.current?.click()}
          >
            <Images aria-hidden="true" size={20} />
          </button>
          <input
            data-track="staff.field.warrantylookup.input.6"
            ref={albumInput}
            type="file"
            accept="image/*"
            aria-label="从相册导入设备标签"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void scanAlbum(file);
            }}
          />
        </div>
        {(albumNotice || albumResult) && (
          <div className="warranty-album-feedback" aria-label="相册识别结果">
            <div role="status" aria-live="polite">
              <Notice>{albumNotice}</Notice>
            </div>
            {albumResult && (
              <>
                {!!albumResult.candidates.length && (
                  <div className="warranty-ocr-actions">
                    {albumResult.candidates.map((value) => (
                      <button
                        data-track="staff.field.warrantylookup.button.7"
                        key={value}
                        type="button"
                        onClick={() => applyRecognizedSerial(value, albumResult.source)}
                      >
                        采用 {value}
                      </button>
                    ))}
                  </div>
                )}
                {!!albumResult.raw && (
                  <div className="warranty-scan-result">
                    <strong>{albumResult.source === 'scan' ? '扫码结果' : '识别文字'}</strong>
                    <pre>{albumResult.raw}</pre>
                    <button
                      data-track="staff.field.warrantylookup.button.8"
                      type="button"
                      className="field-primary"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(albumResult.raw);
                          setAlbumNotice('识别内容已复制。');
                        } catch {
                          setAlbumNotice('浏览器未允许复制，请长按上方内容手动复制。');
                        }
                      }}
                    >
                      复制识别内容
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {captureMode && (
          <section id={id + '-capture'} className="warranty-capture" aria-label="摄像头预览">
            <header className="warranty-capture-header">
              <h3>识别设备标签</h3>
              <div className="warranty-capture-header-actions">
                <div className="warranty-mode-switch" role="group" aria-label="识别方式">
                  <button
                    data-track="staff.field.warrantylookup.button.9"
                    type="button"
                    aria-pressed={captureMode === 'scan'}
                    onClick={() => setCaptureMode('scan')}
                  >
                    扫码
                  </button>
                  <button
                    data-track="staff.field.warrantylookup.button.10"
                    type="button"
                    aria-pressed={captureMode === 'ocr'}
                    onClick={() => setCaptureMode('ocr')}
                  >
                    OCR
                  </button>
                </div>
                <button
                  data-track="staff.field.warrantylookup.button.11"
                  type="button"
                  className="warranty-collapse"
                  onClick={() => setCaptureMode(null)}
                >
                  <ChevronUp aria-hidden="true" size={18} />
                  收起
                </button>
              </div>
            </header>
            <SerialOcr
              key={`${brandId}-${captureMode}`}
              mode={captureMode}
              onSerial={(value) => applyRecognizedSerial(value, captureMode)}
              onBusy={setOcrBusy}
              onAlbumImage={scanAlbum}
            />
          </section>
        )}
        {!!serial && !valid && (
          <Notice>请输入 4–40 位英数字、连字符或斜线，请勿输入型号、MAC 地址或预约编号。</Notice>
        )}
        {provider?.available && !captcha && (
          <button
            data-track="staff.field.warrantylookup.button.12"
            type="button"
            className="field-primary warranty-primary"
            disabled={!valid || ocrBusy || loading}
            onClick={() => void query()}
          >
            {loading
              ? '正在连接原厂…'
              : provider?.mode === 'captcha'
                ? '获取原厂验证码'
                : '查询原厂保修'}
          </button>
        )}
        {brand && !provider?.available && channel?.kind !== 'miniapp' && (
          <button
            data-track="staff.field.warrantylookup.button.13"
            type="button"
            className="field-primary warranty-primary"
            disabled={!valid || ocrBusy || albumBusy || copyBusy || loading}
            onClick={() => void copyAndGo()}
          >
            {copyBusy
              ? '等待复制授权…'
              : copyFailed
                ? '手动复制后打开官网'
                : '复制序列号并前往官网'}
          </button>
        )}
        {brand && channel?.kind === 'miniapp' && (
          <button
            data-track="staff.field.warrantylookup.button.14"
            type="button"
            className="field-primary warranty-primary"
            disabled={!valid || ocrBusy || loading}
            onClick={() => void copyOnly()}
          >
            复制序列号，前往微信查询
          </button>
        )}
        {officialBlocked && destination && (
          <a
            data-track="staff.field.warrantylookup.a.15"
            href={destination.url}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
          >
            在新标签页打开官网 ↗
          </a>
        )}
        {brand && channel && (
          <section className="warranty-fallback" aria-label="查验步骤">
            <h3>查验步骤</h3>
            <strong>{channel.title}</strong>
            <ol className="warranty-channel-steps">
              {channel.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {provider?.available && valid && (
              <button
                data-track="staff.field.warrantylookup.button.16"
                type="button"
                disabled={copyBusy || albumBusy || ocrBusy}
                onClick={() => void copyAndGo()}
              >
                {copyBusy
                  ? '等待复制授权…'
                  : copyFailed
                    ? '手动复制后打开官网'
                    : '复制序列号并前往官网'}
              </button>
            )}
            <a
              data-track="staff.field.warrantylookup.a.17"
              href={brand.url}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >
              打开官方保修入口 ↗
            </a>
          </section>
        )}
        {captcha && (
          <fieldset className="warranty-captcha">
            <legend>原厂人工验证</legend>
            <button
              data-track="staff.field.warrantylookup.button.18"
              type="button"
              className="field-secondary"
              disabled={loading}
              onClick={() => void query()}
            >
              重新获取验证码
            </button>
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
                  data-track="staff.field.warrantylookup.input.19"
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
                  验证码有效至 {new Date(captcha.expiresAt).toLocaleTimeString('zh-CN')}。
                </small>
                <button
                  data-track="staff.field.warrantylookup.button.20"
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
              {result.outcome === 'not_found' ? '原厂未查到保修信息' : statusLabels[result.status]}
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
                    data-track="staff.field.warrantylookup.button.21"
                    type="button"
                    onClick={() => {
                      onUseStatus(result.status);
                      onClose();
                    }}
                  >
                    填入此保修情况
                  </button>
                )}
              </>
            )}
          </section>
        )}
        <details data-track="staff.field.warrantylookup.details.22" className="warranty-privacy">
          <summary data-track="staff.field.warrantylookup.summary.23">数据使用说明</summary>
          <p>
            文字照片仅在本机识别，不上传。查询时序列号经后台发送给原厂；部分官方链接会带入序列号。序列号不会写入预约记录。
          </p>
        </details>
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
    widget.origin === __WARRANTY_CAPTCHA_ORIGIN__ &&
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
      if (event.data.nonce !== widget.nonce) return;
      if (event.data.kind === 'telemetry') {
        const result = event.data.result;
        if (['start', 'ok', 'error', 'cancelled'].includes(result))
          track('flow.result', { view: 'verifier', control: 'captcha', result });
        return;
      }
      if (used.current) return;
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
    </>
  );
}
