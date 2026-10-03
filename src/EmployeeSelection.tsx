import { useEffect, useRef, useState } from 'react';
import type { Employee, EmployeeGroup } from '../shared/model';
import { FormError } from './ui';

function SelectionCheck({ checked, partial, disabled, label, onChange }: { checked: boolean; partial: boolean; disabled?: boolean; label: string; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = partial; }, [partial]);
  return <input ref={ref} type="checkbox" aria-label={label} aria-checked={partial ? 'mixed' : checked} checked={checked} disabled={disabled} onChange={onChange} />;
}

export default function EmployeeSelection({ employees, groups = [], selected, onChange, limit = 100 }: { employees: Employee[]; groups?: EmployeeGroup[]; selected: string[]; onChange: (ids: string[]) => void; limit?: number }) {
  const [error, setError] = useState('');
  const available = employees.filter(e => !e.archived);
  const availableIds = available.map(e => e.id);
  const toggle = (ids: string[]) => {
    const all = ids.length > 0 && ids.every(id => selected.includes(id));
    const next = all ? selected.filter(id => !ids.includes(id)) : [...new Set([...selected, ...ids])];
    if (next.length > limit) { setError('本次最多关联 ' + limit + ' 位员工，请缩小选择范围。'); return; }
    setError(''); onChange(next);
  };
  const check = (ids: string[], label: string) => <SelectionCheck label={label} checked={ids.length > 0 && ids.every(id => selected.includes(id))} partial={ids.some(id => selected.includes(id)) && !ids.every(id => selected.includes(id))} disabled={!ids.length} onChange={() => toggle(ids)} />;
  return <div className="employee-selection">
    <label className="selection-all">{check(availableIds, '全选当前员工')}<span>全选当前员工</span><small>已选 {selected.filter(id => availableIds.includes(id)).length} 人</small></label>
    {groups.length > 0 && <fieldset className="selection-section"><legend>按分组选择</legend>{groups.map(group => {
      const ids = group.employeeIds.filter(id => availableIds.includes(id));
      return <label className="selection-group" key={group.id}>{check(ids, '选择分组：' + group.name)}<span>{group.name}</span><small>{ids.length} 人</small></label>;
    })}</fieldset>}
    <fieldset className="selection-section"><legend>按员工选择</legend>{available.length ? available.map(employee => <label className="employee-option" key={employee.id}>
      <input type="checkbox" aria-label={'选择员工：' + (employee.nickname || employee.alias) + ' · ' + employee.alias} checked={selected.includes(employee.id)} onChange={() => toggle([employee.id])} />
      <span><strong>{employee.nickname || employee.alias}<small className="employee-alias"> {employee.alias}</small></strong><small>{employee.role || '未填写职责'} · {employee.description}</small></span>
    </label>) : <p className="empty-profiles">还没有当前员工，可以新建画像，也可以不关联直接分析。</p>}</fieldset>
    <FormError message={error} />
  </div>;
}
