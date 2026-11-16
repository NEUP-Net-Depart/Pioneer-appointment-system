import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { courses, track } from './courses.js';
import { simulation, samplePhoto } from './simulation/api.js';
import { qrImage } from './simulation/zxing.js';
import { journeysFor } from './journeys.js';

const aliases = {
  '.capacity-page': '.capacity-editor',
  '.attendance-management': '.duty-day',
  '.booking-settings': '.booking-settings-editor',
  '.roster-person-picker': '.duty-people-picker',
  '.roster-invitations': '.schedule-card',
  '.unsaved-changes-dialog': 'dialog[open]:has(.workspace-unsaved-actions)',
  '.field-photo-expanded': 'dialog[open]:has(.field-photo-enlarged)',
  '.repair-support': '.repair-official',
  '.repair-relations': '.field-form:has([data-track="staff.repairrelations.select.5"])',
  '.duty-correction-form': '[data-track="staff.attendancemanagement.form.9"]'
};
const params = new URLSearchParams(location.search);
const session = params.get('session');
const isJourney = !!params.get('journey');
const course = isJourney
  ? journeysFor(simulation.state.profile).find((item) => item.id === params.get('journey'))
  : courses.find((item) => item.id === params.get('lesson'));
const delay = (duration = 120) => new Promise((resolve) => setTimeout(resolve, duration));
const visible = (element) =>
  element instanceof HTMLElement &&
  !element.closest('[hidden], [inert]') &&
  getComputedStyle(element).visibility !== 'hidden' &&
  (element.getClientRects().length > 0 || (element.tagName === 'INPUT' && element.type === 'file'));
const cleanText = (value) => value.replace(/\s+/g, ' ').trim();
let activeStep = -1;
let requests = [];
let errorCount = 0;
let downloadCount = 0;
let busy = false;
let automatic = false;
let guide;
let completionObserver;
let resizeObserver;
let stepRequestStart = 0;
let stepErrorStart = 0;
let stepDownloadStart = 0;
let presentation;
const preparedSteps = new Set();
const interactedSteps = new Set();
export function setPresentation(value) {
  presentation = value;
}
export function updatePresentation({ loading = false } = {}) {
  const button = document.querySelector('.tutorial-popover .driver-popover-next-btn');
  if (!button || !presentation) return;
  button.disabled = loading;
  button.setAttribute('aria-busy', String(loading));
  button.textContent = loading ? '正在演示…' : presentation.final ? '完成' : '下一步';
}
const requestMatches = (item, expected) =>
  item.path.includes(expected) &&
  (expected === '/api/attendance/weekly-summary' || item.method !== 'GET');

function send(type, data = {}) {
  window.parent.postMessage(
    { channel: 'pioneer-academy', session, type, ...data },
    location.origin
  );
}

export function find(target, { all = false } = {}) {
  if (!target) return null;
  target = aliases[target] || target;
  let matches;
  if (target.startsWith('text=')) {
    const value = target.slice(5);
    const controls = [...document.querySelectorAll('button,a,summary,[role="tab"],[role="option"]')]
      .filter(visible)
      .filter((element) => !element.closest('.driver-popover'));
    const exact = controls.filter(
      (element) =>
        cleanText(element.textContent) === value || element.getAttribute('aria-label') === value
    );
    matches = exact.length
      ? exact
      : controls.filter(
          (element) =>
            cleanText(element.textContent).includes(value) ||
            element.getAttribute('aria-label')?.includes(value)
        );
    if (matches.some((element) => element.closest('.workspace-section-nav')))
      matches = matches.filter((element) => element.closest('.workspace-section-nav'));
  } else if (target.startsWith('label=')) {
    const value = target.slice(6);
    const labels = [...document.querySelectorAll('label')].filter(visible);
    const matching =
      labels.find(
        (element) =>
          cleanText(
            [...element.childNodes]
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => node.textContent)
              .join(' ')
          ) === value
      ) || labels.find((element) => cleanText(element.textContent).startsWith(value));
    matches = matching
      ? [matching.control || matching.querySelector('input,textarea,[role="combobox"],button')]
      : [];
  } else matches = [...document.querySelectorAll(target)].filter(visible);
  const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
  if (dialog && matches.some((element) => dialog.contains(element)))
    matches = matches.filter((element) => dialog.contains(element));
  return all ? matches : matches[0] || null;
}

async function until(check, description, timeout = 7000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = check();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`没有找到「${description}」。请检查当前页面，或重新开始流程。`);
}

async function get(target) {
  return until(() => find(target), target);
}

async function clickTarget(target) {
  const element = await get(target);
  await until(
    () => !element.matches(':disabled') && element.getAttribute('aria-disabled') !== 'true',
    cleanText(element.textContent) || target
  );
  element.scrollIntoView({ block: 'center', behavior: 'instant' });
  element.focus({ preventScroll: true });
  element.click();
  await delay();
}

async function fillTarget(target, value) {
  const element = await get(target);
  const prototype =
    element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
  setter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  await delay(60);
}

async function chooseTarget(target, value) {
  await clickTarget(target);
  const option = await until(
    () =>
      [...document.querySelectorAll('[role="option"]')]
        .filter(visible)
        .find((element) => cleanText(element.textContent).includes(value)),
    value
  );
  option.click();
  await delay();
}

async function check(target) {
  const element = await get(target);
  if (!element.checked) await clickTarget(target);
}

async function submit(target) {
  const form = await get(target);
  if (!form.reportValidity()) throw new Error('请先完成高亮表单中的必填项。');
  form.requestSubmit();
  await delay();
}

async function navigate(view) {
  window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: view }));
  const targets = {
    'scene:today': '.today-scene',
    'scene:mine': '.personal-workspace',
    staff: '.records-workspace',
    duties: '.duty-workspace',
    members: '.people-workspace',
    capacity: '.capacity-editor',
    stats: '.report-workspace',
    settings: '.security-layout',
    permissions: '.permissions-workspace'
  };
  await get(targets[view] || '.field-content');
  await delay(200);
}

async function uploadPhoto(side) {
  const inputs = [
    ...document.querySelectorAll(
      'input[type="file"][data-track="staff.field.intakephotos.input.2"]'
    )
  ].filter((element) => !element.parentElement.closest('[hidden]'));
  const input = inputs.find((element) =>
    element
      .getAttribute('aria-label')
      ?.includes(side === 'front' ? '正面' : side === 'back' ? '背面' : '补充')
  );
  if (!input) throw new Error('当前操作区没有对应的照片选择控件。');
  const data = new DataTransfer();
  data.items.add(new File([await samplePhoto()], `演示设备${side}.jpg`, { type: 'image/jpeg' }));
  input.files = data.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await delay(200);
}

async function signature() {
  const canvas = await get('canvas[aria-label="机主签名"]');
  const bounds = canvas.getBoundingClientRect();
  const points = [
    [0.17, 0.43],
    [0.24, 0.35],
    [0.2, 0.66],
    [0.36, 0.44],
    [0.31, 0.65],
    [0.48, 0.35],
    [0.43, 0.7],
    [0.64, 0.42],
    [0.57, 0.66],
    [0.74, 0.56]
  ];
  const dispatch = (type, point, buttons) =>
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 1,
        pointerType: 'pen',
        isPrimary: true,
        pressure: 0.5,
        buttons,
        button: 0,
        clientX: bounds.left + bounds.width * point[0],
        clientY: bounds.top + bounds.height * point[1]
      })
    );
  dispatch('pointerdown', points[0], 1);
  for (const point of points.slice(1)) {
    await delay(25);
    dispatch('pointermove', point, 1);
  }
  dispatch('pointerup', points.at(-1), 0);
}

async function command(action) {
  switch (action.type) {
    case 'closeTopDialog': {
      const dialog = [...document.querySelectorAll('dialog[open]')]
        .filter((element) => !element.matches('.tutorial-start-dialog, .driver-popover'))
        .at(-1);
      const button = dialog?.querySelector(':scope > header > button');
      if (!button) throw new Error('当前窗口没有关闭入口。');
      await until(() => !button.disabled, '当前操作保存完成');
      button.click();
      await delay();
      return;
    }
    case 'attendanceImage': {
      const input = document.querySelector('dialog[open] input[type="file"]');
      if (!input) throw new Error('没有找到签到码的相册识别入口。');
      const files = new DataTransfer();
      files.items.add(
        new File([await qrImage('pioneer:attendance:v1:demo-tutorial')], '演示签到码.png', {
          type: 'image/png'
        })
      );
      input.files = files.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await get(track('staff.field.fieldapp.button.5'));
      return;
    }
    case 'navigate':
      return navigate(action.view);
    case 'closeDialogs': {
      for (let attempt = 0; attempt < 8; attempt++) {
        const dialog = [...document.querySelectorAll('dialog[open]')]
          .filter((element) => !element.classList.contains('tutorial-start-dialog'))
          .at(-1);
        if (!dialog) return;
        if (dialog.querySelector('.workspace-unsaved-actions'))
          throw new Error('请先在原页面处理未保存内容，再继续引导。');
        const button = dialog.querySelector(':scope > header > button');
        if (!button) throw new Error('请先完成当前操作。');
        await until(() => !button.disabled, '当前操作保存完成');
        button.click();
        await delay(120);
      }
      return;
    }
    case 'simulateApplication': {
      const member = simulation.state.members.find(
        (item) => item.memberId === simulation.state.activeMemberId
      );
      simulation.state.activations = [
        {
          ...simulation.state.activations[0],
          id: 'new-member-application',
          memberId: member.memberId,
          name: member.name,
          studentId: member.studentId,
          account: member.studentId,
          status: 'pending',
          revision: 1,
          authorizedCampuses: ['南湖']
        }
      ];
      return;
    }
    case 'logout': {
      if (find('#login-form')) return;
      await navigate('scene:mine');
      await clickTarget(track('staff.field.personalscene.button.1'));
      return get('#login-form');
    }
    case 'approveActivation':
      simulation.state.activations[0].status = 'approved';
      return;
    case 'click':
      return clickTarget(action.target);
    case 'clickText':
      return clickTarget(`text=${action.value}`);
    case 'fill':
      return fillTarget(action.target, action.value);
    case 'choose':
      return chooseTarget(action.target, action.value);
    case 'check':
      return check(action.target);
    case 'submit':
      return submit(action.target);
    case 'upload':
      return uploadPhoto(action.side);
    case 'signature':
      return signature();
    case 'failNext':
      simulation.state.failNext = true;
      return;
    case 'selectOrder':
      simulation.state.activeOrderId = simulation.state.orders[action.index].id;
      return;
    case 'currentOrder': {
      if (
        find('.repair-summary')?.textContent.includes(simulation.state.activeOrderId) &&
        document.querySelectorAll('dialog[open]').length === 1
      )
        return;
      await command({ type: 'closeDialogs' });
      return command({ type: 'order', current: true });
    }
    case 'order': {
      const id = action.current
        ? simulation.state.activeOrderId
        : simulation.state.orders[action.index].id;
      if (isJourney) simulation.state.activeOrderId = id;
      const todayButton = [...document.querySelectorAll('.today-order')]
        .filter(visible)
        .find((element) => element.textContent.includes(id));
      if (!todayButton) {
        await navigate('staff');
        if (
          isJourney &&
          ![...document.querySelectorAll('.records-table tbody tr')].some((element) =>
            element.textContent.includes(id)
          )
        )
          await fillTarget(track('staff.records.input.4'), id);
      }
      const target =
        todayButton ||
        (await until(
          () =>
            [...document.querySelectorAll('.records-table tbody tr')]
              .filter(visible)
              .find((element) => element.textContent.includes(id))
              ?.querySelector('button'),
          id
        ));
      target.click();
      await get('.repair-order-dialog');
      await until(() => find('.repair-summary')?.textContent.includes(id), '工单详情');
      return;
    }
    case 'campus':
      return clickTarget(track('staff.field.todayworkwindow.campus'));
    case 'searchOpen':
      return clickTarget(track('staff.field.todayscene.search.open'));
    case 'recordFilter':
      return clickTarget('text=筛选');
    case 'more':
      return clickTarget(track('staff.workspacemoreactions.summary.2'));
    case 'registration': {
      const inputs = [
        ...document.querySelectorAll(track('staff.field.registration.input.2'))
      ].filter(visible);
      for (const [index, value] of [
        '示例机主',
        '20269999',
        '10000001',
        'Lenovo',
        'ThinkBook 14'
      ].entries()) {
        inputs[index].setAttribute('data-tutorial-field', String(index));
        await fillTarget(`[data-tutorial-field="${index}"]`, value);
      }
      return fillTarget(
        track('staff.field.registration.textarea.4'),
        '启动后蓝屏，请帮助检查系统。'
      );
    }
    case 'replacePhoto': {
      await clickTarget('dialog[open]:last-of-type > header button');
      return uploadPhoto('front');
    }
    case 'link': {
      await fillTarget(
        track('staff.repairrelations.input.7'),
        simulation.state.orders[isJourney ? 1 : 0].id
      );
      await check(track('staff.repairrelations.input.6'));
      return clickTarget(track('staff.repairrelations.button.8'));
    }
    case 'warrantyFill': {
      await chooseTarget(track('staff.field.warrantylookup.select.2'), '联想');
      return fillTarget(track('staff.field.warrantylookup.input.3'), 'PF4DEMO26');
    }
    case 'external': {
      const anchor = await get(action.target);
      send('external', { url: anchor.href, label: cleanText(anchor.textContent) });
      return;
    }
    case 'checkin': {
      const home = simulation.home(new URLSearchParams());
      if (home.attendance) return;
      const button =
        find(track('staff.field.attendanceactions.button.1')) ||
        find(track('staff.field.todayworkwindow.attendance'));
      if (!button) throw new Error('当前页面没有本人签到入口。');
      button.click();
      await delay(200);
      if (!home.directAttendance.allowed) {
        const input = document.querySelector('dialog[open] input[type="file"]');
        if (!input) throw new Error('没有找到签到码的相册识别入口。');
        const files = new DataTransfer();
        files.items.add(
          new File([await qrImage('pioneer:attendance:v1:demo-tutorial')], '演示签到码.png', {
            type: 'image/png'
          })
        );
        input.files = files.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await clickTarget('text=确认签到');
      }
      await until(() => simulation.state.attendances.length, '签到完成');
      const close = find('dialog[open] > header button');
      if (close) close.click();
      await delay();
      return;
    }
    case 'scanOrder': {
      const input = document.querySelector('dialog[open] input[type="file"]');
      if (!input) throw new Error('没有找到扫码相册入口。');
      const data = new DataTransfer();
      data.items.add(
        new File(
          [
            await qrImage(
              isJourney ? simulation.state.activeOrderId : simulation.state.orders[0].id
            )
          ],
          '演示维修码.png',
          { type: 'image/png' }
        )
      );
      input.files = data.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    case 'ocrPhoto': {
      const input = document.querySelector(track('staff.field.warrantylookup.input.6'));
      const data = new DataTransfer();
      data.items.add(new File([await samplePhoto()], '演示设备标签.jpg', { type: 'image/jpeg' }));
      input.files = data.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await get(track('staff.field.warrantylookup.button.7'));
      return;
    }
    case 'attendanceTime': {
      await fillTarget('input[data-track="staff.attendancemanagement.input.11"]', '19:10');
      const confirm = find('text=确认时间');
      if (confirm) confirm.click();
      return;
    }
    case 'discardRoster': {
      await clickTarget(track('staff.dutyplanner.button.8'));
      const discard = find('text=放弃草稿');
      if (discard) discard.click();
      await delay();
      return;
    }
    case 'roleGrant': {
      const inputs = find(track('staff.permissions.input.5'), { all: true });
      const unchecked = inputs.find((element) => !element.checked);
      if (!unchecked) throw new Error('没有可添加的演示系统权限。');
      unchecked.click();
      await delay();
      return;
    }
    case 'profileFill':
      return fillTarget('.personal-profile input:not([readonly])', '林知行（练习）');
    case 'plannerPick':
      return clickTarget(track('staff.dutyplanner.button.10'));
    case 'plannerChoose': {
      await clickTarget(track('staff.dutyplanner.input.11'));
      return clickTarget(track('staff.dutyplanner.button.12'));
    }
    case 'correctionFill': {
      if (find(track('staff.attendancemanagement.select.10')))
        await chooseTarget(
          track('staff.attendancemanagement.select.10'),
          isJourney ? '温言' : '陈一帆'
        );
      return fillTarget(track('staff.attendancemanagement.input.12'), '已核实现场到岗，补记漏签。');
    }
    case 'seedAttendance': {
      if (isJourney) return clickTarget(track('staff.attendancemanagement.button.6'));
      await simulation.request('/api/attendance/corrections', 'POST', {
        memberId: 'demo-chen',
        businessDate: simulation.state.today,
        campusId: 'campus-nanhu',
        reason: '演示来源'
      });
      simulation.state.attendances.at(-1).checkinSource = { kind: 'qr', issuerName: '周宁' };
      return clickTarget(track('staff.attendancemanagement.button.6'));
    }
    case 'memberOpen': {
      const memberName = isJourney
        ? simulation.state.members.find((item) => item.memberId === simulation.state.activeMemberId)
            ?.name
        : '陈一帆';
      const button = await until(
        () =>
          [...document.querySelectorAll('.members-results .react-row')]
            .filter(visible)
            .find((element) => element.textContent.includes(memberName))
            ?.querySelector('button'),
        '示例成员'
      );
      button.click();
      await get(track('staff.membereditor.form.3'));
      return;
    }
    case 'membershipFill':
      return check('label=维修事务');
    case 'accountOpen': {
      const accountId = simulation.state.accounts.find(
        (item) => item.memberId === (isJourney ? simulation.state.activeMemberId : 'demo-chen')
      )?.account;
      const button = [...document.querySelectorAll('.account-list button')]
        .filter(visible)
        .find((element) => element.closest('article')?.textContent.includes(accountId));
      if (!button) throw new Error('没有找到可管理的普通演示账号。');
      button.click();
      await get(track('staff.accounts.form.7'));
      return;
    }
    case 'capacityReview':
      return clickTarget(track('staff.capacityeditor.button.28'));
    case 'capacitySave':
      return clickTarget(track('staff.capacityeditor.button.30'));
    case 'locationEdit':
      return fillTarget(
        track('staff.servicelocationeditor.textarea.5'),
        '图书馆一楼服务区（演示）'
      );
    case 'locationSave': {
      await clickTarget(track('staff.servicelocationeditor.button.9'));
      return clickTarget(track('staff.servicelocationeditor.button.12'));
    }
    case 'serviceDayPick':
      return clickTarget(track('staff.servicedayeditor.button.3'));
    case 'serviceDayPause': {
      await clickTarget(track('staff.servicedayeditor.button.6'));
      return clickTarget(track('staff.servicedayeditor.button.10'));
    }
    case 'releaseFill':
      return fillTarget('input[data-track="staff.bookingsettingseditor.input.4"]', '13:00');
    case 'noticeFill': {
      await fillTarget(track('staff.bookingsettingseditor.input.10'), '本周维修安排');
      return fillTarget(
        track('staff.bookingsettingseditor.textarea.11'),
        '本周按正常时间维修，请提前备份资料。'
      );
    }
    case 'roleOpen':
      return clickTarget('.react-permission-layout aside button');
    case 'reportRuleFill':
      return fillTarget('.report-settings input[type="number"]', '2.5');
    default:
      throw new Error(`未实现的教程动作：${action.type}`);
  }
}

export function stopHighlight() {
  completionObserver?.disconnect();
  resizeObserver?.disconnect();
  guide?.destroy();
  guide = null;
}

export async function highlight(index) {
  stopHighlight();
  if (activeStep !== index) {
    stepRequestStart = requests.length;
    stepErrorStart = errorCount;
    stepDownloadStart = downloadCount;
  }
  activeStep = index;
  const step = course?.steps[index];
  if (!step) return;
  if (step.before?.length && !preparedSteps.has(index)) {
    for (const action of step.before) await command(action);
    preparedSteps.add(index);
  }
  let element = await get(step.target);
  const modal = [...document.querySelectorAll('dialog[open]')]
    .filter((item) => !item.matches('.tutorial-start-dialog, .driver-layer, .driver-popover'))
    .at(-1);
  if (presentation && modal && element.contains(modal))
    element = modal.querySelector(':scope > :not(header):not(.driver-layer)') || element;
  element.scrollIntoView({ block: 'center', behavior: 'instant' });
  guide = driver({
    animate: !matchMedia('(prefers-reduced-motion: reduce)').matches,
    overlayOpacity: 0.34,
    stagePadding: 7,
    stageRadius: 9,
    allowClose: false,
    disableActiveInteraction: !!presentation,
    smoothScroll: false,
    focus: presentation && !element.closest('.today-search-anchor') ? 'popover' : 'none',
    popoverClass: 'tutorial-popover',
    allowedElements: () =>
      document.querySelectorAll('.tutorial-controls, .tutorial-error, .tutorial-notice'),
    onPopoverRender: (popover) => {
      if (presentation) {
        const exit = document.createElement('button');
        exit.type = 'button';
        exit.className = 'tutorial-exit';
        exit.textContent = '退出引导';
        exit.addEventListener('click', presentation.onExit);
        popover.nextButton.before(exit);
      }
      popover.wrapper.addEventListener('pointerdown', (event) => {
        if (document.querySelector('.today-search-panel')) event.preventDefault();
      });
    }
  });
  guide.highlight({
    element,
    ...(presentation
      ? {
          popover: {
            title: step.title,
            side: innerWidth < 600 ? 'bottom' : 'right',
            showButtons: ['next'],
            showProgress: true,
            progressText: `${presentation.index + 1} / ${presentation.total}`,
            nextBtnText: presentation.final ? '完成' : '下一步',
            onNextClick: () => presentation.onNext(index)
          }
        }
      : {})
  });
  resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => guide?.refresh()));
  resizeObserver.observe(element);
  if (step.expect && !presentation) {
    let notified = false;
    completionObserver = new MutationObserver(() => {
      if (!notified && !busy && activeStep === index && satisfied()) {
        notified = true;
        send('interacted', { index, satisfied: true });
      }
    });
    completionObserver.observe(document.body, { childList: true, subtree: true });
  }
  send('highlighted', { index });
}

function satisfied() {
  const step = course?.steps[activeStep];
  if (!step?.action) return true;
  if (step.expect?.request)
    return requests
      .slice(stepRequestStart)
      .some((item) => requestMatches(item, step.expect.request));
  if (step.expect?.error) return errorCount > stepErrorStart;
  if (step.expect?.download) return downloadCount > stepDownloadStart;
  if (step.expect?.photos) return find('.field-photo-preview', { all: true }).length >= 2;
  if (step.expect?.signature) {
    const canvas = document.querySelector('canvas[aria-label="机主签名"]');
    if (!canvas || !document.querySelector(track('staff.field.registration.input.7'))?.checked)
      return false;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, index) => index % 4 === 3 && value > 0 && pixels[index - 1] < 220);
  }
  if (step.expect?.target) return !!find(step.expect.target);
  return interactedSteps.has(activeStep);
}

function inspectInteraction(event) {
  if (presentation || busy || activeStep < 0) return;
  const target = find(course.steps[activeStep].target);
  if (
    !target?.contains(event.target) &&
    target !== event.target &&
    !course.steps[activeStep].expect
  )
    return;
  const index = activeStep;
  setTimeout(() => {
    interactedSteps.add(index);
    guide?.updatePopover({ nextBtnText: '继续' });
    if (index === activeStep && !busy)
      send('interacted', { index, satisfied: !course.steps[index]?.expect || satisfied() });
  }, 250);
}
document.addEventListener('change', inspectInteraction);
document.addEventListener('input', inspectInteraction);
document.addEventListener('click', inspectInteraction);
document.addEventListener('pointerup', inspectInteraction);

export async function perform(index, auto = false) {
  if (busy) return;
  busy = true;
  automatic = auto;
  const step = course.steps[index];
  const startRequests = requests.length;
  const startErrors = errorCount;
  const startDownloads = downloadCount;
  stopHighlight();
  try {
    for (const action of step.action || []) await command(action);
    if (step.expect?.request)
      await until(
        () =>
          requests.slice(startRequests).some((item) => requestMatches(item, step.expect.request)),
        '操作保存成功'
      );
    if (step.expect?.target) await get(step.expect.target);
    if (step.expect?.error) await until(() => errorCount > startErrors, '失败反馈');
    if (step.expect?.download) await until(() => downloadCount > startDownloads, '文件生成');
    if (step.expect?.photos)
      await until(() => find('.field-photo-preview', { all: true }).length >= 2, '正反面照片预览');
    await until(
      () =>
        ![...document.querySelectorAll('button[disabled]')]
          .filter(visible)
          .some((element) => /正在保存|正在提交|发布中/.test(element.textContent)),
      '页面完成保存'
    );
    await delay(200);
    send('performed', { index });
    return true;
  } finally {
    busy = false;
    automatic = false;
  }
}

export function currentSatisfied() {
  return satisfied();
}

let initialization;
export function initialize() {
  initialization ||= (async () => {
    await get(course?.id === 'activation' ? '#activation-form' : '.today-scene');
    if (course) for (const action of course.prepare) await command(action);
    send('ready', { lesson: course?.id });
  })();
  return initialization;
}

window.addEventListener('tutorial-request', (event) => {
  requests.push(event.detail);
  send('request', { path: event.detail.path, method: event.detail.method });
  if (!busy && satisfied()) send('interacted', { index: activeStep, satisfied: true });
});
window.addEventListener('tutorial-api-error', (event) => {
  errorCount++;
  send('api-error', event.detail);
});
window.addEventListener('tutorial-render-error', (event) =>
  send('render-error', { message: event.detail })
);
window.addEventListener('message', async (event) => {
  if (
    event.origin !== location.origin ||
    event.source !== window.parent ||
    event.data?.channel !== 'pioneer-academy' ||
    event.data.session !== session
  )
    return;
  try {
    if (event.data.type === 'highlight') await highlight(event.data.index);
    if (event.data.type === 'perform') await perform(event.data.index, event.data.automatic);
    if (event.data.type === 'explore') stopHighlight();
  } catch (error) {
    send('error', { message: error.message, index: event.data.index });
  }
});

const originalClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () {
  if (this.download) {
    downloadCount++;
    send('download', { filename: this.download, automatic });
    if (automatic) return;
  }
  return originalClick.call(this);
};

document.addEventListener(
  'click',
  (event) => {
    const anchor = event.target.closest?.('a');
    if (!anchor || anchor.download) return;
    if (
      anchor.origin === location.origin &&
      anchor.pathname === `${import.meta.env.BASE_URL}staff/` &&
      !anchor.search &&
      isJourney
    ) {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: 'scene:today' }));
      return;
    }
    if (anchor.origin !== location.origin || anchor.pathname === '/') {
      event.preventDefault();
      send('external', { url: anchor.href, label: cleanText(anchor.textContent) });
    }
  },
  true
);
window.open = (url) => {
  send('external', { url: String(url), label: '外部页面' });
  return null;
};
window.__tutorial = {
  simulation,
  course,
  find,
  command,
  perform,
  highlight,
  initialize,
  get requests() {
    return requests;
  }
};
