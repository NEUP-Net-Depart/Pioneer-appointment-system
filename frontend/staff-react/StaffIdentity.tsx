import type { IdentityLabel } from '../../shared/staff-types.ts';

export type Identity = IdentityLabel;
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
