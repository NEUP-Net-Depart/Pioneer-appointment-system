import { test, expect } from './support/fixtures.mjs';
import { chooseOption, loginStaff, staffPage } from './support/staff.mjs';

async function fixture(page, { camera }) {
  await installVirtualCameraRig(page, camera);
  await page.route('**/api/warranty/providers', (route) =>
    route.fulfill({
      json: {
        providers: [
          'asus',
          'acer',
          'lenovo',
          'hp',
          'dell',
          'msi',
          'apple',
          'xiaomi',
          'huawei',
          'mechrevo'
        ].map((id) => ({
          id,
          available: id === 'lenovo',
          mode: ['acer', 'huawei'].includes(id) ? 'captcha' : 'automatic',
          message: id === 'lenovo' ? '已接通联想中国官方服务接口' : '尚未接通自动查询接口'
        }))
      }
    })
  );
  await loginStaff(page, '20261003', 'StaffTest!2026');
  await staffPage(page, '今日工作');
}
async function openLookup(page) {
  await page.getByRole('button', { name: '查询保修', exact: true }).click();
  return page.getByRole('dialog', { name: '查询设备保修', exact: true });
}
async function openCapture(dialog) {
  await dialog.getByRole('button', { name: '打开摄像头识别设备标签' }).click();
}

// Deterministic multi-lens camera rig: canvas-backed tracks with Camera2-like HAL release delays.
async function installVirtualCameraRig(page, initialConfig) {
  await page.addInitScript((config) => {
    const VIVO_UA =
      'Mozilla/5.0 (Linux; Android 14; V2309A Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 VivoBrowser/22.6.0.0';
    const nativeUA = navigator.userAgent;
    const state = {
      mobile: true,
      halBusyWindowMs: 0,
      openDelayMs: 0,
      ignoreDeviceId: false,
      ignoreIdealFacing: false,
      rejectExactFacing: false,
      lenientExactFacing: false,
      denied: false,
      devices: [],
      enumeratedDevices: null,
      barcodes: {},
      activeTrackCount: 0,
      busyRejections: 0,
      lastStoppedAt: -Infinity,
      pendingRequests: 0,
      requests: [],
      opened: [],
      ...config
    };
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => (state.mobile ? VIVO_UA : nativeUA)
    });
    const barcodeBitmaps = new Map();
    async function ensureBarcodeBitmap(codeText) {
      if (barcodeBitmaps.has(codeText)) return barcodeBitmaps.get(codeText);
      const writer = await import('/vendor/zxing-writer.js');
      writer.prepareZXingModule({ overrides: { locateFile: () => '/vendor/zxing_writer.wasm' } });
      const generated = await writer.writeBarcode(codeText, { format: 'Code128', scale: 4 });
      if (generated.error || !generated.image)
        throw new Error('Failed to build barcode bitmap: ' + generated.error);
      const bitmap = await createImageBitmap(generated.image);
      barcodeBitmaps.set(codeText, bitmap);
      return bitmap;
    }
    function extractConstraint(field) {
      if (!field) return { exact: null, ideal: null };
      if (typeof field === 'string') return { exact: null, ideal: field };
      return { exact: field.exact ?? null, ideal: field.ideal ?? null };
    }
    navigator.mediaDevices.enumerateDevices = async () =>
      (state.enumeratedDevices || state.devices).map((item) => ({
        kind: 'videoinput',
        deviceId: item.exposedDeviceId ?? item.id,
        label: item.label ?? '',
        groupId: item.groupId ?? 'group-camera',
        toJSON() {
          return this;
        }
      }));
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      state.pendingRequests++;
      try {
        return await openVirtualStream(constraints);
      } finally {
        state.pendingRequests--;
      }
    };
    async function openVirtualStream(constraints) {
      const video =
        constraints?.video && typeof constraints.video === 'object' ? constraints.video : {};
      const devReq = extractConstraint(video.deviceId);
      const facingReq = extractConstraint(video.facingMode);
      state.requests.push({
        deviceIdExact: devReq.exact,
        facingExact: facingReq.exact,
        facingIdeal: facingReq.ideal,
        widthIdeal: video.width?.ideal ?? null
      });
      if (state.openDelayMs > 0)
        await new Promise((resolve) => setTimeout(resolve, state.openDelayMs));
      if (state.denied) throw new DOMException('Permission denied', 'NotAllowedError');
      const sinceStop = performance.now() - state.lastStoppedAt;
      if (state.halBusyWindowMs > 0 && sinceStop >= 0 && sinceStop < state.halBusyWindowMs) {
        state.busyRejections++;
        throw new DOMException('Could not start video source', 'NotReadableError');
      }
      let chosen = null;
      if (devReq.exact && !state.ignoreDeviceId) {
        chosen = state.devices.find((item) => item.id === devReq.exact) || null;
        if (!chosen) throw new DOMException('Requested device not found', 'NotFoundError');
      } else if (facingReq.exact) {
        if (state.rejectExactFacing)
          throw new DOMException('facingMode is not supported', 'OverconstrainedError');
        chosen =
          state.devices.find((item) => item.facing === facingReq.exact && !item.error) ||
          state.devices.find((item) => item.facing === facingReq.exact) ||
          (state.lenientExactFacing ? state.devices[0] : null) ||
          null;
        if (!chosen) throw new DOMException('Cannot satisfy facingMode', 'OverconstrainedError');
      } else if (facingReq.ideal && !state.ignoreIdealFacing) {
        chosen =
          state.devices.find((item) => item.facing === facingReq.ideal && !item.error) ||
          state.devices.find((item) => !item.error) ||
          state.devices[0] ||
          null;
      } else chosen = state.devices.find((item) => !item.error) || state.devices[0] || null;
      if (!chosen) throw new DOMException('No video input', 'NotFoundError');
      if (chosen.error) throw new DOMException(chosen.error, chosen.error);
      state.opened.push(chosen.id);

      const canvas = document.createElement('canvas');
      canvas.width = 960;
      canvas.height = 540;
      const ctx = canvas.getContext('2d');
      let tick = 0;
      function paintFrame() {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const codeText = state.barcodes[chosen.id];
        const bitmap = codeText ? barcodeBitmaps.get(codeText) : null;
        if (bitmap) {
          const scale = Math.min(1, (canvas.width - 80) / bitmap.width);
          const width = Math.round(bitmap.width * scale);
          const height = Math.round(bitmap.height * scale);
          ctx.drawImage(
            bitmap,
            Math.round((canvas.width - width) / 2),
            Math.round((canvas.height - height) / 2),
            width,
            height
          );
        } else {
          ctx.fillStyle = tick % 2 === 0 ? '#f1f5f9' : '#e2e8f0';
          ctx.fillRect(16, 16, 32, 32);
        }
        tick++;
      }
      paintFrame();
      const stream = canvas.captureStream(15);
      const track = stream.getVideoTracks()[0];
      paintFrame();
      track.requestFrame?.();
      const pump = setInterval(() => {
        paintFrame();
        track.requestFrame?.();
      }, 60);
      state.activeTrackCount++;
      let stopped = false;
      const nativeStop = track.stop.bind(track);
      track.stop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(pump);
        state.activeTrackCount--;
        state.lastStoppedAt = performance.now();
        nativeStop();
      };
      const settings =
        chosen.settings !== undefined
          ? chosen.settings
          : { deviceId: chosen.id, facingMode: chosen.facing, width: 1280, height: 720 };
      track.getSettings = () => ({ ...settings });
      track.getCapabilities = () => ({ ...(chosen.capabilities || {}) });
      Object.defineProperty(track, 'label', {
        configurable: true,
        value: chosen.trackLabel ?? chosen.label ?? ''
      });
      return stream;
    }
    window.__warrantyCameraMock = {
      getState: () => ({
        activeTrackCount: state.activeTrackCount,
        busyRejections: state.busyRejections,
        pendingRequests: state.pendingRequests,
        opened: [...state.opened],
        requests: [...state.requests],
        targets: state.requests.map((r) => r.deviceIdExact || r.facingExact || r.facingIdeal)
      }),
      resetRequests: () => {
        state.requests.length = 0;
        state.opened.length = 0;
      },
      configure: (patch) => {
        Object.assign(state, {
          barcodes: {},
          enumeratedDevices: null,
          ignoreDeviceId: false,
          ignoreIdealFacing: false,
          rejectExactFacing: false,
          lenientExactFacing: false,
          denied: false,
          halBusyWindowMs: 0,
          openDelayMs: 0,
          ...patch
        });
        state.requests.length = 0;
        state.opened.length = 0;
      },
      setBarcode: async (deviceId, codeText) => {
        if (codeText) await ensureBarcodeBitmap(codeText);
        state.barcodes[deviceId] = codeText || null;
      }
    };
  }, initialConfig);
}
const cameraMock = (page) => page.evaluate(() => window.__warrantyCameraMock.getState());
const configureCamera = (page, patch) =>
  page.evaluate((value) => window.__warrantyCameraMock.configure(value), patch);
const resetCameraRequests = (page) =>
  page.evaluate(() => window.__warrantyCameraMock.resetRequests());
const cameraTargets = async (page) => (await cameraMock(page)).targets;
const openedLenses = async (page) => (await cameraMock(page)).opened;
const activeTracks = async (page) => (await cameraMock(page)).activeTrackCount;
const scannerStatus = (dialog) => dialog.locator('.field-scanner p[role="status"]');
const switchLensButton = (dialog) => dialog.getByRole('button', { name: '切换镜头', exact: true });
const preview = (dialog) => dialog.locator('.warranty-capture video');
async function expectLens(page, dialog, mirrored, status = '正在自动识别设备条码…') {
  await expect(preview(dialog)).toHaveAttribute('data-mirrored', String(mirrored));
  await expect(scannerStatus(dialog)).toHaveText(status);
  await expect.poll(() => activeTracks(page)).toBe(1);
}
async function switchLens(page, dialog, mirrored, status) {
  await expect(switchLensButton(dialog)).toBeEnabled();
  await switchLensButton(dialog).click();
  await expectLens(page, dialog, mirrored, status);
  await expect(switchLensButton(dialog)).toBeEnabled();
}
async function reopenCapture(page, dialog, patch) {
  const collapse = dialog.getByRole('button', { name: '收起', exact: true });
  if (await collapse.count()) await collapse.click();
  await expect(dialog.locator('.warranty-capture')).toHaveCount(0);
  await expect.poll(() => activeTracks(page)).toBe(0);
  await configureCamera(page, patch);
  await openCapture(dialog);
}
const vivoLenses = [
  { id: 'back-0', label: 'camera2 0, facing back', facing: 'environment' },
  {
    id: 'back-2',
    label: 'camera2 2, facing back macro',
    facing: 'environment',
    error: 'NotReadableError'
  },
  {
    id: 'back-3',
    label: 'camera2 3, facing back depth',
    facing: 'environment',
    error: 'OverconstrainedError'
  },
  { id: 'front-1', label: 'camera2 1, facing front', facing: 'user' }
];
const blindDual = (settings, { frontFirst = false } = {}) => {
  const lenses = [
    { id: 'rear-id', facing: 'environment', settings },
    { id: 'front-id', facing: 'user', settings }
  ];
  return frontFirst ? lenses.reverse() : lenses;
};

test('vivo multi-camera skips restricted auxiliary sensors, survives HAL release delay across scan/OCR, and scans on the switched lens', async ({
  page
}) => {
  await fixture(page, { camera: { halBusyWindowMs: 180, devices: vivoLenses } });
  const dialog = await openLookup(page);
  await chooseOption(page, dialog.getByLabel('设备品牌'), 'msi');
  await openCapture(dialog);
  await expectLens(page, dialog, false);
  const modes = dialog.getByRole('group', { name: '识别方式' });
  await modes.getByRole('button', { name: 'OCR' }).click();
  await expectLens(page, dialog, false, '正在自动识别文字，也可以拍摄。');
  await modes.getByRole('button', { name: '扫码' }).click();
  await expectLens(page, dialog, false);
  await expect(dialog).not.toContainText('摄像头未能开启');
  expect((await cameraMock(page)).busyRejections).toBeGreaterThan(0);

  await resetCameraRequests(page);
  await switchLens(page, dialog, true);
  await switchLens(page, dialog, false);
  await switchLens(page, dialog, true);
  const targets = await cameraTargets(page);
  expect(targets).not.toContain('back-2');
  expect(targets).not.toContain('back-3');
  expect([...new Set(targets)].sort()).toEqual(['back-0', 'front-1']);
  await page.evaluate(() => window.__warrantyCameraMock.setBarcode('front-1', 'VIVOSN2026'));
  await expect(dialog.getByLabel('序列号 / S/N / Service Tag', { exact: true })).toHaveValue(
    'VIVOSN2026'
  );
  await expect(dialog.locator('.warranty-capture')).toHaveCount(0);
  await expect.poll(() => activeTracks(page)).toBe(0);

  await reopenCapture(page, dialog, {
    devices: [
      { id: 'cam-0', facing: 'environment' },
      { id: 'cam-1', facing: 'environment', error: 'NotReadableError' },
      { id: 'cam-2', facing: 'user', error: 'OverconstrainedError' },
      { id: 'cam-3', facing: 'user' }
    ]
  });
  await expectLens(page, dialog, false);
  await resetCameraRequests(page);
  await switchLens(page, dialog, true);
  const firstSwitch = await cameraTargets(page);
  expect(firstSwitch).toContain('cam-1');
  expect(firstSwitch).toContain('cam-2');
  expect(firstSwitch.at(-1)).toBe('cam-3');
  await resetCameraRequests(page);
  await switchLens(page, dialog, false);
  await switchLens(page, dialog, true);
  expect(await cameraTargets(page)).toEqual(['cam-0', 'cam-3']);
});

test('camera switching handles missing getSettings metadata, ignored deviceId constraints, and single-device mobile vs desktop modes', async ({
  page
}) => {
  await fixture(page, {
    camera: { devices: blindDual({ width: 1280, height: 720 }, { frontFirst: true }) }
  });
  const dialog = await openLookup(page);
  await chooseOption(page, dialog.getByLabel('设备品牌'), 'msi');
  await openCapture(dialog);
  await expectLens(page, dialog, false);
  await switchLens(page, dialog, true);
  await switchLens(page, dialog, false);
  await switchLens(page, dialog, true);
  expect(await openedLenses(page)).toEqual(['rear-id', 'front-id', 'rear-id', 'front-id']);
  expect(await cameraTargets(page)).toEqual(['environment', 'user', 'environment', 'user']);

  await reopenCapture(page, dialog, { devices: blindDual({}), rejectExactFacing: true });
  await expectLens(page, dialog, false);
  await switchLens(page, dialog, true);
  await switchLens(page, dialog, false);
  await switchLens(page, dialog, true);
  expect(await openedLenses(page)).toEqual(['rear-id', 'front-id', 'rear-id', 'front-id']);
  expect((await cameraMock(page)).requests.map((item) => item.deviceIdExact)).toEqual([
    null,
    null,
    null,
    'front-id',
    'rear-id',
    'front-id'
  ]);

  await reopenCapture(page, dialog, {
    devices: blindDual({}),
    ignoreDeviceId: true,
    rejectExactFacing: true
  });
  await expectLens(page, dialog, false);
  await switchLens(page, dialog, true);
  await switchLens(page, dialog, false);
  expect(await openedLenses(page)).toEqual(['rear-id', 'front-id', 'rear-id']);
  const steered = (await cameraMock(page)).requests.filter((item) => item.deviceIdExact);
  expect(steered.map((item) => [item.deviceIdExact, item.facingIdeal])).toEqual([
    ['front-id', 'user'],
    ['rear-id', 'environment']
  ]);

  await reopenCapture(page, dialog, {
    devices: [
      { id: 'id-a', facing: 'environment', settings: { facingMode: 'environment' } },
      { id: 'id-b', facing: 'user', settings: { facingMode: 'user' } }
    ],
    ignoreDeviceId: true,
    ignoreIdealFacing: true
  });
  await expectLens(page, dialog, false);
  await switchLens(page, dialog, true);
  await switchLens(page, dialog, false);
  await switchLens(page, dialog, true);
  expect(await openedLenses(page)).toEqual(['id-a', 'id-b', 'id-a', 'id-b']);

  await reopenCapture(page, dialog, {
    devices: [
      {
        id: 'rear-phys',
        facing: 'environment',
        settings: { deviceId: 'logical-0', facingMode: 'environment' }
      },
      { id: 'front-phys', facing: 'user', settings: { deviceId: 'logical-0', facingMode: 'user' } }
    ],
    enumeratedDevices: [{ id: 'logical-0' }]
  });
  await expectLens(page, dialog, false);
  await switchLens(page, dialog, true);
  await switchLens(page, dialog, false);

  await reopenCapture(page, dialog, { devices: [{ id: 'only-rear', facing: 'environment' }] });
  await expectLens(page, dialog, false);
  await expect(switchLensButton(dialog)).toBeEnabled();
  await switchLensButton(dialog).click();
  await expectLens(page, dialog, false, '当前只有一个可用摄像头。');
  await expect(switchLensButton(dialog)).toBeDisabled();
  await expect(switchLensButton(dialog)).toHaveAttribute('title', '仅检测到一个可用镜头');

  await reopenCapture(page, dialog, {
    devices: [{ id: 'only-cam', settings: { deviceId: 'only-cam', width: 1280, height: 720 } }],
    lenientExactFacing: true
  });
  await expectLens(page, dialog, false);
  await expect(switchLensButton(dialog)).toBeEnabled();
  await switchLensButton(dialog).click();
  await expectLens(page, dialog, false, '当前只有一个可用摄像头。');
  await expect(switchLensButton(dialog)).toBeDisabled();
  expect(await openedLenses(page)).toEqual(['only-cam', 'only-cam']);

  await reopenCapture(page, dialog, { mobile: false, devices: [{ id: 'desk-cam' }] });
  await expectLens(page, dialog, false);
  await expect(switchLensButton(dialog)).toBeDisabled();
  await expect(switchLensButton(dialog)).toHaveAttribute('title', '仅检测到一个可用镜头');
});

test('camera switching recovers or reports errors cleanly on failure and releases tracks when closed mid-switch', async ({
  page
}) => {
  const dual = [
    { id: 'rear-main', label: 'camera2 0, facing back', facing: 'environment' },
    { id: 'front-main', label: 'camera2 1, facing front', facing: 'user' }
  ];
  await fixture(page, {
    camera: { devices: [dual[0], { ...dual[1], error: 'NotReadableError' }] }
  });
  const dialog = await openLookup(page);
  await chooseOption(page, dialog.getByLabel('设备品牌'), 'msi');
  await openCapture(dialog);
  await expectLens(page, dialog, false);
  await switchLens(page, dialog, false, '切换失败，已恢复原镜头。');
  await expect(switchLensButton(dialog)).toHaveAttribute('title', '切换摄像头');

  await configureCamera(page, { denied: true });
  await switchLensButton(dialog).click();
  await expect(scannerStatus(dialog)).toContainText('摄像头未能开启');
  await expect.poll(() => activeTracks(page)).toBe(0);
  await expect(switchLensButton(dialog)).toBeDisabled();

  await reopenCapture(page, dialog, { devices: dual });
  await expectLens(page, dialog, false);
  await configureCamera(page, { devices: dual, openDelayMs: 600 });
  await switchLensButton(dialog).click();
  await expect.poll(async () => (await cameraMock(page)).requests.length).toBe(1);
  expect((await cameraMock(page)).pendingRequests).toBe(1);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await cameraMock(page)).pendingRequests).toBe(0);
  const settled = await cameraMock(page);
  expect(settled.opened).toEqual(['front-main']);
  expect(settled.activeTrackCount).toBe(0);
  expect(settled.requests).toHaveLength(1);
});
