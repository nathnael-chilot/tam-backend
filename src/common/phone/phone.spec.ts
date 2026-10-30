import { normalizeEthiopianPhone } from './phone';

describe('Ethiopian Phone Normalizer', () => {
  it('should normalize local Ethio Telecom numbers', () => {
    const res = normalizeEthiopianPhone('0911223344');
    expect(res.isValid).toBe(true);
    expect(res.normalized).toBe('+251911223344');
    expect(res.carrier).toBe('ETHIO_TELECOM');
  });

  it('should normalize Safaricom Ethiopia numbers', () => {
    const res = normalizeEthiopianPhone('0711223344');
    expect(res.isValid).toBe(true);
    expect(res.normalized).toBe('+251711223344');
    expect(res.carrier).toBe('SAFARICOM');
  });

  it('should handle already formatted numbers with spaces and dashes', () => {
    const res = normalizeEthiopianPhone('+251 911-22-33-44');
    expect(res.isValid).toBe(true);
    expect(res.normalized).toBe('+251911223344');
  });

  it('should reject invalid numbers', () => {
    expect(normalizeEthiopianPhone('0811223344').isValid).toBe(false);
    expect(normalizeEthiopianPhone('09112233').isValid).toBe(false);
    expect(normalizeEthiopianPhone('').isValid).toBe(false);
  });
});
