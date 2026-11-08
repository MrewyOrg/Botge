export function booleanToAllowed(allowed: boolean): string {
  return allowed ? 'allowed' : 'not allowed';
}

export function booleanToString(value: boolean): string {
  return value ? 'Yes' : 'No';
}

export function stringToBoolean(label: string): boolean {
  return label === 'Yes';
}

export function booleanToEnabled(enabled: boolean): string {
  return enabled ? 'Enabled' : 'Disabled';
}
