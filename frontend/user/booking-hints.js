import { $ } from '/shared/utils.js';

export function initBookingHints() {
  const warranty = $('[name="warranty"]'), fault = $('[name="faultType"]');
  const updateWarranty = () => {
    const visible = warranty.value === '是';
    $('#warranty-advice').hidden = !visible;
    if (visible) warranty.setAttribute('aria-describedby', 'warranty-advice'); else warranty.removeAttribute('aria-describedby');
  };
  const updateThermal = () => {
    const visible = fault.value === '清灰换硅脂';
    $('#thermal-advice').hidden = !visible;
    if (visible) fault.setAttribute('aria-describedby', 'thermal-advice'); else fault.removeAttribute('aria-describedby');
  };
  const counters = ['issue', 'note'].map(name => {
    const input = $(`[name="${name}"]`), counter = $(`#${name}-count`);
    const update = () => { counter.textContent = `${input.value.length} / ${input.maxLength} 字`; };
    input.addEventListener('input', update);
    return update;
  });
  warranty.addEventListener('change', updateWarranty);
  fault.addEventListener('change', updateThermal);
  const update = () => { updateWarranty(); updateThermal(); counters.forEach(update => update()); };
  $('#booking-form').addEventListener('reset', () => { queueMicrotask(update); });
  window.addEventListener('pageshow', update);
  update();
}
