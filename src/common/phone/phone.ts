/**
 * Ethiopian Phone Number Normalizer & Validator
 * Supports Ethio Telecom (+2519...) and Safaricom Ethiopia (+2517...) prefixes.
 */

export interface PhoneValidationResult {
  isValid: boolean;
  normalized?: string;
  carrier?: 'ETHIO_TELECOM' | 'SAFARICOM' | 'UNKNOWN';
  error?: string;
}

export function normalizeEthiopianPhone(input: string): PhoneValidationResult {
  if (!input) {
    return { isValid: false, error: 'Phone number cannot be empty' };
  }

  // Remove spaces, hyphens, parentheses
  let cleaned = input.trim().replace(/[\s\-\(\)]/g, '');

  // Handle prefix variations:
  // "0911223344" -> "+251911223344"
  // "0711223344" -> "+251711223344"
  // "911223344" -> "+251911223344"
  // "251911223344" -> "+251911223344"
  // "+251911223344" -> "+251911223344"

  if (cleaned.startsWith('+251')) {
    cleaned = cleaned.slice(4);
  } else if (cleaned.startsWith('251')) {
    cleaned = cleaned.slice(3);
  } else if (cleaned.startsWith('0')) {
    cleaned = cleaned.slice(1);
  }

  // Check valid remaining 9 digits starting with 9 or 7
  if (!/^[79]\d{8}$/.test(cleaned)) {
    return {
      isValid: false,
      error: 'Invalid Ethiopian mobile number. Expected 9 digits starting with 9 or 7.',
    };
  }

  const carrier = cleaned.startsWith('9') ? 'ETHIO_TELECOM' : 'SAFARICOM';
  const normalized = `+251${cleaned}`;

  return {
    isValid: true,
    normalized,
    carrier,
  };
}
