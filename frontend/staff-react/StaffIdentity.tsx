import React from 'react';

export type Identity = { code: string; label: string };
export function StaffIdentity({ identities = [] }: { identities?: Identity[] }) {
  return identities.length ? (
    <span className="staff-identities">
      {identities.map((identity) => (
        <span className="staff-identity" data-identity={identity.code} key={identity.code}>
          {identity.label}
        </span>
      ))}
    </span>
  ) : null;
}
