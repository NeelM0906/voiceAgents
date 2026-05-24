export function normalizePhoneE164(value: string | undefined | null): string | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const withoutScheme = trimmed.replace(/^(sip:|tel:)/i, '');
  const userPart = withoutScheme.split('@')[0]?.trim();

  if (!userPart) {
    return null;
  }

  const normalized = userPart.startsWith('+')
    ? `+${userPart.slice(1).replace(/\D/g, '')}`
    : `+${userPart.replace(/\D/g, '')}`;

  return /^\+[1-9]\d{1,14}$/.test(normalized) ? normalized : null;
}
