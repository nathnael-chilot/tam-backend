import {
  toSantims,
  fromSantims,
  formatETB,
  amountInWordsEnglish,
  amountInWordsAmharic,
} from './money';

describe('Money Engine', () => {
  it('should convert ETB to Santims and back without float precision loss', () => {
    expect(toSantims('4,500.00')).toBe(450000n);
    expect(toSantims(12.34)).toBe(1234n);
    expect(fromSantims(450000n)).toBe(4500.0);
  });

  it('should format amounts in ETB correctly', () => {
    expect(formatETB(450000n)).toBe('4,500.00 Br');
    expect(formatETB(150000n)).toBe('1,500.00 Br');
  });

  it('should generate English amount in words', () => {
    expect(amountInWordsEnglish(450000n)).toBe('Four Thousand Five Hundred Birr');
    expect(amountInWordsEnglish(150050n)).toBe('One Thousand Five Hundred Birr and Fifty Cents');
  });

  it('should generate Amharic amount in words', () => {
    expect(amountInWordsAmharic(450000n)).toBe('አራት ሺህ አምስት መቶ ብር');
    expect(amountInWordsAmharic(150000n)).toBe('አንድ ሺህ አምስት መቶ ብር');
  });
});
