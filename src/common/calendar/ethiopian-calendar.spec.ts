import {
  toEthiopianDate,
  toGregorianDate,
  formatEthiopianDate,
  toGeezNumber,
  isEthiopianLeapYear,
} from './ethiopian-calendar';

describe('Ethiopian Calendar Engine', () => {
  it('should convert September 11, 2024 to Meskerem 1, 2017 EC (Enkutatash)', () => {
    const gc = new Date(Date.UTC(2024, 8, 11)); // Month is 0-indexed (8 = Sept)
    const ec = toEthiopianDate(gc);
    expect(ec.year).toBe(2017);
    expect(ec.month).toBe(1); // Meskerem
    expect(ec.day).toBe(1);
  });

  it('should convert October 28, 2024 to 18 Tikimt 2017 EC (matching Stitch Receipt)', () => {
    const gc = new Date(Date.UTC(2024, 9, 28)); // 9 = Oct
    const ec = toEthiopianDate(gc);
    expect(ec.year).toBe(2017);
    expect(ec.month).toBe(2); // Tikimt
    expect(ec.day).toBe(18);
  });

  it('should convert Ethiopian Date back to Gregorian Date accurately', () => {
    const gc = toGregorianDate(2017, 2, 18);
    expect(gc.getUTCFullYear()).toBe(2024);
    expect(gc.getUTCMonth()).toBe(9); // October
    expect(gc.getUTCDate()).toBe(28);
  });

  it('should correctly format date in Amharic and English', () => {
    const ec = { year: 2017, month: 2, day: 18 };
    expect(formatEthiopianDate(ec, 'am')).toBe('ጥቅምት 18 ቀን 2017 ዓ.ም.');
    expect(formatEthiopianDate(ec, 'en')).toBe('18 Tikimt 2017 E.C.');
  });

  it('should convert numbers to Ge\'ez numerals correctly', () => {
    expect(toGeezNumber(1)).toBe('፩');
    expect(toGeezNumber(7)).toBe('፯');
    expect(toGeezNumber(10)).toBe('፲');
    expect(toGeezNumber(20)).toBe('፳');
    expect(toGeezNumber(25)).toBe('፳፭');
  });

  it('should identify leap years correctly', () => {
    // In Ethiopian calendar, 2015 EC was a leap year (Pagume had 6 days)
    expect(isEthiopianLeapYear(2015)).toBe(true);
    expect(isEthiopianLeapYear(2016)).toBe(false);
    expect(isEthiopianLeapYear(2017)).toBe(false);
    expect(isEthiopianLeapYear(2019)).toBe(true);
  });
});
