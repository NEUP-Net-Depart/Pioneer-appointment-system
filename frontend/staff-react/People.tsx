import type { StaffProfileDto } from '../../shared/staff-types.ts';
import { useContext, useState } from 'react';
import { ActivityContext } from './field/ui';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceSections } from './WorkspaceSections';
import { staffPermission } from '../../shared/staff-access.ts';
import { Members } from './Members.tsx';
import { Accounts } from './Accounts.tsx';

export function People({ user }: { user: StaffProfileDto }) {
  const active = useContext(ActivityContext);
  const canManageMembers = staffPermission(user, 'members.manage');
  const sections = [
    ...(canManageMembers ? [{ id: 'members', label: '人员列表' }] : []),
    ...(staffPermission(user, 'accounts.manage') ? [{ id: 'accounts', label: '激活与账号' }] : [])
  ];
  const [selected, setSelected] = useState(sections[0]?.id),
    [visited, setVisited] = useState([sections[0]?.id]);
  const section = sections.some((item) => item.id === selected) ? selected : sections[0]?.id;
  return (
    <section className="react-page people-workspace">
      <WorkspaceHeader group="人员权限" title="人员管理" />
      <WorkspaceSections
        label="人员管理功能"
        items={sections}
        value={section}
        onChange={(id) => {
          setSelected(id);
          setVisited((current) => [...new Set([...current, id])]);
        }}
      />
      {sections
        .filter((item) => visited.includes(item.id) || item.id === section)
        .map((item) => (
          <ActivityContext.Provider key={item.id} value={active && section === item.id}>
            <div hidden={section !== item.id}>
              {item.id === 'members' ? <Members user={user} /> : <Accounts user={user} embedded />}
            </div>
          </ActivityContext.Provider>
        ))}
    </section>
  );
}
