import { Select } from './SelectionControls.jsx';
import React from 'react';
import { additionalMembershipLabels } from '../../shared/staff-organization.js';

// Shared by role grants and member bindings. Unknown extension fields survive edits.
export function ScopeFields({
  value = {},
  onChange,
  campuses = [],
  departments = [],
  kinds = ['campus', 'department'],
  inherit = '沿用角色范围'
}) {
  function update(key, alias, next) {
    const scope = { ...value };
    delete scope[key];
    delete scope[alias];
    delete scope.all;
    if (next !== null) scope[key] = next;
    onChange(scope);
  }
  return (
    <div className="react-scope-fields">
      {[
        ['campus', 'campusIds', 'campuses', '校区', campuses],
        ['department', 'departmentIds', 'departments', '部门', departments]
      ]
        .filter(([kind]) => kinds.includes(kind))
        .map(([, key, alias, label, options]) => {
          const values = value[key] ?? value[alias];
          const explicit = Array.isArray(values);
          return (
            <fieldset key={key}>
              <legend>{label}范围</legend>
              <label className="react-check">
                <input
                  data-track="staff.scopefields.input.1"
                  type="checkbox"
                  checked={!explicit}
                  onChange={(event) => update(key, alias, event.target.checked ? null : [])}
                />
                {inherit}
              </label>
              {explicit && (
                <>
                  <div className="react-campus-options">
                    {options.map((option) => (
                      <label className="react-check" key={option.id}>
                        <input
                          data-track="staff.scopefields.input.2"
                          type="checkbox"
                          checked={values.includes(option.id)}
                          onChange={(event) =>
                            update(
                              key,
                              alias,
                              event.target.checked
                                ? [...values, option.id]
                                : values.filter((id) => id !== option.id)
                            )
                          }
                        />
                        {option.name}
                      </label>
                    ))}
                  </div>
                  {!values.length && (
                    <p data-motion-value="text" className="react-muted">
                      尚未选择{label}，此范围不会匹配任何成员。
                    </p>
                  )}
                </>
              )}
            </fieldset>
          );
        })}
    </div>
  );
}

const parameterLabels = {
  kind: '指定岗位',
  roleKinds: '可用岗位',
  dutyType: '值班类型',
  departmentId: '指定部门',
  departmentIds: '可用部门',
  assignmentType: '任职类型',
  isPrimary: '仅主部门任职'
};
export function ConditionFields({
  conditions = [],
  providers = [],
  onChange,
  requiredCodes = [],
  departments = []
}) {
  function update(index, parameters) {
    onChange(conditions.map((item, i) => (i === index ? { ...item, parameters } : item)));
  }
  return (
    <div className="react-condition-fields">
      {conditions.map((condition, index) => {
        const provider = providers.find((item) => item.code === condition.code);
        const parameters = condition.parameters || {};
        return (
          <section data-motion-item="" className="react-binding" key={`${condition.code}-${index}`}>
            <div className="react-heading">
              <strong data-motion-value="text">{provider?.description || condition.code}</strong>
              <button
                data-track="staff.scopefields.button.3"
                type="button"
                disabled={requiredCodes.includes(condition.code)}
                onClick={() => onChange(conditions.filter((_, i) => i !== index))}
              >
                移除条件
              </button>
            </div>
            {Object.entries(provider?.parameterSchema?.properties || {}).map(([key, definition]) =>
              key === 'departmentIds' ? (
                <fieldset key={key}>
                  <legend>{parameterLabels[key]}</legend>
                  <button
                    data-track="staff.scopefields.button.7"
                    type="button"
                    aria-pressed={!parameters[key]?.length}
                    onClick={() => {
                      const next = { ...parameters };
                      delete next[key];
                      update(index, next);
                    }}
                  >
                    不限部门
                  </button>
                  {[
                    ...departments,
                    ...(parameters[key] || [])
                      .filter((id) => !departments.some((department) => department.id === id))
                      .map((id) => ({ id, name: id }))
                  ].map((department) => (
                    <label className="react-check" key={department.id}>
                      <input
                        data-track="staff.scopefields.input.8"
                        type="checkbox"
                        checked={(parameters[key] || []).includes(department.id)}
                        onChange={(event) => {
                          const selected = event.target.checked
                            ? [...(parameters[key] || []), department.id]
                            : (parameters[key] || []).filter((id) => id !== department.id);
                          const next = { ...parameters };
                          if (selected.length) next[key] = selected;
                          else delete next[key];
                          update(index, next);
                        }}
                      />
                      {department.name}
                    </label>
                  ))}
                </fieldset>
              ) : ['departmentId', 'assignmentType'].includes(key) ? (
                <label key={key}>
                  {parameterLabels[key]}
                  <Select
                    data-track="staff.scopefields.select.9"
                    value={parameters[key] || ''}
                    onChange={(event) => {
                      const next = { ...parameters };
                      if (event.target.value) next[key] = event.target.value;
                      else delete next[key];
                      update(index, next);
                    }}
                  >
                    <option value="">不限</option>
                    {key === 'departmentId'
                      ? departments.map((department) => (
                          <option key={department.id} value={department.id}>
                            {department.name}
                          </option>
                        ))
                      : Object.entries({
                          primary: '正式部门任职',
                          ...additionalMembershipLabels
                        }).map(([code, name]) => (
                          <option key={code} value={code}>
                            {name}
                          </option>
                        ))}
                    {parameters[key] &&
                      !(key === 'departmentId'
                        ? departments.some((department) => department.id === parameters[key])
                        : ['primary', ...Object.keys(additionalMembershipLabels)].includes(
                            parameters[key]
                          )) && <option value={parameters[key]}>{parameters[key]}</option>}
                  </Select>
                </label>
              ) : key === 'isPrimary' ? (
                <label key={key}>
                  任职范围
                  <Select
                    data-track="staff.scopefields.select.10"
                    value={parameters[key] === undefined ? '' : String(parameters[key])}
                    onChange={(event) => {
                      const next = { ...parameters };
                      if (event.target.value === '') delete next[key];
                      else next[key] = event.target.value === 'true';
                      update(index, next);
                    }}
                  >
                    <option value="">不限</option>
                    <option value="true">正式部门任职</option>
                    <option value="false">独立身份</option>
                  </Select>
                </label>
              ) : definition.type === 'boolean' ? (
                <label className="react-check" key={key}>
                  <input
                    data-track="staff.scopefields.input.4"
                    type="checkbox"
                    checked={parameters[key] === true}
                    onChange={(event) =>
                      update(index, { ...parameters, [key]: event.target.checked })
                    }
                  />
                  {parameterLabels[key] || key}
                </label>
              ) : (
                <label key={key}>
                  {parameterLabels[key] || key}
                  {definition.type === 'array' ? '（多个值用逗号分隔）' : ''}
                  <input
                    data-track="staff.scopefields.input.5"
                    value={
                      Array.isArray(parameters[key])
                        ? parameters[key].join(', ')
                        : parameters[key] || ''
                    }
                    onChange={(event) => {
                      const next = { ...parameters },
                        text = event.target.value;
                      if (text.trim())
                        next[key] =
                          definition.type === 'array'
                            ? text
                                .split(/[,，]/)
                                .map((item) => item.trim())
                                .filter(Boolean)
                            : text;
                      else delete next[key];
                      update(index, next);
                    }}
                  />
                </label>
              )
            )}
            {!provider && <p className="react-muted">此条件暂未提供编辑器，原配置会完整保留。</p>}
          </section>
        );
      })}
      <label>
        添加条件
        <Select
          data-track="staff.scopefields.select.6"
          value=""
          onChange={(event) => {
            if (event.target.value)
              onChange([...conditions, { code: event.target.value, parameters: {} }]);
          }}
        >
          <option value="">选择附加条件</option>
          {providers
            .filter((provider) => !conditions.some((item) => item.code === provider.code))
            .map((provider) => (
              <option key={provider.code} value={provider.code}>
                {provider.description}
              </option>
            ))}
        </Select>
      </label>
    </div>
  );
}
