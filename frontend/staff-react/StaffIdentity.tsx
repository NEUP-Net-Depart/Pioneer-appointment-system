import React from 'react';

export type Identity = { code: string; label: string };
export function StaffIdentity({ identities = [] }: { identities?: Identity[] }) {
  return identities.length ? (
    <span className="staff-identities">
      {identities.map((identity) => (
        <span
          data-motion-item={identity.code}
          className="staff-identity"
          data-identity={identity.code}
          key={identity.code}
        >
          <span data-motion-value="text">{identity.label}</span>
        </span>
      ))}
    </span>
  ) : null;
}
