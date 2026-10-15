import React from 'react';

// Shared by role grants and member bindings. Unknown extension fields survive edits.
export function ScopeFields({ value = {}, onChange, campuses = [], departments = [], kinds = ['campus', 'department'], inherit = '沿用角色范围' }) {
  function update(key, alias, next) {
    const scope = { ...value }; delete scope[key]; delete scope[alias]; delete scope.all;
    if (next !== null) scope[key] = next;
    onChange(scope);
  }
  return <div className="react-scope-fields">{[['campus', 'campusIds', 'campuses', '校区', campuses], ['department', 'departmentIds', 'departments', '部门', departments]].filter(([kind]) => kinds.includes(kind)).map(([, key, alias, label, options]) => {
    const values = value[key] ?? value[alias];
    const explicit = Array.isArray(values);
    return <fieldset key={key}><legend>{label}范围</legend>
      <label className="react-check"><input type="checkbox" checked={!explicit} onChange={event => update(key, alias, event.target.checked ? null : [])} />{inherit}</label>
      {explicit && <><div className="react-campus-options">{options.map(option => <label className="react-check" key={option.id}>
        <input type="checkbox" checked={values.includes(option.id)} onChange={event => update(key, alias, event.target.checked ? [...values, option.id] : values.filter(id => id !== option.id))} />{option.name}
      </label>)}</div>{!values.length && <p className="react-muted">尚未选择{label}，此范围不会匹配任何成员。</p>}</>}
    </fieldset>;
  })}</div>;
}

const parameterLabels = { kind: '指定岗位', roleKinds: '可用岗位', dutyType: '值班类型', departmentId: '指定部门', departmentIds: '可用部门', assignmentType: '任职类型', isPrimary: '仅主部门任职' };
export function ConditionFields({ conditions = [], providers = [], onChange, requiredCodes = [] }) {
  function update(index, parameters) { onChange(conditions.map((item, i) => i === index ? { ...item, parameters } : item)); }
  return <div className="react-condition-fields">{conditions.map((condition, index) => {
    const provider = providers.find(item => item.code === condition.code);
    const parameters = condition.parameters || {};
    return <section className="react-binding" key={`${condition.code}-${index}`}><div className="react-heading"><strong>{provider?.description || condition.code}</strong>
      <button type="button" disabled={requiredCodes.includes(condition.code)} onClick={() => onChange(conditions.filter((_, i) => i !== index))}>移除条件</button></div>
      {Object.entries(provider?.parameterSchema?.properties || {}).map(([key, definition]) => definition.type === 'boolean' ?
        <label className="react-check" key={key}><input type="checkbox" checked={parameters[key] === true} onChange={event => update(index, { ...parameters, [key]: event.target.checked })} />{parameterLabels[key] || key}</label> :
        <label key={key}>{parameterLabels[key] || key}{definition.type === 'array' ? '（多个值用逗号分隔）' : ''}<input value={Array.isArray(parameters[key]) ? parameters[key].join(', ') : parameters[key] || ''} onChange={event => {
          const next = { ...parameters }, text = event.target.value;
          if (text.trim()) next[key] = definition.type === 'array' ? text.split(/[,，]/).map(item => item.trim()).filter(Boolean) : text;
          else delete next[key];
          update(index, next);
        }} /></label>)}
      {!provider && <p className="react-muted">此条件暂未提供编辑器，原配置会完整保留。</p>}
    </section>;
  })}<label>添加条件<select value="" onChange={event => {
    if (event.target.value) onChange([...conditions, { code: event.target.value, parameters: {} }]);
  }}><option value="">选择附加条件</option>{providers.filter(provider => !conditions.some(item => item.code === provider.code)).map(provider => <option key={provider.code} value={provider.code}>{provider.description}</option>)}</select></label></div>;
}
