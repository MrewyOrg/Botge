import type { Guild, User } from 'discord.js';

type MemberIdentity = Readonly<{ user: Readonly<Pick<User, 'username'>> }>;

export function permitted(
  memberRolesCache: readonly (readonly [string, unknown])[],
  permittedRoleIds: readonly string[] | null
): boolean {
  return (
    permittedRoleIds !== null
    && memberRolesCache.some(([roleId]) => permittedRoleIds.includes(roleId))
  );
}

export function owner(
  member: Readonly<{ user: Readonly<Pick<User, 'id'>> }>,
  guild: Readonly<Pick<Guild, 'ownerId'>>
): boolean {
  return member.user.id === guild.ownerId;
}

export function globalAdministrator(member: MemberIdentity): boolean {
  const { username } = member.user;

  return username === 'gentlebob' || username === 'mrewy2';
}
